import React, { useState } from 'react';
import { Power, Clock, X } from 'lucide-react';
import axios from 'axios';
import { useModal } from '../contexts/ModalContext';

const API_URL = import.meta.env.PROD ? '' : (import.meta.env.VITE_API_URL || 'http://localhost:3000');

export const ShutdownModal = ({ isOpen, onClose }) => {
    const { showConfirm, showAlert } = useModal();
    const [duration, setDuration] = useState(60);

    if (!isOpen) return null;

    const handleStart = () => {
        showConfirm({
            title: "Schedule Shutdown?",
            message: `System will turn OFF completely in ${duration} minutes.`,
            isDestructive: true,
            onConfirm: async () => {
                try {
                    const token = localStorage.getItem('cabane_token');
                    await axios.post(`${API_URL}/api/automation/shutdown`, { duration }, { headers: { Authorization: `Bearer ${token}` } });
                    onClose();
                } catch (e) { showAlert("Error", "Failed to schedule."); }
            }
        });
    };

    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[70] flex items-center justify-center p-4 animate-in fade-in" onClick={onClose}>
            <div className="bg-gray-900 border border-gray-700 w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
                <div className="p-5 border-b border-gray-800 flex justify-between items-center bg-gray-850">
                    <h3 className="text-lg font-bold text-white flex items-center gap-2"><Power className="text-red-500" /> System Shutdown</h3>
                    <button onClick={onClose}><X size={24} className="text-gray-400 hover:text-white" /></button>
                </div>
                <div className="p-6 space-y-6">
                    <div className="flex flex-col items-center gap-2">
                        <label className="text-sm font-bold text-gray-400 uppercase">Shutdown Delay</label>
                        <div className="flex items-center gap-2">
                            <Clock className="text-gray-500" />
                            <input type="number" min="1" value={duration} onChange={e => setDuration(e.target.value)} className="w-24 bg-black border border-gray-600 rounded p-2 text-center text-xl text-white outline-none focus:border-red-500" />
                            <span className="text-gray-500 font-bold">MIN</span>
                        </div>
                    </div>
                    <button onClick={handleStart} className="w-full py-3 bg-red-600 hover:bg-red-500 text-white font-bold rounded-lg shadow-lg flex items-center justify-center gap-2 transition-transform active:scale-95">
                        <Power size={18} /> SCHEDULE SHUTDOWN
                    </button>
                </div>
            </div>
        </div>
    );
};