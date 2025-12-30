import React, { createContext, useContext, useEffect, useState, useMemo } from 'react';
import { io } from 'socket.io-client';
import axios from 'axios';
import { useModal } from './ModalContext';
import { useTranslation } from 'react-i18next';

const SocketContext = createContext();
const API_URL = import.meta.env.PROD ? '' : (import.meta.env.VITE_API_URL || 'http://localhost:3000');

export const useSocket = () => useContext(SocketContext);

const INPUT_MAP = [
    { idx: 0, st: 1, bit: 0 }, { idx: 1, st: 1, bit: 1 },
    { idx: 2, st: 0, bit: 0 }, { idx: 3, st: 0, bit: 1 },
    { idx: 4, st: 1, bit: 2 }, { idx: 5, st: 1, bit: 3 },
    { idx: 6, st: 1, bit: 4 }, { idx: 7, st: 1, bit: 5 },
    { idx: 8, st: 2, bit: 0 }, { idx: 9, st: 2, bit: 1 },
    { idx: 10, st: 2, bit: 2 }, { idx: 11, st: 2, bit: 3 },
    { idx: 12, st: 3, bit: 0 }, { idx: 13, st: 3, bit: 1 },
    { idx: 14, st: 3, bit: 2 }, { idx: 15, st: 3, bit: 3 },
    { idx: 16, st: 4, bit: 0 }, { idx: 17, st: 4, bit: 1 },
    { idx: 18, st: 4, bit: 2 },
    { idx: 19, st: 4, bit: 4 }, { idx: 20, st: 4, bit: 5 } // Corrected Map for ST4
];

// ✅ THERMOSTAT CONFIG (Mirrors Backend)
const THERMOSTATS = [
    { swIdx: 22, feedbackSt: 0, feedbackBit: 3, overrides: [2, 9, 14] },
    { swIdx: 23, feedbackSt: 4, feedbackBit: 3, overrides: [17] }
];

