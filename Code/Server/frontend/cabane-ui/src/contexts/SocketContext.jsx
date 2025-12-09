import React, { createContext, useContext, useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import axios from 'axios';
import { useModal } from './ModalContext'; // ✅ Import Hook

const SocketContext = createContext();

const API_URL = import.meta.env.PROD ? '' : (import.meta.env.VITE_API_URL || 'http://localhost:3000');

export const useSocket = () => useContext(SocketContext);

export const SocketProvider = ({ children }) => {
    const { showAlert } = useModal(); // ✅ Get Alert function
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
        buzzerStatus: 'OFF',
        buzzerEnabled: false,
        timezone: 'UTC'
    });

    // Settings & Weather State
    const [siteSettings, setSiteSettings] = useState({ timezone: 'UTC' });
    const [weatherData, setWeatherData] = useState([]);

    // Auth State
    const [token, setToken] = useState(localStorage.getItem('cabane_token'));
    const [user, setUser] = useState(null);
    const [onlineList, setOnlineList] = useState([]);

    // --- ACTIONS ---
    const logout = () => {
        localStorage.removeItem('cabane_token');
        setToken(null);
        setUser(null);
        window.location.reload();
    };

    // --- 🛡️ GLOBAL AXIOS INTERCEPTOR ---
    useEffect(() => {
        const interceptor = axios.interceptors.response.use(
            (response) => response,
            (error) => {
                if (error.response) {
                    const { status, data } = error.response;

                    if (status === 401) {
                        showAlert("Session Expired", "Your session has timed out. Please log in again.", () => {
                            logout();
                        });
                        return Promise.reject(error);
                    }

                    if (status === 403) {
                        const isExpiry = typeof data === 'string' || (data.error && data.error.toLowerCase().includes('token'));
                        if (isExpiry) {
                            showAlert("Session Expired", "Your session has timed out. Please log in again.", () => {
                                logout();
                            });
                        } else {
                            console.warn("Action blocked:", data.error || data);
                        }
                    }
                }
                return Promise.reject(error);
            }
        );
        return () => axios.interceptors.response.eject(interceptor);
    }, [showAlert]);

    // --- SOCKET SETUP ---
    useEffect(() => {
        const newSocket = io(API_URL);
        setSocket(newSocket);

        newSocket.on('connect', () => setIsConnected(true));
        newSocket.on('disconnect', () => setIsConnected(false));

        newSocket.on('STATE_UPDATE', (data) => setSystemState(prev => ({ ...prev, ...data })));
        newSocket.on('STATE_FULL', (data) => setSystemState(data));
        newSocket.on('ONLINE_USERS', (users) => setOnlineList(users || []));

        // ✅ REPLACED: Listen for the new FULL data structure
        newSocket.on('WEATHER_FULL_UPDATE', (data) => {
            setWeatherData(Array.isArray(data) ? data : []);
        });

        // REMOVED: newSocket.on('WEATHER_UPDATE'...) to prevent conflicts

        return () => newSocket.close();
    }, []);

    // --- SESSION RESTORE ---
    useEffect(() => {
        const checkSession = async () => {
            try {
                if (token) {
                    const resSettings = await axios.get(`${API_URL}/api/system/settings`, {
                        headers: { Authorization: `Bearer ${token}` }
                    });
                    setSiteSettings(resSettings.data);
                }
            } catch (e) { }

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

    useEffect(() => {
        if (socket && user?.username) {
            socket.emit('IDENTIFY', user.username);
        }
    }, [socket, user]);

    // --- API CALLS ---
    const login = async (username, password) => {
        try {
            const res = await axios.post(`${API_URL}/api/auth/login`, { username, password });
            const { token, role, settings } = res.data;
            localStorage.setItem('cabane_token', token);
            setToken(token);
            setUser({ username, role, settings });
            return true;
        } catch (e) { return false; }
    };

    const register = async (username, email, password) => {
        try {
            await axios.post(`${API_URL}/api/auth/register`, { username, email, password });
            return { success: true };
        } catch (e) { return { success: false, error: e.response?.data?.error }; }
    };

    const updateSettings = async (newSettings) => {
        setUser(prev => ({ ...prev, settings: newSettings }));
        if (token) {
            try {
                await axios.post(`${API_URL}/api/user/settings`, { settings: newSettings }, {
                    headers: { Authorization: `Bearer ${token}` }
                });
            } catch (e) { console.error("Settings save failed", e); }
        }
    };

    const updateSiteSettings = async (newSettings) => {
        try {
            await axios.post(`${API_URL}/api/system/settings`, newSettings, {
                headers: { Authorization: `Bearer ${token}` }
            });
            setSiteSettings(prev => ({ ...prev, ...newSettings }));
            return true;
        } catch (e) { return false; }
    };

    // --- CONTROL ---
    const takeControl = async () => {
        if (!token) {
            // ✅ REPLACED: alert("Login required");
            showAlert("Access Denied", "You must be logged in to take control.");
            return;
        }
        try {
            await axios.post(`${API_URL}/api/control/take`, {}, { headers: { Authorization: `Bearer ${token}` } });
        }
        catch (e) {
            // ✅ REPLACED: alert("Failed: " + ...);
            showAlert("Control Error", "Failed to take control: " + (e.response?.data?.error || e.message));
        }
    };

    const releaseToServer = async () => {
        if (!token) return;
        try { await axios.post(`${API_URL}/api/control/release-server`, {}, { headers: { Authorization: `Bearer ${token}` } }); } catch (e) { }
    };

    const releaseToCabane = async () => {
        if (!token) return;
        try { await axios.post(`${API_URL}/api/control/release-cabane`, {}, { headers: { Authorization: `Bearer ${token}` } }); } catch (e) { }
    };

    const toggleSwitch = async (index, value) => {
        setSystemState(prev => {
            const newVirtual = [...prev.virtualSwitches];
            newVirtual[index] = value ? 1 : 0;
            return { ...prev, virtualSwitches: newVirtual };
        });
        if (!token) return;
        await axios.post(`${API_URL}/api/control/toggle`, { index, value }, { headers: { Authorization: `Bearer ${token}` } });
    };

    return (
        <SocketContext.Provider value={{
            socket, isConnected, systemState,
            user, authLoading, onlineList,
            siteSettings,
            weatherData,

            login, register, logout,
            updateSettings, updateSiteSettings,

            takeControl, releaseToServer, releaseToCabane, toggleSwitch
        }}>
            {children}
        </SocketContext.Provider>
    );
};