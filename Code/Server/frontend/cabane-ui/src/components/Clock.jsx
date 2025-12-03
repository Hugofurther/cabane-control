import React, { useState, useEffect } from 'react';
import { Clock as ClockIcon } from 'lucide-react';
import { useSocket } from '../contexts/SocketContext';

export const Clock = () => {
    const { systemState } = useSocket();
    const [timeStr, setTimeStr] = useState('');

    useEffect(() => {
        const tick = () => {
            try {
                const now = new Date();
                const tz = systemState.timezone || 'UTC'; // Source of Truth

                const time = now.toLocaleTimeString('en-US', {
                    timeZone: tz,
                    hour12: false,
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit'
                });
                setTimeStr(time);
            } catch (e) {
                setTimeStr("TZ Error");
            }
        };
        const timer = setInterval(tick, 1000);
        return () => clearInterval(timer);
    }, [systemState.timezone]);

    return (
        <div className="flex items-center gap-3 text-gray-200">
            <ClockIcon size={32} className="text-blue-500" />
            <span className="font-mono font-black text-4xl tracking-widest text-shadow">
                {timeStr}
            </span>
            <span className="text-xs font-bold text-gray-500 self-end mb-2">
                {systemState.timezone?.split('/')[1]?.replace(/_/g, ' ') || "UTC"}
            </span>
        </div>
    );
};