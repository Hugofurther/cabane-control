import React, { useState, useEffect } from 'react';
import { X, Save, Volume2, VolumeX, Smartphone, Clock, Layout, Users, Shield, LogOut, Lock, User, Cloud, ScrollText, Zap, Sliders, Bell, Globe } from 'lucide-react';
import { useSocket } from '../contexts/SocketContext';
import { useModal } from '../contexts/ModalContext';
import { clsx } from 'clsx';
import axios from 'axios';
import { useTranslation } from 'react-i18next';

// Import Embedded Components
import { AdminPanel } from './AdminPanel';
import { LogViewer } from './LogViewer';

const API_URL = import.meta.env.PROD ? '' : (import.meta.env.VITE_API_URL || 'http://localhost:3000');

export const UserSettings = ({ isOpen, onClose }) => {
    const { user, updateSettings, logout } = useSocket();
    const { showAlert } = useModal();
    const { t, i18n } = useTranslation();

    const [activeTab, setActiveTab] = useState('GENERAL');
    const [localSettings, setLocalSettings] = useState({});
    const [profile, setProfile] = useState({ username: '', email: '' });
    const [passwordData, setPasswordData] = useState({ current: '', new: '', confirm: '' });
    const [msg, setMsg] = useState(null);

    const [sessionVal, setSessionVal] = useState(60);
    const [sessionUnit, setSessionUnit] = useState('d');

    const [appSirenSilence, setAppSirenSilence] = useState(5);
    const [appChirpInterval, setAppChirpInterval] = useState(2);

    const canAdmin = user?.role === 'ADMIN';
    const canLogs = canAdmin || user?.can_view_logs;

    useEffect(() => {
        if (isOpen && user) {
            setActiveTab('GENERAL');
            if (user.settings) {
                setLocalSettings(user.settings);
                if (user.settings.tokenExpiration) {
                    const match = user.settings.tokenExpiration.match(/^(\d+)([hdm])$/);
                    if (match) { setSessionVal(parseInt(match[1])); setSessionUnit(match[2]); }
                }
                setAppSirenSilence(user.settings.appSirenSilence || 5);
                setAppChirpInterval(user.settings.appChirpInterval || 2);
            }
            setProfile({ username: user.username || '', email: user.email || '' });
        }
    }, [isOpen, user]);

    if (!isOpen || !user) return null;

    const toggleSetting = (key) => setLocalSettings(prev => ({ ...prev, [key]: !prev[key] }));
    const setSetting = (key, value) => setLocalSettings(prev => ({ ...prev, [key]: value }));

    const changeLanguage = (lang) => {
        i18n.changeLanguage(lang);
        const finalSettings = { ...localSettings, language: lang };
        setLocalSettings(finalSettings);
    };

    const handleSaveAll = async () => {
        const token = localStorage.getItem('cabane_token');
        try {
            if (profile.username !== user.username || profile.email !== user.email) {
                await axios.post(`${API_URL}/api/user/profile`, { newUsername: profile.username, newEmail: profile.email }, { headers: { Authorization: `Bearer ${token}` } });
            }
            const val = sessionVal > 0 ? sessionVal : 60;

            const finalSettings = {
                ...localSettings,
                language: i18n.language,
                tokenExpiration: `${val}${sessionUnit}`,
                appSirenSilence: parseFloat(appSirenSilence) || 5,
                appChirpInterval: parseFloat(appChirpInterval) || 2
            };

            await updateSettings(finalSettings);
            onClose();
        } catch (e) { showAlert(t('common.error'), e.response?.data?.error || "Failed to save settings."); }
    };

    const handlePasswordChange = async (e) => {
        e.preventDefault();
        if (passwordData.new !== passwordData.confirm) { setMsg({ type: 'error', text: "Passwords do not match." }); return; }
        try {
            await axios.post(`${API_URL}/api/user/password`, { currentPassword: passwordData.current, newPassword: passwordData.new }, { headers: { Authorization: `Bearer ${localStorage.getItem('cabane_token')}` } });
            setMsg({ type: 'success', text: t('common.success') }); setPasswordData({ current: '', new: '', confirm: '' });
        } catch (e) { setMsg({ type: 'error', text: e.response?.data?.error || t('common.error') }); }
    };

    const isWide = activeTab === 'ADMIN' || activeTab === 'LOGS';

    // ✅ SAFE CHECK for Language State
    const currentLang = i18n.language || 'en';

    return (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-[1px] z-[60] flex items-center justify-center p-4 animate-in fade-in duration-200" onClick={onClose}>
            <div className={clsx("bg-gray-900 border border-gray-700 w-full rounded-2xl shadow-2xl overflow-hidden flex flex-col transition-all duration-300", isWide ? "max-w-6xl h-[85vh]" : "max-w-md max-h-[90vh]")} onClick={e => e.stopPropagation()}>

                {/* HEADER */}
                <div className="flex justify-between items-center p-6 border-b border-gray-700 bg-gray-800 shrink-0">
                    <h2 className="text-xl font-black text-white tracking-wide uppercase flex items-center gap-2">
                        {activeTab === 'ADMIN' ? <Shield size={20} className="text-blue-500" /> :
                            activeTab === 'LOGS' ? <ScrollText size={20} className="text-yellow-500" /> :
                                <Users size={20} className="text-blue-500" />}
                        {activeTab === 'ADMIN' ? t('admin.title') :
                            activeTab === 'LOGS' ? t('logs.title') : t('settings.title')}
                    </h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors"><X size={24} /></button>
                </div>

                {/* TABS */}
                <div className="flex border-b border-gray-700 bg-gray-900 shrink-0 overflow-x-auto">
                    <button onClick={() => setActiveTab('GENERAL')} className={`flex-1 min-w-[80px] py-3 text-sm font-bold uppercase ${activeTab === 'GENERAL' ? 'text-blue-400 border-t-2 border-blue-500 bg-gray-800' : 'text-gray-500 hover:text-gray-300'}`}>{t('settings.tabs.general')}</button>
                    <button onClick={() => setActiveTab('PROFILE')} className={`flex-1 min-w-[80px] py-3 text-sm font-bold uppercase ${activeTab === 'PROFILE' ? 'text-blue-400 border-t-2 border-blue-500 bg-gray-800' : 'text-gray-500 hover:text-gray-300'}`}>{t('settings.tabs.profile')}</button>
                    {canLogs && <button onClick={() => setActiveTab('LOGS')} className={`flex-1 min-w-[80px] py-3 text-sm font-bold uppercase ${activeTab === 'LOGS' ? 'text-yellow-400 border-t-2 border-yellow-500 bg-gray-800' : 'text-gray-500 hover:text-gray-300'}`}>{t('settings.tabs.logs')}</button>}
                    {canAdmin && <button onClick={() => setActiveTab('ADMIN')} className={`flex-1 min-w-[80px] py-3 text-sm font-bold uppercase ${activeTab === 'ADMIN' ? 'text-red-400 border-t-2 border-red-500 bg-gray-800' : 'text-gray-500 hover:text-gray-300'}`}>{t('settings.tabs.admin')}</button>}
                </div>

                {/* BODY */}
                <div className={clsx("flex-grow bg-gray-900 p-0 relative", (activeTab === 'LOGS' || activeTab === 'ADMIN') ? "overflow-hidden flex flex-col" : "overflow-y-auto")}>

                    {activeTab === 'GENERAL' && (
                        <div className="p-6 space-y-8">

                            {/* LANGUAGE */}
                            <section className="space-y-3">
                                <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">{t('settings.language')}</h3>
                                <div className="p-3 bg-gray-800/50 rounded-lg border border-gray-700">
                                    <div className="flex items-center gap-3 mb-2">
                                        <Globe size={18} className="text-blue-400" />
                                        <span className="text-sm font-medium text-gray-200">Select Language / Langue</span>
                                    </div>
                                    <div className="flex bg-gray-900 rounded p-1">
                                        <button onClick={() => changeLanguage('en')} className={clsx("flex-1 py-1 rounded text-xs font-bold transition-colors", currentLang.startsWith('en') ? 'bg-blue-600 text-white shadow' : 'text-gray-500 hover:text-gray-300')}>ENGLISH</button>
                                        <button onClick={() => changeLanguage('fr')} className={clsx("flex-1 py-1 rounded text-xs font-bold transition-colors", currentLang.startsWith('fr') ? 'bg-blue-600 text-white shadow' : 'text-gray-500 hover:text-gray-300')}>FRANÇAIS</button>
                                    </div>
                                </div>
                            </section>

                            <section className="space-y-3">
                                <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">{t('settings.interface_audio')}</h3>

                                <div className="flex items-center justify-between p-3 bg-gray-800/50 rounded-lg border border-gray-700">
                                    <div className="flex items-center gap-3">{localSettings.soundEnabled ? <Volume2 size={18} className="text-green-400" /> : <VolumeX size={18} className="text-gray-500" />}<span className="text-sm font-medium text-gray-200">{t('settings.master_sound')}</span></div>
                                    <Toggle checked={localSettings.soundEnabled ?? true} onChange={() => toggleSetting('soundEnabled')} />
                                </div>
                                <div className="flex items-center justify-between p-3 bg-gray-800/50 rounded-lg border border-gray-700">
                                    <div className="flex items-center gap-3"><Zap size={18} className={localSettings.flashSoundEnabled !== false ? "text-yellow-400" : "text-gray-500"} /><span className="text-sm font-medium text-gray-200">{t('settings.flash_alert')}</span></div>
                                    <Toggle checked={localSettings.flashSoundEnabled !== false} onChange={() => toggleSetting('flashSoundEnabled')} />
                                </div>

                                {/* AUDIO SLIDERS */}
                                <div className="p-3 bg-gray-800/50 rounded-lg border border-gray-700 space-y-4">
                                    <div>
                                        <div className="flex items-center justify-between mb-2">
                                            <div className="flex items-center gap-3"><Sliders size={18} className="text-red-400" /><span className="text-sm font-medium text-gray-200">{t('settings.siren_silence')}</span></div>
                                            <span className="text-xs font-bold text-gray-400">{appSirenSilence}s</span>
                                        </div>
                                        <input type="range" min="1" max="30" step="1" value={appSirenSilence} onChange={(e) => setAppSirenSilence(e.target.value)} className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-red-500" />
                                        <p className="text-[10px] text-gray-500 mt-1 text-right">{t('settings.siren_desc')}</p>
                                    </div>
                                    <div>
                                        <div className="flex items-center justify-between mb-2">
                                            <div className="flex items-center gap-3"><Bell size={18} className="text-yellow-400" /><span className="text-sm font-medium text-gray-200">{t('settings.chirp_interval')}</span></div>
                                            <span className="text-xs font-bold text-gray-400">{appChirpInterval}m</span>
                                        </div>
                                        <input type="range" min="1" max="60" step="1" value={appChirpInterval} onChange={(e) => setAppChirpInterval(e.target.value)} className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-yellow-500" />
                                        <p className="text-[10px] text-gray-500 mt-1 text-right">{t('settings.chirp_desc')}</p>
                                    </div>
                                </div>

                                {/* HAPTIC */}
                                <div className="flex items-center justify-between p-3 bg-gray-800/50 rounded-lg border border-gray-700">
                                    <div className="flex items-center gap-3"><Smartphone size={18} className={localSettings.vibrationEnabled ? "text-purple-400" : "text-gray-500"} /><span className="text-sm font-medium text-gray-200">{t('settings.haptic')}</span></div>
                                    <Toggle checked={localSettings.vibrationEnabled ?? true} onChange={() => toggleSetting('vibrationEnabled')} />
                                </div>
                                <div className="flex items-center justify-between p-3 bg-gray-800/50 rounded-lg border border-gray-700">
                                    <div className="flex items-center gap-3"><Cloud size={18} className="text-cyan-400" /><span className="text-sm font-medium text-gray-200">{t('settings.weather_widget')}</span></div>
                                    <Toggle checked={localSettings.showWeather ?? true} onChange={() => toggleSetting('showWeather')} />
                                </div>
                                <div className="flex items-center justify-between p-3 bg-gray-800/50 rounded-lg border border-gray-700">
                                    <div className="flex items-center gap-3"><Clock size={18} className="text-blue-400" /><span className="text-sm font-medium text-gray-200">{t('settings.clock_format')}</span></div>
                                    <div className="flex bg-gray-900 rounded p-1">
                                        {['12h', '24h'].map(fmt => (<button key={fmt} onClick={() => setSetting('clockFormat', fmt)} className={clsx("px-3 py-1 rounded text-xs font-bold transition-colors", (localSettings.clockFormat || '24h') === fmt ? 'bg-blue-600 text-white shadow' : 'text-gray-500 hover:text-gray-300')}>{fmt.toUpperCase()}</button>))}
                                    </div>
                                </div>
                                <div className="flex items-center justify-between p-3 bg-gray-800/50 rounded-lg border border-gray-700">
                                    <div className="flex items-center gap-3"><Layout size={18} className="text-yellow-400" /><span className="text-sm font-medium text-gray-200">{t('settings.cabane_status')}</span></div>
                                    <Toggle checked={localSettings.showMainStatus ?? true} onChange={() => toggleSetting('showMainStatus')} />
                                </div>
                            </section>

                            <section className="space-y-3 pt-4 border-t border-gray-800">
                                <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">{t('settings.admin_defaults')}</h3>
                                <div className="p-3 bg-gray-800/50 rounded-lg border border-gray-700 space-y-2">
                                    <div className="flex items-center gap-3 mb-2"><Shield size={18} className="text-red-400" /><span className="text-sm font-medium text-gray-200">{t('settings.member_notif')}</span></div>
                                    <div className="grid grid-cols-3 gap-2">
                                        {['QUIET', 'PUBLIC', 'PRIVATE'].map(type => (<button key={type} onClick={() => setSetting('defaultGroupNotify', type)} className={clsx("py-2 rounded text-[10px] font-bold uppercase transition-all border", (localSettings.defaultGroupNotify || 'PUBLIC') === type ? 'bg-red-900/50 border-red-500 text-red-200 shadow-sm' : 'bg-gray-900 border-gray-700 text-gray-500 hover:bg-gray-800')}>{type}</button>))}
                                    </div>
                                </div>
                            </section>

                            <section className="space-y-3 pt-4 border-t border-gray-800">
                                <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">{t('settings.disabled_stations_vis')}</h3>
                                <div className="p-3 bg-gray-800/50 rounded-lg border border-gray-700 space-y-3">
                                    <div className="flex items-center justify-between pl-2 border-l-2 border-gray-700">
                                        <span className="text-xs font-bold text-gray-300">{t('settings.desktop')}</span>
                                        <Toggle checked={localSettings.showDisabledLarge !== false} onChange={() => toggleSetting('showDisabledLarge')} />
                                    </div>
                                    <div className="flex items-center justify-between pl-2 border-l-2 border-gray-700">
                                        <span className="text-xs font-bold text-gray-300">{t('settings.mobile')}</span>
                                        <Toggle checked={localSettings.showDisabledSmall !== false} onChange={() => toggleSetting('showDisabledSmall')} />
                                    </div>
                                </div>
                            </section>
                        </div>
                    )}

                    {/* PROFILE TAB */}
                    {activeTab === 'PROFILE' && (
                        <div className="p-6 space-y-8">
                            <section className="space-y-3">
                                <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">{t('settings.my_profile')}</h3>
                                <div className="space-y-3">
                                    <div><label className="text-[10px] font-bold text-gray-500 mb-1 block">{t('auth.username').toUpperCase()}</label><div className="flex items-center bg-gray-900 border border-gray-600 rounded px-3 py-2"><User size={16} className="text-gray-500 mr-2" /><input type="text" value={profile.username} onChange={e => setProfile({ ...profile, username: e.target.value })} className="bg-transparent text-white text-sm outline-none w-full" /></div></div>
                                    <div><label className="text-[10px] font-bold text-gray-500 mb-1 block">{t('auth.email').toUpperCase()}</label><input type="email" value={profile.email} onChange={e => setProfile({ ...profile, email: e.target.value })} className="bg-gray-900 border border-gray-600 rounded p-2 text-white text-sm w-full outline-none" /></div>
                                </div>
                            </section>
                            <section className="space-y-3 pt-4 border-t border-gray-800">
                                <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">{t('settings.security')}</h3>
                                <div className="p-3 bg-gray-800/50 rounded-lg border border-gray-700 mb-4">
                                    <div className="flex items-center gap-3 mb-2"><Lock size={18} className="text-orange-400" /><span className="text-sm font-medium text-gray-200">{t('settings.session_timeout')}</span></div>
                                    <div className="flex gap-2">
                                        <input type="number" min="1" value={sessionVal} onChange={(e) => setSessionVal(e.target.value)} className="bg-gray-900 border border-gray-600 rounded p-2 text-white text-sm w-20 text-center" />
                                        <select value={sessionUnit} onChange={(e) => setSessionUnit(e.target.value)} className="bg-gray-900 border border-gray-600 rounded p-2 text-white text-sm flex-grow"><option value="d">Days</option><option value="h">Hours</option><option value="m">Minutes</option></select>
                                    </div>
                                </div>
                                <form onSubmit={handlePasswordChange} className="space-y-3">
                                    <input type="password" placeholder={t('auth.password')} value={passwordData.current} onChange={e => setPasswordData(p => ({ ...p, current: e.target.value }))} className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-white text-sm" required />
                                    <div className="flex gap-2"><input type="password" placeholder="New Password" value={passwordData.new} onChange={e => setPasswordData(p => ({ ...p, new: e.target.value }))} className="w-1/2 bg-gray-900 border border-gray-600 rounded p-2 text-white text-sm" required /><input type="password" placeholder="Confirm" value={passwordData.confirm} onChange={e => setPasswordData(p => ({ ...p, confirm: e.target.value }))} className="w-1/2 bg-gray-900 border border-gray-600 rounded p-2 text-white text-sm" required /></div>
                                    {msg && <div className={clsx("text-xs font-bold p-2 rounded text-center", msg.type === 'error' ? 'bg-red-900/50 text-red-400' : 'bg-green-900/50 text-green-400')}>{msg.text}</div>}
                                    <button type="submit" className="w-full py-2 bg-gray-700 hover:bg-gray-600 rounded text-white font-bold text-sm shadow-sm transition-colors">{t('settings.update_password_only')}</button>
                                </form>
                            </section>
                        </div>
                    )}
                    {activeTab === 'ADMIN' && <AdminPanel embedded={true} />}
                    {activeTab === 'LOGS' && <LogViewer embedded={true} />}
                </div>

                {/* FOOTER */}
                {(activeTab === 'GENERAL' || activeTab === 'PROFILE') && (
                    <div className="p-4 bg-gray-900 border-t border-gray-800 flex gap-3 shrink-0">
                        <button onClick={() => { logout(); onClose(); }} className="flex-1 py-3 bg-red-900/20 hover:bg-red-900/40 text-red-400 border border-red-900/50 rounded font-bold uppercase tracking-widest transition-all text-xs flex items-center justify-center gap-2"><LogOut size={16} /> {t('settings.sign_out')}</button>
                        <button onClick={handleSaveAll} className="flex-1 py-3 bg-blue-600 hover:bg-blue-500 rounded text-white font-black uppercase tracking-widest shadow-lg flex items-center justify-center gap-2 transition-all text-xs"><Save size={16} /> {t('settings.save_all')}</button>
                    </div>
                )}
            </div>
        </div>
    );
};

const Toggle = ({ checked, onChange }) => (
    <div onClick={onChange} className={clsx("w-10 h-5 rounded-full p-1 cursor-pointer transition-colors relative", checked ? "bg-blue-500" : "bg-gray-700")}>
        <div className={clsx("w-3 h-3 bg-white rounded-full shadow-sm transform transition-transform", checked ? "translate-x-5" : "translate-x-0")} />
    </div>
);