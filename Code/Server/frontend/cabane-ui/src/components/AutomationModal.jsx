import React, { useState, useEffect } from 'react';
import { Play, X, List, Power, Clock, CheckCircle } from 'lucide-react';
import axios from 'axios';
import { useModal } from '../contexts/ModalContext';
import { clsx } from 'clsx';
import { useTranslation } from 'react-i18next';

const API_URL = import.meta.env.PROD ? '' : (import.meta.env.VITE_API_URL || 'http://localhost:3000');

export const AutomationModal = ({ isOpen, onClose }) => {
    const { t } = useTranslation();
    const { showConfirm, showAlert } = useModal();
    const [shutdownEnabled, setShutdownEnabled] = useState(false);
    const [shutdownDuration, setShutdownDuration] = useState(60);

    // Load defaults
    useEffect(() => {
        if (isOpen) {
            const token = localStorage.getItem('cabane_token');
            axios.get(`${API_URL}/api/automation/status`, { headers: { Authorization: `Bearer ${token}` } })
                .then(res => {
                    if (res.data.defaultConfig?.shutdown_timer_min) {
                        setShutdownDuration(res.data.defaultConfig.shutdown_timer_min);
                    }
                });
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const handleStart = () => {
        const confirmMsg = shutdownEnabled
            ? t('automation.confirm_shutdown', { duration: shutdownDuration })
            : t('automation.confirm_start');

        showConfirm({
            title: t('automation.start_title'),
            message: confirmMsg,
            isDestructive: false,
            onConfirm: async () => {
                try {
                    const token = localStorage.getItem('cabane_token');
                    await axios.post(`${API_URL}/api/automation/start`, {
                        shutdownEnabled,
                        shutdownDuration
                    }, { headers: { Authorization: `Bearer ${token}` } });
                    onClose();
                } catch (e) {
                    showAlert(t('common.error'), e.response?.data?.error || "Failed");
                }
            }
        });
    };

    const BranchInfo = ({ label, steps }) => (
        <div className="bg-gray-800 p-3 rounded border border-gray-700">
            <h4 className="text-xs font-bold text-gray-400 mb-2 uppercase">{label}</h4>
            <div className="space-y-1">
                {steps.map((s, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs text-gray-500">
                        <div className="w-1.5 h-1.5 rounded-full bg-gray-600" /><span>{s}</span>
                    </div>
                ))}
            </div>
        </div>
    );

    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[70] flex items-center justify-center p-4 animate-in fade-in" onClick={onClose}>
            <div className="bg-gray-900 border border-gray-700 w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]" onClick={e => e.stopPropagation()}>

                <div className="p-5 border-b border-gray-800 flex justify-between items-center bg-gray-850">
                    <h3 className="text-lg font-bold text-white flex items-center gap-2"><List className="text-purple-400" /> {t('automation.title')}</h3>
                    <button onClick={onClose}><X size={24} className="text-gray-400 hover:text-white" /></button>
                </div>

                <div className="p-6 space-y-6 overflow-y-auto">
                    <div className="space-y-3">
                        <BranchInfo label="Branch 1: Main (ST1-ST2-ST3)" steps={["Start/Drain T2", "Drain ST2-3", "Drain ST1-2", "Drain T1", "Finish"]} />
                        <BranchInfo label="Branch 2: Station 4" steps={["Start", "Drain", "Finish"]} />
                        <BranchInfo label="Branch 3: Station 5" steps={["Start", "Drain", "Finish"]} />
                    </div>

                    {/* ✅ RED SHUTDOWN OPTION */}
                    <div className={clsx("p-4 rounded-xl border-2 transition-all", shutdownEnabled ? "bg-red-900/20 border-red-500" : "bg-gray-800 border-gray-700")}>
                        <div className="flex items-center justify-between cursor-pointer" onClick={() => setShutdownEnabled(!shutdownEnabled)}>
                            <div className="flex items-center gap-3">
                                <div className={clsx("p-2 rounded-full", shutdownEnabled ? "bg-red-500 text-white" : "bg-gray-700 text-gray-400")}>
                                    <Power size={20} />
                                </div>
                                <div className="flex flex-col">
                                    <span className={clsx("font-bold text-sm", shutdownEnabled ? "text-white" : "text-gray-400")}>{t('automation.auto_shutdown')}</span>
                                    <span className="text-[10px] text-gray-500">{t('automation.shutdown_desc')}</span>
                                </div>
                            </div>
                            <div className={clsx("w-6 h-6 rounded border flex items-center justify-center transition-colors", shutdownEnabled ? "bg-red-500 border-red-500" : "border-gray-600")}>
                                {shutdownEnabled && <CheckCircle size={16} className="text-white" />}
                            </div>
                        </div>

                        {shutdownEnabled && (
                            <div className="mt-4 pt-4 border-t border-red-500/30 flex items-center justify-between animate-in slide-in-from-top-2">
                                <label className="text-xs font-bold text-red-200 uppercase">{t('automation.delay_min')}</label>
                                <div className="flex items-center gap-2">
                                    <Clock size={16} className="text-red-400" />
                                    <input type="number" min="1" max="120" value={shutdownDuration} onChange={e => setShutdownDuration(e.target.value)} className="w-20 bg-black border border-red-500 rounded p-2 text-center text-white font-bold outline-none focus:ring-2 focus:ring-red-500" />
                                </div>
                            </div>
                        )}
                        {shutdownEnabled && <p className="text-[10px] text-red-300 mt-2 text-center italic">*{t('automation.timer_note')}</p>}
                    </div>

                    <button onClick={handleStart} className="w-full py-4 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded-lg shadow-lg flex items-center justify-center gap-2 transition-transform active:scale-95 text-lg">
                        <Play size={20} /> {t('automation.start_seq')}
                    </button>
                </div>
            </div>
        </div>
    );
};