import React, { useState, useEffect, useRef } from 'react';
import { AlertTriangle, X, Check, Edit3, Zap, ChevronDown, Share2, Users, Calendar } from 'lucide-react';
import { clsx } from 'clsx';

export const FlashViewer = ({ messages, readOnly, onDismiss, onClose, onSave, onShare, onUnshare, isOwner, initialEditMode = false }) => {
    // ... [State setup same as before] ...
    const [currentIndex, setCurrentIndex] = useState(0);
    const [editMode, setEditMode] = useState(initialEditMode);
    const [editContent, setEditContent] = useState('');
    const [editTitle, setEditTitle] = useState('');

    // Dropdown States
    const [activeDropdown, setActiveDropdown] = useState(null);
    const toggleDropdown = (name) => setActiveDropdown(prev => prev === name ? null : name);

    const textareaRef = useRef(null);
    const currentMsg = messages[currentIndex];

    // --- PARSE CONTENT ---
    let noteData = null;
    let displayContent = "";

    // ✅ Define realNoteId at scope level
    let realNoteId = currentMsg?.id;

    if (currentMsg) {
        try {
            if (currentMsg.content && currentMsg.content.startsWith('{') && currentMsg.content.includes('NOTE_FLASH')) {
                noteData = JSON.parse(currentMsg.content);
                displayContent = noteData.content;
                if (noteData.noteId) realNoteId = noteData.noteId;
            } else {
                displayContent = currentMsg.content;
            }
        } catch (e) {
            displayContent = currentMsg.content;
        }
    }

    useEffect(() => {
        if (currentMsg) {
            setEditContent(displayContent || '');
            setEditTitle(currentMsg.title || noteData?.title || '');
            if (initialEditMode) setEditMode(true);
        }
    }, [currentMsg, initialEditMode, displayContent]);

    useEffect(() => {
        if (editMode && textareaRef.current) {
            textareaRef.current.focus();
            textareaRef.current.setSelectionRange(textareaRef.current.value.length, textareaRef.current.value.length);
        }
    }, [editMode]);

    if (!currentMsg) return null;

    // --- FLAGS ---
    const isUrgent = currentMsg.priority === 'URGENT';
    const isFlashMemo = !!noteData;
    const isNote = !!currentMsg.title && !isFlashMemo;
    const isSystemAlarm = isUrgent && !isFlashMemo;

    // --- METADATA LOGIC ---

    // 1. History
    const history = noteData?.shareHistory || (currentMsg.share_history ? JSON.parse(currentMsg.share_history) : []);
    const lastShare = history.length > 0 ? history[history.length - 1] : null;
    const creatorName = currentMsg.creator_name || noteData?.creatorName || 'Unknown';

    // 2. Shared By Label
    let sharedByLabel = `Shared by ${creatorName}`;
    if (lastShare) {
        const actionPrefix = (lastShare.action === 'RE-SHARED' || lastShare.action === 'RE-FLASHED' || lastShare.user !== creatorName)
            ? "Re-Shared" : "Shared";
        sharedByLabel = `${actionPrefix} by ${lastShare.user}`;
    }

    // 3. Shared With List
    const rawSharedWith = noteData?.sharedWith || currentMsg.shared_with_names || "";
    const sharedWithList = rawSharedWith ? rawSharedWith.split(', ').filter(s => s.trim() !== '') : [];

    // 4. Dates
    const dateOpts = { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' };
    const updatedDate = new Date(currentMsg.updated_at || Date.now()).toLocaleString([], dateOpts);
    const createdDate = new Date(currentMsg.created_at || Date.now()).toLocaleString([], dateOpts);

    const handleSave = () => {
        if (onSave) {
            onSave(realNoteId, editTitle, editContent);
            setEditMode(false);
            onClose();
        }
    };

    // --- STYLES ---
    let borderColor = "border-gray-600";
    let shadowColor = "shadow-2xl";
    let headerBg = "bg-gray-800 border-gray-700";
    let pulseClass = "";

    if (isSystemAlarm) {
        borderColor = "border-red-500";
        shadowColor = "shadow-red-900/50";
        headerBg = "bg-red-900/80 border-red-500";
        pulseClass = "bg-red-500/10 animate-pulse";
    } else if (isFlashMemo) {
        borderColor = "border-yellow-500";
        shadowColor = "shadow-yellow-500/50";
        headerBg = "bg-yellow-900/90 border-yellow-500";
        pulseClass = "bg-yellow-500/10 animate-pulse";
    } else if (isNote) {
        borderColor = "border-blue-500";
        headerBg = "bg-gray-800 border-gray-700";
    }

    return (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-md z-[100] flex items-center justify-center p-4 animate-in fade-in zoom-in-95 duration-200" onClick={onClose}>
            <div className={clsx("w-full max-w-2xl bg-gray-900 border-2 rounded-2xl overflow-hidden flex flex-col relative max-h-[90vh]", borderColor, shadowColor)} onClick={e => e.stopPropagation()}>

                {pulseClass && <div className={`absolute inset-0 ${pulseClass} pointer-events-none`} />}

                {/* ✅ CLICK OUTSIDE OVERLAY */}
                {activeDropdown && (
                    <div className="fixed inset-0 z-[30] cursor-default" onClick={() => setActiveDropdown(null)} />
                )}

                {/* HEADER */}
                <div className={clsx("p-6 flex justify-between items-start z-20 border-b relative", headerBg)}>
                    <div className="flex items-start gap-3 w-full">
                        <div className="mt-1">
                            {isSystemAlarm && <AlertTriangle className="text-white animate-bounce" size={32} />}
                            {isFlashMemo && <Zap className="text-yellow-400" size={28} />}
                            {isNote && <Edit3 className="text-blue-400" size={24} />}
                        </div>

                        <div className="flex-grow min-w-0">
                            {/* TITLE */}
                            {editMode ? (
                                <input
                                    value={editTitle}
                                    onChange={e => setEditTitle(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'Enter') textareaRef.current?.focus(); }}
                                    className="bg-black/20 border-b border-white/20 text-white outline-none w-full font-black text-xl uppercase tracking-widest placeholder-gray-500"
                                    placeholder="NOTE TITLE"
                                    autoFocus
                                />
                            ) : (
                                <h2 className="text-2xl font-black text-white uppercase tracking-widest leading-tight break-words">
                                    {editTitle || currentMsg.title || (isFlashMemo ? "MEMO REMINDER" : "MESSAGE")}
                                </h2>
                            )}

                            {/* METADATA ROW */}
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-3 pl-0">

                                {/* 1. SHARED BY (History) */}
                                <HeaderDropdown
                                    icon={<Share2 size={12} />}
                                    label={sharedByLabel}
                                    isActive={activeDropdown === 'SHARED_BY'}
                                    onToggle={() => toggleDropdown('SHARED_BY')}
                                    color="text-blue-300"
                                >
                                    <div className="text-xs font-bold text-gray-500 mb-2 uppercase border-b border-gray-700 pb-1">Share History</div>
                                    {history.length === 0 ? <div className="text-gray-500 italic">No history</div> :
                                        history.slice().reverse().map((h, i) => (
                                            <div key={i} className="mb-2 last:mb-0">
                                                <span className="text-yellow-500 font-bold">{h.action}</span> <span className="text-gray-400">by {h.user}</span>
                                                {h.target && <div className="text-xs text-red-400">Revoked access for {h.target}</div>}
                                                <div className="text-[10px] text-gray-600">{new Date(h.timestamp).toLocaleString()}</div>
                                            </div>
                                        ))
                                    }
                                </HeaderDropdown>

                                {/* 2. SHARED WITH */}
                                {sharedWithList.length > 0 && (
                                    <HeaderDropdown
                                        icon={<Users size={12} />}
                                        label={`Shared with ${sharedWithList.length}`}
                                        isActive={activeDropdown === 'SHARED_WITH'}
                                        onToggle={() => toggleDropdown('SHARED_WITH')}
                                        color="text-green-300"
                                    >
                                        <div className="text-xs font-bold text-gray-500 mb-2 uppercase border-b border-gray-700 pb-1">Active Users</div>
                                        {sharedWithList.map((u, i) => (
                                            <div key={i} className="flex justify-between items-center py-1.5 px-2 group hover:bg-gray-800 rounded transition-colors">
                                                <span className="text-gray-300">{u}</span>

                                                {/* ✅ UPDATED BUTTON: Lighter color, larger click area */}
                                                {isOwner && onUnshare && (
                                                    <button
                                                        onClick={(e) => {
                                                            e.preventDefault();
                                                            e.stopPropagation();
                                                            console.log("Clicking Unshare for:", u); // Check console for this
                                                            onUnshare(realNoteId, u.trim());
                                                        }}
                                                        className="text-gray-400 hover:text-red-500 p-1.5 rounded-md hover:bg-gray-700 transition-all flex items-center justify-center"
                                                        title="Revoke Access"
                                                    >
                                                        <X size={14} />
                                                    </button>
                                                )}
                                            </div>
                                        ))}
                                    </HeaderDropdown>
                                )}

                                {/* 3. DATES */}
                                {(updatedDate) && (
                                    <HeaderDropdown
                                        icon={<Calendar size={12} />}
                                        label={`Edited: ${updatedDate}`}
                                        isActive={activeDropdown === 'DATES'}
                                        onToggle={() => toggleDropdown('DATES')}
                                        color="text-gray-400"
                                    >
                                        <div className="mb-2">
                                            <span className="text-gray-500 font-bold uppercase text-[10px]">Created</span>
                                            <div className="text-gray-300">{createdDate}</div>
                                        </div>
                                    </HeaderDropdown>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* ACTIONS */}
                    <div className="flex gap-2 shrink-0 ml-4">
                        {onShare && (
                            <button onClick={onShare} className="p-2 bg-black/20 hover:bg-blue-600/50 text-blue-400 hover:text-white rounded transition-colors" title="Share / Re-Share">
                                <Share2 size={20} />
                            </button>
                        )}

                        {isNote && isOwner && !editMode && (
                            <button onClick={() => setEditMode(true)} className="p-2 bg-black/20 hover:bg-black/40 rounded text-white transition-colors" title="Edit"><Edit3 size={20} /></button>
                        )}
                        {editMode && (
                            <button onClick={handleSave} className="p-2 bg-green-600 hover:bg-green-500 rounded text-white shadow-lg transition-colors" title="Save"><Check size={20} /></button>
                        )}
                        <button onClick={onClose} className="p-2 bg-black/20 hover:bg-black/40 rounded text-white transition-colors"><X size={24} /></button>
                    </div>
                </div>

                {/* CONTENT */}
                <div className="p-8 overflow-y-auto flex-grow z-0 bg-gray-900/95 min-h-[250px]">
                    {editMode ? (
                        <textarea
                            ref={textareaRef}
                            value={editContent}
                            onChange={e => setEditContent(e.target.value)}
                            className="w-full h-full min-h-[300px] bg-transparent text-white font-mono text-lg outline-none resize-none placeholder-gray-600"
                            placeholder="Type your note content here..."
                        />
                    ) : (
                        <div className={clsx("whitespace-pre-wrap leading-relaxed font-medium text-lg", isUrgent ? "text-white drop-shadow-sm" : "text-gray-300")}>
                            {displayContent}
                        </div>
                    )}
                </div>

                {/* FOOTER */}
                {!readOnly && isUrgent && !isOwner && (
                    <div className="p-4 bg-gray-900 border-t border-gray-800 z-10 flex gap-4">
                        <button onClick={() => onDismiss(currentMsg.id)} className={clsx("flex-grow py-4 font-black text-xl uppercase tracking-[0.2em] rounded shadow-xl transition-transform active:scale-95 flex items-center justify-center gap-3", isFlashMemo ? "bg-yellow-500 text-black hover:bg-yellow-400" : "bg-white text-red-600 hover:bg-gray-200")}>
                            <Check size={28} strokeWidth={3} /> Acknowledge
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

// Reusable Dropdown
const HeaderDropdown = ({ icon, label, children, isActive, onToggle, color = "text-gray-400" }) => (
    <div className={clsx("relative", isActive && "z-[40]")}>
        <button
            onClick={(e) => { e.stopPropagation(); onToggle(); }}
            className={`flex items-center gap-1.5 text-[10px] font-bold uppercase transition-colors hover:text-white ${color}`}
        >
            {icon} {label} <ChevronDown size={10} />
        </button>

        {isActive && (
            <div className="absolute top-full left-0 mt-2 bg-gray-900 border border-gray-600 rounded-lg shadow-2xl p-3 w-60 text-xs normal-case font-normal text-gray-300 cursor-default animate-in fade-in zoom-in-95 duration-100" onClick={e => e.stopPropagation()}>
                {children}
            </div>
        )}
    </div>
);