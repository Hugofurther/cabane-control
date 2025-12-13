import React from 'react';
import { AlertTriangle, Bell, X } from 'lucide-react';
import { clsx } from 'clsx';

export const NotificationBanner = ({ type, message, onDismiss }) => {
    if (!message) return null;

    const isAlarm = type === 'ALARM';

    return (
        <div className={clsx(
            "fixed top-0 left-0 right-0 z-[200] px-4 py-3 shadow-2xl flex items-center justify-between transition-transform duration-300 animate-in slide-in-from-top",
            isAlarm ? "bg-red-600 text-white animate-alarm" : "bg-blue-600 text-white"
        )}>
            <div className="flex items-center gap-4 max-w-4xl w-full">
                {/* Icon */}
                <div className={clsx(
                    "p-2 rounded-full",
                    isAlarm ? "bg-red-800" : "bg-yellow-600/30"
                )}>
                    {isAlarm ? <AlertTriangle size={24} /> : <Bell size={24} />}
                </div>

                {/* Text */}
                <div className="flex-grow">
                    <h4 className="font-black text-lg uppercase tracking-wide">
                        {isAlarm ? "ALARME DU SYSTÈME" : "RAPPEL"}
                    </h4>
                    <p className="font-mono text-sm md:text-base font-bold whitespace-pre-line">
                        {message}
                    </p>
                </div>

                {/* Dismiss Button */}
                <button
                    onClick={onDismiss}
                    className={clsx(
                        "p-2 rounded-lg transition-colors",
                        isAlarm ? "hover:bg-red-700 text-white" : "hover:bg-yellow-600/50 text-gray-900"
                    )}
                >
                    <X size={28} strokeWidth={3} />
                </button>
            </div>
        </div>
    );
};