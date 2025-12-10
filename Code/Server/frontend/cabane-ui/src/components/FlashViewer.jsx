import React from 'react';
import { AlertTriangle, Check, X } from 'lucide-react';

export const FlashViewer = ({ messages, onDismiss, onClose, readOnly }) => {
    // ✅ NOTE: Scroll Lock useEffect REMOVED.

    if (!messages || messages.length === 0) return null;

    const currentMsg = messages[0];

    return (
        <div className="fixed inset-0 bg-red-900/90 z-[60] flex flex-col items-center justify-center p-6 animate-in fade-in zoom-in duration-300 backdrop-blur-sm">
            <div className="bg-black/40 p-8 rounded-2xl border-4 border-red-500 shadow-2xl max-w-2xl w-full text-center relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-2 bg-red-500 animate-pulse"></div>

                <div className="mb-6 flex justify-center">
                    <div className="bg-red-600 p-4 rounded-full shadow-lg shadow-red-500/50 animate-bounce">
                        <AlertTriangle size={48} className="text-white" />
                    </div>
                </div>

                <h2 className="text-3xl md:text-4xl font-black text-white uppercase tracking-widest mb-2 drop-shadow-lg">
                    URGENT MESSAGE
                </h2>

                <p className="text-red-200 text-xs font-bold uppercase tracking-widest mb-8">
                    Sender: {currentMsg.sender} &bull; {new Date(currentMsg.timestamp).toLocaleString()}
                </p>

                <div className="bg-black/30 p-6 rounded-xl border border-red-500/30 mb-8 max-h-[40vh] overflow-y-auto">
                    <p className="text-xl md:text-2xl text-white font-bold whitespace-pre-wrap leading-relaxed">
                        {currentMsg.content}
                    </p>
                </div>

                <div className="flex flex-col gap-3">
                    {!readOnly && (
                        <button
                            onClick={() => onDismiss(currentMsg.id)}
                            className="w-full py-4 bg-white text-red-900 hover:bg-gray-200 font-black text-lg uppercase tracking-widest rounded-xl shadow-xl transition-transform transform active:scale-95 flex items-center justify-center gap-3"
                        >
                            <Check size={24} /> Acknowledge & Dismiss
                        </button>
                    )}

                    {/* Read Only Close (or secondary close for queue) */}
                    {(readOnly || messages.length > 1) && (
                        <button onClick={onClose} className="text-red-400 hover:text-white text-sm font-bold uppercase mt-2">
                            Close Viewer
                        </button>
                    )}
                </div>
            </div>

            {messages.length > 1 && (
                <div className="mt-4 text-white font-bold bg-black/50 px-4 py-2 rounded-full">
                    {messages.length - 1} more urgent message(s) waiting
                </div>
            )}
        </div>
    );
};