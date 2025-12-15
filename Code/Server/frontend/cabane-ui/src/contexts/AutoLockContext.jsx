import React, { createContext, useContext, useEffect, useState, useRef, useCallback } from 'react';
import { useSocket } from './SocketContext';

const AutoLockContext = createContext();

export const useAutoLock = () => useContext(AutoLockContext);

export const AutoLockProvider = ({ children }) => {
    const { user } = useSocket();
    const [isLocked, setIsLocked] = useState(false);

    // Settings (Defaults)
    const [lockMethod, setLockMethod] = useState('DISABLED');
    const [timeoutMinutes, setTimeoutMinutes] = useState(5);

    const idleTimer = useRef(null);

    useEffect(() => {
        if (user?.settings) {
            setLockMethod(user.settings.lockMethod || 'DISABLED');
            setTimeoutMinutes(parseInt(user.settings.lockTimeout) || 5);
        }
    }, [user]);

    const resetTimer = useCallback(() => {
        if (lockMethod === 'DISABLED' || isLocked) return;

        if (idleTimer.current) clearTimeout(idleTimer.current);

        idleTimer.current = setTimeout(() => {
            console.log("[AutoLock] System Idle. Locking.");
            setIsLocked(true);
        }, timeoutMinutes * 60 * 1000);
    }, [lockMethod, timeoutMinutes, isLocked]);

    useEffect(() => {
        if (lockMethod === 'DISABLED') return;

        // ✅ ADDED: 'mousemove'
        const events = ['mousedown', 'mousemove', 'keydown', 'touchstart', 'scroll'];

        resetTimer();

        const handleActivity = () => resetTimer();

        events.forEach(ev => window.addEventListener(ev, handleActivity));
        return () => {
            events.forEach(ev => window.removeEventListener(ev, handleActivity));
            if (idleTimer.current) clearTimeout(idleTimer.current);
        };
    }, [resetTimer, lockMethod]);

    const lockScreen = () => setIsLocked(true);
    const unlockScreen = () => {
        setIsLocked(false);
        resetTimer();
    };

    return (
        <AutoLockContext.Provider value={{ isLocked, lockMethod, lockScreen, unlockScreen }}>
            {children}
        </AutoLockContext.Provider>
    );
};