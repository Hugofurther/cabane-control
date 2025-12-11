import React, { useEffect, useRef } from 'react';
import { Send, AlertTriangle, Clock, Trash2, ArrowDown } from 'lucide-react';
import { getUserColor, formatSmartTime } from './utils';
import { clsx } from 'clsx';
import { useSocket } from '../../contexts/SocketContext';

export const ChatView = ({
    messages,
    user,
    input, setInput, isUrgent, setIsUrgent,
    onSend, onZoom, onDelete, onDowngrade, onCancelUrgency,
    scrollRef, containerRef, showScrollButton, onScrollToBottom, onScroll
}) => {

    const textareaRef = useRef(null);

    const handleKeyDown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(e); } };
    const handleInput = (e) => {
        setInput(e.target.value);
        e.target.style.height = 'auto';
        e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
    };

    return (
        <div className="flex flex-col flex-grow overflow-hidden">
            <div ref={containerRef} onScroll={onScroll} className="flex-grow overflow-y-auto p-4 space-y-3 bg-cabane-dark pb-4 overscroll-contain relative">
                {messages.length === 0 && <div className="text-center text-gray-500 text-xs italic mt-4">No messages yet.</div>}
                {messages.map(msg => {
                    const isMe = user && (String(msg.sender_id) === String(user.id));
                    const isUrgentMsg = msg.priority === 'URGENT';
                    const isAcked = msg.is_ack_by_me;
                    const userColorClass = getUserColor(msg.sender);
                    const showRedAlert = isUrgentMsg && !isAcked;
                    return (
                        <div key={msg.id} id={`msg-${msg.id}`} className={`flex flex-col w-full group ${isMe ? 'items-end' : 'items-start'}`}>
                            {!isMe && <span className="text-[10px] text-gray-500 ml-1 mb-0.5">{msg.sender}</span>}
                            <div onClick={() => onZoom(msg)} className={clsx("max-w-[85%] p-3 rounded-lg text-sm border shadow-sm relative break-words transition-all cursor-pointer hover:scale-[1.02] whitespace-pre-wrap", isMe && !showRedAlert && "bg-blue-600 border-blue-500 text-white rounded-br-none text-right", !isMe && !showRedAlert && clsx("rounded-bl-none border-l-4 text-gray-200 bg-gray-800", userColorClass), showRedAlert && "bg-red-900/80 border-red-500 text-white animate-pulse", msg.isOptimistic && "opacity-70")}>
                                {showRedAlert && <div className="flex items-center gap-1 text-[10px] font-bold text-red-300 mb-1"><AlertTriangle size={10} /> FLASH MESSAGE</div>}
                                {msg.content}
                                {msg.isOptimistic && <span className="absolute bottom-1 right-1 text-[8px] text-gray-300"><Clock size={8} /></span>}
                            </div>
                            <div className="flex items-center gap-2 mt-1 mx-1">
                                <span className="text-[10px] text-gray-600">{formatSmartTime(msg.timestamp)}</span>
                                {isMe && !msg.isOptimistic && (
                                    <>
                                        {isUrgentMsg && <button onClick={(e) => { e.stopPropagation(); onCancelUrgency(msg.id); }} className="text-red-400 hover:text-red-300 text-[10px] font-bold border border-red-900/50 px-1.5 rounded bg-red-900/20 uppercase transition-colors" title="Downgrade to Normal">Cancel Flash</button>}
                                        <button onClick={(e) => { e.stopPropagation(); onDelete(msg.id); }} className="text-gray-600 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity" title="Delete"><Trash2 size={12} /></button>
                                    </>
                                )}
                            </div>
                        </div>
                    );
                })}
                <div ref={scrollRef} />
                {showScrollButton && <button onClick={onScrollToBottom} className="fixed bottom-20 md:bottom-40 right-4 md:right-auto md:left-1/2 md:-translate-x-1/2 flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-full shadow-lg font-bold text-xs animate-bounce z-50 border border-blue-400 cursor-pointer"><ArrowDown size={14} /> New Messages</button>}
            </div>

            <form className="p-4 bg-gray-800 border-t border-gray-700 shrink-0">
                <div className="flex gap-2 mb-2">
                    <label onMouseDown={(e) => e.preventDefault()} className={`flex items-center gap-1 text-xs font-bold cursor-pointer px-2 py-1 rounded border transition-colors ${isUrgent ? 'bg-red-900 text-red-200 border-red-600' : 'bg-gray-700 text-gray-400 border-gray-600'}`}>
                        <input type="checkbox" className="hidden" checked={isUrgent} onChange={e => { setIsUrgent(e.target.checked); textareaRef.current?.focus(); }} /><AlertTriangle size={12} /> FLASH MESSAGE
                    </label>
                </div>
                <div className="flex gap-2 items-end">
                    <textarea ref={textareaRef} value={input} onChange={handleInput} onKeyDown={handleKeyDown} rows={1} placeholder="Type a message..." className="flex-grow bg-gray-900 border border-gray-600 rounded-lg p-2 text-white outline-none resize-none overflow-hidden min-h-[40px] max-h-[120px] text-sm" />
                    <button onClick={onSend} className="p-2.5 bg-blue-600 hover:bg-blue-500 rounded-lg text-white mb-0.5 shadow-lg shadow-blue-900/20"><Send size={20} /></button>
                </div>
            </form>
        </div>
    );
};