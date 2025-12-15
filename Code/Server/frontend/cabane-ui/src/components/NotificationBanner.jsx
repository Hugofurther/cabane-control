import React from 'react';
import { AlertTriangle, Info, X, ShieldAlert } from 'lucide-react';
import { clsx } from 'clsx';
import { useTranslation } from 'react-i18next'; // ✅ Import

export const NotificationBanner = ({ type, message, onDismiss }) => {
    const { t } = useTranslation(); // ✅ Hook
    const isAlarm = type === 'ALARM';
    const isBurglar = type === 'BURGLAR';

    let bgClass = "bg-blue-600";
    let icon = <Info size={32} />;
    let title = t('notifications.reminder');

    if (isAlarm) {
        bgClass = "bg-red-600";
        icon = <AlertTriangle size={32} />;
        title = t('notifications.alarm');
    } else if (isBurglar) {
        bgClass = "bg-gradient-to-r from-purple-900 to-red-900 border-b-2 border-red-500";
        icon = <ShieldAlert className="text-red-400" size={32} />;
        title = t('notifications.burglar');
    }

    return (
        <div onClick={onDismiss} className={clsx("fixed top-0 left-0 right-0 z-[200] min-h-[140px] px-6 py-6 shadow-2xl flex items-center justify-between cursor-pointer animate-custom-flash transition-all", bgClass)}>
            <div className="flex items-center gap-6 flex-grow justify-center md:justify-start overflow-hidden">
                <div className="shrink-0 p-3 bg-black/20 rounded-full">{icon}</div>
                <div className="flex flex-col">
                    <span className="font-black tracking-widest uppercase text-lg md:text-xl whitespace-pre-line text-center md:text-left drop-shadow-md">
                        {title}
                    </span>
                    <span className="font-bold text-sm md:text-base opacity-90 text-center md:text-left">
                        {message}
                    </span>
                </div>
            </div>
            <button onClick={(e) => { e.stopPropagation(); onDismiss(); }} className="p-3 bg-black/20 hover:bg-black/40 rounded-full transition-colors ml-6 shrink-0"><X size={28} /></button>
        </div>
    );
};