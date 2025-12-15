import React from 'react';
import { AlertTriangle, Info, X, ShieldAlert } from 'lucide-react';
import { clsx } from 'clsx';

export const NotificationBanner = ({ type, message, onDismiss }) => {
    // Types: ALARM (Red), BURGLAR (Purple/Red), INFO (Blue)
    const isAlarm = type === 'ALARM';
    const isBurglar = type === 'BURGLAR';

    // Style Logic
    let bgClass = "bg-blue-600";
    let icon = <Info size={32} />;

    if (isAlarm) {
        bgClass = "bg-red-600";
        icon = <AlertTriangle size={32} />;
    } else if (isBurglar) {
        bgClass = "bg-gradient-to-r from-purple-900 to-red-900 border-b-2 border-red-500";
        icon = <ShieldAlert className="text-red-400" size={32} />;
    }

    return (
        <div
            onClick={onDismiss}
            className={clsx(
                // ✅ CHANGED: Replaced 'animate-pulse' with 'animate-custom-flash'
                "fixed top-0 left-0 right-0 z-[200] min-h-[140px] px-6 py-6 shadow-2xl flex items-center justify-between cursor-pointer animate-custom-flash transition-all",
                bgClass
            )}
        >
            <div className="flex items-center gap-6 flex-grow justify-center md:justify-start overflow-hidden">
                <div className="shrink-0 p-3 bg-black/20 rounded-full">
                    {icon}
                </div>
                <div className="flex flex-col">
                    <span className="font-black tracking-widest uppercase text-lg md:text-xl whitespace-pre-line text-center md:text-left drop-shadow-md">
                        {isAlarm ? "SYSTEM ALARM" : (isBurglar ? "SECURITY ALERT" : "SYSTEM REMINDER")}
                    </span>
                    <span className="font-bold text-sm md:text-base opacity-90 text-center md:text-left">
                        {message}
                    </span>
                </div>
            </div>

            <button
                onClick={(e) => { e.stopPropagation(); onDismiss(); }}
                className="p-3 bg-black/20 hover:bg-black/40 rounded-full transition-colors ml-6 shrink-0"
            >
                <X size={28} />
            </button>
        </div>
    );
};