import React, { useState, useEffect } from 'react';
import axios from 'axios';
import {
    X, Check, Trash2, Shield, Globe, MapPin, Search, Save,
    HardDrive, Power, Clock, RefreshCw, Calculator, User,
    Lock, Crown, Volume2
} from 'lucide-react';
import { useModal } from '../contexts/ModalContext';
import { clsx } from 'clsx';
import { useSocket } from '../contexts/SocketContext';
import { useTranslation } from 'react-i18next'; // ✅ Import

const API_URL = import.meta.env.PROD ? '' : (import.meta.env.VITE_API_URL || 'http://localhost:3000');

const formatBytes = (bytes) => {
    if (!bytes || isNaN(bytes)) return '0 GB';
    const gb = bytes / (1024 * 1024 * 1024);
    return `${gb.toFixed(1)} GB`;
};

const Toggle = ({ checked, onChange, disabled }) => (
    <div
        onClick={disabled ? undefined : onChange}
        className={clsx(
            "w-10 h-5 rounded-full p-1 transition-colors relative flex-shrink-0",
            disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
            checked ? "bg-green-500" : "bg-gray-600"
        )}
    >
        <div className={clsx("w-3 h-3 bg-white rounded-full shadow-sm transform transition-transform duration-200", checked ? "translate-x-5" : "translate-x-0")} />
    </div>
);

