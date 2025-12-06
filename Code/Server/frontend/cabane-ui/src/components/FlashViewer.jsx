import React, { useState, useEffect } from 'react';
import { X, ChevronLeft, ChevronRight, CheckCircle, AlertTriangle, User, Calendar, Layers, Globe, Users, Lock } from 'lucide-react'; // Added Globe, Users, Lock
import { clsx } from 'clsx';

export const FlashViewer = ({ messages, onClose, onDismiss, readOnly = false }) => {
    const [currentIndex, setCurrentIndex] = useState(0);
    const [processing, setProcessing] = useState(false);

    useEffect(() => {
        if (currentIndex >= messages.length) {
            setCurrentIndex(Math.max(0, messages.length - 1));
        }
    }, [messages.length]);

    if (!messages || messages.length === 0) return null;

    const currentMsg = messages[currentIndex];

    const handleNext = (e) => {
        e.stopPropagation();
        setCurrentIndex((prev) => (prev + 1) % messages.length);
    };

    const handlePrev = (e) => {
        e.stopPropagation();
        setCurrentIndex((prev) => (prev - 1 + messages.length) % messages.length);
    };

    const handleDismissAction = async (e) => {
        e.stopPropagation();
        if (readOnly) {
            onClose();
        } else {
            if (onDismiss) {
                setProcessing(true);
                await onDismiss(currentMsg.id);
                setProcessing(false);
            }
        }
    };

    // --- HELPER: Determine Context Badge ---
    const renderContextBadge = () => {
        if (currentMsg.group_id) {
            return (
                <div className="flex items-center gap-1.5 text-xs font-bold text-purple-400 bg-purple-900/30 px-2 py-1 rounded border border-purple-500/30">
                    <Users size={12} />
                    <span className="uppercase truncate max-w-[150px]">GROUP: {currentMsg.group_name || 'Unknown'}</span>
                </div>
            );
        }
        if (currentMsg.recipient_id) {
            return (
                <div className="flex items-center gap-1.5 text-xs font-bold text-blue-400 bg-blue-900/30 px-2 py-1 rounded border border-blue-500/30">
                    <Lock size={12} />
                    <span className="uppercase truncate max-w-[150px]">DM: {currentMsg.recipient_name || 'User'}</span>
                </div>
            );
        }
        // Global
        return (
            <div className="flex items-center gap-1.5 text-xs font-bold text-green-400 bg-green-900/30 px-2 py-1 rounded border border-green-500/30">
                <Globe size={12} />
                <span className="uppercase">GLOBAL BROADCAST</span>
            </div>
        );
    };

    return (
        <div
            className="fixed inset-0 bg-black/35 backdrop-blur-[0.75px] z-[100] flex items-center justify-center p-4 animate-in fade-in duration-200"
            onClick={onClose}
        >
            <div
                className={clsx(
                    "relative flex flex-col bg-gray-900 border-2 rounded-2xl shadow-2xl overflow-hidden transition-all scale-100",
                    "w-[95%] h-[60%] md:w-[75%] md:h-[60%] lg:w-[50%] lg:h-[60%]",
                    currentMsg.priority === 'URGENT' ? "border-red-500 shadow-red-900/50" : "border-blue-500 shadow-blue-900/50"
                )}
                onClick={(e) => e.stopPropagation()}
            >

                {/* HEADER */}
                <div className={clsx(
                    "p-6 flex justify-between items-start border-b gap-4",
                    currentMsg.priority === 'URGENT' ? "bg-red-900/30 border-red-500/30" : "bg-blue-900/30 border-blue-500/30"
                )}>
                    <div className="flex flex-col gap-2 w-full min-w-0">

                        {/* Top Row: User & Metadata */}
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="p-2 rounded-full bg-gray-800 border border-gray-600 shrink-0">
                                    <User size={24} className="text-gray-300" />
                                </div>
                                <div className="min-w-0">
                                    <h2 className="text-xl md:text-2xl font-black text-white tracking-wide uppercase truncate">
                                        {currentMsg.sender}
                                    </h2>
                                    <div className="flex items-center gap-3">
                                        <div className="flex items-center gap-1.5 text-gray-400 text-sm font-mono">
                                            <Calendar size={12} />
                                            {new Date(currentMsg.timestamp).toLocaleString()}
                                        </div>

                                        {/* RENDER CONTEXT BADGE (Global/Group/DM) */}
                                        {renderContextBadge()}
                                    </div>
                                </div>
                            </div>

                            {/* Stack Indicator */}
                            {messages.length > 1 && (
                                <div className="flex items-center gap-1 px-3 py-1 rounded-full bg-gray-800 border border-gray-600 text-xs font-bold text-gray-300 shrink-0">
                                    <Layers size={12} />
                                    <span>{currentIndex + 1} / {messages.length}</span>
                                </div>
                            )}
                        </div>

                        {/* Urgent Badge */}
                        {currentMsg.priority === 'URGENT' && (
                            <span className="inline-flex items-center gap-1 text-red-400 font-bold text-xs uppercase border border-red-500/50 px-2 py-1 rounded bg-red-950/50 w-fit mt-1">
                                <AlertTriangle size={12} /> FLASH MESSAGE
                            </span>
                        )}
                    </div>

                    <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors ml-1">
                        <X size={32} />
                    </button>
                </div>

                {/* BODY */}
                <div className="flex-grow p-8 overflow-y-auto bg-gray-950/50 text-xl md:text-2xl font-medium text-gray-200 leading-relaxed whitespace-pre-wrap overscroll-contain">
                    {currentMsg.content}
                </div>

                {/* FOOTER */}
                <div className="p-4 bg-gray-900 border-t border-gray-800 flex justify-between items-center">
                    <div className="flex gap-2">
                        {messages.length > 1 && (
                            <>
                                <button onClick={handlePrev} className="p-3 rounded-full bg-gray-800 hover:bg-gray-700 text-white border border-gray-600 transition-colors"><ChevronLeft size={24} /></button>
                                <button onClick={handleNext} className="p-3 rounded-full bg-gray-800 hover:bg-gray-700 text-white border border-gray-600 transition-colors"><ChevronRight size={24} /></button>
                            </>
                        )}
                    </div>
                    <button
                        onClick={handleDismissAction}
                        disabled={processing}
                        className={clsx(
                            "px-6 md:px-8 py-3 rounded-xl font-black uppercase tracking-widest shadow-lg flex items-center gap-3 transition-all transform",
                            readOnly ? "bg-gray-700 hover:bg-gray-600 text-gray-300" : "bg-green-600 hover:bg-green-500 text-white hover:scale-105 active:scale-95"
                        )}
                    >
                        {readOnly ? "Close" : <><CheckCircle size={24} /><span className="hidden md:inline">Acknowledge</span><span className="md:hidden">OK</span></>}
                    </button>
                </div>

            </div>
        </div>
    );
};