import React from 'react';
import { AlertTriangle, Info, X } from 'lucide-react';
import { clsx } from 'clsx';

export const NotificationBanner = ({ type, message, onDismiss }) => {
    const isAlarm = type === 'ALARM';

    return (
        <div
            onClick={onDismiss} // ✅ Click anywhere to dismiss
            className={clsx(
                "fixed top-0 left-0 right-0 z-[200] px-4 py-3 shadow-2xl flex items-center justify-between transition-transform duration-300 animate-in slide-in-from-top cursor-pointer",
                isAlarm ? "bg-red-600 text-white animate-alarm" : "bg-blue-600 text-white"
            )}>
            {/* Content Container */}
            <div className="flex items-center gap-3 flex-grow justify-center md:justify-start overflow-hidden">
                <div className="shrink-0">
                    {isAlarm ? <AlertTriangle className="animate-bounce" size={24} /> : <Info size={24} />}
                </div>
                <span className="font-black tracking-wider uppercase text-sm md:text-base whitespace-pre-line text-center md:text-left truncate">
                    {message}
                </span>
            </div>

            {/* X Button (Pushed to right) */}
            <button
                onClick={(e) => { e.stopPropagation(); onDismiss(); }}
                className="p-2 bg-black/20 hover:bg-black/40 rounded-full transition-colors ml-4 shrink-0"
            >
                <X size={20} />
            </button>
        </div>
    );
};