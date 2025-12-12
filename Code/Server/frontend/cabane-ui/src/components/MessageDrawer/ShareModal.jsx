import React, { useState } from 'react';
import axios from 'axios';
import { X, Share2, Zap, Check } from 'lucide-react';
import { clsx } from 'clsx';
import { useModal } from '../../contexts/ModalContext';

const API_URL = import.meta.env.PROD ? '' : (import.meta.env.VITE_API_URL || 'http://localhost:3000');

export const ShareModal = ({ note, users, isFlash, onClose }) => {
    const { showAlert } = useModal();
    const [selectedUser, setSelectedUser] = useState('');
    const [flashEnabled, setFlashEnabled] = useState(isFlash);
    const [status, setStatus] = useState('IDLE');

    const handleShare = async () => {
        if (!selectedUser) return;
        const token = localStorage.getItem('cabane_token');
        const endpoint = flashEnabled ? 'flash' : 'share';

        try {
            await axios.post(`${API_URL}/api/notes/${note.id}/${endpoint}`,
                { targetUserId: selectedUser },
                { headers: { Authorization: `Bearer ${token}` } }
            );
            setStatus('SUCCESS');
            setTimeout(onClose, 1500);
        } catch (e) {
            if (showAlert) showAlert("Error", "Failed to share note.");
            else alert("Failed to share.");
        }
    };

    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4 animate-in fade-in zoom-in-95 duration-200" onClick={onClose}>
            <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-sm overflow-hidden" onClick={e => e.stopPropagation()}>
                <div className="p-4 border-b border-gray-800 flex justify-between items-center bg-gray-850">
                    <h3 className="font-bold text-white flex items-center gap-2">
                        {flashEnabled ? <Zap className="text-yellow-400" size={18} /> : <Share2 className="text-blue-400" size={18} />}
                        {flashEnabled ? "Send Flash Memo" : "Share Note"}
                    </h3>
                    <button onClick={onClose}><X size={20} className="text-gray-500 hover:text-white" /></button>
                </div>

                <div className="p-6 space-y-4">
                    <div>
                        <label className="text-xs font-bold text-gray-500 block mb-2">SELECT USER</label>
                        <select
                            className="w-full bg-gray-800 border border-gray-600 rounded p-2 text-white outline-none text-sm"
                            value={selectedUser}
                            onChange={e => setSelectedUser(e.target.value)}
                        >
                            <option value="">-- Choose User --</option>
                            {users.map(u => (
                                <option key={u.id} value={u.id}>{u.username}</option>
                            ))}
                        </select>
                    </div>

                    <div onClick={() => setFlashEnabled(!flashEnabled)} className="flex items-center gap-3 p-3 bg-gray-800/50 rounded border border-gray-700 cursor-pointer hover:bg-gray-800 transition-colors">
                        <div className={clsx("w-5 h-5 rounded border flex items-center justify-center", flashEnabled ? "bg-yellow-500 border-yellow-500" : "border-gray-500")}>
                            {flashEnabled && <Check size={14} className="text-black" />}
                        </div>
                        <div>
                            {/* ✅ UPDATED TEXT */}
                            <p className={clsx("text-sm font-bold", flashEnabled ? "text-yellow-400" : "text-gray-400")}>Flash Memo</p>
                            <p className="text-[10px] text-gray-500">Display the note on user's screen.</p>
                        </div>
                    </div>

                    <button
                        onClick={handleShare}
                        disabled={!selectedUser || status === 'SUCCESS'}
                        className={clsx(
                            "w-full py-3 rounded-lg font-black uppercase tracking-widest shadow-lg flex items-center justify-center gap-2 transition-all",
                            status === 'SUCCESS'
                                ? "bg-green-600 text-white scale-105"
                                : (flashEnabled ? "bg-yellow-600 hover:bg-yellow-500 text-black" : "bg-blue-600 hover:bg-blue-500 text-white")
                        )}
                    >
                        {status === 'SUCCESS' ? <Check size={24} strokeWidth={3} /> : (flashEnabled ? "SEND FLASH MEMO" : "SHARE")}
                    </button>
                </div>
            </div>
        </div>
    );
};