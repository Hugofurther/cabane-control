import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { X, Send, AlertTriangle, StickyNote, Users, User, RefreshCw } from 'lucide-react';
import { useSocket } from '../contexts/SocketContext';
import { clsx } from 'clsx';

const API_URL = import.meta.env.PROD ? '' : (import.meta.env.VITE_API_URL || 'http://localhost:3000');

// --- COLOR HELPER ---
const getUserColor = (username) => {
    if (!username) return 'border-gray-500 text-gray-400 bg-gray-800';
    const colors = [
        'border-emerald-500 text-emerald-400 bg-emerald-900/10',
        'border-purple-500 text-purple-400 bg-purple-900/10',
        'border-orange-500 text-orange-400 bg-orange-900/10',
        'border-pink-500 text-pink-400 bg-pink-900/10',
        'border-cyan-500 text-cyan-400 bg-cyan-900/10',
        'border-indigo-500 text-indigo-400 bg-indigo-900/10',
    ];
    let hash = 0;
    for (let i = 0; i < username.length; i++) {
        hash = username.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
};

export const MessageDrawer = ({ isOpen, onClose, onUnreadChange }) => {
    const { user, systemState, onlineList } = useSocket();

    const [messages, setMessages] = useState([]);
    const [userList, setUserList] = useState([]);
    const [input, setInput] = useState('');
    const [isUrgent, setIsUrgent] = useState(false);
    const [tab, setTab] = useState('GLOBAL');
    const [loadingUsers, setLoadingUsers] = useState(false);

    const messagesEndRef = useRef(null);

    // --- FETCH DATA ---
    const fetchData = async () => {
        if (!user) return;
        const token = localStorage.getItem('cabane_token');

        try {
            // 1. Messages
            const resMsg = await axios.get(`${API_URL}/api/messages`, { headers: { Authorization: `Bearer ${token}` } });
            if (Array.isArray(resMsg.data)) {
                setMessages(resMsg.data);
            }

            // 2. Users (Directory)
            if (tab === 'USERS') {
                setLoadingUsers(true);
                try {
                    const resUsers = await axios.get(`${API_URL}/api/users/directory`, { headers: { Authorization: `Bearer ${token}` } });
                    if (Array.isArray(resUsers.data)) setUserList(resUsers.data);
                } catch (e) { console.error(e); }
                finally { setLoadingUsers(false); }
            }

            // 3. Unread Counts
            if (Array.isArray(resMsg.data)) {
                // Helper for safe comparison
                const isNotMe = (id) => String(id) !== String(user.id);

                const unread = resMsg.data.filter(m => !m.is_read && isNotMe(m.sender_id)).length;
                const notes = resMsg.data.filter(m => String(m.sender_id) === String(user.id) && String(m.recipient_id) === String(user.id) && !m.is_read).length;

                if (onUnreadChange) onUnreadChange(unread, notes);

                // 4. Mark Read Logic
                if (isOpen && tab !== 'USERS') markRead(resMsg.data);
            }

        } catch (e) { console.error(e); }
    };

    const markRead = async (msgs) => {
        if (!user) return;
        const unreadIds = msgs
            .filter(m => !m.is_read && (m.recipient_id === user.id || m.recipient_id === null) && String(m.sender_id) !== String(user.id))
            .map(m => m.id);

        if (unreadIds.length > 0) {
            const token = localStorage.getItem('cabane_token');
            await axios.post(`${API_URL}/api/messages/read`, { messageIds: unreadIds }, { headers: { Authorization: `Bearer ${token}` } });
            setMessages(prev => prev.map(m => unreadIds.includes(m.id) ? { ...m, is_read: 1 } : m));
            if (onUnreadChange) onUnreadChange(0, null);
        }
    };

    useEffect(() => {
        if (isOpen) fetchData();
        const interval = setInterval(fetchData, 3000);
        return () => clearInterval(interval);
    }, [isOpen, user, tab]);

    useEffect(() => {
        if (tab !== 'USERS') {
            messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
        }
    }, [messages, tab, isOpen]);

    // --- SEND HANDLER ---
    const handleSend = async (e) => {
        e.preventDefault();
        if (!input.trim()) return;
        const token = localStorage.getItem('cabane_token');
        const recipientId = tab === 'NOTES' ? user.id : null;
        try {
            await axios.post(`${API_URL}/api/messages`,
                { content: input, recipientId, priority: isUrgent ? 'URGENT' : 'NORMAL' },
                { headers: { Authorization: `Bearer ${token}` } }
            );
            setInput('');
            setIsUrgent(false);
            fetchData();
        } catch (e) { alert("Send failed"); }
    };

    // Filter & Sort
    const viewMessages = messages.filter(m => {
        if (tab === 'NOTES') return String(m.sender_id) === String(user.id) && String(m.recipient_id) === String(user.id);
        return m.recipient_id === null;
    });

    const sortedMessages = [...viewMessages].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    // --- RENDER ---
    return (
        <div
            className={clsx(
                "fixed inset-0 bg-black/50 z-[55] transition-opacity duration-300",
                isOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
            )}
            onClick={onClose}
        >
            <div
                className={clsx(
                    "absolute top-0 bottom-0 right-0 w-full md:w-96 bg-gray-900 border-l border-gray-700 shadow-2xl transform transition-transform duration-300 flex flex-col",
                    isOpen ? "translate-x-0" : "translate-x-full"
                )}
                onClick={e => e.stopPropagation()}
            >

                {/* HEADER */}
                <div className="p-4 bg-gray-800 border-b border-gray-700 flex justify-between items-center">
                    <div className="flex gap-2">
                        <button onClick={() => setTab('GLOBAL')} className={`px-3 py-1 rounded text-xs font-bold flex items-center gap-1 ${tab === 'GLOBAL' ? 'bg-gray-700 text-white' : 'text-gray-500 hover:text-gray-300'}`}>
                            <Users size={14} /> CHAT
                        </button>
                        <button onClick={() => setTab('USERS')} className={`px-3 py-1 rounded text-xs font-bold flex items-center gap-1 ${tab === 'USERS' ? 'bg-gray-700 text-blue-400' : 'text-gray-500 hover:text-gray-300'}`}>
                            <User size={14} /> USERS
                        </button>
                        <button onClick={() => setTab('NOTES')} className={`px-3 py-1 rounded text-xs font-bold flex items-center gap-1 ${tab === 'NOTES' ? 'bg-gray-700 text-yellow-400' : 'text-gray-500 hover:text-gray-300'}`}>
                            <StickyNote size={14} /> NOTES
                        </button>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-white"><X size={24} /></button>
                </div>

                {/* CONTENT AREA */}
                <div className="flex-grow overflow-y-auto p-4 space-y-3 bg-cabane-dark">

                    {/* --- TAB: USERS --- */}
                    {tab === 'USERS' && (
                        <div className="space-y-2">
                            <h3 className="text-xs font-bold text-gray-500 uppercase mb-3 flex justify-between">
                                <span>Registered Operators</span>
                                {loadingUsers && <RefreshCw size={12} className="animate-spin" />}
                            </h3>
                            {userList.map(u => {
                                const isOnline = (onlineList || []).includes(u.username);
                                const isControlling = systemState.controller === 'USER' && systemState.currentUser === u.username;
                                const isMe = user?.username === u.username;
                                const colorClass = getUserColor(u.username);

                                return (
                                    <div key={u.id} className="flex items-center justify-between p-3 rounded bg-gray-800 border border-gray-700">
                                        <div className="flex items-center gap-3">
                                            <div className={clsx("w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs border", colorClass)}>
                                                {u.username.substring(0, 2).toUpperCase()}
                                            </div>
                                            <span className={clsx("font-bold text-sm", isMe ? "text-white" : "text-gray-400")}>
                                                {u.username} {isMe && <span className="text-[10px] text-gray-600 font-normal">(You)</span>}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            {isControlling && <span className="text-[10px] font-bold bg-blue-900/50 text-blue-400 px-2 py-0.5 rounded border border-blue-800">DRIVER</span>}
                                            <div className={`w-2 h-2 rounded-full ${isOnline ? 'bg-green-500 shadow-[0_0_5px_rgba(34,197,94,0.8)]' : 'bg-gray-600'}`} title={isOnline ? "Online" : "Offline"} />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {/* --- TAB: CHAT & NOTES --- */}
                    {(tab === 'GLOBAL' || tab === 'NOTES') && sortedMessages.map(msg => {

                        // ✅ ALIGNMENT FIX: Strict String Comparison
                        const isMe = user && (String(msg.sender_id) === String(user.id));

                        const isUrgentMsg = msg.priority === 'URGENT';
                        const userColorClass = getUserColor(msg.sender);

                        return (
                            <div key={msg.id} className={`flex flex-col w-full ${isMe ? 'items-end' : 'items-start'}`}>

                                {/* Name Bubble (Only for others) */}
                                {!isMe && tab !== 'NOTES' && (
                                    <span className="text-[10px] font-bold text-gray-500 mb-0.5 ml-1">{msg.sender}</span>
                                )}

                                <div className={clsx(
                                    "max-w-[85%] p-3 rounded-lg text-sm border shadow-sm relative break-words",

                                    // ME: Right Aligned, Blue
                                    isMe && !isUrgentMsg && "bg-blue-600 border-blue-500 text-white rounded-br-none text-right",

                                    // OTHERS: Left Aligned, Custom Color Border
                                    !isMe && !isUrgentMsg && clsx("rounded-bl-none border-l-4 text-gray-200 bg-gray-800", userColorClass),

                                    // URGENT: Red Pulse
                                    isUrgentMsg && "bg-red-900/80 border-red-500 text-white animate-pulse"
                                )}>
                                    {isUrgentMsg && <div className="flex items-center gap-1 text-[10px] font-bold text-red-300 mb-1"><AlertTriangle size={10} /> URGENT</div>}
                                    {msg.content}
                                </div>

                                <span className="text-[10px] text-gray-600 mt-1 mx-1">
                                    {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </span>
                            </div>
                        );
                    })}
                    <div ref={messagesEndRef} />
                </div>

                {/* INPUT AREA */}
                {tab !== 'USERS' && (
                    <form onSubmit={handleSend} className="p-4 bg-gray-800 border-t border-gray-700">
                        <div className="flex gap-2 mb-2">
                            {tab === 'GLOBAL' && (
                                <label className={`flex items-center gap-1 text-xs font-bold cursor-pointer px-2 py-1 rounded border transition-colors ${isUrgent ? 'bg-red-900 text-red-200 border-red-600' : 'bg-gray-700 text-gray-400 border-gray-600'}`}>
                                    <input type="checkbox" className="hidden" checked={isUrgent} onChange={e => setIsUrgent(e.target.checked)} />
                                    <AlertTriangle size={12} /> URGENT
                                </label>
                            )}
                        </div>

                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={input}
                                onChange={e => setInput(e.target.value)}
                                placeholder={tab === 'NOTES' ? "Write a reminder..." : "Type a message..."}
                                className="flex-grow bg-gray-900 border border-gray-600 rounded-lg p-2 text-white focus:border-blue-500 outline-none"
                            />
                            <button type="submit" className="p-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-white transition-colors">
                                <Send size={20} />
                            </button>
                        </div>
                    </form>
                )}

            </div>
        </div>
    );
};