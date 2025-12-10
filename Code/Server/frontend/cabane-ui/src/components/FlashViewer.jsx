import React, { useState, useEffect, useRef } from 'react';
import { AlertTriangle, X, Check, Edit3, Lock, Zap } from 'lucide-react';
import { clsx } from 'clsx';

export const FlashViewer = ({ messages, readOnly, onDismiss, onClose, onSave, isOwner, initialEditMode = false }) => {
    const [currentIndex, setCurrentIndex] = useState(0);
    const [editMode, setEditMode] = useState(initialEditMode);
    const [editContent, setEditContent] = useState('');
    const [editTitle, setEditTitle] = useState('');

    // Auto-focus ref
    const textareaRef = useRef(null);

    const currentMsg = messages[currentIndex];

    // Reset state when switching messages
    useEffect(() => {
        if (currentMsg) {
            setEditContent(currentMsg.content || '');
            setEditTitle(currentMsg.title || '');
            // Only set edit mode if explicitly requested (creation)
            if (initialEditMode) setEditMode(true);
        }
    }, [currentMsg, initialEditMode]);

    // Auto-focus textarea when entering edit mode
    useEffect(() => {
        if (editMode && textareaRef.current) {
            textareaRef.current.focus();
            // Move cursor to end
            textareaRef.current.setSelectionRange(textareaRef.current.value.length, textareaRef.current.value.length);
        }
    }, [editMode]);

    if (!currentMsg) return null;

    // --- LOGIC ---
    // 1. Detect Flash Memo vs System Alarm
    const isUrgent = currentMsg.priority === 'URGENT';
    const isMemo = isUrgent && (currentMsg.content || "").startsWith("📝 MEMO:");
    const isSystemAlarm = isUrgent && !isMemo;

    // 2. Identify Note
    const isNote = !!currentMsg.title;

    // 3. Sender Label Logic
    let senderLabel = "";
    if (isNote) {
        if (!isOwner) senderLabel = `Shared by ${currentMsg.creator_name || 'Unknown'}`;
        // If owner, we show nothing or "Personal Note"
    } else if (isUrgent) {
        senderLabel = `FROM: ${currentMsg.sender || 'SYSTEM'}`;
    }

    const handleSave = () => {
        if (onSave) {
            onSave(currentMsg.id, editTitle, editContent);
            setEditMode(false);
            onClose(); // ✅ Dismiss on Save
        }
    };

    // Parse Memo Content (Remove "📝 MEMO: Title" line for clean display if needed, 
    // or keep it. Let's keep it simple for now, or strip the header if it's redundant).
    const displayContent = editMode ? editContent : currentMsg.content;

    // --- STYLES ---
    // Blue (Standard), Yellow (Memo), Red (Alarm)
    let borderColor = "border-gray-600";
    let shadowColor = "shadow-2xl";
    let headerBg = "bg-gray-800 border-gray-700";
    let pulseClass = "";

    if (isSystemAlarm) {
        borderColor = "border-red-500";
        shadowColor = "shadow-red-900/50";
        headerBg = "bg-red-900/80 border-red-500";
        pulseClass = "bg-red-500/10 animate-pulse";
    } else if (isMemo) {
        borderColor = "border-yellow-500";
        shadowColor = "shadow-yellow-900/50";
        headerBg = "bg-yellow-900/80 border-yellow-500";
        pulseClass = "bg-yellow-500/10 animate-pulse";
    } else if (isNote) {
        borderColor = "border-blue-500"; // Solid blue for notes
        headerBg = "bg-gray-800 border-gray-700";
    }

    return (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-md z-[100] flex items-center justify-center p-4 animate-in fade-in zoom-in-95 duration-200" onClick={onClose}>
            <div className={clsx("w-full max-w-2xl bg-gray-900 border-2 rounded-2xl overflow-hidden flex flex-col relative max-h-[90vh]", borderColor, shadowColor)} onClick={e => e.stopPropagation()}>

                {/* ANIMATED BACKGROUND */}
                {pulseClass && <div className={`absolute inset-0 ${pulseClass} pointer-events-none`} />}

                {/* HEADER */}
                <div className={clsx("p-6 flex justify-between items-center z-10 border-b", headerBg)}>
                    <div className="flex items-center gap-3">
                        {isSystemAlarm && <AlertTriangle className="text-white animate-bounce" size={32} />}
                        {isMemo && <Zap className="text-yellow-200" size={28} />}
                        {isNote && !isMemo && !isSystemAlarm && <Edit3 className="text-blue-400" size={24} />}

                        <div className="flex-grow min-w-0">
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
                                <h2 className="text-2xl font-black text-white uppercase tracking-widest leading-none truncate">
                                    {currentMsg.title || (isMemo ? "MEMO REMINDER" : (isUrgent ? "SYSTEM ALERT" : "MESSAGE"))}
                                </h2>
                            )}

                            {/* SUBTEXT */}
                            {(senderLabel || currentMsg.timestamp) && (
                                <p className="text-xs font-bold opacity-80 uppercase mt-1 flex items-center gap-2">
                                    {senderLabel}
                                    {senderLabel && <span>•</span>}
                                    {new Date(currentMsg.timestamp || Date.now()).toLocaleString()}
                                </p>
                            )}
                        </div>
                    </div>

                    <div className="flex gap-2">
                        {/* EDIT BUTTON (Only for Notes + Owner) */}
                        {isNote && isOwner && !editMode && (
                            <button onClick={() => setEditMode(true)} className="p-2 bg-black/20 hover:bg-black/40 rounded text-white transition-colors"><Edit3 size={20} /></button>
                        )}
                        {/* SAVE BUTTON */}
                        {editMode && (
                            <button onClick={handleSave} className="p-2 bg-green-600 hover:bg-green-500 rounded text-white shadow-lg transition-colors"><Check size={20} /></button>
                        )}
                        <button onClick={onClose} className="p-2 bg-black/20 hover:bg-black/40 rounded text-white transition-colors"><X size={24} /></button>
                    </div>
                </div>

                {/* CONTENT */}
                <div className="p-8 overflow-y-auto flex-grow z-10 bg-gray-900/90 min-h-[250px]">
                    {editMode ? (
                        <textarea
                            ref={textareaRef}
                            value={editContent}
                            onChange={e => setEditContent(e.target.value)}
                            className="w-full h-full min-h-[300px] bg-transparent text-white font-mono text-lg outline-none resize-none placeholder-gray-600"
                            placeholder="Type your note content here..."
                        />
                    ) : (
                        <div className={clsx("whitespace-pre-wrap leading-relaxed font-medium text-lg", isUrgent ? "text-white drop-shadow-md" : "text-gray-300")}>
                            {displayContent}
                        </div>
                    )}
                </div>

                {/* FOOTER ACTION (Acknowledge for Receiver) */}
                {!readOnly && isUrgent && !isOwner && (
                    <div className="p-6 bg-gray-900 border-t border-gray-800 z-10 flex justify-center">
                        <button onClick={() => onDismiss(currentMsg.id)} className="w-full py-4 bg-white text-gray-900 hover:bg-gray-200 font-black text-xl uppercase tracking-[0.2em] rounded shadow-xl transition-transform active:scale-95 flex items-center justify-center gap-3">
                            <Check size={28} strokeWidth={3} className="text-green-600" /> Acknowledge
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};