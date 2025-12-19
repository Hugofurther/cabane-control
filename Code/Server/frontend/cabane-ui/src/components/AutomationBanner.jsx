import React, { useState, useEffect } from 'react';
import { Play, Pause, Square, Clock, CheckCircle, AlertTriangle, Loader2 } from 'lucide-react';
import axios from 'axios';
import { useSocket } from '../contexts/SocketContext';
import { clsx } from 'clsx';

const API_URL = import.meta.env.PROD ? '' : (import.meta.env.VITE_API_URL || 'http://localhost:3000');

const formatTime = (ms) => {
    if (ms <= 0) return "00:00";
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    return `${m}:${(s % 60).toString().padStart(2, '0')}`;
};

export const AutomationBanner = () => {
    const { socket } = useSocket();
    const [status, setStatus] = useState({ active: false, paused: false, branches: {} });
    const [now, setNow] = useState(Date.now());

    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 1000);
        const token = localStorage.getItem('cabane_token');
        if (token) axios.get(`${API_URL}/api/automation/status`, { headers: { Authorization: `Bearer ${token}` } }).then(res => setStatus(res.data));

        const handleUpdate = (data) => setStatus(data);
        socket?.on('AUTO_UPDATE', handleUpdate);
        return () => { clearInterval(timer); socket?.off('AUTO_UPDATE', handleUpdate); };
    }, [socket]);

    if (!status.active && Object.values(status.branches || {}).every(b => !b.active)) return null;

    const token = localStorage.getItem('cabane_token');
    const handlePause = () => axios.post(`${API_URL}/api/automation/pause`, {}, { headers: { Authorization: `Bearer ${token}` } });
    const handleResume = () => axios.post(`${API_URL}/api/automation/resume`, {}, { headers: { Authorization: `Bearer ${token}` } });
    const handleStop = () => axios.post(`${API_URL}/api/automation/stop`, {}, { headers: { Authorization: `Bearer ${token}` } });

    const BranchStatus = ({ id, label, b }) => {
        if (!b) return null;
        let icon = <Loader2 size={12} className="animate-spin text-blue-400" />;
        let color = "text-blue-300";
        let text = `Step ${b.step}`;

        if (b.status === 'DONE') { icon = <CheckCircle size={12} className="text-green-500" />; color = "text-green-400"; text = "Done"; }
        else if (b.status === 'ERROR') { icon = <AlertTriangle size={12} className="text-red-500" />; color = "text-red-400"; text = "Error"; }
        else if (b.timerEnd > 0) {
            const rem = Math.max(0, b.timerEnd - now);
            text = `Timer: ${formatTime(rem)}`;
        }

        return (
            <div className="flex items-center justify-between text-xs bg-black/20 px-2 py-1 rounded">
                <span className="font-bold text-gray-400">{label}</span>
                <div className={`flex items-center gap-2 ${color}`}>
                    {icon} <span>{text}</span>
                </div>
            </div>
        );
    };

    return (
        <div className="fixed bottom-0 left-0 right-0 bg-gray-900 border-t border-purple-500/50 shadow-2xl p-4 z-[60] flex flex-col md:flex-row items-start md:items-center justify-between gap-4 animate-in slide-in-from-bottom-full">

            {/* LEFT: Info */}
            <div className="flex items-center gap-4 flex-grow min-w-0 w-full md:w-auto">
                <div className={clsx("p-3 rounded-full animate-pulse hidden md:block", status.paused ? "bg-yellow-900/20 text-yellow-500" : "bg-purple-900/20 text-purple-400")}>
                    {status.paused ? <Pause size={24} /> : <Clock size={24} />}
                </div>
                <div className="flex flex-col gap-1 w-full">
                    <div className="flex justify-between items-center">
                        <span className="font-black text-white uppercase tracking-widest text-sm">
                            {status.paused ? "PAUSED" : "DRAINAGE ACTIVE"}
                        </span>
                        <span className="text-xs font-mono text-gray-500">{formatTime(now - status.startTime)}</span>
                    </div>

                    {/* Compact Branch List */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2 w-full">
                        <BranchStatus id={1} label="B1: Main" b={status.branches[1]} />
                        <BranchStatus id={2} label="B2: ST4" b={status.branches[2]} />
                        <BranchStatus id={3} label="B3: ST5" b={status.branches[3]} />
                    </div>
                </div>
            </div>

            {/* RIGHT: Controls */}
            <div className="flex items-center gap-2 shrink-0 w-full md:w-auto justify-end">
                {status.paused ? (
                    <button onClick={handleResume} className="px-4 py-2 bg-green-600 hover:bg-green-500 text-white rounded font-bold flex items-center gap-2 shadow-lg">
                        <Play size={16} /> RESUME
                    </button>
                ) : (
                    <button onClick={handlePause} className="px-4 py-2 bg-yellow-600 hover:bg-yellow-500 text-black rounded font-bold flex items-center gap-2 shadow-lg">
                        <Pause size={16} /> PAUSE
                    </button>
                )}
                <button onClick={handleStop} className="px-4 py-2 bg-red-900/50 hover:bg-red-900 text-red-200 border border-red-800 rounded font-bold flex items-center gap-2">
                    <Square size={16} /> STOP
                </button>
            </div>
        </div>
    );
};