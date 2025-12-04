import React, { useState, useEffect, useRef, useMemo } from 'react';
import axios from 'axios';
import { X, Send, AlertTriangle, StickyNote, Users, User, Plus, ArrowLeft, Search, MessageSquare, Check, ChevronDown, ChevronUp, RefreshCw, Clock } from 'lucide-react';
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
    const { user, socket, onlineList } = useSocket();

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

    const handleMarkRead = async (msgs) => {
        if (!user) return;
        const unreadIds = msgs.filter(m => {
            // ✅ CHECK NEW FLAG: is_read_by_me
            if (m.is_read_by_me || String(m.sender_id) === String(user.id)) return false;

            if (activeTab === 'GLOBAL') return !m.recipient_id && !m.group_id;
            if (activeTab === 'NOTES') return String(m.recipient_id) === String(user.id) && String(m.sender_id) === String(user.id);
            if (selectedTarget) {
                if (activeTab === 'USERS') return String(m.sender_id) === String(selectedTarget.id) && !m.group_id;
                if (activeTab === 'GROUPS') return String(m.group_id) === String(selectedTarget.id);
            }
            return false;
        }).map(m => m.id);

        if (unreadIds.length > 0) {
            const token = localStorage.getItem('cabane_token');
            await axios.post(`${API_URL}/api/messages/read`, { messageIds: unreadIds }, { headers: { Authorization: `Bearer ${token}` } });
            // Optimistic Update: Set is_read_by_me = 1
            setMessages(prev => prev.map(m => unreadIds.includes(m.id) ? { ...m, is_read_by_me: 1 } : m));
        }
    };

    // --- POLLING & SOCKETS ---
    useEffect(() => {
        if (isOpen) fetchData();
        const interval = setInterval(fetchData, 4000);
        return () => clearInterval(interval);
    }, [isOpen, user]);

    useEffect(() => {
        if (!socket || !user) return;
        const handleNew = (msg) => {
            // Default incoming message is unread (0)
            const newMsg = { ...msg, is_read_by_me: 0 };
            setMessages(prev => {
                if (prev.some(p => p.id === msg.id)) return prev;
                return [...prev, newMsg];
            });
            if (isOpen) handleMarkRead([newMsg]);
        };
        socket.on('NEW_MESSAGE', handleNew);
        return () => socket.off('NEW_MESSAGE', handleNew);
    }, [socket, isOpen, activeTab, selectedTarget]);

    // --- BADGE CALCULATION ---
    // Moved logic here to ensure badges update based on 'messages' state
    useEffect(() => {
        if (!user) return;
        // ✅ COUNT BASED ON is_read_by_me
        const unread = messages.filter(m => !m.is_read_by_me && String(m.sender_id) !== String(user.id)).length;
        const notes = messages.filter(m => String(m.sender_id) === String(user.id) && String(m.recipient_id) === String(user.id) && !m.is_read_by_me).length;
        if (onUnreadChange) onUnreadChange(unread, notes);
    }, [messages, user]);

    // Scroll
    useEffect(() => {
        if (isOpen) messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages.length, activeTab, selectedTarget, isOpen]);

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
            is_read_by_me: 0, // My own message is essentially read, but for consistency
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

    const handleCreateGroup = async () => {
        if (!newGroupName) return;
        const token = localStorage.getItem('cabane_token');
        try {
            await axios.post(`${API_URL}/api/groups`, { name: newGroupName, memberIds: newGroupMembers }, { headers: { Authorization: `Bearer ${token}` } });
            setNewGroupName(''); setNewGroupMembers([]); setIsCreatingGroup(false);
            fetchData();
        } catch (e) { alert("Failed to create group"); }
    };

    // --- VIEW LOGIC ---
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

    // Calc Local Badges for Tabs
    const badges = useMemo(() => {
        const counts = { global: 0, users: 0, groups: 0 };
        const dmCounts = {};
        const groupCounts = {};
        messages.forEach(m => {
            // ✅ USE is_read_by_me
            if (m.is_read_by_me || String(m.sender_id) === String(user?.id)) return;
            if (!m.recipient_id && !m.group_id) counts.global++;
            else if (String(m.recipient_id) === String(user?.id) && !m.group_id) {
                counts.users++;
                dmCounts[m.sender_id] = (dmCounts[m.sender_id] || 0) + 1;
            }
            else if (m.group_id) {
                counts.groups++;
                groupCounts[m.group_id] = (groupCounts[m.group_id] || 0) + 1;
            }
        });
        return { counts, dmCounts, groupCounts };
    }, [messages, user]);


    // --- RENDER ---
    const renderChat = () => (
        <div className="flex-grow overflow-y-auto p-4 space-y-3 bg-cabane-dark pb-4">
            {currentMessages.length === 0 && <div className="text-center text-gray-500 text-xs italic mt-4">No messages yet.</div>}
            {currentMessages.map(msg => {
                const isMe = user && (String(msg.sender_id) === String(user.id));
                const isUrgentMsg = msg.priority === 'URGENT';
                const userColorClass = getUserColor(msg.sender);

                return (
                    <div key={msg.id} className={`flex flex-col w-full ${isMe ? 'items-end' : 'items-start'}`}>
                        {!isMe && activeTab !== 'NOTES' && <span className="text-[10px] text-gray-500 ml-1 mb-0.5">{msg.sender}</span>}
                        <div className={clsx(
                            "max-w-[85%] p-3 rounded-lg text-sm border shadow-sm relative break-words",
                            isMe && !isUrgentMsg && "bg-blue-600 border-blue-500 text-white rounded-br-none text-right",
                            !isMe && !isUrgentMsg && clsx("rounded-bl-none border-l-4 text-gray-200 bg-gray-800", userColorClass),
                            isUrgentMsg && "bg-red-900/80 border-red-500 text-white animate-pulse",
                            msg.isOptimistic && "opacity-70"
                        )}>
                            {isUrgentMsg && <div className="flex items-center gap-1 text-[10px] font-bold text-red-300 mb-1"><AlertTriangle size={10} /> URGENT</div>}
                            {msg.content}
                            {msg.isOptimistic && <span className="absolute bottom-1 right-1 text-[8px] text-gray-300"><Clock size={8} /></span>}
                        </div>
                        <span className="text-[10px] text-gray-600 mt-1 mx-1">{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                );
            })}
            <div ref={messagesEndRef} />
        </div>
    );

    return (
        <div className={clsx("fixed inset-0 bg-black/50 z-[55] transition-opacity duration-300", isOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none")} onClick={onClose}>
            <div className={clsx("absolute top-0 bottom-0 right-0 w-full md:w-96 bg-gray-900 border-l border-gray-700 shadow-2xl transform transition-transform duration-300 flex flex-col", isOpen ? "translate-x-0" : "translate-x-full")} onClick={e => e.stopPropagation()}>

                {/* TAB HEADER */}
                <div className="flex bg-gray-900 border-b border-gray-700">
                    {['GLOBAL', 'USERS', 'GROUPS', 'NOTES'].map(t => (
                        <button key={t} onClick={() => { setActiveTab(t); setSelectedTarget(null); setIsCreatingGroup(false); setSearchQuery(''); setIsHeaderExpanded(false); }}
                            className={clsx("flex-1 py-3 text-[10px] font-bold uppercase relative transition-colors", activeTab === t ? "text-blue-400 bg-gray-800 border-b-2 border-blue-500" : "text-gray-500 hover:text-white")}>
                            {t}
                            {badges.counts[t.toLowerCase()] > 0 && <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full animate-pulse" />}
                        </button>
                    ))}
                    <button onClick={onClose} className="px-3 text-gray-400 hover:text-white"><X size={20} /></button>
                </div>

                {/* ACTIVE CHAT HEADER */}
                {selectedTarget && (
                    <div
                        className="bg-gray-800 border-b border-gray-700 p-3 flex items-start gap-2 cursor-pointer hover:bg-gray-750 transition-colors"
                        onClick={() => activeTab === 'GROUPS' ? setIsHeaderExpanded(!isHeaderExpanded) : null}
                    >
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

                {/* CONTENT */}
                <div className="flex-grow flex flex-col overflow-hidden">
                    {((activeTab === 'GLOBAL' || activeTab === 'NOTES') || selectedTarget) && !isCreatingGroup && renderChat()}

                    {!selectedTarget && (activeTab === 'USERS' || activeTab === 'GROUPS') && (
                        isCreatingGroup ? (
                            <div className="p-4 space-y-4 bg-cabane-dark h-full">
                                <div className="flex items-center gap-2 mb-4"><button onClick={() => setIsCreatingGroup(false)}><ArrowLeft size={16} className="text-white" /></button><h3 className="font-bold text-white">New Group</h3></div>
                                <input type="text" placeholder="Group Name" value={newGroupName} onChange={e => setNewGroupName(e.target.value)} className="w-full bg-gray-800 border border-gray-600 rounded p-2 text-white text-sm" />
                                <div className="space-y-1 max-h-64 overflow-y-auto border border-gray-700 rounded p-2">
                                    <label className="text-xs text-gray-500 font-bold block mb-2">SELECT MEMBERS:</label>
                                    {userList.filter(u => u.id !== user?.id).map(u => (
                                        <div key={u.id} onClick={() => setNewGroupMembers(p => p.includes(u.id) ? p.filter(i => i !== u.id) : [...p, u.id])} className={`p-2 rounded border text-xs cursor-pointer flex justify-between items-center mb-1 ${newGroupMembers.includes(u.id) ? 'bg-blue-900/30 border-blue-500 text-white' : 'bg-gray-800 border-gray-700 text-gray-400'}`}>
                                            {u.username} {newGroupMembers.includes(u.id) && <Check size={14} className="text-blue-400" />}
                                        </div>
                                    ))}
                                </div>
                                <button onClick={handleCreateGroup} className="w-full py-2 bg-blue-600 rounded font-bold text-white text-sm">Create Group</button>
                            </div>
                        ) : (
                            <div className="flex-col p-2 space-y-2 overflow-y-auto h-full bg-cabane-dark">
                                {activeTab === 'GROUPS' && <button onClick={() => setIsCreatingGroup(true)} className="w-full py-2 bg-blue-900/30 border border-blue-500/50 text-blue-300 rounded text-xs font-bold flex items-center justify-center gap-2 hover:bg-blue-900/50 mb-2"><Plus size={14} /> New Group</button>}
                                <div className="relative mb-2">
                                    <Search className="absolute left-2 top-2 text-gray-500" size={14} />
                                    <input type="text" placeholder="Search..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded pl-8 p-1.5 text-sm text-white focus:border-blue-500 outline-none" />
                                </div>
                                {(activeTab === 'USERS' ? userList : groupList)
                                    .filter(i => (i.username || i.name).toLowerCase().includes(searchQuery.toLowerCase()) && i.id !== user?.id)
                                    .map(item => {
                                        const isOnline = activeTab === 'USERS' && (onlineList || []).includes(item.username);
                                        const count = activeTab === 'USERS' ? badges.dmCounts[item.id] : badges.groupCounts[item.id];
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

                {/* INPUT FOOTER */}
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