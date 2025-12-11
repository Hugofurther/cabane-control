import React, { useState, useEffect, useRef, useMemo, useLayoutEffect } from 'react';
import axios from 'axios';
import { X, CheckCheck, ArrowLeft, Settings, Edit3, UserMinus, Crown, Trash, Check, ChevronDown } from 'lucide-react';
import { useSocket } from '../../contexts/SocketContext';
import { clsx } from 'clsx';
import { useModal } from '../../contexts/ModalContext';
import { FlashViewer } from '../FlashViewer';
import { getAdminName } from './utils';

// Sub Components
import { ChatView } from './ChatView';
import { NotesView } from './NotesView';
import { DirectoryView } from './DirectoryView';
import { ShareModal } from './ShareModal';

const API_URL = import.meta.env.PROD ? '' : (import.meta.env.VITE_API_URL || 'http://localhost:3000');

export const MessageDrawer = ({ isOpen, onClose, onUnreadChange }) => {
    const { showConfirm, showAlert } = useModal();
    const { user, socket } = useSocket();

    // --- STATE ---
    const [activeTab, setActiveTab] = useState('GLOBAL');
    const [selectedTarget, setSelectedTarget] = useState(null);
    const [isCreatingGroup, setIsCreatingGroup] = useState(false);
    const [isGroupSettingsOpen, setIsGroupSettingsOpen] = useState(false);

    // Data
    const [messages, setMessages] = useState([]);
    const [userList, setUserList] = useState([]);
    const [groupList, setGroupList] = useState([]);
    const [notes, setNotes] = useState([]);

    // UI State
    const [viewingNote, setViewingNote] = useState(null);
    const [zoomedMessage, setZoomedMessage] = useState(null);
    const [shareTargetNote, setShareTargetNote] = useState(null);
    const [shareModalOpen, setShareModalOpen] = useState(false);
    const [shareModalIsFlash, setShareModalIsFlash] = useState(false);
    const [initialEditMode, setInitialEditMode] = useState(false);

    // Inputs
    const [input, setInput] = useState('');
    const [isUrgent, setIsUrgent] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [newGroupName, setNewGroupName] = useState('');
    const [newGroupMembers, setNewGroupMembers] = useState([]);
    const [renameInput, setRenameInput] = useState('');
    const [notifyType, setNotifyType] = useState('PUBLIC');

    // Scroll
    const [showScrollButton, setShowScrollButton] = useState(false);
    const messagesEndRef = useRef(null);
    const chatContainerRef = useRef(null);
    const isAtBottomRef = useRef(true);
    const hasInitialScrolledRef = useRef(false);
    const prevMessagesLength = useRef(0);
    const allowedGroupIds = useRef(new Set());

    // --- DATA FETCHING ---
    const fetchData = async () => {
        if (!user) return;
        const token = localStorage.getItem('cabane_token');
        try {
            const resMsg = await axios.get(`${API_URL}/api/messages`, { headers: { Authorization: `Bearer ${token}` } });
            if (Array.isArray(resMsg.data)) setMessages(prev => {
                const serverIds = new Set(resMsg.data.map(m => m.id));
                const pending = prev.filter(m => m.isOptimistic && !serverIds.has(m.id));
                return [...resMsg.data, ...pending];
            });
            const resUsers = await axios.get(`${API_URL}/api/users/directory`, { headers: { Authorization: `Bearer ${token}` } });
            if (Array.isArray(resUsers.data)) setUserList(resUsers.data);
            const resConvos = await axios.get(`${API_URL}/api/conversations`, { headers: { Authorization: `Bearer ${token}` } });
            if (Array.isArray(resConvos.data)) {
                const groups = resConvos.data.filter(c => c.type === 'GROUP');
                setGroupList(groups);
                allowedGroupIds.current = new Set(groups.map(g => String(g.id)));
            }
        } catch (e) { console.error(e); }
    };

    const fetchNotes = async () => {
        const token = localStorage.getItem('cabane_token');
        try {
            const res = await axios.get(`${API_URL}/api/notes`, { headers: { Authorization: `Bearer ${token}` } });
            setNotes(res.data || []);
        } catch (e) { console.error(e); }
    };

    // --- SOCKETS ---
    useEffect(() => {
        if (!socket || !user) return;

        // Listeners for Messages, Notes, Group updates...
        const handleNew = (msg) => {
            setMessages(prev => {
                if (prev.some(p => p.id === msg.id)) return prev;
                // Filtering logic (same as before)
                if (msg.recipient_id && String(msg.recipient_id) !== String(user.id)) { if (String(msg.sender_id) !== String(user.id)) return prev; }
                if (msg.group_id && !allowedGroupIds.current.has(String(msg.group_id))) { if (String(msg.sender_id) !== String(user.id)) return prev; }
                if (msg.tempId) {
                    const idx = prev.findIndex(p => p.isOptimistic && p.id === msg.tempId);
                    if (idx !== -1) { const newArr = [...prev]; newArr[idx] = { ...msg, is_read_by_me: 1, is_ack_by_me: 0 }; return newArr; }
                }
                return [...prev, { ...msg, is_read_by_me: 0, is_ack_by_me: 0 }];
            });
        };
        const handleNoteUpdate = (updatedNote) => {
            setNotes(prev => {
                const exists = prev.find(n => n.id === updatedNote.id);
                if (exists) return prev.map(n => n.id === updatedNote.id ? { ...n, ...updatedNote, is_owner: n.creator_id === user.id ? 1 : 0 } : n);
                if (updatedNote.creator_id === user.id || (updatedNote.shared_with_names && updatedNote.shared_with_names.includes(user.username))) return [updatedNote, ...prev];
                return prev;
            });
            setViewingNote(prev => (prev && prev.id === updatedNote.id) ? { ...prev, ...updatedNote } : prev);
        };
        const handleNoteDelete = ({ id }) => {
            setNotes(prev => prev.filter(n => n.id !== id));
            setViewingNote(prev => (prev && String(prev.id) === String(id)) ? null : prev);
        };
        const handleDeleteMsg = ({ id }) => setMessages(prev => prev.filter(m => m.id !== id));
        const handleUpdateMsg = ({ id, priority }) => setMessages(prev => prev.map(m => m.id === id ? { ...m, priority } : m));
        const handleReadMsg = ({ userId, messageIds }) => { if (String(userId) === String(user.id)) setMessages(prev => prev.map(m => messageIds.includes(m.id) ? { ...m, is_read_by_me: 1 } : m)); };

        socket.on('NEW_MESSAGE', handleNew);
        socket.on('NOTE_UPDATE', handleNoteUpdate);
        socket.on('NOTE_DELETE', handleNoteDelete);
        socket.on('DELETE_MESSAGE', handleDeleteMsg);
        socket.on('UPDATE_MESSAGE', handleUpdateMsg);
        socket.on('MESSAGES_READ', handleReadMsg);

        return () => {
            socket.off('NEW_MESSAGE', handleNew);
            socket.off('NOTE_UPDATE', handleNoteUpdate);
            socket.off('NOTE_DELETE', handleNoteDelete);
            socket.off('DELETE_MESSAGE', handleDeleteMsg);
            socket.off('UPDATE_MESSAGE', handleUpdateMsg);
            socket.off('MESSAGES_READ', handleReadMsg);
        };
    }, [socket, user]);

    // --- EFFECTS ---
    useEffect(() => {
        if (isOpen) {
            hasInitialScrolledRef.current = false;
            isAtBottomRef.current = true;
            setShowScrollButton(false);
            fetchData();
            if (activeTab === 'NOTES') fetchNotes();
        }
    }, [activeTab, selectedTarget, isOpen]);

    useEffect(() => {
        if (selectedTarget && activeTab === 'GROUPS') setRenameInput(selectedTarget.name || '');
    }, [selectedTarget]);

    useEffect(() => {
        if (!user) return;
        const totalUnread = messages.filter(m => !m.is_read_by_me && String(m.sender_id) !== String(user.id)).length;
        if (onUnreadChange) onUnreadChange(totalUnread, null);
    }, [messages, user, onUnreadChange]);

    // --- LOGIC ---
    const getTabUnreadCount = (tab) => {
        if (!user) return 0;
        return messages.filter(m => {
            const isUnread = !m.is_read_by_me && String(m.sender_id) !== String(user.id);
            if (!isUnread) return false;
            if (tab === 'GLOBAL') return !m.recipient_id && !m.group_id;
            if (tab === 'USERS') return m.recipient_id && !m.group_id;
            if (tab === 'GROUPS') return m.group_id;
            return false;
        }).length;
    };

    const currentMessages = useMemo(() => {
        return messages.filter(m => {
            if (activeTab === 'GLOBAL') return !m.recipient_id && !m.group_id;
            if (activeTab === 'NOTES') return false;
            if (activeTab === 'USERS' && selectedTarget) return ((String(m.sender_id) === String(selectedTarget.id) && String(m.recipient_id) === String(user.id)) || (String(m.sender_id) === String(user.id) && String(m.recipient_id) === String(selectedTarget.id)));
            if (activeTab === 'GROUPS' && selectedTarget) return String(m.group_id) === String(selectedTarget.id);
            return false;
        }).sort((a, b) => {
            if (a.isOptimistic && !b.isOptimistic) return 1; if (!a.isOptimistic && b.isOptimistic) return -1;
            const idA = parseInt(a.id); const idB = parseInt(b.id);
            if (!isNaN(idA) && !isNaN(idB)) return idA - idB;
            return new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
        });
    }, [messages, activeTab, selectedTarget, user]);

    // --- SCROLL LOGIC ---
    useLayoutEffect(() => {
        if (!isOpen || !chatContainerRef.current || currentMessages.length === 0 || activeTab === 'NOTES') return;
        const container = chatContainerRef.current;
        const isNewMessage = currentMessages.length > prevMessagesLength.current;
        const isContentShort = container.scrollHeight <= container.clientHeight;

        if (isContentShort) { isAtBottomRef.current = true; setShowScrollButton(false); handleMarkRead(currentMessages); prevMessagesLength.current = currentMessages.length; return; }

        if (!hasInitialScrolledRef.current) {
            container.scrollTop = container.scrollHeight;
            isAtBottomRef.current = true;
            hasInitialScrolledRef.current = true;
            setTimeout(() => { if (isAtBottomRef.current) handleMarkRead(currentMessages); }, 500);
        } else if (isNewMessage) {
            const lastMsg = currentMessages[currentMessages.length - 1];
            const isMyMessage = lastMsg && String(lastMsg.sender_id) === String(user?.id);
            if (isMyMessage || isAtBottomRef.current) { container.scrollTop = container.scrollHeight; setShowScrollButton(false); isAtBottomRef.current = true; if (!isMyMessage && isOpen) handleMarkRead([lastMsg]); }
            else { setShowScrollButton(true); }
        }
        prevMessagesLength.current = currentMessages.length;
    }, [currentMessages, isOpen, activeTab, selectedTarget]);

    const handleScroll = () => {
        if (!chatContainerRef.current) return;
        const isNearBottom = chatContainerRef.current.scrollHeight - chatContainerRef.current.scrollTop - chatContainerRef.current.clientHeight < 100;
        isAtBottomRef.current = isNearBottom;
        if (isNearBottom) { setShowScrollButton(false); handleMarkRead(currentMessages); }
    };
    const scrollToBottom = () => { if (chatContainerRef.current) chatContainerRef.current.scrollTo({ top: chatContainerRef.current.scrollHeight, behavior: 'smooth' }); setShowScrollButton(false); isAtBottomRef.current = true; handleMarkRead(currentMessages); };

    const handleMarkRead = async (msgs) => {
        if (!user) return;
        const unreadIds = msgs.filter(m => !m.is_read_by_me && String(m.sender_id) !== String(user.id)).map(m => m.id);
        if (unreadIds.length > 0) {
            const token = localStorage.getItem('cabane_token');
            try { await axios.post(`${API_URL}/api/messages/read`, { messageIds: unreadIds }, { headers: { Authorization: `Bearer ${token}` } }); } catch (e) { }
            // Optimistic update handled by socket
        }
    };
    const handleMarkAllRead = () => handleMarkRead(currentMessages);

    // --- ACTIONS ---
    const handleSend = async (e) => {
        e.preventDefault(); if (!input.trim()) return;
        const token = localStorage.getItem('cabane_token');
        const tempId = `temp-${Date.now()}`;
        const payload = { content: input, priority: isUrgent ? 'URGENT' : 'NORMAL', tempId };
        if (activeTab === 'USERS' && selectedTarget) payload.recipientId = selectedTarget.id;
        if (activeTab === 'GROUPS' && selectedTarget) payload.groupId = selectedTarget.id;

        const optimisticMsg = { id: tempId, sender_id: user.id, sender: user.username, recipient_id: payload.recipientId || null, group_id: payload.groupId || null, content: input, priority: payload.priority, timestamp: new Date().toISOString(), is_read_by_me: 1, is_ack_by_me: 0, isOptimistic: true };
        setMessages(prev => [...prev, optimisticMsg]);
        setInput(''); setIsUrgent(false);
        isAtBottomRef.current = true;
        try { await axios.post(`${API_URL}/api/messages`, payload, { headers: { Authorization: `Bearer ${token}` } }); }
        catch (e) { showAlert("Error", "Send failed"); setMessages(prev => prev.filter(m => m.id !== tempId)); }
    };

    // Note Handlers
    const handleCreateNote = async (title) => {
        try {
            const token = localStorage.getItem('cabane_token');
            const res = await axios.post(`${API_URL}/api/notes`, { title, content: "" }, { headers: { Authorization: `Bearer ${token}` } });
            const newNote = { id: res.data.id, title, content: "", is_owner: 1, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
            fetchNotes();
            setViewingNote(newNote);
            setInitialEditMode(true);
        } catch (e) { showAlert("Error", "Failed to create note."); }
    };
    const handleUpdateNote = async (id, title, content) => {
        try {
            const token = localStorage.getItem('cabane_token');
            await axios.put(`${API_URL}/api/notes/${id}`, { title, content }, { headers: { Authorization: `Bearer ${token}` } });
            fetchNotes();
            setViewingNote(null);
        } catch (e) { showAlert("Error", "Failed to save note."); }
    };
    const handleDeleteNote = (id) => {
        showConfirm({
            title: "Delete Note?", message: "Permanently delete this note?", isDestructive: true, onConfirm: async () => {
                try { await axios.delete(`${API_URL}/api/notes/${id}`, { headers: { Authorization: `Bearer ${localStorage.getItem('cabane_token')}` } }); fetchNotes(); }
                catch (e) { showAlert("Error", "Delete failed."); }
            }
        });
    };
    const handleCopyNote = async (id) => {
        try { await axios.post(`${API_URL}/api/notes/${id}/copy`, {}, { headers: { Authorization: `Bearer ${localStorage.getItem('cabane_token')}` } }); fetchNotes(); showAlert("Success", "Copied to your notes."); }
        catch (e) { showAlert("Error", "Copy failed."); }
    };
    const openShareModal = (note, isFlash) => { setShareTargetNote(note); setShareModalIsFlash(isFlash); setShareModalOpen(true); };
    const handleUnshareNote = (noteId, username) => {
        const targetUser = userList.find(u => u.username === username);
        if (!targetUser) return;
        showConfirm({
            title: "Revoke Access", message: `Remove ${username}?`, isDestructive: true, onConfirm: async () => {
                try { await axios.post(`${API_URL}/api/notes/${noteId}/unshare`, { targetUserId: targetUser.id }, { headers: { Authorization: `Bearer ${localStorage.getItem('cabane_token')}` } }); }
                catch (e) { showAlert("Error", "Failed."); }
            }
        });
    };

    // Chat Message Handlers
    const handleCancelUrgency = (id) => {
        showConfirm({
            title: "Cancel Flash", message: "Stop alarm for all?", isDestructive: true, onConfirm: async () => {
                try { await axios.post(`${API_URL}/api/messages/cancel-urgency`, { messageId: id }, { headers: { Authorization: `Bearer ${localStorage.getItem('cabane_token')}` } }); }
                catch (e) { showAlert("Error", "Failed."); }
            }
        });
    };
    const handleDeleteMessage = (id) => {
        showConfirm({
            title: "Delete Message", message: "Delete this message?", isDestructive: true, onConfirm: async () => {
                try { await axios.post(`${API_URL}/api/messages/delete`, { messageId: id }, { headers: { Authorization: `Bearer ${localStorage.getItem('cabane_token')}` } }); }
                catch (e) { showAlert("Error", "Failed."); }
            }
        });
    };
    const handleDowngradeUrgency = async (id) => {
        setMessages(prev => prev.map(m => m.id === id ? { ...m, is_ack_by_me: 1 } : m));
        try { await axios.post(`${API_URL}/api/messages/downgrade`, { messageId: id }, { headers: { Authorization: `Bearer ${localStorage.getItem('cabane_token')}` } }); } catch (e) { }
    };

    // --- RENDER ---
    return (
        <div className={clsx("fixed inset-0 bg-black/50 z-[55] transition-opacity duration-300", isOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none")} onClick={onClose}>
            <div className={clsx("absolute top-0 bottom-0 right-0 w-full md:w-96 bg-gray-900 border-l border-gray-700 shadow-2xl transform transition-transform duration-300 flex flex-col", isOpen ? "translate-x-0" : "translate-x-full")} onClick={e => e.stopPropagation()}>

                {/* HEADER */}
                <div className="p-4 bg-gray-800 border-b border-gray-700 flex justify-between items-center shrink-0">
                    <div className="flex gap-2">
                        {['GLOBAL', 'USERS', 'GROUPS', 'NOTES'].map(t => {
                            const count = getTabUnreadCount(t);
                            return (
                                <button key={t} onClick={() => { setActiveTab(t); setSelectedTarget(null); setIsCreatingGroup(false); setIsGroupSettingsOpen(false); setSearchQuery(''); }} className={clsx("px-2 py-1 rounded text-[10px] font-bold uppercase transition-colors relative", activeTab === t ? "bg-gray-700 text-blue-400 border border-blue-500/50" : "text-gray-500 hover:text-white")}>
                                    {t} {count > 0 && <span className="absolute -top-1 -right-1 flex h-3 w-3 items-center justify-center rounded-full bg-red-500 text-[8px] text-white">{count > 9 ? '9+' : count}</span>}
                                </button>
                            );
                        })}
                    </div>
                    <div className="flex gap-2"><button onClick={handleMarkAllRead} className="text-gray-500 hover:text-green-400"><CheckCheck size={18} /></button><button onClick={onClose} className="text-gray-400 hover:text-white"><X size={24} /></button></div>
                </div>

                {/* SUB HEADER & BODY */}
                <div className="flex-grow flex flex-col overflow-hidden">
                    {/* 1. NOTES VIEW */}
                    {activeTab === 'NOTES' && (
                        <NotesView
                            notes={notes}
                            onViewNote={(n) => { setViewingNote(n); setInitialEditMode(n.is_owner === 1); }}
                            onCreateNote={handleCreateNote}
                            onDeleteNote={handleDeleteNote}
                            onCopyNote={handleCopyNote}
                            onShareNote={openShareModal}
                            onFlashNote={(n) => openShareModal(n, true)} // Reuses ShareModal logic
                        />
                    )}

                    {/* 2. CHAT / DIRECTORY VIEW */}
                    {activeTab !== 'NOTES' && (
                        <>
                            {/* SUB-HEADER (User/Group Header) */}
                            {selectedTarget && !isCreatingGroup && (
                                <div className="bg-gray-800 border-b border-gray-700 p-3 flex justify-between items-center shrink-0">
                                    <div className="flex items-center gap-2 cursor-pointer text-white" onClick={() => setSelectedTarget(null)}><ArrowLeft size={18} /><span className="font-bold text-sm truncate">{selectedTarget.username || selectedTarget.name}</span></div>
                                    {activeTab === 'GROUPS' && String(selectedTarget.created_by) === String(user.id) && <button onClick={() => setIsGroupSettingsOpen(!isGroupSettingsOpen)}><Settings size={16} className="text-gray-400 hover:text-white" /></button>}
                                </div>
                            )}

                            {/* GROUP SETTINGS */}
                            {isGroupSettingsOpen && activeTab === 'GROUPS' && selectedTarget && (
                                <div className="bg-gray-850 p-4 space-y-4">
                                    <h4 className="text-xs font-bold text-gray-500 uppercase">Admin Zone</h4>
                                    {/* ... [Admin Logic Placeholder - Keep existing] ... */}
                                    <button onClick={handleDeleteGroup} className="w-full py-2 bg-red-900/50 text-red-300 rounded text-xs">Delete Group</button>
                                </div>
                            )}

                            {/* CONTENT SWITCHOVER */}
                            {isCreatingGroup ? (
                                <div className="p-4 space-y-4">
                                    <h3 className="font-bold text-white">New Group</h3>
                                    <input type="text" placeholder="Group Name" value={newGroupName} onChange={e => setNewGroupName(e.target.value)} className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-white text-sm" />
                                    <button onClick={handleCreateGroup} className="w-full py-2 bg-blue-600 rounded font-bold text-white text-sm">Create</button>
                                    <button onClick={() => setIsCreatingGroup(false)} className="w-full py-2 bg-gray-700 rounded text-gray-300 text-sm">Cancel</button>
                                </div>
                            ) : (
                                (!selectedTarget && activeTab !== 'GLOBAL') ? (
                                    <DirectoryView
                                        activeTab={activeTab}
                                        list={activeTab === 'USERS' ? userList : groupList}
                                        userList={userList}
                                        searchQuery={searchQuery}
                                        setSearchQuery={setSearchQuery}
                                        onSelect={setSelectedTarget}
                                        onCreateGroupClick={() => setIsCreatingGroup(true)}
                                    />
                                ) : (
                                    <ChatView
                                        messages={currentMessages}
                                        user={user}
                                        input={input} setInput={setInput}
                                        isUrgent={isUrgent} setIsUrgent={setIsUrgent}
                                        onSend={handleSend}
                                        onZoom={(m) => setZoomedMessage(m)}
                                        onDelete={handleDeleteMessage}
                                        onCancelUrgency={handleCancelUrgency}
                                        scrollRef={messagesEndRef}
                                        containerRef={chatContainerRef}
                                        showScrollButton={showScrollButton}
                                        onScrollToBottom={scrollToBottom}
                                        onScroll={handleScroll}
                                    />
                                )
                            )}
                        </>
                    )}
                </div>
            </div>

            {/* MODALS */}
            {zoomedMessage && <FlashViewer messages={[zoomedMessage]} readOnly={true} onDismiss={() => handleDowngradeUrgency(zoomedMessage.id)} onClose={() => setZoomedMessage(null)} onShare={() => openShareModal({ id: zoomedMessage.noteId || zoomedMessage.id, title: zoomedMessage.title || "Flash Memo" }, true)} onUnshare={handleUnshareNote} userList={userList} />}

            {viewingNote && <FlashViewer messages={[viewingNote]} readOnly={false} isOwner={viewingNote.is_owner === 1} initialEditMode={initialEditMode} onClose={() => setViewingNote(null)} onSave={handleUpdateNote} onShare={() => openShareModal(viewingNote, false)} onUnshare={handleUnshareNote} userList={userList} />}

            {shareModalOpen && shareTargetNote && <ShareModal note={shareTargetNote} users={userList.filter(u => u.id !== user?.id)} isFlash={shareModalIsFlash} showAlert={showAlert} onClose={() => setShareModalOpen(false)} />}
        </div>
    );
};