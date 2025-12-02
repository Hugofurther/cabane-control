import React, { createContext, useContext, useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import axios from 'axios';

const SocketContext = createContext();

// Production/Development URL Logic
const API_URL = import.meta.env.PROD ? '' : (import.meta.env.VITE_API_URL || 'http://localhost:3000');

export const useSocket = () => useContext(SocketContext);

export const SocketProvider = ({ children }) => {
    const [socket, setSocket] = useState(null);
    const [isConnected, setIsConnected] = useState(false);
    const [authLoading, setAuthLoading] = useState(true);

    // System State
    const [systemState, setSystemState] = useState({
        controller: 'CABANE',
        currentUser: null,
        mainControllerOnline: false,
        virtualSwitches: new Array(24).fill(0),
        physicalSwitches: new Array(24).fill(0),
        stationFeedback: new Array(6).fill(0),
        stationOnline: new Array(6).fill(false),
        stationLastSeen: new Array(6).fill(0),
        globalVacuumAlarm: false,
        buzzerStatus: 'OFF'
    });

    // Auth State
    const [token, setToken] = useState(localStorage.getItem('cabane_token'));
    const [user, setUser] = useState(null);

    // --- SOCKET SETUP ---
    useEffect(() => {
        const newSocket = io(API_URL);
        setSocket(newSocket);

        newSocket.on('connect', () => setIsConnected(true));
        newSocket.on('disconnect', () => setIsConnected(false));

        newSocket.on('STATE_UPDATE', (data) => setSystemState(prev => ({ ...prev, ...data })));
        newSocket.on('STATE_FULL', (data) => setSystemState(data));

        return () => newSocket.close();
    }, []);

    // --- AUTH RESTORE ---
    useEffect(() => {
        const checkSession = async () => {
            if (!token) {
                setAuthLoading(false);
                return;
            }
            try {
                const res = await axios.get(`${API_URL}/api/auth/me`, {
                    headers: { Authorization: `Bearer ${token}` }
                });
                setUser(res.data);
            } catch (e) {
                localStorage.removeItem('cabane_token');
                setToken(null);
                setUser(null);
            } finally {
                setAuthLoading(false);
            }
        };
        checkSession();
    }, [token]);

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
            return false;
        }
    };

    const register = async (username, email, password) => {
        try {
            await axios.post(`${API_URL}/api/auth/register`, { username, email, password });
            return { success: true };
        } catch (e) {
            return { success: false, error: e.response?.data?.error || "Registration failed" };
        }
    };

    const logout = () => {
        localStorage.removeItem('cabane_token');
        setToken(null);
        setUser(null);
        window.location.reload();
    };

    // --- CONTROL ACTIONS ---

    const takeControl = async () => {
        if (!token) {
            alert("Please login to take control.");
            return;
        }
        try {
            await axios.post(`${API_URL}/api/control/take`, {}, {
                headers: { Authorization: `Bearer ${token}` }
            });
        } catch (e) {
            alert("Failed to Take Control: " + (e.response?.data?.error || e.message));
        }
    };

    const releaseToServer = async () => {
        if (!token) return;
        try {
            await axios.post(`${API_URL}/api/control/release-server`, {}, {
                headers: { Authorization: `Bearer ${token}` }
            });
        } catch (e) {
            alert("Error: " + e.message);
        }
    };

    const releaseToCabane = async () => {
        if (!token) return;
        try {
            await axios.post(`${API_URL}/api/control/release-cabane`, {}, {
                headers: { Authorization: `Bearer ${token}` }
            });
        } catch (e) {
            alert("Error: " + e.message);
        }
    };

    const toggleSwitch = async (index, value) => {
        // Optimistic Update for instant feedback
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
            socket, isConnected, systemState, user, authLoading,
            login, register, logout,
            takeControl, releaseToServer, releaseToCabane, toggleSwitch
        }}>
            {children}
        </SocketContext.Provider>
    );
};