import React, { createContext, useContext, useEffect, useState, useRef, useCallback } from 'react';
import { useSocket } from './SocketContext';

const AutoLockContext = createContext();

export const useAutoLock = () => useContext(AutoLockContext);

export const AutoLockProvider = ({ children }) => {
    const { user } = useSocket();
    const [isLocked, setIsLocked] = useState(false);

    // Settings (Defaults)
    const [lockMethod, setLockMethod] = useState('DISABLED'); // DISABLED, SIMPLE, PASSWORD
    const [timeoutMinutes, setTimeoutMinutes] = useState(5);

    const idleTimer = useRef(null);

    // Load Settings when User loads
    useEffect(() => {
        if (user?.settings) {
            setLockMethod(user.settings.lockMethod || 'DISABLED');
            setTimeoutMinutes(parseInt(user.settings.lockTimeout) || 5);
        }
    }, [user]);

    // Reset Timer on Activity
    const resetTimer = useCallback(() => {
        if (lockMethod === 'DISABLED' || isLocked) return;

        if (idleTimer.current) clearTimeout(idleTimer.current);

        idleTimer.current = setTimeout(() => {
            console.log("[AutoLock] System Idle. Locking.");
            setIsLocked(true);
        }, timeoutMinutes * 60 * 1000);
    }, [lockMethod, timeoutMinutes, isLocked]);

    // Listen to Activity
    useEffect(() => {
        if (lockMethod === 'DISABLED') return;

        const events = ['mousedown', 'keydown', 'touchstart', 'scroll'];

        // Initial set
        resetTimer();

        const handleActivity = () => resetTimer();

        events.forEach(ev => window.addEventListener(ev, handleActivity));
        return () => {
            events.forEach(ev => window.removeEventListener(ev, handleActivity));
            if (idleTimer.current) clearTimeout(idleTimer.current);
        };
    }, [resetTimer, lockMethod]);

    // Function to manually lock (e.g. from a button)
    const lockScreen = () => setIsLocked(true);

    // Function to unlock
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