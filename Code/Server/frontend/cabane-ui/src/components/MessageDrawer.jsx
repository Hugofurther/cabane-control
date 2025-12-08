import React, { useState, useEffect, useRef, useMemo, useLayoutEffect } from 'react';
import axios from 'axios';
import { X, Send, AlertTriangle, StickyNote, Users, User, Plus, ArrowLeft, Search, Clock, Trash2, LogOut, CheckCheck, ArrowDown, ChevronUp, ChevronDown, Check } from 'lucide-react';
import { useSocket } from '../contexts/SocketContext';
import { clsx } from 'clsx';
import { FlashViewer } from './FlashViewer';

const API_URL = import.meta.env.PROD ? '' : (import.meta.env.VITE_API_URL || 'http://localhost:3000');

// --- HELPERS ---
const getUserColor = (username) => {
    if (!username) return 'border-gray-500 text-gray-400 bg-gray-800';
    const colors = ['border-emerald-500 text-emerald-400 bg-emerald-900/10', 'border-purple-500 text-purple-400 bg-purple-900/10', 'border-orange-500 text-orange-400 bg-orange-900/10', 'border-pink-500 text-pink-400 bg-pink-900/10', 'border-cyan-500 text-cyan-400 bg-cyan-900/10', 'border-indigo-500 text-indigo-400 bg-indigo-900/10'];
    let hash = 0;
    for (let i = 0; i < username.length; i++) hash = username.charCodeAt(i) + ((hash << 5) - hash);
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
    const [zoomedMessage, setZoomedMessage] = useState(null);

    // Scroll & Ref
    const [showScrollButton, setShowScrollButton] = useState(false);
    const messagesEndRef = useRef(null);
    const chatContainerRef = useRef(null);

    // Flags
    const isAtBottomRef = useRef(true);
    const hasInitialScrolledRef = useRef(false);
    const prevMessagesLength = useRef(0);

    // --- EFFECT: REPORT BADGE COUNTS ---
    useEffect(() => {
        if (!user) return;
        const totalUnread = messages.filter(m =>
            !m.is_read_by_me &&
            String(m.sender_id) !== String(user.id)
        ).length;
        const notesCount = messages.filter(m =>
            String(m.sender_id) === String(user.id) &&
            String(m.recipient_id) === String(user.id)
        ).length;
        if (onUnreadChange) onUnreadChange(totalUnread, notesCount);
    }, [messages, user, onUnreadChange]);

    // --- SCROLL LOCK ---
    useEffect(() => {
        if (isOpen) document.body.style.overflow = 'hidden';
        else document.body.style.overflow = '';
        return () => { document.body.style.overflow = ''; };
    }, [isOpen]);

    // Reset View State
    useEffect(() => {
        if (isOpen) {
            hasInitialScrolledRef.current = false;
            isAtBottomRef.current = true;
            setShowScrollButton(false);
            fetchData();
        }
    }, [activeTab, selectedTarget, isOpen]);

    // --- FETCH DATA ---
    const fetchData = async () => {
        if (!user) return;
        const token = localStorage.getItem('cabane_token');
        try {
            const resMsg = await axios.get(`${API_URL}/api/messages`, { headers: { Authorization: `Bearer ${token}` } });
            if (Array.isArray(resMsg.data)) {
                setMessages(prev => {
                    const serverIds = new Set(resMsg.data.map(m => m.id));
                    const pendingOptimistic = prev.filter(m => m.isOptimistic && !serverIds.has(m.id));
                    return [...resMsg.data, ...pendingOptimistic];
                });
            }

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
            if (m.is_read_by_me === 1 || String(m.sender_id) === String(user.id)) return false;
            return true;
        }).map(m => m.id);

        if (unreadIds.length > 0) {
            const token = localStorage.getItem('cabane_token');
            setMessages(prev => prev.map(m => unreadIds.includes(m.id) ? { ...m, is_read_by_me: 1 } : m));
            try {
                await axios.post(`${API_URL}/api/messages/read`, { messageIds: unreadIds }, { headers: { Authorization: `Bearer ${token}` } });
            } catch (e) { }
        }
    };

    // --- SOCKET LISTENERS ---
    useEffect(() => {
        if (!socket || !user) return;

        const handleNew = (msg) => {
            setMessages(prev => {
                if (prev.some(p => p.id === msg.id)) return prev;
                if (msg.tempId) {
                    const pendingIndex = prev.findIndex(p => p.isOptimistic && p.id === msg.tempId);
                    if (pendingIndex !== -1) {
                        const newArr = [...prev];
                        newArr[pendingIndex] = { ...msg, is_read_by_me: 1, is_ack_by_me: 0 };
                        return newArr;
                    }
                }
                return [...prev, { ...msg, is_read_by_me: 0, is_ack_by_me: 0 }];
            });
        };

        const handleDelete = ({ id }) => setMessages(prev => prev.filter(m => m.id !== id));
        const handleUpdate = ({ id, priority }) => setMessages(prev => prev.map(m => m.id === id ? { ...m, priority } : m));

        const handleRead = ({ userId, messageIds }) => {
            if (String(userId) === String(user.id)) {
                setMessages(prev => prev.map(m => messageIds.includes(m.id) ? { ...m, is_read_by_me: 1 } : m));
            }
        };

        socket.on('NEW_MESSAGE', handleNew);
        socket.on('DELETE_MESSAGE', handleDelete);
        socket.on('UPDATE_MESSAGE', handleUpdate);
        socket.on('MESSAGES_READ', handleRead);

        return () => {
            socket.off('NEW_MESSAGE', handleNew);
            socket.off('DELETE_MESSAGE', handleDelete);
            socket.off('UPDATE_MESSAGE', handleUpdate);
            socket.off('MESSAGES_READ', handleRead);
        };
    }, [socket, user]);

    // --- VIEW FILTERING & SORTING ---
    const currentMessages = useMemo(() => {
        return messages.filter(m => {
            if (activeTab === 'GLOBAL') return !m.recipient_id && !m.group_id;
            if (activeTab === 'NOTES') return String(m.sender_id) === String(user.id) && String(m.recipient_id) === String(user.id);
            if (activeTab === 'USERS' && selectedTarget) return ((String(m.sender_id) === String(selectedTarget.id) && String(m.recipient_id) === String(user.id)) || (String(m.sender_id) === String(user.id) && String(m.recipient_id) === String(selectedTarget.id)));
            if (activeTab === 'GROUPS' && selectedTarget) return String(m.group_id) === String(selectedTarget.id);
            return false;
        }).sort((a, b) => {
            // 1. Optimistic ALWAYS last
            if (a.isOptimistic && !b.isOptimistic) return 1;
            if (!a.isOptimistic && b.isOptimistic) return -1;

            // 2. Sort by ID (Robust against Clock Skew)
            const idA = parseInt(a.id);
            const idB = parseInt(b.id);
            if (!isNaN(idA) && !isNaN(idB)) return idA - idB;

            // 3. Fallback
            return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
        });
    }, [messages, activeTab, selectedTarget, user]);

    // --- ✅ SCROLL LOGIC (FIXED FOR SHORT THREADS) ---
    useLayoutEffect(() => {
        if (!isOpen || !chatContainerRef.current || currentMessages.length === 0) return;
        const container = chatContainerRef.current;
        const isNewMessage = currentMessages.length > prevMessagesLength.current;

        // 🟢 FIX: Check if content actually overflows the container
        const isContentShort = container.scrollHeight <= container.clientHeight;

        if (isContentShort) {
            // If it fits, we are effectively "At Bottom"
            isAtBottomRef.current = true;
            setShowScrollButton(false);
            // Mark visible messages read immediately
            handleMarkRead(currentMessages);
            prevMessagesLength.current = currentMessages.length;
            return;
        }

        // --- Standard Logic for Overflowing Content ---

        if (!hasInitialScrolledRef.current) {
            const firstUnread = currentMessages.find(m => !m.is_read_by_me && String(m.sender_id) !== String(user.id));
            if (firstUnread) {
                const el = document.getElementById(`msg-${firstUnread.id}`);
                if (el) {
                    el.scrollIntoView({ block: 'center' });
                    setShowScrollButton(true);
                    isAtBottomRef.current = false;
                } else {
                    container.scrollTop = container.scrollHeight;
                    isAtBottomRef.current = true;
                }
            } else {
                container.scrollTop = container.scrollHeight;
                isAtBottomRef.current = true;
            }
            hasInitialScrolledRef.current = true;
            setTimeout(() => { if (isAtBottomRef.current) handleMarkRead(currentMessages); }, 500);
        } else if (isNewMessage) {
            const lastMsg = currentMessages[currentMessages.length - 1];
            const isMyMessage = lastMsg && String(lastMsg.sender_id) === String(user?.id);
            if (isMyMessage || isAtBottomRef.current) {
                container.scrollTop = container.scrollHeight;
                setShowScrollButton(false);
                isAtBottomRef.current = true;
                if (!isMyMessage && isOpen) handleMarkRead([lastMsg]);
            } else {
                setShowScrollButton(true);
            }
        }
        prevMessagesLength.current = currentMessages.length;
    }, [currentMessages, isOpen, activeTab, selectedTarget]);

    const handleScroll = () => {
        if (!chatContainerRef.current) return;
        const container = chatContainerRef.current;
        const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;
        isAtBottomRef.current = isNearBottom;
        if (isNearBottom) {
            setShowScrollButton(false);
            handleMarkRead(currentMessages);
        }
    };

    const scrollToBottom = () => {
        if (chatContainerRef.current) chatContainerRef.current.scrollTo({ top: chatContainerRef.current.scrollHeight, behavior: 'smooth' });
        setShowScrollButton(false);
        isAtBottomRef.current = true;
        handleMarkRead(currentMessages);
    };

    // --- ACTIONS ---
    const handleSend = async (e) => {
        e.preventDefault();
        if (!input.trim()) return;
        const token = localStorage.getItem('cabane_token');
        const tempId = `temp-${Date.now()}`;
        const payload = { content: input, priority: isUrgent ? 'URGENT' : 'NORMAL', tempId };

        if (activeTab === 'NOTES') payload.recipientId = user.id;
        if (activeTab === 'USERS' && selectedTarget) payload.recipientId = selectedTarget.id;
        if (activeTab === 'GROUPS' && selectedTarget) payload.groupId = selectedTarget.id;

        const optimisticMsg = {
            id: tempId, sender_id: user.id, sender: user.username,
            recipient_id: payload.recipientId || null, group_id: payload.groupId || null,
            content: input, priority: payload.priority, timestamp: new Date().toISOString(),
            is_read_by_me: 1, is_ack_by_me: 0, isOptimistic: true
        };

        setMessages(prev => [...prev, optimisticMsg]);
        setInput(''); setIsUrgent(false);
        isAtBottomRef.current = true;

        try { await axios.post(`${API_URL}/api/messages`, payload, { headers: { Authorization: `Bearer ${token}` } }); }
        catch (e) { alert("Send failed"); setMessages(prev => prev.filter(m => m.id !== tempId)); }
    };

    const handleMarkAllRead = () => {
        if (!user) return;
        const allUnreadIds = messages.filter(m => !m.is_read_by_me && String(m.sender_id) !== String(user.id)).map(m => m.id);
        if (allUnreadIds.length > 0) {
            const token = localStorage.getItem('cabane_token');
            axios.post(`${API_URL}/api/messages/read`, { messageIds: allUnreadIds }, { headers: { Authorization: `Bearer ${token}` } });
            setMessages(prev => prev.map(m => allUnreadIds.includes(m.id) ? { ...m, is_read_by_me: 1 } : m));
        }
    };

    const handleDowngradeUrgency = async (id) => {
        setMessages(prev => prev.map(m => m.id === id ? { ...m, is_ack_by_me: 1 } : m));
        try {
            const token = localStorage.getItem('cabane_token');
            await axios.post(`${API_URL}/api/messages/downgrade`, { messageId: id }, { headers: { Authorization: `Bearer ${token}` } });
        } catch (e) { console.error(e); }
    };

    const handleCreateGroup = async () => { if (!newGroupName) return; try { const token = localStorage.getItem('cabane_token'); await axios.post(`${API_URL}/api/groups`, { name: newGroupName, memberIds: newGroupMembers }, { headers: { Authorization: `Bearer ${token}` } }); setNewGroupName(''); setNewGroupMembers([]); setIsCreatingGroup(false); fetchData(); } catch (e) { alert("Failed"); } };
    const handleLeaveGroup = async () => { if (!selectedTarget || activeTab !== 'GROUPS') return; if (!confirm("Leave?")) return; try { const token = localStorage.getItem('cabane_token'); await axios.post(`${API_URL}/api/groups/leave`, { groupId: selectedTarget.id }, { headers: { Authorization: `Bearer ${token}` } }); setSelectedTarget(null); fetchData(); } catch (e) { alert("Failed"); } };
    const handleDeleteMessage = async (id) => { if (!confirm("Delete?")) return; try { const token = localStorage.getItem('cabane_token'); await axios.post(`${API_URL}/api/messages/delete`, { messageId: id }, { headers: { Authorization: `Bearer ${token}` } }); } catch (e) { alert("Delete failed"); } };

    const renderChat = () => (
        <div ref={chatContainerRef} onScroll={handleScroll} className="flex-grow overflow-y-auto p-4 space-y-3 bg-cabane-dark pb-4 overscroll-contain relative">
            {currentMessages.length === 0 && <div className="text-center text-gray-500 text-xs italic mt-4">No messages yet.</div>}
            {currentMessages.map(msg => {
                const isMe = user && (String(msg.sender_id) === String(user.id));
                const isUrgentMsg = msg.priority === 'URGENT';
                const isAcked = msg.is_ack_by_me;
                const userColorClass = getUserColor(msg.sender);
                const showRedAlert = isUrgentMsg && !isAcked;

                return (
                    <div key={msg.id} id={`msg-${msg.id}`} className={`flex flex-col w-full group ${isMe ? 'items-end' : 'items-start'}`}>
                        {!isMe && activeTab !== 'NOTES' && <span className="text-[10px] text-gray-500 ml-1 mb-0.5">{msg.sender}</span>}
                        <div onClick={() => setZoomedMessage(msg)} className={clsx("max-w-[85%] p-3 rounded-lg text-sm border shadow-sm relative break-words transition-all cursor-pointer hover:scale-[1.02]", isMe && !showRedAlert && "bg-blue-600 border-blue-500 text-white rounded-br-none text-right", !isMe && !showRedAlert && clsx("rounded-bl-none border-l-4 text-gray-200 bg-gray-800", userColorClass), showRedAlert && "bg-red-900/80 border-red-500 text-white animate-pulse", msg.isOptimistic && "opacity-70")}>
                            {showRedAlert && <div className="flex items-center gap-1 text-[10px] font-bold text-red-300 mb-1"><AlertTriangle size={10} /> FLASH MESSAGE</div>}
                            {msg.content}
                            {msg.isOptimistic && <span className="absolute bottom-1 right-1 text-[8px] text-gray-300"><Clock size={8} /></span>}
                        </div>
                        <div className="flex items-center gap-2 mt-1 mx-1">
                            <span className="text-[10px] text-gray-600">{formatSmartTime(msg.timestamp)}</span>
                            {isMe && !msg.isOptimistic && <button onClick={(e) => { e.stopPropagation(); handleDeleteMessage(msg.id); }} className="text-gray-600 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity" title="Delete"><Trash2 size={12} /></button>}
                        </div>
                    </div>
                );
            })}
            <div ref={messagesEndRef} />
            {showScrollButton && <button onClick={scrollToBottom} className="fixed bottom-20 md:bottom-40 right-4 md:right-auto md:left-1/2 md:-translate-x-1/2 flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-full shadow-lg font-bold text-xs animate-bounce z-50 border border-blue-400 cursor-pointer"><ArrowDown size={14} /> New Messages</button>}
        </div>
    );

    return (
        <div className={clsx("fixed inset-0 bg-black/50 z-[55] transition-opacity duration-300", isOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none")} onClick={onClose}>
            <div className={clsx("absolute top-0 bottom-0 right-0 w-full md:w-96 bg-gray-900 border-l border-gray-700 shadow-2xl transform transition-transform duration-300 flex flex-col", isOpen ? "translate-x-0" : "translate-x-full")} onClick={e => e.stopPropagation()}>
                <div className="p-4 bg-gray-800 border-b border-gray-700 flex justify-between items-center">
                    <div className="flex gap-2">
                        {['GLOBAL', 'USERS', 'GROUPS', 'NOTES'].map(t => (
                            <button key={t} onClick={() => { setActiveTab(t); setSelectedTarget(null); setIsCreatingGroup(false); setSearchQuery(''); setIsHeaderExpanded(false); }} className={clsx("px-2 py-1 rounded text-[10px] font-bold uppercase transition-colors relative", activeTab === t ? "bg-gray-700 text-blue-400 border border-blue-500/50" : "text-gray-500 hover:text-white")}>{t}</button>
                        ))}
                    </div>
                    <div className="flex gap-2"><button onClick={handleMarkAllRead} className="text-gray-500 hover:text-green-400" title="Mark All Read"><CheckCheck size={18} /></button><button onClick={onClose} className="text-gray-400 hover:text-white"><X size={24} /></button></div>
                </div>
                {selectedTarget && (
                    <div className="bg-gray-800 border-b border-gray-700 p-3 flex items-start gap-2 cursor-pointer hover:bg-gray-750 transition-colors" onClick={() => activeTab === 'GROUPS' ? setIsHeaderExpanded(!isHeaderExpanded) : null}>
                        <button onClick={(e) => { e.stopPropagation(); setSelectedTarget(null); }} className="mt-0.5"><ArrowLeft size={18} className="text-gray-400 hover:text-white" /></button>
                        <div className="flex-grow overflow-hidden">
                            <div className="font-bold text-sm text-white flex justify-between items-center"><span>{selectedTarget.username || selectedTarget.name}</span>{activeTab === 'GROUPS' && (<div className="flex items-center gap-2"><button onClick={(e) => { e.stopPropagation(); handleLeaveGroup(); }} className="text-[10px] text-red-400 border border-red-900/50 px-1.5 py-0.5 rounded hover:bg-red-900/30 flex items-center gap-1"><LogOut size={10} /> Leave</button>{isHeaderExpanded ? <ChevronUp size={14} className="text-gray-500" /> : <ChevronDown size={14} className="text-gray-500" />}</div>)}</div>
                            {activeTab === 'GROUPS' && selectedTarget.members && <div className={clsx("text-xs text-gray-400 mt-1 transition-all duration-300", isHeaderExpanded ? "whitespace-normal" : "truncate")}>{selectedTarget.members}</div>}
                        </div>
                    </div>
                )}
                <div className="flex-grow flex flex-col overflow-hidden">
                    {((activeTab === 'GLOBAL' || activeTab === 'NOTES') || selectedTarget) && !isCreatingGroup && renderChat()}
                    {!selectedTarget && (activeTab === 'USERS' || activeTab === 'GROUPS') && (
                        isCreatingGroup ? (
                            <div className="p-4 space-y-4 bg-cabane-dark h-full">
                                <div className="flex items-center gap-2 mb-4"><button onClick={() => setIsCreatingGroup(false)}><ArrowLeft size={16} className="text-white" /></button><h3 className="font-bold text-white">New Group</h3></div>
                                <input type="text" placeholder="Group Name" value={newGroupName} onChange={e => setNewGroupName(e.target.value)} className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-white text-sm" />
                                <div className="space-y-1 max-h-64 overflow-y-auto border border-gray-700 rounded p-2"><label className="text-xs text-gray-500 font-bold block mb-2">SELECT MEMBERS:</label>{userList && userList.filter(u => u.id !== user?.id).map(u => (<div key={u.id} onClick={() => setNewGroupMembers(p => p.includes(u.id) ? p.filter(i => i !== u.id) : [...p, u.id])} className={`p-2 rounded border text-xs cursor-pointer flex justify-between items-center mb-1 ${newGroupMembers.includes(u.id) ? 'bg-blue-900/30 border-blue-500 text-white' : 'bg-gray-800 border-gray-700 text-gray-400'}`}>{u.username} {newGroupMembers.includes(u.id) && <Check size={14} className="text-blue-400" />}</div>))}</div>
                                <button onClick={handleCreateGroup} className="w-full py-2 bg-blue-600 rounded font-bold text-white text-sm">Create Group</button>
                            </div>
                        ) : (
                            <div className="flex-col p-2 space-y-2 overflow-y-auto h-full bg-cabane-dark overscroll-contain">
                                {activeTab === 'GROUPS' && <button onClick={() => setIsCreatingGroup(true)} className="w-full py-2 bg-blue-900/30 border border-blue-500/50 text-blue-300 rounded text-xs font-bold flex items-center justify-center gap-2 hover:bg-blue-900/50 mb-2"><Plus size={14} /> New Group</button>}
                                <div className="relative mb-2"><Search className="absolute left-2 top-2 text-gray-500" size={14} /><input type="text" placeholder="Search..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded pl-8 p-1.5 text-sm text-white focus:border-blue-500 outline-none" /></div>
                                {(activeTab === 'USERS' ? userList : groupList).filter(i => (i.username || i.name).toLowerCase().includes(searchQuery.toLowerCase()) && i.id !== user?.id).map(item => { const isOnline = activeTab === 'USERS' && (onlineList || []).includes(item.username); const colorClass = activeTab === 'USERS' ? getUserColor(item.username) : 'border-gray-600 text-gray-400'; return (<div key={item.id} onClick={() => setSelectedTarget(item)} className="p-3 bg-gray-800/50 hover:bg-gray-800 rounded border border-gray-700 cursor-pointer flex justify-between items-center"><div className="flex items-center gap-3">{activeTab === 'USERS' ? (<div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs border bg-gray-900 ${colorClass}`}>{item.username.substring(0, 2).toUpperCase()}</div>) : (<div className="p-1.5 rounded bg-gray-700 text-gray-300"><Users size={16} /></div>)}<div className="flex flex-col overflow-hidden"><span className="text-sm font-bold text-gray-300">{item.username || item.name}</span>{activeTab === 'GROUPS' && <span className="text-[10px] text-gray-500 truncate w-40">{item.members}</span>}</div></div>{activeTab === 'USERS' && <div className={`w-2 h-2 rounded-full ${isOnline ? 'bg-green-500' : 'bg-gray-600'}`} title={isOnline ? "Online" : "Offline"} />}</div>); })}
                            </div>
                        )
                    )}
                </div>
                {((activeTab === 'GLOBAL' || activeTab === 'NOTES') || selectedTarget) && !isCreatingGroup && (<form onSubmit={handleSend} className="p-4 bg-gray-800 border-t border-gray-700"><div className="flex gap-2 mb-2">{activeTab !== 'NOTES' && (<label className={`flex items-center gap-1 text-xs font-bold cursor-pointer px-2 py-1 rounded border transition-colors ${isUrgent ? 'bg-red-900 text-red-200 border-red-600' : 'bg-gray-700 text-gray-400 border-gray-600'}`}><input type="checkbox" className="hidden" checked={isUrgent} onChange={e => setIsUrgent(e.target.checked)} /><AlertTriangle size={12} /> FLASH MESSAGE</label>)}</div><div className="flex gap-2"><input type="text" value={input} onChange={e => setInput(e.target.value)} placeholder="Type a message..." className="flex-grow bg-gray-900 border border-gray-600 rounded-lg p-2 text-white outline-none" /><button type="submit" className="p-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-white"><Send size={20} /></button></div></form>)}
            </div>
            {zoomedMessage && <FlashViewer messages={[zoomedMessage]} readOnly={true} onDismiss={() => handleDowngradeUrgency(zoomedMessage.id)} onClose={() => setZoomedMessage(null)} />}
        </div>
    );
};