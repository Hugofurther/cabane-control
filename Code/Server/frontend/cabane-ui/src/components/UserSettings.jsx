import React, { useState, useEffect } from 'react';
import { X, Save, Volume2, VolumeX, Smartphone, Clock, Layout, Users, Shield, LogOut, Lock } from 'lucide-react';
import { useSocket } from '../contexts/SocketContext';
import { clsx } from 'clsx';
import axios from 'axios';

const API_URL = import.meta.env.PROD ? '' : (import.meta.env.VITE_API_URL || 'http://localhost:3000');

export const UserSettings = ({ isOpen, onClose }) => {
    const { user, updateSettings, logout } = useSocket();
    const [passwordData, setPasswordData] = useState({ current: '', new: '', confirm: '' });
    const [msg, setMsg] = useState(null);

    // State for Session Timeout inputs
    const [sessionVal, setSessionVal] = useState(60);
    const [sessionUnit, setSessionUnit] = useState('d');

    // Parse existing setting on open
    useEffect(() => {
        if (user?.settings?.tokenExpiration) {
            // ✅ CHANGE: Added 'm' to the regex: [hdm]
            const match = user.settings.tokenExpiration.match(/^(\d+)([hdm])$/);
            if (match) {
                setSessionVal(parseInt(match[1]));
                setSessionUnit(match[2]);
            }
        }
    }, [user, isOpen]);

    if (!isOpen || !user) return null;

    // Helper to toggle a boolean setting
    const toggleSetting = (key) => {
        const current = user.settings?.[key] ?? true; // Default true for most
        updateSettings({ ...user.settings, [key]: !current });
    };

    // Helper to set a specific value
    const setSetting = (key, value) => {
        updateSettings({ ...user.settings, [key]: value });
    };

    // Handle Session Save
    const saveSessionTimeout = () => {
        const val = sessionVal > 0 ? sessionVal : 60; // Prevent 0 or negative
        const str = `${val}${sessionUnit}`;
        updateSettings({ ...user.settings, tokenExpiration: str });
    };

    const handlePasswordChange = async (e) => {
        e.preventDefault();
        if (passwordData.new !== passwordData.confirm) {
            setMsg({ type: 'error', text: "Passwords do not match." });
            return;
        }
        try {
            const token = localStorage.getItem('cabane_token');
            await axios.post(`${API_URL}/api/user/password`,
                { currentPassword: passwordData.current, newPassword: passwordData.new },
                { headers: { Authorization: `Bearer ${token}` } }
            );
            setMsg({ type: 'success', text: "Password updated." });
            setPasswordData({ current: '', new: '', confirm: '' });
        } catch (e) {
            setMsg({ type: 'error', text: e.response?.data?.error || "Failed to update." });
        }
    };

    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[60] flex items-center justify-center p-4 animate-in fade-in duration-200" onClick={onClose}>
            <div className="bg-gray-900 border border-gray-700 w-full max-w-md rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>

                {/* HEADER */}
                <div className="p-6 bg-gray-800 border-b border-gray-700 flex justify-between items-center">
                    <h2 className="text-xl font-black text-white tracking-wide uppercase flex items-center gap-2">
                        <Users size={20} className="text-blue-500" /> User Settings
                    </h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors"><X size={24} /></button>
                </div>

                {/* SCROLLABLE CONTENT */}
                <div className="p-6 space-y-8 overflow-y-auto flex-grow">

                    {/* 1. APPEARANCE & BEHAVIOR */}
                    <section className="space-y-3">
                        <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Interface Preferences</h3>

                        {/* Sound */}
                        <div className="flex items-center justify-between p-3 bg-gray-800/50 rounded-lg border border-gray-700">
                            <div className="flex items-center gap-3">
                                {user.settings?.soundEnabled ? <Volume2 size={18} className="text-green-400" /> : <VolumeX size={18} className="text-gray-500" />}
                                <span className="text-sm font-medium text-gray-200">Sound Effects</span>
                            </div>
                            <Toggle checked={user.settings?.soundEnabled ?? true} onChange={() => toggleSetting('soundEnabled')} />
                        </div>

                        {/* Vibration */}
                        <div className="flex items-center justify-between p-3 bg-gray-800/50 rounded-lg border border-gray-700">
                            <div className="flex items-center gap-3">
                                <Smartphone size={18} className={user.settings?.vibrationEnabled ? "text-purple-400" : "text-gray-500"} />
                                <span className="text-sm font-medium text-gray-200">Haptic Feedback</span>
                            </div>
                            <Toggle checked={user.settings?.vibrationEnabled ?? true} onChange={() => toggleSetting('vibrationEnabled')} />
                        </div>

                        {/* Clock Format */}
                        <div className="flex items-center justify-between p-3 bg-gray-800/50 rounded-lg border border-gray-700">
                            <div className="flex items-center gap-3">
                                <Clock size={18} className="text-blue-400" />
                                <span className="text-sm font-medium text-gray-200">Clock Format</span>
                            </div>
                            <div className="flex bg-gray-900 rounded p-1">
                                {['12h', '24h'].map(fmt => (
                                    <button
                                        key={fmt}
                                        onClick={() => setSetting('clockFormat', fmt)}
                                        className={clsx("px-3 py-1 rounded text-xs font-bold transition-colors", (user.settings?.clockFormat || '24h') === fmt ? 'bg-blue-600 text-white shadow' : 'text-gray-500 hover:text-gray-300')}
                                    >
                                        {fmt.toUpperCase()}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Show Main Controller Status */}
                        <div className="flex items-center justify-between p-3 bg-gray-800/50 rounded-lg border border-gray-700">
                            <div className="flex items-center gap-3">
                                <Layout size={18} className="text-yellow-400" />
                                <span className="text-sm font-medium text-gray-200">Show Cabane Status</span>
                            </div>
                            <Toggle checked={user.settings?.showMainStatus ?? true} onChange={() => toggleSetting('showMainStatus')} />
                        </div>
                    </section>

                    {/* 2. ADMIN DEFAULTS */}
                    <section className="space-y-3">
                        <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Group Admin Defaults</h3>

                        <div className="p-3 bg-gray-800/50 rounded-lg border border-gray-700 space-y-2">
                            <div className="flex items-center gap-3 mb-2">
                                <Shield size={18} className="text-red-400" />
                                <span className="text-sm font-medium text-gray-200">Member Add/Remove Notification</span>
                            </div>
                            <div className="grid grid-cols-3 gap-2">
                                {['QUIET', 'PUBLIC', 'PRIVATE'].map(type => (
                                    <button
                                        key={type}
                                        onClick={() => setSetting('defaultGroupNotify', type)}
                                        className={clsx(
                                            "py-2 rounded text-[10px] font-bold uppercase transition-all border",
                                            (user.settings?.defaultGroupNotify || 'PUBLIC') === type
                                                ? 'bg-red-900/50 border-red-500 text-red-200 shadow-sm'
                                                : 'bg-gray-900 border-gray-700 text-gray-500 hover:bg-gray-800'
                                        )}
                                    >
                                        {type}
                                    </button>
                                ))}
                            </div>
                            <p className="text-[10px] text-gray-500 italic mt-1 text-center">
                                {(user.settings?.defaultGroupNotify || 'PUBLIC') === 'QUIET' && "No alerts sent."}
                                {(user.settings?.defaultGroupNotify || 'PUBLIC') === 'PUBLIC' && "Alerts sent to the whole group."}
                                {(user.settings?.defaultGroupNotify || 'PUBLIC') === 'PRIVATE' && "Alert sent only to the affected user."}
                            </p>
                        </div>
                    </section>

                    {/* 3. SECURITY */}
                    <section className="space-y-3 pt-4 border-t border-gray-800">
                        <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Security</h3>

                        {/* Session Timeout Config */}
                        <div className="p-3 bg-gray-800/50 rounded-lg border border-gray-700 mb-4">
                            <div className="flex items-center gap-3 mb-2">
                                <Lock size={18} className="text-orange-400" />
                                <span className="text-sm font-medium text-gray-200">Session Timeout</span>
                            </div>
                            <div className="flex gap-2">
                                <input
                                    type="number"
                                    min="1"
                                    value={sessionVal}
                                    onChange={(e) => {
                                        setSessionVal(e.target.value);
                                        // Auto-save logic could go here, or rely on blur
                                    }}
                                    onBlur={saveSessionTimeout}
                                    className="bg-gray-900 border border-gray-600 rounded p-2 text-white text-sm w-20 text-center"
                                />
                                <select
                                    value={sessionUnit}
                                    onChange={(e) => {
                                        setSessionUnit(e.target.value);
                                        updateSettings({ ...user.settings, tokenExpiration: `${sessionVal}${e.target.value}` });
                                    }}
                                    className="bg-gray-900 border border-gray-600 rounded p-2 text-white text-sm flex-grow"
                                >
                                    <option value="d">Days</option>
                                    <option value="h">Hours</option>
                                    {/* ✅ NEW OPTION */}
                                    <option value="m">Minutes</option>
                                </select>
                            </div>
                            <p className="text-[10px] text-gray-500 mt-1">Changes apply at next login.</p>
                        </div>

                        <form onSubmit={handlePasswordChange} className="space-y-3">
                            <input type="password" placeholder="Current Password" value={passwordData.current} onChange={e => setPasswordData(p => ({ ...p, current: e.target.value }))} className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-white text-sm" required />
                            <div className="flex gap-2">
                                <input type="password" placeholder="New Password" value={passwordData.new} onChange={e => setPasswordData(p => ({ ...p, new: e.target.value }))} className="w-1/2 bg-gray-900 border border-gray-600 rounded p-2 text-white text-sm" required />
                                <input type="password" placeholder="Confirm" value={passwordData.confirm} onChange={e => setPasswordData(p => ({ ...p, confirm: e.target.value }))} className="w-1/2 bg-gray-900 border border-gray-600 rounded p-2 text-white text-sm" required />
                            </div>
                            {msg && <div className={clsx("text-xs font-bold p-2 rounded text-center", msg.type === 'error' ? 'bg-red-900/50 text-red-400' : 'bg-green-900/50 text-green-400')}>{msg.text}</div>}
                            <button type="submit" className="w-full py-2 bg-blue-600 hover:bg-blue-500 rounded text-white font-bold text-sm flex items-center justify-center gap-2 shadow-lg"><Save size={16} /> Update Password</button>
                        </form>
                    </section>
                </div>

                {/* FOOTER */}
                <div className="p-4 bg-gray-900 border-t border-gray-800">
                    <button onClick={() => { logout(); onClose(); }} className="w-full py-3 bg-red-600 hover:bg-red-500 rounded text-white font-black uppercase tracking-widest shadow-lg flex items-center justify-center gap-2 transition-all">
                        <LogOut size={20} /> Sign Out
                    </button>
                </div>
            </div>
        </div>
    );
};

// Simple Toggle Component
const Toggle = ({ checked, onChange }) => (
    <div onClick={onChange} className={clsx("w-10 h-5 rounded-full p-1 cursor-pointer transition-colors relative", checked ? "bg-blue-500" : "bg-gray-700")}>
        <div className={clsx("w-3 h-3 bg-white rounded-full shadow-sm transform transition-transform", checked ? "translate-x-5" : "translate-x-0")} />
    </div>
);