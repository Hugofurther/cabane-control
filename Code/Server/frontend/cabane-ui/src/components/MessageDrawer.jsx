import React, { useState, useEffect, useRef, useMemo } from 'react';
import axios from 'axios';
import { X, Send, AlertTriangle, StickyNote, Users, User, Plus, ArrowLeft, Search, MessageSquare, Check, ChevronDown, ChevronUp, RefreshCw, Clock, Trash2, LogOut, CheckCheck } from 'lucide-react';
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

const formatSmartTime = (isoString) => {
    const date = new Date(isoString);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    const isYesterday = new Date(now.setDate(now.getDate() - 1)).toDateString() === date.toDateString();
    const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (isToday) return time;
    if (isYesterday) return `Yesterday ${time}`;
    return `${date.toLocaleDateString()} ${time}`;
};

export const MessageDrawer = ({ isOpen, onClose, onUnreadChange }) => {
    const { user, socket, onlineList } = useSocket();

    // --- STATE ---
    const [activeTab, setActiveTab] = useState('GLOBAL');
    const [selectedTarget, setSelectedTarget] = useState(null);
    const [isCreatingGroup, setIsCreatingGroup] = useState(false);
    const [isHeaderExpanded, setIsHeaderExpanded] = useState(false);

    const [messages, setMessages] = useState([]);
    const [userList, setUserList] = useState([]);
    const [groupList, setGroupList] = useState([]);

    const [input, setInput] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [isUrgent, setIsUrgent] = useState(false);

    const [newGroupName, setNewGroupName] = useState('');
    const [newGroupMembers, setNewGroupMembers] = useState([]);

    const messagesEndRef = useRef(null);

    // --- SCROLL LOCK ---
    useEffect(() => {
        if (isOpen) document.body.style.overflow = 'hidden';
        else document.body.style.overflow = '';
        return () => { document.body.style.overflow = ''; };
    }, [isOpen]);

    // --- FETCH DATA ---
    const fetchData = async () => {
        if (!user) return;
        const token = localStorage.getItem('cabane_token');
        try {
            const resMsg = await axios.get(`${API_URL}/api/messages`, { headers: { Authorization: `Bearer ${token}` } });
            if (Array.isArray(resMsg.data)) setMessages(resMsg.data);

            const resUsers = await axios.get(`${API_URL}/api/users/directory`, { headers: { Authorization: `Bearer ${token}` } });
            if (Array.isArray(resUsers.data)) setUserList(resUsers.data);

            const resConvos = await axios.get(`${API_URL}/api/conversations`, { headers: { Authorization: `Bearer ${token}` } });
            if (Array.isArray(resConvos.data)) {
                setGroupList(resConvos.data.filter(c => c.type === 'GROUP'));
            }
        } catch (e) { console.error(e); }
    };

    // --- MARK READ LOGIC ---
    const markReadIds = async (ids) => {
        if (ids.length === 0) return;
        const token = localStorage.getItem('cabane_token');
        // Optimistic Update
        setMessages(prev => prev.map(m => ids.includes(m.id) ? { ...m, is_read_by_me: 1 } : m));
        try {
            await axios.post(`${API_URL}/api/messages/read`, { messageIds: ids }, { headers: { Authorization: `Bearer ${token}` } });
        } catch (e) { console.error("Read Sync Failed"); }
    };

    const handleAutoMarkRead = () => {
        if (!user || !isOpen) return;
        // Find messages in CURRENT view that are unread
        const unreadIds = messages.filter(m => {
            if (m.is_read_by_me || String(m.sender_id) === String(user.id)) return false;

            if (activeTab === 'GLOBAL') return !m.recipient_id && !m.group_id;
            if (activeTab === 'NOTES') return String(m.recipient_id) === String(user.id) && String(m.sender_id) === String(user.id);

            if (selectedTarget) {
                if (activeTab === 'USERS') return String(m.sender_id) === String(selectedTarget.id) && !m.group_id;
                if (activeTab === 'GROUPS') return String(m.group_id) === String(selectedTarget.id);
            }
            return false;
        }).map(m => m.id);

        markReadIds(unreadIds);
    };

    // --- FLUSH BUTTON (Fix Stuck Badges) ---
    const handleMarkAllRead = () => {
        if (!user) return;
        // Mark EVERYTHING loaded as read (except my own)
        const allUnreadIds = messages
            .filter(m => !m.is_read_by_me && String(m.sender_id) !== String(user.id))
            .map(m => m.id);
        markReadIds(allUnreadIds);
    };

    // --- SOCKETS ---
    useEffect(() => {
        if (isOpen) fetchData();
        const interval = setInterval(fetchData, 4000);
        return () => clearInterval(interval);
    }, [isOpen, user]);

    useEffect(() => {
        if (!socket || !user) return;
        const handleNew = (msg) => {
            setMessages(prev => {
                if (prev.some(p => p.id === msg.id)) return prev;
                // New messages are unread by default
                return [...prev, { ...msg, is_read_by_me: 0 }];
            });
            if (isOpen) setTimeout(handleAutoMarkRead, 500); // Small delay to allow render
        };

        const handleDelete = ({ id }) => setMessages(prev => prev.filter(m => m.id !== id));
        const handleUpdate = ({ id, priority }) => setMessages(prev => prev.map(m => m.id === id ? { ...m, priority } : m));

        socket.on('NEW_MESSAGE', handleNew);
        socket.on('DELETE_MESSAGE', handleDelete);
        socket.on('UPDATE_MESSAGE', handleUpdate);
        return () => {
            socket.off('NEW_MESSAGE', handleNew);
            socket.off('DELETE_MESSAGE', handleDelete);
            socket.off('UPDATE_MESSAGE', handleUpdate);
        };
    }, [socket, isOpen, activeTab, selectedTarget]);

    // Trigger auto-read when view changes
    useEffect(() => {
        if (isOpen) {
            handleAutoMarkRead();
            messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
        }
    }, [activeTab, selectedTarget, isOpen, messages.length]);

    // --- BADGES ---
    const badges = useMemo(() => {
        const counts = { global: 0, users: 0, groups: 0, notes: 0, total: 0 };
        const dmCounts = {};
        const groupCounts = {};

        if (user) {
            messages.forEach(m => {
                if (m.is_read_by_me || String(m.sender_id) === String(user.id)) return;
                if (!m.recipient_id && !m.group_id) counts.global++;
                else if (String(m.recipient_id) === String(user.id) && String(m.sender_id) === String(user.id)) counts.notes++;
                else if (String(m.recipient_id) === String(user.id) && !m.group_id) {
                    counts.users++;
                    dmCounts[m.sender_id] = (dmCounts[m.sender_id] || 0) + 1;
                }
                else if (m.group_id) {
                    counts.groups++;
                    groupCounts[m.group_id] = (groupCounts[m.group_id] || 0) + 1;
                }
            });
            counts.total = counts.global + counts.users + counts.groups + counts.notes;
        }
        return { counts, dmCounts, groupCounts };
    }, [messages, user]);

    // Sync to Parent
    useEffect(() => {
        if (onUnreadChange) onUnreadChange(badges.counts.total, badges.counts.notes);
    }, [badges.counts.total, badges.counts.notes]);


    // --- ACTIONS ---
    const handleSend = async (e) => {
        e.preventDefault();
        if (!input.trim()) return;
        const token = localStorage.getItem('cabane_token');
        const payload = { content: input, priority: isUrgent ? 'URGENT' : 'NORMAL' };
        if (activeTab === 'NOTES') payload.recipientId = user.id;
        if (activeTab === 'USERS' && selectedTarget) payload.recipientId = selectedTarget.id;
        if (activeTab === 'GROUPS' && selectedTarget) payload.groupId = selectedTarget.id;

        const tempId = 'temp-' + Date.now();
        const optimisticMsg = {
            id: tempId,
            sender_id: user.id,
            sender: user.username,
            recipient_id: payload.recipientId || null,
            group_id: payload.groupId || null,
            content: input,
            priority: payload.priority,
            timestamp: new Date().toISOString(),
            is_read_by_me: 0,
            isOptimistic: true
        };
        setMessages(prev => [...prev, optimisticMsg]);
        setInput(''); setIsUrgent(false);

        try {
            await axios.post(`${API_URL}/api/messages`, payload, { headers: { Authorization: `Bearer ${token}` } });
            fetchData();
        } catch (e) {
            alert("Send failed");
            setMessages(prev => prev.filter(m => m.id !== tempId));
        }
    };

    const handleCreateGroup = async () => { /* ... same as before ... */ };
    const handleLeaveGroup = async () => { /* ... same as before ... */ };

    const handleDeleteMessage = async (id) => {
        if (!confirm("Delete this message?")) return;
        const token = localStorage.getItem('cabane_token');
        try { await axios.post(`${API_URL}/api/messages/delete`, { messageId: id }, { headers: { Authorization: `Bearer ${token}` } }); }
        catch (e) { alert("Delete failed"); }
    };

    const handleDowngradeUrgency = async (id) => {
        const token = localStorage.getItem('cabane_token');
        try { await axios.post(`${API_URL}/api/messages/downgrade`, { messageId: id }, { headers: { Authorization: `Bearer ${token}` } }); }
        catch (e) { }
    };

    // --- RENDER CHAT ---

    // Filter Logic
    const currentMessages = messages.filter(m => {
        if (activeTab === 'GLOBAL') return !m.recipient_id && !m.group_id;
        if (activeTab === 'NOTES') return String(m.sender_id) === String(user.id) && String(m.recipient_id) === String(user.id);
        if (activeTab === 'USERS' && selectedTarget) return ((String(m.sender_id) === String(selectedTarget.id) && String(m.recipient_id) === String(user.id)) || (String(m.sender_id) === String(user.id) && String(m.recipient_id) === String(selectedTarget.id)));
        if (activeTab === 'GROUPS' && selectedTarget) return String(m.group_id) === String(selectedTarget.id);
        return false;
    }).sort((a, b) => {
        if (a.isOptimistic && !b.isOptimistic) return 1;
        if (!a.isOptimistic && b.isOptimistic) return -1;
        return new Date(a.timestamp) - new Date(b.timestamp);
    });

    const renderChat = () => (
        <div className="flex-grow overflow-y-auto p-4 space-y-3 bg-cabane-dark pb-4 overscroll-contain">
            {currentMessages.length === 0 && <div className="text-center text-gray-500 text-xs italic mt-4">No messages yet.</div>}
            {currentMessages.map(msg => {
                const isMe = user && (String(msg.sender_id) === String(user.id));
                const isUrgentMsg = msg.priority === 'URGENT';
                const userColorClass = getUserColor(msg.sender);

                return (
                    <div key={msg.id} className={`flex flex-col w-full group ${isMe ? 'items-end' : 'items-start'}`}>
                        {!isMe && activeTab !== 'NOTES' && <span className="text-[10px] text-gray-500 ml-1 mb-0.5">{msg.sender}</span>}

                        <div
                            onClick={() => isUrgentMsg && handleDowngradeUrgency(msg.id)}
                            className={clsx(
                                "max-w-[85%] p-3 rounded-lg text-sm border shadow-sm relative break-words transition-all",
                                isUrgentMsg && "cursor-pointer hover:scale-[1.02]",
                                isMe && !isUrgentMsg && "bg-blue-600 border-blue-500 text-white rounded-br-none text-right",
                                !isMe && !isUrgentMsg && clsx("rounded-bl-none border-l-4 text-gray-200 bg-gray-800", userColorClass),
                                isUrgentMsg && "bg-red-900/80 border-red-500 text-white animate-pulse",
                                msg.isOptimistic && "opacity-70"
                            )}>
                            {isUrgentMsg && <div className="flex items-center gap-1 text-[10px] font-bold text-red-300 mb-1"><AlertTriangle size={10} /> URGENT (Tap to Ack)</div>}
                            {msg.content}
                            {msg.isOptimistic && <span className="absolute bottom-1 right-1 text-[8px] text-gray-300"><Clock size={8} /></span>}
                        </div>

                        <div className="flex items-center gap-2 mt-1 mx-1">
                            <span className="text-[10px] text-gray-600">{formatSmartTime(msg.timestamp)}</span>
                            {isMe && !msg.isOptimistic && (
                                <button onClick={() => handleDeleteMessage(msg.id)} className="text-gray-600 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity" title="Delete">
                                    <Trash2 size={12} />
                                </button>
                            )}
                        </div>
                    </div>
                );
            })}
            <div ref={messagesEndRef} />
        </div>
    );

    return (
        <div className={clsx("fixed inset-0 bg-black/50 z-[55] transition-opacity duration-300", isOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none")} onClick={onClose}>
            <div className={clsx("absolute top-0 bottom-0 right-0 w-full md:w-96 bg-gray-900 border-l border-gray-700 shadow-2xl transform transition-transform duration-300 flex flex-col", isOpen ? "translate-x-0" : "translate-x-full")} onClick={e => e.stopPropagation()}>

                {/* HEADER */}
                <div className="p-4 bg-gray-800 border-b border-gray-700 flex justify-between items-center">
                    <div className="flex gap-2">
                        {/* TABS ... */}
                        {['GLOBAL', 'USERS', 'GROUPS', 'NOTES'].map(t => (
                            <button key={t} onClick={() => { setActiveTab(t); setSelectedTarget(null); setIsCreatingGroup(false); setSearchQuery(''); setIsHeaderExpanded(false); }}
                                className={clsx("px-2 py-1 rounded text-[10px] font-bold uppercase transition-colors relative", activeTab === t ? "bg-gray-700 text-blue-400 border border-blue-500/50" : "text-gray-500 hover:text-white")}>
                                {t}
                                {badges.counts[t.toLowerCase()] > 0 && <span className="absolute -top-1 -right-1 w-2 h-2 bg-red-500 rounded-full animate-pulse" />}
                            </button>
                        ))}
                    </div>
                    <div className="flex gap-2">
                        {/* MARK ALL READ BUTTON */}
                        <button onClick={handleMarkAllRead} className="text-gray-500 hover:text-green-400" title="Mark All Read"><CheckCheck size={18} /></button>
                        <button onClick={onClose} className="text-gray-400 hover:text-white"><X size={24} /></button>
                    </div>
                </div>

                {/* SUB-HEADER & CONTENT (Keep existing logic for Directories/Chat) */}
                {selectedTarget && (
                    <div className="bg-gray-800 border-b border-gray-700 p-3 flex items-start gap-2 cursor-pointer hover:bg-gray-750 transition-colors" onClick={() => activeTab === 'GROUPS' ? setIsHeaderExpanded(!isHeaderExpanded) : null}>
                        <button onClick={(e) => { e.stopPropagation(); setSelectedTarget(null); }} className="mt-0.5"><ArrowLeft size={18} className="text-gray-400 hover:text-white" /></button>
                        <div className="flex-grow overflow-hidden">
                            <div className="font-bold text-sm text-white flex justify-between items-center">
                                <span>{selectedTarget.username || selectedTarget.name}</span>
                                {activeTab === 'GROUPS' && (isHeaderExpanded ? <ChevronUp size={14} className="text-gray-500" /> : <ChevronDown size={14} className="text-gray-500" />)}
                            </div>
                            {activeTab === 'GROUPS' && selectedTarget.members && (
                                <div className={clsx("text-xs text-gray-400 mt-1 transition-all duration-300", isHeaderExpanded ? "whitespace-normal" : "truncate")}>
                                    {selectedTarget.members}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* BODY */}
                <div className="flex-grow flex flex-col overflow-hidden">
                    {((activeTab === 'GLOBAL' || activeTab === 'NOTES') || selectedTarget) && !isCreatingGroup && renderChat()}
                    {/* ... (Keep Directory / New Group Logic from previous file, it was correct) ... */}

                    {/* Note: For brevity, I am assuming you keep the Directory logic. 
               If you need the Full File with Directory logic included again, ask. 
               I just replaced the top section and renderChat here. */}

                    {!selectedTarget && (activeTab === 'USERS' || activeTab === 'GROUPS') && (
                        isCreatingGroup ? (
                            // ... New Group Form ...
                            <div className="p-4 space-y-4 bg-cabane-dark h-full">
                                {/* Same as before */}
                            </div>
                        ) : (
                            // ... List Views ...
                            <div className="flex-col p-2 space-y-2 overflow-y-auto h-full bg-cabane-dark overscroll-contain">
                                {/* Same as before */}
                                {activeTab === 'GROUPS' && <button onClick={() => setIsCreatingGroup(true)} className="w-full py-2 bg-blue-900/30 border border-blue-500/50 text-blue-300 rounded text-xs font-bold flex items-center justify-center gap-2 hover:bg-blue-900/50 mb-2"><Plus size={14} /> New Group</button>}
                                <div className="relative mb-2">
                                    <Search className="absolute left-2 top-2 text-gray-500" size={14} />
                                    <input type="text" placeholder="Search..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded pl-8 p-1.5 text-sm text-white focus:border-blue-500 outline-none" />
                                </div>

                                {(activeTab === 'USERS' ? userList : groupList)
                                    .filter(i => (i.username || i.name).toLowerCase().includes(searchQuery.toLowerCase()) && i.id !== user?.id)
                                    .map(item => {
                                        const isOnline = activeTab === 'USERS' && (onlineList || []).includes(item.username);
                                        const count = activeTab === 'USERS' ? (badges.dmCounts[item.id] || 0) : (badges.groupCounts[item.id] || 0);
                                        const colorClass = activeTab === 'USERS' ? getUserColor(item.username) : 'border-gray-600 text-gray-400';
                                        return (
                                            <div key={item.id} onClick={() => setSelectedTarget(item)} className="p-3 bg-gray-800/50 hover:bg-gray-800 rounded border border-gray-700 cursor-pointer flex justify-between items-center">
                                                <div className="flex items-center gap-3">
                                                    {activeTab === 'USERS' ? (
                                                        <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs border bg-gray-900 ${colorClass}`}>{item.username.substring(0, 2).toUpperCase()}</div>
                                                    ) : (
                                                        <div className="p-1.5 rounded bg-gray-700 text-gray-300"><Users size={16} /></div>
                                                    )}
                                                    <div className="flex flex-col overflow-hidden">
                                                        <span className="text-sm font-bold text-gray-300">{item.username || item.name}</span>
                                                        {activeTab === 'GROUPS' && <span className="text-[10px] text-gray-500 truncate w-40">{item.members}</span>}
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    {count > 0 && <span className="bg-red-600 text-white text-[10px] font-bold px-1.5 rounded-full">{count}</span>}
                                                    {activeTab === 'USERS' && <div className={`w-2 h-2 rounded-full ${isOnline ? 'bg-green-500' : 'bg-gray-600'}`} title={isOnline ? "Online" : "Offline"} />}
                                                </div>
                                            </div>
                                        );
                                    })}
                            </div>
                        )
                    )}
                </div>

                {/* INPUT */}
                {((activeTab === 'GLOBAL' || activeTab === 'NOTES') || selectedTarget) && !isCreatingGroup && (
                    <form onSubmit={handleSend} className="p-4 bg-gray-800 border-t border-gray-700">
                        <div className="flex gap-2 mb-2">
                            {activeTab !== 'NOTES' && (
                                <label className={`flex items-center gap-1 text-xs font-bold cursor-pointer px-2 py-1 rounded border transition-colors ${isUrgent ? 'bg-red-900 text-red-200 border-red-600' : 'bg-gray-700 text-gray-400 border-gray-600'}`}>
                                    <input type="checkbox" className="hidden" checked={isUrgent} onChange={e => setIsUrgent(e.target.checked)} />
                                    <AlertTriangle size={12} /> URGENT
                                </label>
                            )}
                        </div>
                        <div className="flex gap-2">
                            <input type="text" value={input} onChange={e => setInput(e.target.value)} placeholder="Type a message..." className="flex-grow bg-gray-900 border border-gray-600 rounded-lg p-2 text-white outline-none" />
                            <button type="submit" className="p-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-white"><Send size={20} /></button>
                        </div>
                    </form>
                )}

            </div>
        </div>
    );
};