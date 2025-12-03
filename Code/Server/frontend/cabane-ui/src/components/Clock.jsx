import React, { useState, useEffect } from 'react';
import { Clock as ClockIcon } from 'lucide-react';
import { useSocket } from '../contexts/SocketContext';

export const Clock = () => {
    const { systemState, user } = useSocket();
    const [timeStr, setTimeStr] = useState('');

    const is12h = user?.settings?.clockFormat === '12h';

    useEffect(() => {
        const tick = () => {
            try {
                const now = new Date();
                const tz = systemState.timezone || 'UTC';

                const time = now.toLocaleTimeString('en-US', {
                    timeZone: tz,
                    hour12: is12h,
                    hour: '2-digit',
                    minute: '2-digit',
                    // second: '2-digit' // Removed to save space
                });
                setTimeStr(time);
            } catch (e) {
                setTimeStr("Time Err");
            }
        };

        tick();
        const timer = setInterval(tick, 1000); // Update every sec to keep sync
        return () => clearInterval(timer);
    }, [systemState.timezone, is12h]);

    return (
        <div className="flex items-center gap-2 text-gray-200">
            <ClockIcon size={24} className="text-blue-500" />
            <span className="font-mono font-black text-3xl tracking-widest text-shadow">
                {timeStr}
            </span>
            {/* Removed Timezone Label */}
        </div>
    );
};