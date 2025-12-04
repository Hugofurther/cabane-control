import React, { useState, useEffect } from 'react';
import { Settings, X, Volume2, BellOff, Smartphone, Clock, Thermometer, Mail } from 'lucide-react';
import { useSocket } from '../contexts/SocketContext';
import axios from 'axios';

const API_URL = import.meta.env.PROD ? '' : (import.meta.env.VITE_API_URL || 'http://localhost:3000');

export const UserSettings = ({ isOpen, onClose }) => {
    const { user, updateSettings } = useSocket();
    const [activeTab, setActiveTab] = useState('GENERAL');

    const [formData, setFormData] = useState({
        username: user?.username || '',
        email: user?.email || '',
        currentPassword: '',
        newPassword: ''
    });
    const [msg, setMsg] = useState({ type: '', text: '' });

    // Sync form data when user loads
    useEffect(() => {
        if (isOpen && user) {
            setFormData(prev => ({ ...prev, username: user.username, email: user.email }));
        }
    }, [isOpen, user]);

    if (!isOpen || !user) return null;

    // --- HANDLERS ---

    const handleSettingChange = (key, val) => {
        // Merge current settings with new change
        const newSettings = { ...user.settings, [key]: val };
        updateSettings(newSettings);
    };

    const handleProfileUpdate = async (e) => {
        e.preventDefault();
        setMsg({ type: '', text: '' });
        const token = localStorage.getItem('cabane_token');
        try {
            await axios.post(`${API_URL}/api/user/profile`,
                { newUsername: formData.username, newEmail: formData.email },
                { headers: { Authorization: `Bearer ${token}` } }
            );
            setMsg({ type: 'success', text: 'Profile updated!' });
        } catch (e) {
            setMsg({ type: 'error', text: e.response?.data?.error || 'Update failed' });
        }
    };

    const handlePasswordUpdate = async (e) => {
        e.preventDefault();
        setMsg({ type: '', text: '' });
        const token = localStorage.getItem('cabane_token');
        try {
            await axios.post(`${API_URL}/api/user/password`,
                { currentPassword: formData.currentPassword, newPassword: formData.newPassword },
                { headers: { Authorization: `Bearer ${token}` } }
            );
            setMsg({ type: 'success', text: 'Password changed!' });
            setFormData(p => ({ ...p, currentPassword: '', newPassword: '' }));
        } catch (e) {
            setMsg({ type: 'error', text: e.response?.data?.error || 'Failed' });
        }
    };

    return (
        // Backdrop
        <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-[70] p-4 backdrop-blur-sm" onClick={onClose}>
            {/* Modal */}
            <div className="bg-cabane-panel border border-gray-600 rounded-lg shadow-2xl w-full max-w-md overflow-hidden flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>

                {/* Header */}
                <div className="flex justify-between items-center p-4 border-b border-gray-700 bg-gray-800">
                    <h2 className="text-xl font-bold text-gray-200 flex items-center gap-2">
                        <Settings size={20} /> Settings
                    </h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-white"><X size={24} /></button>
                </div>

                {/* Tabs */}
                <div className="flex border-b border-gray-700 bg-gray-900">
                    <button
                        onClick={() => setActiveTab('GENERAL')}
                        className={`flex-1 py-3 text-sm font-bold uppercase tracking-wide transition-colors ${activeTab === 'GENERAL' ? 'bg-gray-800 text-blue-400 border-t-2 border-blue-500' : 'text-gray-500 hover:text-white'}`}
                    >
                        General
                    </button>
                    <button
                        onClick={() => setActiveTab('PROFILE')}
                        className={`flex-1 py-3 text-sm font-bold uppercase tracking-wide transition-colors ${activeTab === 'PROFILE' ? 'bg-gray-800 text-blue-400 border-t-2 border-blue-500' : 'text-gray-500 hover:text-white'}`}
                    >
                        Profile
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 overflow-y-auto">
                    {msg.text && (
                        <div className={`mb-4 p-2 rounded text-sm text-center ${msg.type === 'success' ? 'bg-green-900/50 text-green-400' : 'bg-red-900/50 text-red-400'}`}>
                            {msg.text}
                        </div>
                    )}

                    {activeTab === 'GENERAL' ? (
                        <div className="flex flex-col gap-6">

                            {/* Audio Toggle */}
                            <div className="flex justify-between items-center">
                                <div className="flex items-center gap-3">
                                    <div className={`p-2 rounded-full ${user.settings?.soundEnabled ? 'bg-green-900/50 text-green-400' : 'bg-gray-700 text-gray-500'}`}>
                                        {user.settings?.soundEnabled ? <Volume2 /> : <BellOff />}
                                    </div>
                                    <div>
                                        <div className="font-bold text-gray-200">Audio Alarm</div>
                                        <div className="text-xs text-gray-500">Siren and Chirps</div>
                                    </div>
                                </div>
                                <input type="checkbox" className="w-6 h-6 cursor-pointer accent-blue-600"
                                    checked={!!user.settings?.soundEnabled}
                                    onChange={e => handleSettingChange('soundEnabled', e.target.checked)} />
                            </div>

                            {/* Vibration Toggle */}
                            <div className="flex justify-between items-center">
                                <div className="flex items-center gap-3">
                                    <div className={`p-2 rounded-full ${user.settings?.vibrationEnabled ? 'bg-purple-900/50 text-purple-400' : 'bg-gray-700 text-gray-500'}`}>
                                        <Smartphone />
                                    </div>
                                    <div><div className="font-bold text-gray-200">Vibration</div></div>
                                </div>
                                <input type="checkbox" className="w-6 h-6 cursor-pointer accent-blue-600"
                                    checked={!!user.settings?.vibrationEnabled}
                                    onChange={e => handleSettingChange('vibrationEnabled', e.target.checked)} />
                            </div>

                            {/* Main Controller Status Toggle */}
                            <div className="flex justify-between items-center border-t border-gray-700 pt-4">
                                <div className="flex items-center gap-3">
                                    <div className="p-2 rounded-full bg-blue-900/50 text-blue-400"><Settings size={20} /></div>
                                    <div>
                                        <div className="font-bold text-gray-200">Main Controller Status</div>
                                        <div className="text-xs text-gray-500">Show Online/Offline badge</div>
                                    </div>
                                </div>
                                <input type="checkbox" className="w-6 h-6 cursor-pointer accent-blue-600"
                                    checked={!!user.settings?.showMainStatus}
                                    onChange={e => handleSettingChange('showMainStatus', e.target.checked)} />
                            </div>

                            {/* Clock Format */}
                            <div className="flex justify-between items-center border-t border-gray-700 pt-4">
                                <div className="flex items-center gap-3">
                                    <div className="p-2 rounded-full bg-blue-900/50 text-blue-400"><Clock size={20} /></div>
                                    <div><div className="font-bold text-gray-200">Clock Format</div></div>
                                </div>
                                <div className="flex bg-gray-900 rounded p-1 border border-gray-700">
                                    <button
                                        onClick={() => handleSettingChange('clockFormat', '12h')}
                                        className={`px-3 py-1 rounded text-xs font-bold ${user.settings?.clockFormat === '12h' ? 'bg-blue-600 text-white' : 'text-gray-500 hover:text-white'}`}
                                    >12h</button>
                                    <button
                                        onClick={() => handleSettingChange('clockFormat', '24h')}
                                        className={`px-3 py-1 rounded text-xs font-bold ${user.settings?.clockFormat !== '12h' ? 'bg-blue-600 text-white' : 'text-gray-500 hover:text-white'}`}
                                    >24h</button>
                                </div>
                            </div>

                            {/* Temperature Unit */}
                            <div className="flex justify-between items-center border-t border-gray-700 pt-4">
                                <div className="flex items-center gap-3">
                                    <div className="p-2 rounded-full bg-orange-900/50 text-orange-400"><Thermometer size={20} /></div>
                                    <div><div className="font-bold text-gray-200">Temperature</div></div>
                                </div>
                                <div className="flex bg-gray-900 rounded p-1 border border-gray-700">
                                    <button
                                        onClick={() => handleSettingChange('tempUnit', 'C')}
                                        className={`px-3 py-1 rounded text-xs font-bold ${user.settings?.tempUnit !== 'F' ? 'bg-orange-600 text-white' : 'text-gray-500 hover:text-white'}`}
                                    >°C</button>
                                    <button
                                        onClick={() => handleSettingChange('tempUnit', 'F')}
                                        className={`px-3 py-1 rounded text-xs font-bold ${user.settings?.tempUnit === 'F' ? 'bg-orange-600 text-white' : 'text-gray-500 hover:text-white'}`}
                                    >°F</button>
                                </div>
                            </div>

                            {/* Message Auto-Dismiss */}
                            <div className="flex justify-between items-center border-t border-gray-700 pt-4">
                                <div className="flex items-center gap-3">
                                    <div className="p-2 rounded-full bg-pink-900/50 text-pink-400"><Mail size={20} /></div>
                                    <div>
                                        <div className="font-bold text-gray-200">Message Popup</div>
                                        <div className="text-xs text-gray-500">Auto-dismiss seconds (0 = Never)</div>
                                    </div>
                                </div>
                                <input
                                    type="number"
                                    min="0" max="60"
                                    className="w-16 bg-gray-900 border border-gray-600 rounded p-2 text-white outline-none text-center focus:border-blue-500"
                                    value={user.settings?.msgDismissTime !== undefined ? user.settings.msgDismissTime : 0}
                                    onChange={e => handleSettingChange('msgDismissTime', parseInt(e.target.value) || 0)}
                                />
                            </div>

                        </div>
                    ) : (
                        <div className="flex flex-col gap-8">
                            {/* Profile Form */}
                            <form onSubmit={handleProfileUpdate} className="flex flex-col gap-3">
                                <h3 className="text-gray-400 text-xs font-bold uppercase border-b border-gray-700 pb-1">Account Details</h3>
                                <div className="space-y-1">
                                    <label className="text-xs text-gray-500">Username</label>
                                    <input type="text" value={formData.username} onChange={e => setFormData({ ...formData, username: e.target.value })}
                                        className="w-full bg-gray-800 border border-gray-600 rounded p-2 text-white focus:border-blue-500 outline-none" />
                                </div>
                                <div className="space-y-1">
                                    <label className="text-xs text-gray-500">Email</label>
                                    <input type="email" value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })}
                                        className="w-full bg-gray-800 border border-gray-600 rounded p-2 text-white focus:border-blue-500 outline-none" />
                                </div>
                                <button className="bg-blue-700 hover:bg-blue-600 text-white py-2 rounded font-bold text-sm transition-colors">Save Profile</button>
                            </form>

                            {/* Password Form */}
                            <form onSubmit={handlePasswordUpdate} className="flex flex-col gap-3">
                                <h3 className="text-gray-400 text-xs font-bold uppercase border-b border-gray-700 pb-1">Change Password</h3>
                                <input type="password" placeholder="Current Password" value={formData.currentPassword} onChange={e => setFormData({ ...formData, currentPassword: e.target.value })}
                                    className="w-full bg-gray-800 border border-gray-600 rounded p-2 text-white focus:border-blue-500 outline-none" />
                                <input type="password" placeholder="New Password" value={formData.newPassword} onChange={e => setFormData({ ...formData, newPassword: e.target.value })}
                                    className="w-full bg-gray-800 border border-gray-600 rounded p-2 text-white focus:border-blue-500 outline-none" />
                                <button className="bg-red-900/50 hover:bg-red-800 border border-red-800 text-red-200 py-2 rounded font-bold text-sm transition-colors">Update Password</button>
                            </form>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};