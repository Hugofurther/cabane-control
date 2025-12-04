import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { X, Check, Trash2, Shield, User, Globe, MapPin, Search, Save, HardDrive, Power } from 'lucide-react';

const API_URL = import.meta.env.PROD ? '' : (import.meta.env.VITE_API_URL || 'http://localhost:3000');

export const AdminPanel = ({ isOpen, onClose }) => {
    const [activeTab, setActiveTab] = useState('USERS');
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    // System Settings
    const [sysSettings, setSysSettings] = useState({
        timezone: 'UTC',
    });
    const [locations, setLocations] = useState([]);
    const [disabledStations, setDisabledStations] = useState([]);
    const [diskUsage, setDiskUsage] = useState('-%');

    // UI State
    const [citySearch, setCitySearch] = useState('');
    const [cityResults, setCityResults] = useState([]);

    const timezones = [
        { label: "Montréal, QC (EST)", value: "America/Montreal" },
        { label: "Drummondville, QC (EST)", value: "America/Montreal" },
        { label: "Sainte-Brigitte-des-Saults, QC (EST)", value: "America/Montreal" },
        { label: "New York (EST)", value: "America/New_York" },
        { label: "Paris (CET)", value: "Europe/Paris" },
        { label: "UTC", value: "UTC" }
    ];

    // --- DATA FETCHING ---
    const fetchData = async () => {
        setLoading(true);
        const token = localStorage.getItem('cabane_token');
        try {
            // 1. Users
            const resUsers = await axios.get(`${API_URL}/api/users`, { headers: { Authorization: `Bearer ${token}` } });
            setUsers(resUsers.data);

            // 2. Settings
            const resSettings = await axios.get(`${API_URL}/api/system/settings`, { headers: { Authorization: `Bearer ${token}` } });
            setSysSettings(prev => ({ ...prev, ...resSettings.data }));

            // Parse JSON fields
            if (resSettings.data.weather_locations) {
                try { setLocations(JSON.parse(resSettings.data.weather_locations)); } catch (e) { }
            } else if (resSettings.data.weather_city) {
                setLocations([{ name: resSettings.data.weather_city, lat: resSettings.data.weather_lat, lon: resSettings.data.weather_lon }]);
            }

            if (resSettings.data.disabled_stations) {
                try { setDisabledStations(JSON.parse(resSettings.data.disabled_stations)); } catch (e) { }
            }

            // 3. Status
            const resStatus = await axios.get(`${API_URL}/api/system/status`, { headers: { Authorization: `Bearer ${token}` } });
            setDiskUsage(resStatus.data.diskUsage || 'Unknown');

            setError('');
        } catch (e) { setError("Failed to load data."); }
        finally { setLoading(false); }
    };

    useEffect(() => { if (isOpen) fetchData(); }, [isOpen]);

    // --- HANDLERS ---

    const toggleStation = (id) => {
        setDisabledStations(prev => prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]);
    };

    const searchCity = async () => {
        if (!citySearch) return;
        try {
            const res = await axios.get(`https://geocoding-api.open-meteo.com/v1/search?name=${citySearch}&count=5&language=en&format=json`);
            setCityResults(res.data.results || []);
        } catch (e) { alert("Search failed"); }
    };

    const addLocation = (city) => {
        setLocations(prev => [...prev, {
            name: city.name + (city.admin1 ? `, ${city.admin1}` : ''),
            lat: city.latitude,
            lon: city.longitude
        }]);
        setCityResults([]); setCitySearch('');
    };

    const removeLocation = (index) => {
        setLocations(prev => prev.filter((_, i) => i !== index));
    };

    const saveSettings = async () => {
        const token = localStorage.getItem('cabane_token');
        try {
            const payload = {
                timezone: sysSettings.timezone,
                weather_locations: JSON.stringify(locations),
                disabled_stations: JSON.stringify(disabledStations)
            };
            await axios.post(`${API_URL}/api/system/settings`, payload, { headers: { Authorization: `Bearer ${token}` } });
            alert("Settings saved.");
            window.location.reload();
        } catch (e) { alert("Failed to save"); }
    };

    // User Actions
    const approveUser = async (id) => {
        await axios.post(`${API_URL}/api/users/approve`, { userId: id }, { headers: { Authorization: `Bearer ${localStorage.getItem('cabane_token')}` } });
        fetchData();
    };
    const togglePermission = async (id, type, val) => {
        await axios.post(`${API_URL}/api/users/permission`, { userId: id, type, value: !val }, { headers: { Authorization: `Bearer ${localStorage.getItem('cabane_token')}` } });
        fetchData();
    };
    const deleteUser = async (id) => {
        if (confirm("Delete user?")) {
            await axios.post(`${API_URL}/api/users/delete`, { userId: id }, { headers: { Authorization: `Bearer ${localStorage.getItem('cabane_token')}` } });
            fetchData();
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-[60] p-4 backdrop-blur-sm" onClick={onClose}>
            <div className="bg-cabane-panel border border-gray-600 rounded-xl shadow-2xl w-full max-w-5xl overflow-hidden flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>

                <div className="flex justify-between items-center p-5 border-b border-gray-700 bg-gray-800">
                    <h2 className="text-xl font-black text-gray-200 flex items-center gap-3 tracking-wide"><Shield className="text-blue-500" size={24} /> ADMINISTRATION</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-white"><X size={28} /></button>
                </div>

                <div className="flex border-b border-gray-700 bg-gray-900">
                    <button onClick={() => setActiveTab('USERS')} className={`flex-1 py-3 text-sm font-bold uppercase ${activeTab === 'USERS' ? 'text-blue-400 border-t-2 border-blue-500 bg-gray-800' : 'text-gray-500'}`}>Users</button>
                    <button onClick={() => setActiveTab('SYSTEM')} className={`flex-1 py-3 text-sm font-bold uppercase ${activeTab === 'SYSTEM' ? 'text-blue-400 border-t-2 border-blue-500 bg-gray-800' : 'text-gray-500'}`}>System Settings</button>
                </div>

                <div className="flex-grow overflow-y-auto p-0">
                    {/* USERS TAB */}
                    {activeTab === 'USERS' && (
                        <table className="w-full text-left border-collapse">
                            <thead className="bg-gray-900/50 text-gray-400 text-xs uppercase font-mono sticky top-0 z-10">
                                <tr><th className="p-4">User</th><th className="p-4">Role</th><th className="p-4">Status</th><th className="p-4 text-center">Control</th><th className="p-4 text-center">Logs</th><th className="p-4 text-right">Actions</th></tr>
                            </thead>
                            <tbody className="divide-y divide-gray-700">
                                {users.map(u => (
                                    <tr key={u.id} className="hover:bg-gray-700/50">
                                        <td className="p-4 font-bold text-gray-200">{u.username}<br /><span className="text-xs text-gray-500">{u.email}</span></td>
                                        <td className="p-4 text-sm text-gray-400">{u.role}</td>
                                        <td className="p-4">{u.status === 'ACTIVE' ? <span className="text-green-400 text-xs font-bold">ACTIVE</span> : <span className="text-yellow-400 text-xs font-bold">PENDING</span>}</td>
                                        <td className="p-4 text-center"><button onClick={() => togglePermission(u.id, 'control', u.can_control)} className={`px-2 py-1 rounded text-xs font-bold border w-20 ${u.can_control ? 'bg-blue-900/50 text-blue-400 border-blue-800' : 'bg-gray-800 text-gray-500 border-gray-700'}`}>{u.can_control ? "GRANTED" : "DENIED"}</button></td>
                                        <td className="p-4 text-center"><button onClick={() => togglePermission(u.id, 'logs', u.can_view_logs)} className={`px-2 py-1 rounded text-xs font-bold border w-20 ${u.can_view_logs ? 'bg-yellow-900/50 text-yellow-400 border-yellow-800' : 'bg-gray-800 text-gray-500 border-gray-700'}`}>{u.can_view_logs ? "VIEWER" : "HIDDEN"}</button></td>
                                        <td className="p-4 flex justify-end gap-2">{u.status === 'PENDING' && <button onClick={() => approveUser(u.id)} className="p-2 bg-green-700 rounded text-white"><Check size={16} /></button>}{u.username !== 'admin' && <button onClick={() => deleteUser(u.id)} className="p-2 bg-gray-700 rounded text-red-400"><Trash2 size={16} /></button>}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}

                    {/* SYSTEM TAB */}
                    {activeTab === 'SYSTEM' && (
                        <div className="p-8 grid grid-cols-1 md:grid-cols-2 gap-6">

                            {/* Timezone */}
                            <div className="bg-gray-800 p-6 rounded-lg border border-gray-700 shadow-lg h-fit">
                                <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2"><Globe size={20} className="text-blue-500" /> Timezone</h3>
                                <select value={sysSettings.timezone} onChange={(e) => setSysSettings({ ...sysSettings, timezone: e.target.value })} className="w-full bg-gray-900 border border-gray-600 rounded p-3 text-white mb-2 outline-none">
                                    {timezones.map(tz => <option key={tz.label} value={tz.value}>{tz.label}</option>)}
                                </select>
                            </div>

                            {/* Disk Usage */}
                            <div className="bg-gray-800 p-6 rounded-lg border border-gray-700 shadow-lg h-fit">
                                <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2"><HardDrive size={20} className="text-purple-500" /> Storage</h3>
                                <div className="text-3xl font-mono font-black text-white flex items-baseline gap-2">{diskUsage} <span className="text-sm text-gray-500 font-sans font-bold">USED</span></div>
                                <div className="w-full bg-gray-700 rounded-full h-2.5 mt-3 overflow-hidden"><div className="bg-purple-600 h-2.5 rounded-full" style={{ width: diskUsage !== 'Unknown' ? diskUsage : '0%' }}></div></div>
                            </div>

                            {/* Stations Config */}
                            <div className="bg-gray-800 p-6 rounded-lg border border-gray-700 shadow-lg md:col-span-2">
                                <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2"><Power size={20} className="text-red-500" /> Station Configuration</h3>
                                <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
                                    {[0, 1, 2, 3, 4, 5].map(id => {
                                        const isDisabled = disabledStations.includes(id);
                                        return (
                                            <button key={id} onClick={() => toggleStation(id)} className={`p-3 rounded border flex flex-col items-center gap-1 transition-all ${isDisabled ? 'bg-red-900/20 border-red-800 text-red-500' : 'bg-green-900/20 border-green-800 text-green-400'}`}>
                                                <span className="text-xs font-bold">STATION {id}</span>
                                                <span className="text-[10px] uppercase">{isDisabled ? "DISABLED" : "ENABLED"}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Weather Config */}
                            <div className="bg-gray-800 p-6 rounded-lg border border-gray-700 shadow-lg md:col-span-2">
                                <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2"><MapPin size={20} className="text-green-500" /> Weather Rotation</h3>
                                <div className="flex gap-2 mb-4">
                                    <input type="text" placeholder="Add City..." value={citySearch} onChange={e => setCitySearch(e.target.value)} onKeyDown={e => e.key === 'Enter' && searchCity()} className="flex-grow bg-gray-900 border border-gray-600 rounded p-2 text-white outline-none" />
                                    <button onClick={searchCity} className="p-2 bg-blue-600 rounded text-white hover:bg-blue-500"><Search size={20} /></button>
                                </div>
                                {cityResults.length > 0 && (
                                    <ul className="mb-4 bg-gray-900 border border-gray-600 rounded max-h-40 overflow-y-auto">
                                        {cityResults.map(city => (
                                            <li key={city.id} onClick={() => addLocation(city)} className="p-2 hover:bg-blue-900/50 cursor-pointer text-sm text-gray-300 border-b border-gray-700">{city.name}, {city.admin1}</li>
                                        ))}
                                    </ul>
                                )}
                                <div className="space-y-2">
                                    {locations.map((loc, i) => (
                                        <div key={i} className="flex justify-between items-center bg-gray-900/50 p-3 rounded border border-gray-700">
                                            <div className="text-sm text-gray-300">{loc.name}</div>
                                            <button onClick={() => removeLocation(i)} className="text-red-400 hover:text-white"><Trash2 size={16} /></button>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="md:col-span-2"><button onClick={saveSettings} className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-4 rounded-lg shadow-lg flex items-center justify-center gap-2 transition-all"><Save size={20} /> SAVE ALL SETTINGS</button></div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};