export const AdminPanel = ({ embedded, isOpen, onClose }) => {
    const { t } = useTranslation(); // ✅ Hook
    const { user: currentUser } = useSocket();
    const { showConfirm, showAlert } = useModal();

    const [activeTab, setActiveTab] = useState('USERS');
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    // System Settings State
    const [sysSettings, setSysSettings] = useState({
        timezone: 'UTC',
        weather_api_key: '',
        weather_rotation_interval: '10',
        weather_rotation_enabled: 'true',
        weather_update_interval: '15',
        weather_update_interval_forecast: '60',
        weather_api_limit_min: '60',
        weather_api_limit_month: '1000000',
        buzzer_alarm_on: '5',
        buzzer_alarm_off: '10',
        buzzer_reminder_min: '2',
        burglar_station: '0'
    });

    const [locations, setLocations] = useState([]);
    const [disabledStations, setDisabledStations] = useState([]);
    const [diskStats, setDiskStats] = useState({ percent: '0%', free: 0, size: 0, used: 0 });

    const [citySearch, setCitySearch] = useState('');
    const [cityResults, setCityResults] = useState([]);

    const timezones = [
        { label: "Montréal, QC (EST)", value: "America/Montreal" },
        { label: "Drummondville, QC (EST)", value: "America/Montreal" },
        { label: "New York (EST)", value: "America/New_York" },
        { label: "Paris (CET)", value: "Europe/Paris" },
        { label: "UTC", value: "UTC" }
    ];

    const fetchData = async () => {
        setLoading(true);
        const token = localStorage.getItem('cabane_token');
        try {
            const resUsers = await axios.get(`${API_URL}/api/users`, { headers: { Authorization: `Bearer ${token}` } });
            setUsers(Array.isArray(resUsers.data) ? resUsers.data : []);

            const resSettings = await axios.get(`${API_URL}/api/system/settings`, { headers: { Authorization: `Bearer ${token}` } });
            setSysSettings(prev => ({ ...prev, ...resSettings.data }));

            if (resSettings.data.weather_locations) {
                try {
                    const locs = JSON.parse(resSettings.data.weather_locations);
                    setLocations(locs.map(l => ({ ...l, enabled: l.enabled !== false })));
                } catch (e) { }
            }

            if (resSettings.data.disabled_stations) {
                try { setDisabledStations(JSON.parse(resSettings.data.disabled_stations)); } catch (e) { }
            }

            const resStatus = await axios.get(`${API_URL}/api/system/status`, { headers: { Authorization: `Bearer ${token}` } });
            setDiskStats({
                percent: resStatus.data.diskUsage || '0%',
                free: resStatus.data.free || 0,
                size: resStatus.data.size || 0,
                used: (resStatus.data.size || 0) - (resStatus.data.free || 0)
            });

            setError('');
        } catch (e) { setError("Failed to load data."); }
        finally { setLoading(false); }
    };

    useEffect(() => {
        if (isOpen || embedded) fetchData();
    }, [isOpen, embedded]);

    // --- LOGIC ---
    const toggleStation = (id) => {
        setDisabledStations(prev => prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]);
    };

    const searchCity = async () => {
        if (!citySearch) return;
        if (!sysSettings.weather_api_key) { showAlert(t('common.error'), "Enter API Key first."); return; }
        try {
            const res = await axios.get(`https://api.openweathermap.org/geo/1.0/direct?q=${citySearch}&limit=5&appid=${sysSettings.weather_api_key}`);
            setCityResults(res.data || []);
        } catch (e) { showAlert("Search Failed", "Check API Key."); }
    };

    const addLocation = (city) => {
        const locationName = city.name + (city.state ? `, ${city.state}` : `, ${city.country}`);
        setLocations(prev => [...prev, { name: locationName, lat: city.lat, lon: city.lon, enabled: true }]);
        setCityResults([]); setCitySearch('');
    };

    const removeLocation = (index) => {
        setLocations(prev => prev.filter((_, i) => i !== index));
    };

    const toggleLocation = (index) => {
        setLocations(prev => prev.map((l, i) => i === index ? { ...l, enabled: !l.enabled } : l));
    };

    // --- CALCULATOR ---
    const calculateApiUsage = () => {
        const activeCount = locations.filter(l => l.enabled).length;
        if (activeCount === 0) return { val: '0.00', status: 'SAFE', color: 'text-gray-500', limitMsg: 'Idle', monthly: 0 };

        const callsCurrent = activeCount / (parseInt(sysSettings.weather_update_interval) || 15);
        const callsForecast = activeCount / (parseInt(sysSettings.weather_update_interval_forecast) || 60);
        const totalPerMin = callsCurrent + callsForecast;

        const limitMin = parseInt(sysSettings.weather_api_limit_min) || 60;
        const limitMonth = parseInt(sysSettings.weather_api_limit_month) || 1000000;
        const estimatedMonth = totalPerMin * 43200;

        let status = 'SAFE';
        let color = 'text-green-400';
        let limitMsg = `Limit: ${limitMin}/min`;

        if (totalPerMin > limitMin) {
            status = 'EXCEEDED (MIN)'; color = 'text-red-500';
        } else if (estimatedMonth > limitMonth) {
            status = 'EXCEEDED (MONTH)'; color = 'text-red-500';
            limitMsg = `Limit: ${limitMonth}/mo`;
        } else if (totalPerMin > limitMin * 0.8) {
            status = 'WARNING'; color = 'text-yellow-500';
        }

        return { val: totalPerMin.toFixed(2), status, color, limitMsg, monthly: Math.round(estimatedMonth) };
    };

    const apiUsage = calculateApiUsage();

    const saveSettings = async () => {
        if (apiUsage.status.includes('EXCEEDED')) {
            showAlert(t('common.error'), "API Limit Exceeded. Adjust settings.");
            return;
        }

        const token = localStorage.getItem('cabane_token');
        try {
            const payload = {
                ...sysSettings,
                weather_locations: JSON.stringify(locations),
                disabled_stations: JSON.stringify(disabledStations)
            };
            await axios.post(`${API_URL}/api/system/settings`, payload, { headers: { Authorization: `Bearer ${token}` } });
            window.location.reload();
        } catch (e) { showAlert(t('common.error'), "Failed to save."); }
    };

    // --- USER ACTIONS ---
    const approveUser = async (id) => {
        await axios.post(`${API_URL}/api/users/approve`, { userId: id }, { headers: { Authorization: `Bearer ${localStorage.getItem('cabane_token')}` } });
        fetchData();
    };

    const togglePermission = async (id, type, val) => {
        await axios.post(`${API_URL}/api/users/permission`, { userId: id, type, value: !val }, { headers: { Authorization: `Bearer ${localStorage.getItem('cabane_token')}` } });
        fetchData();
    };

    const deleteUser = async (id) => {
        showConfirm({
            title: t('common.delete'),
            message: "Permanently delete user?",
            isDestructive: true,
            onConfirm: async () => {
                try {
                    await axios.post(`${API_URL}/api/users/delete`, { userId: id }, { headers: { Authorization: `Bearer ${localStorage.getItem('cabane_token')}` } });
                    fetchData();
                } catch (e) { }
            }
        });
    };

    const transferAdmin = async (targetId, targetName) => {
        showConfirm({
            title: t('admin.transfer_admin'),
            message: `Transfer rights to ${targetName}?`,
            isDestructive: false,
            onConfirm: async () => {
                try {
                    await axios.post(`${API_URL}/api/users/transfer-admin`, { newAdminId: targetId }, { headers: { Authorization: `Bearer ${localStorage.getItem('cabane_token')}` } });
                    showAlert(t('common.success'), "Admin rights transferred.");
                    fetchData();
                } catch (e) {
                    showAlert(t('common.error'), e.response?.data?.error || "Transfer failed.");
                }
            }
        });
    };

    // --- RENDER ---
    const containerClass = embedded ? "flex-grow flex flex-col overflow-hidden" : "bg-cabane-panel border border-gray-600 rounded-xl shadow-2xl w-full max-w-5xl overflow-hidden flex flex-col max-h-[90vh]";

    if (!embedded && !isOpen) return null;

    const content = (
        <div className={containerClass} onClick={e => e.stopPropagation()}>

            {!embedded && (
                <div className="flex justify-between items-center p-5 border-b border-gray-700 bg-gray-800 shrink-0">
                    <h2 className="text-xl font-black text-gray-200 flex items-center gap-3 tracking-wide"><Shield className="text-blue-500" size={24} /> {t('admin.title').toUpperCase()}</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-white"><X size={28} /></button>
                </div>
            )}

            <div className="flex border-b border-gray-700 bg-gray-900 shrink-0">
                <button onClick={() => setActiveTab('USERS')} className={`flex-1 py-3 text-sm font-bold uppercase ${activeTab === 'USERS' ? 'text-blue-400 border-t-2 border-blue-500 bg-gray-800' : 'text-gray-500'}`}>{t('admin.users')}</button>
                <button onClick={() => setActiveTab('SYSTEM')} className={`flex-1 py-3 text-sm font-bold uppercase ${activeTab === 'SYSTEM' ? 'text-blue-400 border-t-2 border-blue-500 bg-gray-800' : 'text-gray-500'}`}>{t('admin.system')}</button>
            </div>

            <div className="flex-grow overflow-y-auto p-0">
                {activeTab === 'USERS' && (
                    <table className="w-full text-left border-collapse">
                        <thead className="bg-gray-900/50 text-gray-400 text-xs uppercase font-mono sticky top-0 z-10">
                            <tr>
                                <th className="p-4">{t('auth.username')}</th>
                                <th className="p-4">{t('admin.role')}</th>
                                <th className="p-4">{t('admin.status')}</th>
                                <th className="p-4 text-center">{t('admin.control')}</th>
                                <th className="p-4 text-center">{t('settings.tabs.logs')}</th>
                                <th className="p-4 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-700">
                            {users.map(u => (
                                <tr key={u.id} className="hover:bg-gray-700/50">
                                    <td className="p-4 font-bold text-gray-200">{u.username}<br /><span className="text-xs text-gray-500">{u.email}</span></td>
                                    <td className="p-4 text-sm text-gray-400">{u.role}</td>
                                    <td className="p-4">{u.status === 'ACTIVE' ? <span className="text-green-400 text-xs font-bold">{t('admin.active')}</span> : <span className="text-yellow-400 text-xs font-bold">{t('admin.pending')}</span>}</td>
                                    <td className="p-4 text-center"><button onClick={() => togglePermission(u.id, 'control', u.can_control)} className={`px-2 py-1 rounded text-xs font-bold border w-20 ${u.can_control ? 'bg-blue-900/50 text-blue-400 border-blue-800' : 'bg-gray-800 text-gray-500 border-gray-700'}`}>{u.can_control ? t('admin.granted') : t('admin.denied')}</button></td>
                                    <td className="p-4 text-center"><button onClick={() => togglePermission(u.id, 'logs', u.can_view_logs)} className={`px-2 py-1 rounded text-xs font-bold border w-20 ${u.can_view_logs ? 'bg-yellow-900/50 text-yellow-400 border-yellow-800' : 'bg-gray-800 text-gray-500 border-gray-700'}`}>{u.can_view_logs ? t('admin.viewer') : t('admin.hidden')}</button></td>
                                    <td className="p-4 flex justify-end gap-2">
                                        {u.status === 'PENDING' && <button onClick={() => approveUser(u.id)} className="p-2 bg-green-700 rounded text-white"><Check size={16} /></button>}
                                        {u.status === 'ACTIVE' && currentUser && String(u.id) !== String(currentUser.id) && (
                                            <button onClick={() => transferAdmin(u.id, u.username)} className="p-2 bg-gray-700 hover:bg-yellow-900/50 text-yellow-500 rounded"><Crown size={16} /></button>
                                        )}
                                        {u.username !== 'admin' && String(u.id) !== String(currentUser?.id) && <button onClick={() => deleteUser(u.id)} className="p-2 bg-gray-700 rounded text-red-400 hover:bg-red-900/50"><Trash2 size={16} /></button>}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}

                {activeTab === 'SYSTEM' && (
                    <div className="p-8 grid grid-cols-1 md:grid-cols-2 gap-6 pb-20">

                        {/* Timezone & Disk */}
                        <div className="bg-gray-800 p-6 rounded-lg border border-gray-700 shadow-lg h-fit space-y-4">
                            <div>
                                <h3 className="text-lg font-bold text-white mb-2 flex items-center gap-2"><Globe size={20} className="text-blue-500" /> {t('admin.timezone')}</h3>
                                <select value={sysSettings.timezone} onChange={(e) => setSysSettings({ ...sysSettings, timezone: e.target.value })} className="w-full bg-gray-900 border border-gray-600 rounded p-3 text-white mb-6 outline-none">
                                    {timezones.map(tz => <option key={tz.label} value={tz.value}>{tz.label}</option>)}
                                </select>
                            </div>
                            <div className="pt-4 border-t border-gray-700">
                                <h3 className="text-lg font-bold text-white mb-2 flex items-center gap-2"><HardDrive size={20} className="text-purple-500" /> {t('admin.storage')}</h3>
                                <div className="flex justify-between items-baseline mb-2">
                                    <div className="text-3xl font-mono font-black text-white">{diskStats.percent} <span className="text-sm text-gray-500 font-sans font-bold">{t('admin.full')}</span></div>
                                    <div className="text-xs font-bold text-gray-400">{formatBytes(diskStats.size)} {t('admin.total')}</div>
                                </div>
                                <div className="w-full bg-gray-700 rounded-full h-3 mb-3 overflow-hidden border border-gray-600">
                                    <div className="bg-purple-600 h-full rounded-full transition-all duration-1000 ease-out" style={{ width: diskStats.percent }}></div>
                                </div>
                                <div className="flex justify-between text-xs text-gray-400">
                                    <span>{t('admin.used')}: {formatBytes(diskStats.used)}</span>
                                    <span>{t('admin.free')}: {formatBytes(diskStats.free)}</span>
                                </div>
                            </div>
                        </div>

                        {/* Buzzer Config */}
                        <div className="bg-gray-800 p-6 rounded-lg border border-gray-700 shadow-lg md:col-span-2 space-y-6">
                            <h3 className="text-lg font-bold text-white flex items-center gap-2"><Volume2 size={20} className="text-yellow-500" /> {t('admin.buzzer_config')}</h3>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                                <div>
                                    <label htmlFor="buzzer_on" className="text-xs font-bold text-gray-500 mb-1 block">{t('admin.alarm_on')}</label>
                                    <input id="buzzer_on" name="buzzer_on" type="number" min="1" max="60" autoComplete="off" value={sysSettings.buzzer_alarm_on || '5'} onChange={e => setSysSettings({ ...sysSettings, buzzer_alarm_on: e.target.value })} className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-white outline-none focus:border-blue-500" />
                                </div>
                                <div>
                                    <label htmlFor="buzzer_off" className="text-xs font-bold text-gray-500 mb-1 block">{t('admin.alarm_off')}</label>
                                    <input id="buzzer_off" name="buzzer_off" type="number" min="1" max="60" autoComplete="off" value={sysSettings.buzzer_alarm_off || '10'} onChange={e => setSysSettings({ ...sysSettings, buzzer_alarm_off: e.target.value })} className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-white outline-none focus:border-blue-500" />
                                </div>
                                <div>
                                    <label htmlFor="buzzer_rem" className="text-xs font-bold text-gray-500 mb-1 block">{t('admin.reminder_int')}</label>
                                    <input id="buzzer_rem" name="buzzer_rem" type="number" min="1" max="240" autoComplete="off" value={sysSettings.buzzer_reminder_min || '2'} onChange={e => setSysSettings({ ...sysSettings, buzzer_reminder_min: e.target.value })} className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-white outline-none focus:border-blue-500" />
                                </div>
                            </div>
                        </div>

                        {/* Weather Config */}
                        <div className="bg-gray-800 p-6 rounded-lg border border-gray-700 shadow-lg md:col-span-2 space-y-6">
                            <div className="flex justify-between items-center"><h3 className="text-lg font-bold text-white flex items-center gap-2"><MapPin size={20} className="text-green-500" /> {t('admin.weather_services')}</h3></div>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pb-6 border-b border-gray-700">
                                <div className="md:col-span-1"><label className="text-xs font-bold text-gray-500 mb-1 block">{t('admin.api_key')}</label><input type="text" value={sysSettings.weather_api_key || ''} onChange={e => setSysSettings({ ...sysSettings, weather_api_key: e.target.value })} className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-white outline-none font-mono text-xs" /></div>
                                <div><label className="text-xs font-bold text-gray-500 mb-1 block">{t('admin.limit_min')}</label><input type="number" value={sysSettings.weather_api_limit_min} onChange={e => setSysSettings({ ...sysSettings, weather_api_limit_min: e.target.value })} className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-white outline-none" /></div>
                                <div><label className="text-xs font-bold text-gray-500 mb-1 block">{t('admin.limit_month')}</label><input type="number" value={sysSettings.weather_api_limit_month} onChange={e => setSysSettings({ ...sysSettings, weather_api_limit_month: e.target.value })} className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-white outline-none" /></div>
                            </div>
                            <div className="grid grid-cols-3 gap-4 pb-6 border-b border-gray-700">
                                <div><label className="text-xs font-bold text-gray-500 mb-1 block">{t('admin.current_min')}</label><input type="number" min="5" value={sysSettings.weather_update_interval} onChange={e => setSysSettings({ ...sysSettings, weather_update_interval: e.target.value })} className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-white outline-none" /></div>
                                <div><label className="text-xs font-bold text-gray-500 mb-1 block">{t('admin.forecast_min')}</label><input type="number" min="30" value={sysSettings.weather_update_interval_forecast} onChange={e => setSysSettings({ ...sysSettings, weather_update_interval_forecast: e.target.value })} className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-white outline-none" /></div>
                                <div><label className="text-xs font-bold text-gray-500 mb-1 block">{t('admin.rotation_sec')}</label><input type="number" min="2" value={sysSettings.weather_rotation_interval} onChange={e => setSysSettings({ ...sysSettings, weather_rotation_interval: e.target.value })} className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-white outline-none" /></div>
                            </div>
                            <div className={`p-3 rounded border flex items-center justify-between ${apiUsage.status.includes('EXCEEDED') ? 'bg-red-900/20 border-red-800' : 'bg-gray-900/50 border-gray-700'}`}>
                                <div className="flex items-center gap-2"><Calculator size={16} className={apiUsage.color} /><div className="flex flex-col"><span className="text-xs font-bold text-gray-300">{t('admin.usage')}: <span className={apiUsage.color}>{apiUsage.val}</span> /min</span><span className="text-[9px] text-gray-500">{t('admin.est_monthly')}: {apiUsage.monthly.toLocaleString()}</span></div></div><span className={`text-[10px] font-black px-2 py-1 rounded ${apiUsage.status === 'SAFE' ? 'bg-green-900 text-green-400' : 'bg-red-900 text-red-200'}`}>{apiUsage.limitMsg}</span>
                            </div>
                            <div className="space-y-4">
                                <div className="flex gap-2"><input type="text" placeholder="Add City..." value={citySearch} onChange={e => setCitySearch(e.target.value)} onKeyDown={e => e.key === 'Enter' && searchCity()} className="flex-grow bg-gray-900 border border-gray-600 rounded p-2 text-white outline-none" /><button onClick={searchCity} className="p-2 bg-blue-600 rounded text-white hover:bg-blue-500"><Search size={20} /></button></div>
                                {cityResults.length > 0 && (<ul className="bg-gray-900 border border-gray-600 rounded max-h-40 overflow-y-auto">{cityResults.map(city => (<li key={`${city.lat}-${city.lon}`} onClick={() => addLocation(city)} className="p-2 hover:bg-blue-900/50 cursor-pointer text-sm text-gray-300 border-b border-gray-700">{city.name}, {city.state ? `${city.state}, ` : ''}{city.country}</li>))}</ul>)}
                                <div className="grid grid-cols-1 gap-2 max-h-60 overflow-y-auto pr-2">
                                    {locations.map((loc, i) => (
                                        <div key={i} className={`flex justify-between items-center p-3 rounded border transition-colors ${loc.enabled ? 'bg-gray-900/50 border-gray-700' : 'bg-gray-800 border-gray-700 opacity-50'}`}><div className="flex items-center gap-3"><Toggle checked={loc.enabled} onChange={() => toggleLocation(i)} /><span className={`text-sm ${loc.enabled ? 'text-gray-300' : 'text-gray-500 line-through'}`}>{loc.name}</span></div><button onClick={() => removeLocation(i)} className="text-red-400 hover:text-white"><Trash2 size={16} /></button></div>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* Burglar Config */}
                        <div className="bg-gray-800 p-6 rounded-lg border border-gray-700 shadow-lg md:col-span-2 space-y-4">
                            <h3 className="text-lg font-bold text-white flex items-center gap-2"><Shield size={20} className="text-red-500" /> {t('admin.burglar_alarm')}</h3>
                            <div>
                                <label className="text-xs font-bold text-gray-500 mb-1 block">{t('admin.input_source')}</label>
                                <select value={sysSettings.burglar_station || '0'} onChange={e => setSysSettings({ ...sysSettings, burglar_station: e.target.value })} className="w-full bg-gray-900 border border-gray-600 rounded p-2 text-white outline-none">
                                    <option value="0">{t('common.disabled')}</option>
                                    <option value="2">Station 2</option>
                                    <option value="3">Station 3</option>
                                </select>
                                <p className="text-[10px] text-gray-500 mt-1">{t('admin.burglar_desc')}</p>
                            </div>
                        </div>

                        {/* Station Config */}
                        <div className="bg-gray-800 p-6 rounded-lg border border-gray-700 shadow-lg md:col-span-2">
                            <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2"><Power size={20} className="text-red-500" /> {t('admin.station_config')}</h3>
                            <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
                                {[0, 1, 2, 3, 4, 5].map(id => {
                                    const isDisabled = disabledStations.includes(id);
                                    return (
                                        <button key={id} onClick={() => toggleStation(id)} className={`p-3 rounded border flex flex-col items-center gap-1 transition-all ${isDisabled ? 'bg-red-900/20 border-red-800 text-red-500' : 'bg-green-900/20 border-green-800 text-green-400'}`}>
                                            <span className="text-xs font-bold">STATION {id}</span>
                                            <span className="text-[10px] uppercase">{isDisabled ? t('common.disabled') : t('common.enabled')}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {activeTab === 'SYSTEM' && (
                <div className="p-4 bg-gray-900 border-t border-gray-800 shrink-0 flex justify-end">
                    <button onClick={saveSettings} disabled={apiUsage.status.includes('EXCEEDED')} className={`w-full md:w-auto px-8 font-bold py-3 rounded-lg shadow-lg flex items-center justify-center gap-2 transition-all ${apiUsage.status.includes('EXCEEDED') ? 'bg-gray-700 text-gray-500 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-500 text-white'}`}>
                        <Save size={20} /> {t('settings.save_all').toUpperCase()}
                    </button>
                </div>
            )}
        </div>
    );

    if (embedded) return content;

    return (
        <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-[60] p-4 backdrop-blur-sm" onClick={onClose}>
            {content}
        </div>
    );
};