export const SocketProvider = ({ children }) => {
    const { showAlert } = useModal();
    const { i18n } = useTranslation();
    const [socket, setSocket] = useState(null);
    const [isConnected, setIsConnected] = useState(false);
    const [authLoading, setAuthLoading] = useState(true);

    const [realState, setRealState] = useState({
        controller: 'CABANE',
        currentUser: null,
        mainControllerOnline: false,
        virtualSwitches: new Array(24).fill(0),
        physicalSwitches: new Array(24).fill(0),
        stationFeedback: new Array(6).fill(0),
        stationOnline: new Array(6).fill(false),
        stationLastSeen: new Array(6).fill(0),
        globalVacuumAlarm: false,
        burglarAlarm: false,
        buzzerStatus: 'OFF',
        buzzerEnabled: false,
        timezone: 'UTC'
    });

    const [siteSettings, setSiteSettings] = useState({ timezone: 'UTC', switch_logic_mask: '0', led_logic_mask: '0' });
    const [weatherData, setWeatherData] = useState([]);

    const [simMeta, setSimMeta] = useState({ active: false, owner: null });
    const [simRuntime, setSimRuntime] = useState(null);
    const [simExtra, setSimExtra] = useState(0);
    const [isSimViewer, setIsSimViewer] = useState(false);
    const [bannerHeight, setBannerHeight] = useState(0);

    const [token, setToken] = useState(localStorage.getItem('cabane_token'));
    const [user, setUser] = useState(null);
    const [onlineList, setOnlineList] = useState([]);

    useEffect(() => {
        const interceptor = axios.interceptors.response.use(
            (response) => response,
            (error) => {
                if (error.response && (error.response.status === 401 || error.response.status === 403)) {
                    const { data } = error.response;
                    const isExpiry = typeof data === 'string' || (data.error && data.error.toLowerCase().includes('token'));
                    if (error.response.status === 401 || isExpiry) showAlert("Session Expired", "Please log in again.", () => logout());
                }
                return Promise.reject(error);
            }
        );
        return () => axios.interceptors.response.eject(interceptor);
    }, [showAlert]);

    useEffect(() => {
        const newSocket = io(API_URL);
        setSocket(newSocket);

        newSocket.on('connect', () => setIsConnected(true));
        newSocket.on('disconnect', () => setIsConnected(false));

        newSocket.on('STATE_UPDATE', (data) => setRealState(prev => ({ ...prev, ...data })));
        newSocket.on('STATE_FULL', (data) => setRealState(data));
        newSocket.on('ONLINE_USERS', (users) => setOnlineList(users || []));
        newSocket.on('WEATHER_FULL_UPDATE', (data) => setWeatherData(Array.isArray(data) ? data : []));

        newSocket.on('SIM_STATUS', (data) => {
            setSimMeta({ active: data.active, owner: data.owner });
            setSimRuntime(data.state);
            setSimExtra(data.extraState || 0);
            if (!data.active) setIsSimViewer(false);
        });

        newSocket.on('SIM_UPDATE', (update) => {
            setSimRuntime(prev => {
                if (!prev) return prev;
                const newState = [...prev];
                newState[update.id] = { ...newState[update.id], ...update };
                return newState;
            });
        });

        newSocket.on('USER_PERMISSION_UPDATE', ({ userId, key, value }) => {
            setUser(prevUser => {
                if (!prevUser || String(prevUser.id) !== String(userId)) return prevUser;
                const finalValue = (key === 'role') ? value : !!value;
                return { ...prevUser, [key]: finalValue };
            });
        });

        return () => newSocket.close();
    }, []);

    // ✅ DERIVED STATE: APPLY INVERSION & OVERRIDES (VISUAL)
    const systemState = useMemo(() => {
        const amISimOwner = user && simMeta.owner === user.username;
        const amIViewer = isSimViewer && simMeta.active;
        const isSimMode = (amISimOwner || amIViewer) && simRuntime;

        // 1. Determine Source
        let currentVirtual = isSimMode ? new Array(24).fill(0) : [...realState.virtualSwitches];
        let currentFeedback = isSimMode ? simRuntime.map(s => s.inputMask) : realState.stationFeedback;
        const onlineState = isSimMode ? simRuntime.map(s => s.connected) : realState.stationOnline;
        const lastSeen = isSimMode ? simRuntime.map(s => s.connected ? Date.now() : 0) : realState.stationLastSeen;

        // 2. Populate Virtual Switches (if Sim Mode)
        if (isSimMode) {
            // Standard Switches
            INPUT_MAP.forEach(m => {
                const stData = simRuntime[m.st];
                if (stData) {
                    let rawVal = (stData.relayMask >> m.bit) & 1;
                    const mask = parseInt(siteSettings.switch_logic_mask || '0');
                    // Invert if needed
                    if ((mask >> m.idx) & 1) rawVal = rawVal === 1 ? 0 : 1;
                    if (rawVal === 1) currentVirtual[m.idx] = 1;
                }
            });
            // Extra Switches
            const mask = parseInt(siteSettings.switch_logic_mask || '0');
            for (let i = 21; i <= 23; i++) {
                let rawVal = (simExtra >> i) & 1;
                if ((mask >> i) & 1) rawVal = rawVal === 1 ? 0 : 1;
                if (rawVal === 1) currentVirtual[i] = 1;
            }
        }

        // 3. ✅ APPLY THERMOSTAT VISUAL OVERRIDES
        // If thermostat active, force vacuum switches to LOOK "ON".
        const ledMask = parseInt(siteSettings.led_logic_mask || '0');

        THERMOSTATS.forEach(th => {
            // If Thermostat Switch is ON
            if (currentVirtual[th.swIdx]) {
                // Read Feedback
                let rawBit = (currentFeedback[th.feedbackSt] >> th.feedbackBit) & 1;

                // Apply Sensor Inversion (NO/NC)
                if ((ledMask >> th.swIdx) & 1) {
                    rawBit = rawBit === 1 ? 0 : 1;
                }

                // Logic: 0 = Active/Cold (Call for Heat)
                if (rawBit === 0) {
                    th.overrides.forEach(targetIdx => {
                        currentVirtual[targetIdx] = 1; // Force Visual ON
                    });
                }
            }
        });

        if (isSimMode) {
            return {
                ...realState,
                controller: 'USER',
                currentUser: user?.username,
                virtualSwitches: currentVirtual,
                stationFeedback: currentFeedback,
                stationOnline: onlineState,
                stationLastSeen: lastSeen,
                mainControllerOnline: true
            };
        }

        return {
            ...realState,
            virtualSwitches: currentVirtual
        };

    }, [realState, simMeta, simRuntime, simExtra, user, isSimViewer, siteSettings.switch_logic_mask, siteSettings.led_logic_mask]);

    // ... (Rest of useEffects and functions same as before) ...
    useEffect(() => {
        const checkSession = async () => {
            try {
                if (token) {
                    const resSettings = await axios.get(`${API_URL}/api/system/settings`, { headers: { Authorization: `Bearer ${token}` } });
                    setSiteSettings(resSettings.data);
                }
            } catch (e) { }

            if (!token) { setAuthLoading(false); return; }
            try {
                const res = await axios.get(`${API_URL}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
                setUser(res.data);
            } catch (e) { logout(); } finally { setAuthLoading(false); }
        };
        checkSession();
    }, [token]);

    useEffect(() => {
        if (user && user.settings && user.settings.language) {
            if (i18n.language !== user.settings.language) i18n.changeLanguage(user.settings.language);
        }
    }, [user]);

    useEffect(() => { if (socket && user?.username) socket.emit('IDENTIFY', user.username); }, [socket, user]);

    const login = async (username, password) => {
        try {
            const res = await axios.post(`${API_URL}/api/auth/login`, { username, password });
            const { token, role, settings } = res.data;
            localStorage.setItem('cabane_token', token);
            setToken(token);
            const meRes = await axios.get(`${API_URL}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } });
            setUser(meRes.data);
            return true;
        } catch (e) { return false; }
    };
    const register = async (username, email, password) => { try { await axios.post(`${API_URL}/api/auth/register`, { username, email, password }); return { success: true }; } catch (e) { return { success: false, error: e.response?.data?.error }; } };
    const logout = () => { localStorage.removeItem('cabane_token'); setToken(null); setUser(null); window.location.reload(); };
    const updateSettings = async (newSettings) => { setUser(prev => ({ ...prev, settings: newSettings })); if (token) try { await axios.post(`${API_URL}/api/user/settings`, { settings: newSettings }, { headers: { Authorization: `Bearer ${token}` } }); } catch (e) { } };
    const updateSiteSettings = async (newSettings) => { try { await axios.post(`${API_URL}/api/system/settings`, newSettings, { headers: { Authorization: `Bearer ${token}` } }); setSiteSettings(prev => ({ ...prev, ...newSettings })); return true; } catch (e) { return false; } };

    const takeControl = async () => {
        if (!token) { showAlert("Access Denied", "Login required."); return; }
        try { await axios.post(`${API_URL}/api/control/take`, {}, { headers: { Authorization: `Bearer ${token}` } }); }
        catch (e) { showAlert("Control Error", e.message); }
    };
    const releaseToServer = async () => { if (token) try { await axios.post(`${API_URL}/api/control/release-server`, {}, { headers: { Authorization: `Bearer ${token}` } }); } catch (e) { } };
    const releaseToCabane = async () => { if (token) try { await axios.post(`${API_URL}/api/control/release-cabane`, {}, { headers: { Authorization: `Bearer ${token}` } }); } catch (e) { } };

    const toggleSwitch = async (index, value) => {
        if (!simMeta.active) {
            setRealState(prev => {
                const newVirtual = [...prev.virtualSwitches];
                newVirtual[index] = value ? 1 : 0;
                return { ...prev, virtualSwitches: newVirtual };
            });
        }
        if (token) await axios.post(`${API_URL}/api/control/toggle`, { index, value }, { headers: { Authorization: `Bearer ${token}` } });
    };

    return (
        <SocketContext.Provider value={{
            socket, isConnected, systemState, user, authLoading, onlineList, siteSettings, weatherData, simState: simMeta,
            bannerHeight, setBannerHeight, isSimViewer, setIsSimViewer,
            login, register, logout, updateSettings, updateSiteSettings, takeControl, releaseToServer, releaseToCabane, toggleSwitch
        }}>
            {children}
        </SocketContext.Provider>
    );
};