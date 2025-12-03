import React, { createContext, useContext, useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import axios from 'axios';

const SocketContext = createContext();

// API URL Logic: Use relative path in Prod (Pi), specific IP in Dev (Computer)
const API_URL = import.meta.env.PROD ? '' : (import.meta.env.VITE_API_URL || 'http://localhost:3000');

export const useSocket = () => useContext(SocketContext);

export const SocketProvider = ({ children }) => {
    const [socket, setSocket] = useState(null);
    const [isConnected, setIsConnected] = useState(false);
    const [authLoading, setAuthLoading] = useState(true);
    const [siteSettings, setSiteSettings] = useState({ timezone: 'UTC' });

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
        buzzerStatus: 'OFF',
        buzzerEnabled: false
    });

    // Auth State
    const [token, setToken] = useState(localStorage.getItem('cabane_token'));
    const [user, setUser] = useState(null);

    // --- 1. SOCKET CONNECTION ---
    useEffect(() => {
        const newSocket = io(API_URL);
        setSocket(newSocket);

        newSocket.on('connect', () => setIsConnected(true));
        newSocket.on('disconnect', () => setIsConnected(false));

        newSocket.on('STATE_UPDATE', (data) => {
            setSystemState(prev => ({ ...prev, ...data }));
        });

        newSocket.on('STATE_FULL', (data) => {
            setSystemState(data);
        });

        return () => newSocket.close();
    }, []);

    // --- 2. SESSION RESTORE ---
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
                console.error("Session restore failed", e);
                localStorage.removeItem('cabane_token');
                setToken(null);
                setUser(null);
            } finally {
                setAuthLoading(false);
            }
        };
        checkSession();
    }, [token]);

    // --- AUTH ACTIONS ---

    const login = async (username, password) => {
        try {
            const res = await axios.post(`${API_URL}/api/auth/login`, { username, password });
            const { token, role, settings } = res.data;

            localStorage.setItem('cabane_token', token);
            setToken(token);

            // Optimistic user set (will be confirmed by checkSession if needed)
            setUser({ username, role, settings });
            return true;
        } catch (e) {
            console.error("Login error:", e);
            return false;
        }
    };

    // Load Site Settings on Mount (after auth check)
    useEffect(() => {
        if (token) {
            axios.get(`${API_URL}/api/system/settings`, {
                headers: { Authorization: `Bearer ${token}` }
            }).then(res => {
                // Save ALL settings (timezone + weather) to state
                setSiteSettings(res.data);
            }).catch(console.error);
        }
    }, [token]);

    // Helper to update settings
    const updateSiteSettings = async (newSettings) => {
        try {
            await axios.post(`${API_URL}/api/system/settings`, newSettings, {
                headers: { Authorization: `Bearer ${token}` }
            });
            setSiteSettings(prev => ({ ...prev, ...newSettings }));
            return true;
        } catch (e) { return false; }
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

    const updateSettings = async (newSettings) => {
        // Optimistic Update
        setUser(prev => ({ ...prev, settings: newSettings }));

        if (token) {
            try {
                await axios.post(`${API_URL}/api/user/settings`, { settings: newSettings }, {
                    headers: { Authorization: `Bearer ${token}` }
                });
            } catch (e) { console.error("Settings save failed", e); }
        }
    };

    // --- CONTROL ACTIONS ---

    const takeControl = async () => {
        if (!token) { alert("Login required"); return; }
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
        } catch (e) { console.error(e); }
    };

    const releaseToCabane = async () => {
        if (!token) return;
        try {
            await axios.post(`${API_URL}/api/control/release-cabane`, {}, {
                headers: { Authorization: `Bearer ${token}` }
            });
        } catch (e) { console.error(e); }
    };

    const toggleSwitch = async (index, value) => {
        // Optimistic Update
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
            authLoading,
            login,
            register,
            logout,
            updateSettings,
            takeControl,
            releaseToServer,
            releaseToCabane,
            toggleSwitch,
            siteSettings,      // <--- Export this
            updateSiteSettings // <--- Export this

        }}>
            {children}
        </SocketContext.Provider>
    );
};