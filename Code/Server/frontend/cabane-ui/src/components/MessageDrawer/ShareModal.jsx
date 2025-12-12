import React, { useState, useMemo } from 'react';
import axios from 'axios';
import { X, Share2, Zap, Check, Search, Users, Globe, User, Loader2 } from 'lucide-react';
import { clsx } from 'clsx';
import { useModal } from '../../contexts/ModalContext';

const API_URL = import.meta.env.PROD ? '' : (import.meta.env.VITE_API_URL || 'http://localhost:3000');

export const ShareModal = ({ note, users, groups, isFlash, onClose }) => {
    const { showAlert } = useModal();

    // State
    const [selectedMap, setSelectedMap] = useState(new Map()); // Key: "TYPE:ID" -> Object
    const [flashEnabled, setFlashEnabled] = useState(isFlash);
    const [status, setStatus] = useState('IDLE'); // IDLE, SENDING, SUCCESS
    const [filter, setFilter] = useState('');

    // Toggle Selection Logic
    const toggleSelection = (type, id, name) => {
        const key = `${type}:${id}`;
        setSelectedMap(prev => {
            const next = new Map(prev);

            // Exclusive Logic: If picking Global, clear others? 
            // Or if picking specific, clear Global?
            if (type === 'GLOBAL' && id === 'ALL') {
                // If selecting Global, maybe we don't clear others, just let them stack?
                // Actually, Global implies everyone, so let's keep it simple and just toggle it.
            }

            if (next.has(key)) {
                next.delete(key);
            } else {
                next.set(key, { type, id, name });
            }
            return next;
        });
    };

    // Filtered Lists
    const filteredUsers = useMemo(() => users.filter(u => u.username.toLowerCase().includes(filter.toLowerCase())), [users, filter]);
    const filteredGroups = useMemo(() => (groups || []).filter(g => g.name.toLowerCase().includes(filter.toLowerCase())), [groups, filter]);
    const showGlobal = "global".includes(filter.toLowerCase()) || "everyone".includes(filter.toLowerCase()) || filter === '';

    const handleShare = async () => {
        if (selectedMap.size === 0) return;

        setStatus('SENDING');
        const token = localStorage.getItem('cabane_token');
        const endpoint = flashEnabled ? 'flash' : 'share';

        // Convert Map to Array of Promises
        const promises = Array.from(selectedMap.values()).map(target => {
            return axios.post(`${API_URL}/api/notes/${note.id}/${endpoint}`,
                {
                    targetId: target.id,
                    targetType: target.type,
                    targetUserId: target.id // Backward compatibility
                },
                { headers: { Authorization: `Bearer ${token}` } }
            );
        });

        try {
            await Promise.all(promises);
            setStatus('SUCCESS');
            setTimeout(onClose, 1500);
        } catch (e) {
            console.error(e);
            showAlert("Error", "Some shares failed to send.");
            setStatus('IDLE');
        }
    };

    // Helper to render a list item
    const RenderItem = ({ type, id, name, icon: Icon, subtext }) => {
        const key = `${type}:${id}`;
        const isSelected = selectedMap.has(key);

        return (
            <div
                onClick={() => status === 'IDLE' && toggleSelection(type, id, name)}
                className={clsx(
                    "flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-all mb-2",
                    isSelected
                        ? "bg-blue-900/30 border-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.3)]"
                        : "bg-gray-800/50 border-gray-700 hover:bg-gray-800 hover:border-gray-600",
                    status !== 'IDLE' && "opacity-50 cursor-not-allowed"
                )}
            >
                <div className="flex items-center gap-3">
                    <div className={clsx("p-2 rounded-full", isSelected ? "bg-blue-600 text-white" : "bg-gray-700 text-gray-400")}>
                        <Icon size={16} />
                    </div>
                    <div>
                        <p className={clsx("text-sm font-bold", isSelected ? "text-white" : "text-gray-300")}>{name}</p>
                        {subtext && <p className="text-[10px] text-gray-500">{subtext}</p>}
                    </div>
                </div>
                {isSelected && <Check size={18} className="text-blue-400" />}
            </div>
        );
    };

    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4 animate-in fade-in zoom-in-95 duration-200" onClick={onClose}>
            <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col max-h-[85vh]" onClick={e => e.stopPropagation()}>

                {/* HEADER */}
                <div className="p-5 border-b border-gray-800 flex justify-between items-center bg-gray-850 shrink-0">
                    <h3 className="font-bold text-white flex items-center gap-2">
                        {flashEnabled ? <Zap className="text-yellow-400" size={20} /> : <Share2 className="text-blue-400" size={20} />}
                        {flashEnabled ? "Send Flash Memo" : "Share Note"}
                    </h3>
                    <button onClick={onClose}><X size={24} className="text-gray-500 hover:text-white" /></button>
                </div>

                {/* CONTROLS */}
                <div className="p-4 space-y-3 bg-gray-900 border-b border-gray-800 shrink-0">
                    {/* Flash Toggle */}
                    <div onClick={() => status === 'IDLE' && setFlashEnabled(!flashEnabled)} className="flex items-center gap-3 p-3 bg-gray-800 rounded border border-gray-700 cursor-pointer hover:border-gray-500 transition-colors">
                        <div className={clsx("w-5 h-5 rounded border flex items-center justify-center transition-colors", flashEnabled ? "bg-yellow-500 border-yellow-500" : "border-gray-500 bg-transparent")}>
                            {flashEnabled && <Check size={14} className="text-black" />}
                        </div>
                        <div>
                            <p className={clsx("text-sm font-bold", flashEnabled ? "text-yellow-400" : "text-gray-300")}>Flash Memo</p>
                            <p className="text-[10px] text-gray-500">Display the note on user's screen.</p>
                        </div>
                    </div>

                    {/* Search */}
                    <div className="relative">
                        <Search className="absolute left-3 top-2.5 text-gray-500" size={16} />
                        <input
                            type="text"
                            placeholder="Search users or groups..."
                            value={filter}
                            onChange={e => setFilter(e.target.value)}
                            className="w-full bg-black/30 border border-gray-700 rounded-lg pl-9 pr-3 py-2 text-sm text-white outline-none focus:border-blue-500"
                        />
                    </div>
                </div>

                {/* LIST */}
                <div className="flex-grow overflow-y-auto p-4">

                    {/* 1. Global */}
                    {showGlobal && (
                        <div className="mb-4">
                            <p className="text-[10px] font-bold text-gray-500 uppercase mb-2 ml-1">System Wide</p>
                            <RenderItem type="GLOBAL" id="ALL" name="Global (Everyone)" icon={Globe} subtext="Send to all active users" />
                        </div>
                    )}

                    {/* 2. Groups */}
                    {filteredGroups.length > 0 && (
                        <div className="mb-4">
                            <p className="text-[10px] font-bold text-gray-500 uppercase mb-2 ml-1">Groups</p>
                            {filteredGroups.map(g => (
                                <RenderItem key={g.id} type="GROUP" id={g.id} name={g.name} icon={Users} subtext="All group members" />
                            ))}
                        </div>
                    )}

                    {/* 3. Users */}
                    <div className="mb-2">
                        <p className="text-[10px] font-bold text-gray-500 uppercase mb-2 ml-1">Users</p>
                        {filteredUsers.length > 0 ? (
                            filteredUsers.map(u => (
                                <RenderItem key={u.id} type="USER" id={u.id} name={u.username} icon={User} />
                            ))
                        ) : (
                            <div className="text-center text-gray-500 text-xs py-4 italic">No users found</div>
                        )}
                    </div>
                </div>

                {/* FOOTER */}
                <div className="p-4 bg-gray-850 border-t border-gray-800 shrink-0">
                    <button
                        onClick={handleShare}
                        disabled={selectedMap.size === 0 || status === 'SUCCESS' || status === 'SENDING'}
                        className={clsx(
                            "w-full py-3.5 rounded-lg font-black uppercase tracking-widest shadow-lg flex items-center justify-center gap-2 transition-all",
                            status === 'SUCCESS'
                                ? "bg-green-600 text-white scale-105"
                                : (selectedMap.size === 0 ? "bg-gray-700 text-gray-500 cursor-not-allowed" : (flashEnabled ? "bg-yellow-600 hover:bg-yellow-500 text-black" : "bg-blue-600 hover:bg-blue-500 text-white"))
                        )}
                    >
                        {status === 'SUCCESS' && <><Check size={24} strokeWidth={3} /> SENT</>}
                        {status === 'SENDING' && <><Loader2 size={20} className="animate-spin" /> SENDING...</>}
                        {status === 'IDLE' && (
                            <>
                                {flashEnabled ? "SEND FLASH MEMO" : "SHARE NOTE"}
                                {selectedMap.size > 0 && <span className="bg-black/20 px-2 py-0.5 rounded text-xs ml-1">{selectedMap.size}</span>}
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
};