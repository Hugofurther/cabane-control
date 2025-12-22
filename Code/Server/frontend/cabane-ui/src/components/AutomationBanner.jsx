import React, { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { Play, Pause, Square, Clock, CheckCircle, AlertTriangle, Loader2, Power } from 'lucide-react';
import axios from 'axios';
import { useSocket } from '../contexts/SocketContext';
import { clsx } from 'clsx';
import { useTranslation } from 'react-i18next';

const API_URL = import.meta.env.PROD ? '' : (import.meta.env.VITE_API_URL || 'http://localhost:3000');

const formatTime = (ms) => {
    if (ms <= 0) return "00:00";
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    return `${m}:${(s % 60).toString().padStart(2, '0')}`;
};

export const AutomationBanner = () => {
    const { t } = useTranslation();
    const { socket, setBannerHeight } = useSocket(); // ✅ Get Setter from Context
    const [status, setStatus] = useState({ active: false, paused: false, mode: 'SEQUENCE', branches: {} });
    const [now, setNow] = useState(Date.now());
    const bannerRef = useRef(null);

    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 1000);

        const token = localStorage.getItem('cabane_token');
        if (token) axios.get(`${API_URL}/api/automation/status`, { headers: { Authorization: `Bearer ${token}` } }).then(res => setStatus(res.data));

        const handleUpdate = (data) => setStatus(data);
        socket?.on('AUTO_UPDATE', handleUpdate);
        return () => {
            clearInterval(timer);
            socket?.off('AUTO_UPDATE', handleUpdate);
        };
    }, [socket]);

    // ✅ REPORT HEIGHT TO CONTEXT (Clean)
    useLayoutEffect(() => {
        if (!status.active) {
            setBannerHeight(0);
            return;
        }
        if (bannerRef.current) {
            const observer = new ResizeObserver(entries => {
                for (let entry of entries) {
                    const height = entry.borderBoxSize ? entry.borderBoxSize[0].blockSize : entry.target.offsetHeight;
                    setBannerHeight(height);
                }
            });
            observer.observe(bannerRef.current);
            return () => observer.disconnect();
        }
    }, [status.active, setBannerHeight]);

    if (!status.active) return null;

    const token = localStorage.getItem('cabane_token');
    const handlePause = () => axios.post(`${API_URL}/api/automation/pause`, {}, { headers: { Authorization: `Bearer ${token}` } });
    const handleResume = () => axios.post(`${API_URL}/api/automation/resume`, {}, { headers: { Authorization: `Bearer ${token}` } });
    const handleStop = () => axios.post(`${API_URL}/api/automation/stop`, {}, { headers: { Authorization: `Bearer ${token}` } });

    if (status.mode === 'SHUTDOWN_ONLY' || status.mode === 'SHUTDOWN_WAIT') {
        const remaining = Math.max(0, status.globalTimerEnd - now);
        return (
            <div ref={bannerRef} className="fixed bottom-0 left-0 right-0 bg-red-900 border-t-4 border-red-500 shadow-[0_-5px_20px_rgba(220,38,38,0.5)] p-4 z-[100] flex flex-col md:flex-row items-center justify-between gap-4 animate-in slide-in-from-bottom-full">
                <div className="flex items-center gap-6">
                    <div className="p-4 bg-black/40 rounded-full animate-pulse border-2 border-red-400">
                        <Power size={32} className="text-white" />
                    </div>
                    <div>
                        <div className="font-black text-white uppercase tracking-widest text-lg md:text-xl">
                            {status.mode === 'SHUTDOWN_WAIT' ? t('automation.drainage_complete') : t('automation.shutdown_active')}
                        </div>
                        <div className="text-sm text-red-200 font-bold uppercase tracking-wide mb-1">
                            {t('automation.shutdown_countdown')}
                        </div>
                        <div className="text-4xl font-mono font-black text-white tabular-nums tracking-tighter">
                            {formatTime(remaining)}
                        </div>
                    </div>
                </div>
                <button onClick={handleStop} className="px-8 py-4 bg-white text-red-900 rounded-xl font-black hover:bg-gray-200 shadow-xl uppercase tracking-wider transition-transform active:scale-95">
                    {t('automation.cancel_shutdown')}
                </button>
            </div>
        );
    }

    const totalElapsed = status.startTime ? now - status.startTime : 0;
    const BranchStatus = ({ id, label, b }) => {
        if (!b) return null;
        let icon = <Loader2 size={14} className="animate-spin text-blue-400" />;
        let color = "text-blue-300 border-blue-500/30 bg-blue-900/20";
        const stepDesc = t(`automation.steps.b${id}_s${b.step}`, { defaultValue: '' });
        let text = `${t('automation.step')} ${b.step}: ${stepDesc}`;

        if (b.status === 'DONE') { icon = <CheckCircle size={14} className="text-green-500" />; color = "text-green-400 border-green-500/30 bg-green-900/20"; text = t('common.done'); }
        else if (b.status === 'ERROR') { icon = <AlertTriangle size={14} className="text-red-500" />; color = "text-red-400 border-red-500/30 bg-red-900/20"; text = `${t('common.error')}: ${b.error || ''}`; }
        else if (b.timerEnd > 0) { const rem = Math.max(0, b.timerEnd - now); text = `${stepDesc} (${formatTime(rem)})`; }

        return (
            <div className={`flex items-center justify-between text-xs px-3 py-2 rounded border ${color}`}>
                <span className="font-bold opacity-80 whitespace-nowrap mr-2">{label}</span>
                <div className="flex items-center gap-2 font-mono font-bold overflow-hidden">
                    <span className="shrink-0">{icon}</span>
                    <span className="truncate">{text}</span>
                </div>
            </div>
        );
    };

    return (
        <div ref={bannerRef} className="fixed bottom-0 left-0 right-0 bg-gray-900 border-t border-purple-500/50 shadow-2xl p-4 z-[100] flex flex-col md:flex-row items-start md:items-center justify-between gap-4 animate-in slide-in-from-bottom-full">
            <div className="flex items-center gap-4 flex-grow min-w-0 w-full md:w-auto">
                <div className={clsx("p-3 rounded-full animate-pulse hidden md:block", status.paused ? "bg-yellow-900/20 text-yellow-500" : "bg-purple-900/20 text-purple-400")}>
                    {status.paused ? <Pause size={24} /> : <Clock size={24} />}
                </div>
                <div className="flex flex-col gap-2 w-full">
                    <div className="flex justify-between items-center">
                        <div className="flex items-center gap-3">
                            <span className="font-black text-white uppercase tracking-widest text-sm">{status.paused ? t('automation.paused') : t('automation.active')}</span>
                            {status.shutdownPending && (<span className="text-[10px] bg-red-900/80 text-white border border-red-500 px-2 py-0.5 rounded font-bold flex items-center gap-1"><Power size={10} /> {t('automation.auto_off')}</span>)}
                        </div>
                        <span className="text-xs font-mono text-gray-500">{formatTime(totalElapsed)}</span>
                    </div>
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-2 w-full">
                        <BranchStatus id={1} label={t('automation.b1_short')} b={status.branches[1]} />
                        <BranchStatus id={2} label={t('automation.b2_short')} b={status.branches[2]} />
                        <BranchStatus id={3} label={t('automation.b3_short')} b={status.branches[3]} />
                    </div>
                </div>
            </div>
            <div className="flex items-center gap-2 shrink-0 w-full md:w-auto justify-end mt-2 md:mt-0">
                {status.paused ? (
                    <button onClick={handleResume} className="px-6 py-2 bg-green-600 hover:bg-green-500 text-white rounded font-bold flex items-center gap-2 shadow-lg"><Play size={16} /> {t('automation.resume')}</button>
                ) : (
                    <button onClick={handlePause} className="px-6 py-2 bg-yellow-600 hover:bg-yellow-500 text-black rounded font-bold flex items-center gap-2 shadow-lg"><Pause size={16} /> {t('automation.paused')}</button>
                )}
                <button onClick={handleStop} className="px-6 py-2 bg-red-900/50 hover:bg-red-900 text-red-200 border border-red-800 rounded font-bold flex items-center gap-2"><Square size={16} /> {t('automation.stop')}</button>
            </div>
        </div>
    );
};