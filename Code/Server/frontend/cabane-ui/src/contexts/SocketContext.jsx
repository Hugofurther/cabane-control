import React, { createContext, useContext, useEffect, useState, useRef } from 'react';
import { io } from 'socket.io-client';
import axios from 'axios';

const SocketContext = createContext();

// Get API URL from env, default to local if missing
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export const useSocket = () => useContext(SocketContext);

export const SocketProvider = ({ children }) => {
    const [socket, setSocket] = useState(null);
    const [isConnected, setIsConnected] = useState(false);

    // The God Object: Holds all system state
    const [systemState, setSystemState] = useState({
        controller: 'CABANE',
        currentUser: null,
        mainControllerOnline: false,
        virtualSwitches: new Array(24).fill(0),
        physicalSwitches: new Array(24).fill(0),
        stationFeedback: new Array(6).fill(0),
        stationOnline: new Array(6).fill(false),
        stationLastSeen: new Array(6).fill(0), // ✅ ADDED THIS
        globalVacuumAlarm: false,              // ✅ ADDED THIS (Safe default)
        buzzerStatus: 'OFF'                    // ✅ ADDED THIS (Safe default)
    });

    // Auth State
    const [token, setToken] = useState(localStorage.getItem('cabane_token'));
    const [user, setUser] = useState(null);

    // --- SESSION RESTORE ---
    useEffect(() => {
        const checkSession = async () => {
            if (!token) return;
            try {
                // Ask Server: "Who am I based on this token?"
                const res = await axios.get(`${API_URL}/api/auth/me`, {
                    headers: { Authorization: `Bearer ${token}` }
                });
                setUser(res.data); // { id, username, role }
            } catch (e) {
                // Token invalid/expired
                console.error("Session restore failed", e);
                localStorage.removeItem('cabane_token');
                setToken(null);
                setUser(null);
            }
        };

        checkSession();
    }, [token]);

    useEffect(() => {
        // Initialize Socket
        const newSocket = io(API_URL);
        setSocket(newSocket);

        newSocket.on('connect', () => setIsConnected(true));
        newSocket.on('disconnect', () => setIsConnected(false));

        // Listen for State Updates from Pi
        newSocket.on('STATE_UPDATE', (data) => {
            setSystemState(prev => ({ ...prev, ...data }));
        });

        newSocket.on('STATE_FULL', (data) => {
            setSystemState(data);
        });

        return () => newSocket.close();
    }, []);

    // --- ACTIONS ---

    const login = async (username, password) => {
        try {
            const res = await axios.post(`${API_URL}/api/auth/login`, { username, password });
            const { token, role } = res.data;
            localStorage.setItem('cabane_token', token);
            setToken(token);
            setUser({ username, role });
            return true;
        } catch (e) {
            console.error(e);
            return false;
        }
    };

    const takeControl = async () => {
        // DEBUG: Alert if no token found
        if (!token) {
            alert("You must be logged in to Take Control.");
            return;
        }

        await axios.post(`${API_URL}/api/control/take`, {}, {
            headers: { Authorization: `Bearer ${token}` }
        });
    };

    const releaseToServer = async () => {
        if (!token) return;
        try {
            await axios.post(`${API_URL}/api/control/release-server`, {}, {
                headers: { Authorization: `Bearer ${token}` }
            });
        } catch (e) { console.error("Release to Server failed", e); }
    };

    const releaseToCabane = async () => {
        if (!token) return;
        try {
            await axios.post(`${API_URL}/api/control/release-cabane`, {}, {
                headers: { Authorization: `Bearer ${token}` }
            });
        } catch (e) { console.error("Release to Cabane failed", e); }
    };

    const toggleSwitch = async (index, value) => {
        // Optimistic UI update (makes it feel instant)
        setSystemState(prev => {
            const newVirtual = [...prev.virtualSwitches];
            newVirtual[index] = value ? 1 : 0;
            return { ...prev, virtualSwitches: newVirtual };
        });

        if (!token) return;
        await axios.post(`${API_URL}/api/control/toggle`,
            { index, value },
            { headers: { Authorization: `Bearer ${token}` } }
        );
    };

    return (
        <SocketContext.Provider value={{
            socket,
            isConnected,
            systemState,
            user,
            login,
            takeControl,
            releaseToServer, // <--- EXPORT NEW FUNCTION
            releaseToCabane, // <--- EXPORT NEW FUNCTION
            toggleSwitch
        }}>
            {children}
        </SocketContext.Provider>
    );
};