import React, { useState, useEffect } from 'react';
import { Clock as ClockIcon } from 'lucide-react';
import { useSocket } from '../contexts/SocketContext';

export const Clock = () => {
    const { systemState, user } = useSocket();
    const [timeParts, setTimeParts] = useState({ time: '', period: '' });

    // User Preference (Default 24h)
    const is12h = user?.settings?.clockFormat === '12h';

    useEffect(() => {
        const tick = () => {
            try {
                const now = new Date();
                const tz = systemState.timezone || 'UTC';

                // Get full string first
                const fullTime = now.toLocaleTimeString('en-US', {
                    timeZone: tz,
                    hour12: is12h,
                    hour: '2-digit',
                    minute: '2-digit',
                });

                // Split logic
                if (is12h) {
                    // "07:50 PM" -> ["07:50", "PM"]
                    const [t, p] = fullTime.split(' ');
                    setTimeParts({ time: t, period: p });
                } else {
                    // "19:50" -> ["19:50", ""]
                    setTimeParts({ time: fullTime, period: '' });
                }

            } catch (e) {
                setTimeParts({ time: "Err", period: "" });
            }
        };

        tick();
        const timer = setInterval(tick, 1000);
        return () => clearInterval(timer);
    }, [systemState.timezone, is12h]);

    return (
        <div className="flex items-center gap-2 text-gray-200">
            <ClockIcon size={28} className="text-blue-500" />

            <div className="flex items-baseline gap-1">
                <span className="font-mono font-black text-4xl tracking-widest text-shadow leading-none">
                    {timeParts.time}
                </span>
                {timeParts.period && (
                    <span className="text-sm font-bold text-gray-400 font-mono">
                        {timeParts.period}
                    </span>
                )}
            </div>
        </div>
    );
};