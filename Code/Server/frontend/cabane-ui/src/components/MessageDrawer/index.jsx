import React, { useState, useEffect, useRef, useMemo, useLayoutEffect } from 'react';
import axios from 'axios';
import { X, CheckCheck, ArrowLeft, Settings, Edit3, UserMinus, Crown, Trash, Check, ChevronDown, Plus, Search, Send, AlertTriangle, Clock } from 'lucide-react';
import { clsx } from 'clsx';
import { useSocket } from '../../contexts/SocketContext';
import { useModal } from '../../contexts/ModalContext';
import { FlashViewer } from '../FlashViewer';

// Sub-Components
import { ChatView } from './ChatView';
import { NotesView } from './NotesView';
import { DirectoryView } from './DirectoryView';
import { ShareModal } from './ShareModal';
import { getAdminName, formatSmartTime, getUserColor } from './utils';

const API_URL = import.meta.env.PROD ? '' : (import.meta.env.VITE_API_URL || 'http://localhost:3000');

export const MessageDrawer = ({ isOpen, onClose, onUnreadChange }) => {
    const { showConfirm, showAlert } = useModal();
    const { user, socket } = useSocket();

    // --- STATE ---
    const [activeTab, setActiveTab] = useState('GLOBAL');
    const [selectedTarget, setSelectedTarget] = useState(null);
    const [isCreatingGroup, setIsCreatingGroup] = useState(false);
    const [isGroupSettingsOpen, setIsGroupSettingsOpen] = useState(false);

    // Data Lists
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

    // Scroll Refs
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

    // Helper: Ensure User Directory Exists (Crucial for Unshare)
    const ensureDirectory = async () => {
        if (userList && userList.length > 0) return userList;
        const token = localStorage.getItem('cabane_token');
        try {
            const res = await axios.get(`${API_URL}/api/users/directory`, { headers: { Authorization: `Bearer ${token}` } });
            if (Array.isArray(res.data)) {
                setUserList(res.data);
                return res.data;
            }
        } catch (e) { console.error("Directory fetch failed", e); }
        return [];
    };

    // --- SOCKET LISTENERS ---
    useEffect(() => {
        if (!socket || !user) return;

        const handleNew = (msg) => {
            setMessages(prev => {
                if (prev.some(p => p.id === msg.id)) return prev;
                if (msg.recipient_id && String(msg.recipient_id) !== String(user.id)) { if (String(msg.sender_id) !== String(user.id)) return prev; }
                if (msg.group_id && !allowedGroupIds.current.has(String(msg.group_id))) { if (String(msg.sender_id) !== String(user.id)) return prev; }
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
        const handleNoteDelete = ({ id, targetUserId }) => {
            if (targetUserId && String(targetUserId) !== String(user.id)) return;
            setNotes(prev => prev.filter(n => n.id !== id));
            setViewingNote(prev => (prev && String(prev.id) === String(id)) ? null : prev);
        };
        const handleMembership = ({ targetUserId, groupId, action }) => {
            if (String(targetUserId) === String(user.id)) {
                if (action === 'ADD') allowedGroupIds.current.add(String(groupId));
                else if (action === 'REMOVE') allowedGroupIds.current.delete(String(groupId));
                fetchData();
                if (action === 'REMOVE' && activeTab === 'GROUPS' && String(selectedTarget?.id) === String(groupId)) {
                    setSelectedTarget(null);
                    showAlert("Removed", "You have been removed from this group.");
                }
            }
        };
        const handleGroupDeleted = ({ groupId }) => {
            allowedGroupIds.current.delete(String(groupId));
            fetchData();
            if (activeTab === 'GROUPS' && String(selectedTarget?.id) === String(groupId)) {
                setSelectedTarget(null);
                showAlert("Deleted", "This group has been deleted by the admin.");
            }
        };
        const handleDeleteMsg = ({ id }) => setMessages(prev => prev.filter(m => m.id !== id));
        const handleUpdateMsg = ({ id, priority }) => setMessages(prev => prev.map(m => m.id === id ? { ...m, priority } : m));
        const handleReadMsg = ({ userId, messageIds }) => { if (String(userId) === String(user.id)) setMessages(prev => prev.map(m => messageIds.includes(m.id) ? { ...m, is_read_by_me: 1 } : m)); };

        socket.on('NEW_MESSAGE', handleNew);
        socket.on('NOTE_UPDATE', handleNoteUpdate);
        socket.on('NOTE_DELETE', handleNoteDelete);
        socket.on('GROUP_MEMBERSHIP_UPDATE', handleMembership);
        socket.on('GROUP_DELETED', handleGroupDeleted);
        socket.on('DELETE_MESSAGE', handleDeleteMsg);
        socket.on('UPDATE_MESSAGE', handleUpdateMsg);
        socket.on('MESSAGES_READ', handleReadMsg);

        return () => {
            socket.off('NEW_MESSAGE', handleNew);
            socket.off('NOTE_UPDATE', handleNoteUpdate);
            socket.off('NOTE_DELETE', handleNoteDelete);
            socket.off('GROUP_MEMBERSHIP_UPDATE', handleMembership);
            socket.off('GROUP_DELETED', handleGroupDeleted);
            socket.off('DELETE_MESSAGE', handleDeleteMsg);
            socket.off('UPDATE_MESSAGE', handleUpdateMsg);
            socket.off('MESSAGES_READ', handleReadMsg);
        };
    }, [socket, user, activeTab, selectedTarget]);

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

    useEffect(() => {
        if (isGroupSettingsOpen) setNotifyType(user?.settings?.defaultGroupNotify || 'PUBLIC');
    }, [isGroupSettingsOpen, user]);

    // --- COMPUTED HELPERS ---
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

    // --- SCROLL HANDLING ---
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
        }
    };
    const handleMarkAllRead = () => handleMarkRead(currentMessages);

    // --- NOTE HANDLERS ---
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

    // ✅ FIXED UNSHARE LOGIC (Auto-Fetch)
    const handleUnshareNote = async (noteId, username) => {
        console.log(`[Unshare] Request: Note ${noteId}, User ${username}`);

        let currentDirectory = userList;
        // Auto-fetch if empty
        if (!currentDirectory || currentDirectory.length === 0) {
            console.log("[Unshare] Fetching directory...");
            currentDirectory = await ensureDirectory();
        }

        if (!currentDirectory || currentDirectory.length === 0) {
            showAlert("System Error", "User directory unavailable.");
            return;
        }

        const safeUsername = username.trim().toLowerCase();
        const targetUser = currentDirectory.find(u => u.username.toLowerCase() === safeUsername);

        if (!targetUser) {
            showAlert("Error", `User "${username}" not found.`);
            return;
        }

        showConfirm({
            title: "Revoke Access",
            message: `Remove ${targetUser.username} from this note?`,
            isDestructive: true,
            onConfirm: async () => {
                // Optimistic Update
                const updateSharedWith = (currentList) => {
                    if (!currentList) return "";
                    return currentList.split(', ').filter(u => u.toLowerCase() !== username.trim().toLowerCase()).join(', ');
                };
                setNotes(prev => prev.map(n => n.id === noteId ? { ...n, shared_with_names: updateSharedWith(n.shared_with_names) } : n));
                setViewingNote(prev => (prev && prev.id === noteId) ? { ...prev, shared_with_names: updateSharedWith(prev.shared_with_names) } : prev);

                try {
                    await axios.post(`${API_URL}/api/notes/${noteId}/unshare`,
                        { targetUserId: targetUser.id },
                        { headers: { Authorization: `Bearer ${localStorage.getItem('cabane_token')}` } }
                    );
                } catch (e) {
                    showAlert("Error", "Failed to revoke access.");
                    fetchNotes(); // Revert
                }
            }
        });
    };

    // Chat Actions
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
    const handleCancelUrgency = (id) => { showConfirm({ title: "Cancel Flash", message: "Stop alarm for all?", isDestructive: true, onConfirm: async () => { try { await axios.post(`${API_URL}/api/messages/cancel-urgency`, { messageId: id }, { headers: { Authorization: `Bearer ${localStorage.getItem('cabane_token')}` } }); } catch (e) { showAlert("Error", "Failed."); } } }); };
    const handleDeleteMessage = (id) => { showConfirm({ title: "Delete Message", message: "Delete this message?", isDestructive: true, onConfirm: async () => { try { await axios.post(`${API_URL}/api/messages/delete`, { messageId: id }, { headers: { Authorization: `Bearer ${localStorage.getItem('cabane_token')}` } }); } catch (e) { showAlert("Error", "Failed."); } } }); };
    const handleDowngradeUrgency = async (id) => { setMessages(prev => prev.map(m => m.id === id ? { ...m, is_ack_by_me: 1 } : m)); try { await axios.post(`${API_URL}/api/messages/downgrade`, { messageId: id }, { headers: { Authorization: `Bearer ${localStorage.getItem('cabane_token')}` } }); } catch (e) { } };

    // Group Actions
    const handleCreateGroup = async () => { if (!newGroupName) return; try { const token = localStorage.getItem('cabane_token'); await axios.post(`${API_URL}/api/groups`, { name: newGroupName, memberIds: newGroupMembers }, { headers: { Authorization: `Bearer ${token}` } }); setNewGroupName(''); setNewGroupMembers([]); setIsCreatingGroup(false); fetchData(); } catch (e) { showAlert("Error", e.response?.data?.error || "Failed"); } };
    const handleRenameGroup = async () => { if (!renameInput) return; try { const token = localStorage.getItem('cabane_token'); await axios.post(`${API_URL}/api/groups/${selectedTarget.id}/rename`, { newName: renameInput }, { headers: { Authorization: `Bearer ${token}` } }); setSelectedTarget(prev => ({ ...prev, name: renameInput })); fetchData(); showAlert("Success", "Group renamed."); } catch (e) { showAlert("Error", e.response?.data?.error || "Failed"); } };
    const handleDeleteGroup = () => { if (!selectedTarget) return; showConfirm({ title: "Delete Group", message: "Delete this group?", isDestructive: true, onConfirm: async () => { try { const token = localStorage.getItem('cabane_token'); await axios.post(`${API_URL}/api/groups/${selectedTarget.id}/delete`, {}, { headers: { Authorization: `Bearer ${token}` } }); setSelectedTarget(null); fetchData(); } catch (e) { showAlert("Error", "Failed."); } } }); };
    const handleTransferAdmin = (newAdminId) => { showConfirm({ title: "Transfer Ownership", message: "Transfer admin rights?", isDestructive: false, onConfirm: async () => { try { const token = localStorage.getItem('cabane_token'); await axios.post(`${API_URL}/api/groups/${selectedTarget.id}/transfer`, { newAdminId }, { headers: { Authorization: `Bearer ${token}` } }); fetchData(); setIsGroupSettingsOpen(false); showAlert("Success", "Transferred."); } catch (e) { showAlert("Error", "Failed."); } } }); };
    const handleManageMember = async (targetId, action) => { try { const token = localStorage.getItem('cabane_token'); await axios.post(`${API_URL}/api/groups/${selectedTarget.id}/members`, { targetUserId: targetId, action, notificationType: notifyType }, { headers: { Authorization: `Bearer ${token}` } }); fetchData(); } catch (e) { showAlert("Error", "Failed."); } };

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
                    <div className="flex gap-2"><button onClick={() => handleMarkAllRead()} className="text-gray-500 hover:text-green-400"><CheckCheck size={18} /></button><button onClick={onClose} className="text-gray-400 hover:text-white"><X size={24} /></button></div>
                </div>

                {/* SUB HEADER & BODY */}
                <div className="flex-grow flex flex-col overflow-hidden">
                    {/* NOTES TAB */}
                    {activeTab === 'NOTES' && (
                        <NotesView
                            notes={notes}
                            onViewNote={(n) => { setViewingNote(n); setInitialEditMode(n.is_owner === 1); }}
                            onCreateNote={handleCreateNote}
                            onDeleteNote={handleDeleteNote}
                            onCopyNote={handleCopyNote}
                            onShareNote={openShareModal}
                            onFlashNote={(n) => openShareModal(n, true)}
                        />
                    )}

                    {/* CHAT TABS */}
                    {activeTab !== 'NOTES' && (
                        <>
                            {/* Sub-Header */}
                            {selectedTarget && !isCreatingGroup && (
                                <div className="bg-gray-800 border-b border-gray-700 p-3 flex justify-between items-center shrink-0">
                                    <div className="flex items-center gap-2 cursor-pointer text-white" onClick={() => setSelectedTarget(null)}><ArrowLeft size={18} /><span className="font-bold text-sm truncate">{selectedTarget.username || selectedTarget.name}</span></div>
                                    {activeTab === 'GROUPS' && String(selectedTarget.created_by) === String(user.id) && <button onClick={() => setIsGroupSettingsOpen(!isGroupSettingsOpen)}><Settings size={16} className="text-gray-400 hover:text-white" /></button>}
                                </div>
                            )}

                            {/* Group Admin Panel */}
                            {isGroupSettingsOpen && activeTab === 'GROUPS' && selectedTarget && (
                                <div className="bg-gray-850 p-4 space-y-4">
                                    <h4 className="text-xs font-bold text-gray-500 uppercase">Manage Members</h4>
                                    <div className="flex gap-2 bg-gray-900 p-1 rounded text-xs">
                                        {['QUIET', 'PUBLIC', 'PRIVATE'].map(type => (<button key={type} onClick={() => setNotifyType(type)} className={`flex-1 py-1 rounded ${notifyType === type ? 'bg-blue-900 text-blue-200' : 'text-gray-500 hover:text-white'}`}>{type}</button>))}
                                    </div>
                                    <div className="max-h-32 overflow-y-auto border border-gray-700 rounded p-2">
                                        {selectedTarget.members?.split(', ').map(mName => {
                                            const mUser = userList.find(u => u.username === mName);
                                            return mUser ? (<div key={mName} className="flex justify-between items-center text-xs text-gray-300 py-1 border-b border-gray-700 last:border-0"><span>{mName}</span>{mName !== user?.username && <button onClick={() => handleManageMember(mUser.id, 'REMOVE')} className="text-red-500 hover:text-red-400"><UserMinus size={14} /></button>}</div>) : null;
                                        })}
                                    </div>
                                    <div className="relative">
                                        <select className="w-full bg-gray-900 border border-gray-600 rounded p-1.5 text-xs text-white" onChange={(e) => { if (e.target.value) handleManageMember(e.target.value, 'ADD'); e.target.value = ''; }}>
                                            <option value="">+ Add Member...</option>
                                            {userList.filter(u => !selectedTarget.members?.includes(u.username)).map(u => (<option key={u.id} value={u.id}>{u.username}</option>))}
                                        </select>
                                    </div>
                                    <div className="pt-2 border-t border-gray-700 space-y-2">
                                        <div className="flex gap-2 items-center bg-yellow-900/20 p-2 rounded border border-yellow-700/30">
                                            <select className="bg-transparent text-xs text-yellow-200 w-full outline-none" onChange={(e) => { if (e.target.value) handleTransferAdmin(e.target.value); }}>
                                                <option value="">Transfer Admin Rights...</option>
                                                {selectedTarget.members?.split(', ').filter(m => m !== user?.username).map(mName => { const mUser = userList.find(u => u.username === mName); return mUser ? <option key={mUser.id} value={mUser.id}>{mUser.username}</option> : null; })}
                                            </select>
                                            <Crown size={14} className="text-yellow-500" />
                                        </div>
                                        <button onClick={handleDeleteGroup} className="w-full py-2 bg-red-900/50 hover:bg-red-900 text-red-300 rounded text-xs font-bold flex items-center justify-center gap-2 border border-red-700/50 transition-colors"><Trash size={14} /> DELETE GROUP</button>
                                    </div>
                                </div>
                            )}

                            {/* View Content */}
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
                                        onDowngrade={handleDowngradeUrgency}
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
            {zoomedMessage && <FlashViewer messages={[zoomedMessage]} readOnly={true} onDismiss={() => handleDowngradeUrgency(zoomedMessage.id)} onClose={() => setZoomedMessage(null)} onShare={() => openShareModal({ id: zoomedMessage.noteId || zoomedMessage.id, title: zoomedMessage.title || "Flash Memo" }, true)} onUnshare={handleUnshareNote} isOwner={false} />}

            {viewingNote && (
                <FlashViewer
                    messages={[viewingNote]}
                    readOnly={false}
                    isOwner={viewingNote.is_owner === 1}
                    initialEditMode={initialEditMode}
                    onClose={() => setViewingNote(null)}
                    onSave={handleUpdateNote}
                    onShare={() => openShareModal(viewingNote, false)}
                    onUnshare={handleUnshareNote}
                />
            )}

            {shareModalOpen && shareTargetNote && <ShareModal note={shareTargetNote} users={userList.filter(u => u.id !== user?.id)} isFlash={shareModalIsFlash} showAlert={showAlert} onClose={() => setShareModalOpen(false)} />}
        </div>
    );
};