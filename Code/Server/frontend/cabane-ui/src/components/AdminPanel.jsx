import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { X, Check, Trash2, Shield, User, Globe, MapPin, Search, Save } from 'lucide-react';

const API_URL = import.meta.env.PROD ? '' : (import.meta.env.VITE_API_URL || 'http://localhost:3000');

export const AdminPanel = ({ isOpen, onClose }) => {
    const [activeTab, setActiveTab] = useState('USERS');
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    // Settings State
    const [sysSettings, setSysSettings] = useState({
        timezone: 'UTC',
        weather_city: '',
        weather_lat: '',
        weather_lon: ''
    });
    const [citySearch, setCitySearch] = useState('');
    const [cityResults, setCityResults] = useState([]);

    // UPDATED TIMEZONES LIST
    const timezones = [
        { label: "Montréal, QC (EST)", value: "America/Montreal" },
        { label: "Drummondville, QC (EST)", value: "America/Montreal" },
        { label: "Sainte-Brigitte-des-Saults, QC (EST)", value: "America/Montreal" },
        { label: "New York (EST)", value: "America/New_York" },
        { label: "UTC", value: "UTC" }
    ];

    // --- DATA FETCHING ---
    const fetchData = async () => {
        setLoading(true);
        const token = localStorage.getItem('cabane_token');
        try {
            const resUsers = await axios.get(`${API_URL}/api/users`, { headers: { Authorization: `Bearer ${token}` } });
            setUsers(resUsers.data);

            const resSettings = await axios.get(`${API_URL}/api/system/settings`, { headers: { Authorization: `Bearer ${token}` } });
            // Merge DB settings into state
            setSysSettings(prev => ({ ...prev, ...resSettings.data }));
        } catch (e) { setError("Failed to load data."); }
        finally { setLoading(false); }
    };

    useEffect(() => { if (isOpen) fetchData(); }, [isOpen]);

    // --- USER ACTIONS ---
    const approveUser = async (userId) => {
        const token = localStorage.getItem('cabane_token');
        await axios.post(`${API_URL}/api/users/approve`, { userId }, { headers: { Authorization: `Bearer ${token}` } });
        fetchData();
    };

    const togglePermission = async (userId, type, currentValue) => {
        const token = localStorage.getItem('cabane_token');
        await axios.post(`${API_URL}/api/users/permission`, { userId, type, value: !currentValue }, { headers: { Authorization: `Bearer ${token}` } });
        fetchData();
    };

    const deleteUser = async (userId) => {
        if (!confirm("Delete user?")) return;
        const token = localStorage.getItem('cabane_token');
        await axios.post(`${API_URL}/api/users/delete`, { userId }, { headers: { Authorization: `Bearer ${token}` } });
        fetchData();
    };

    // --- SETTINGS ACTIONS ---
    const searchCity = async () => {
        if (!citySearch) return;
        try {
            // Use Open-Meteo Geocoding API
            const res = await axios.get(`https://geocoding-api.open-meteo.com/v1/search?name=${citySearch}&count=5&language=en&format=json`);
            setCityResults(res.data.results || []);
        } catch (e) { alert("Search failed"); }
    };

    const selectCity = (city) => {
        setSysSettings(prev => ({
            ...prev,
            weather_city: city.name + (city.admin1 ? `, ${city.admin1}` : ''),
            weather_lat: city.latitude,
            weather_lon: city.longitude
        }));
        setCityResults([]); // Clear results
        setCitySearch('');
    };

    const saveSettings = async () => {
        const token = localStorage.getItem('cabane_token');
        try {
            await axios.post(`${API_URL}/api/system/settings`, sysSettings, {
                headers: { Authorization: `Bearer ${token}` }
            });
            alert("Settings Saved. Weather will update shortly.");
            window.location.reload(); // Force reload to refresh context
        } catch (e) { alert("Failed to save settings"); }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-[60] p-4 backdrop-blur-sm" onClick={onClose}>
            <div className="bg-cabane-panel border border-gray-600 rounded-xl shadow-2xl w-full max-w-5xl overflow-hidden flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>

                <div className="flex justify-between items-center p-5 border-b border-gray-700 bg-gray-800">
                    <h2 className="text-xl font-black text-gray-200 flex items-center gap-3 tracking-wide">
                        <Shield className="text-blue-500" size={24} /> ADMINISTRATION
                    </h2>
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
                                <tr><th className="p-4">User</th><th className="p-4">Role</th><th className="p-4">Status</th><th className="p-4">Control</th><th className="p-4">Logs</th><th className="p-4 text-right">Actions</th></tr>
                            </thead>
                            <tbody className="divide-y divide-gray-700">
                                {users.map(user => (
                                    <tr key={user.id} className="hover:bg-gray-700/50">
                                        <td className="p-4 font-bold text-gray-200">{user.username}<br /><span className="text-xs text-gray-500">{user.email}</span></td>
                                        <td className="p-4 text-sm text-gray-400">{user.role}</td>
                                        <td className="p-4">{user.status === 'ACTIVE' ? <span className="text-green-400 font-bold text-xs">ACTIVE</span> : <span className="text-yellow-400 font-bold text-xs">PENDING</span>}</td>
                                        <td className="p-4"><button onClick={() => togglePermission(user.id, 'control', user.can_control)} className={`px-2 py-1 rounded text-xs font-bold border w-20 ${user.can_control ? 'bg-blue-900/50 text-blue-400 border-blue-800' : 'bg-gray-800 text-gray-500 border-gray-700'}`}>{user.can_control ? "GRANTED" : "DENIED"}</button></td>
                                        <td className="p-4"><button onClick={() => togglePermission(user.id, 'logs', user.can_view_logs)} className={`px-2 py-1 rounded text-xs font-bold border w-20 ${user.can_view_logs ? 'bg-yellow-900/50 text-yellow-400 border-yellow-800' : 'bg-gray-800 text-gray-500 border-gray-700'}`}>{user.can_view_logs ? "VIEWER" : "HIDDEN"}</button></td>
                                        <td className="p-4 flex justify-end gap-2">
                                            {user.status === 'PENDING' && <button onClick={() => approveUser(user.id)} className="p-2 bg-green-700 rounded text-white"><Check size={16} /></button>}
                                            {user.username !== 'admin' && <button onClick={() => deleteUser(user.id)} className="p-2 bg-gray-700 rounded text-red-400"><Trash2 size={16} /></button>}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}

                    {/* SYSTEM TAB */}
                    {activeTab === 'SYSTEM' && (
                        <div className="p-8 grid grid-cols-1 md:grid-cols-2 gap-8">

                            {/* Timezone */}
                            <div className="bg-gray-800 p-6 rounded-lg border border-gray-700 shadow-lg h-fit">
                                <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2"><Globe size={20} className="text-blue-500" /> Timezone</h3>
                                <select value={sysSettings.timezone} onChange={(e) => setSysSettings({ ...sysSettings, timezone: e.target.value })} className="w-full bg-gray-900 border border-gray-600 rounded p-3 text-white mb-4 outline-none">
                                    {timezones.map(tz => <option key={tz.label} value={tz.value}>{tz.label}</option>)}
                                </select>
                            </div>

                            {/* Weather Location */}
                            <div className="bg-gray-800 p-6 rounded-lg border border-gray-700 shadow-lg">
                                <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2"><MapPin size={20} className="text-green-500" /> Weather Location</h3>

                                <div className="flex gap-2 mb-4">
                                    <input type="text" placeholder="Search City..." value={citySearch} onChange={e => setCitySearch(e.target.value)} className="flex-grow bg-gray-900 border border-gray-600 rounded p-2 text-white outline-none" />
                                    <button onClick={searchCity} className="p-2 bg-blue-600 rounded text-white hover:bg-blue-500"><Search size={20} /></button>
                                </div>

                                {/* Search Results */}
                                {cityResults.length > 0 && (
                                    <ul className="mb-4 bg-gray-900 border border-gray-600 rounded max-h-40 overflow-y-auto">
                                        {cityResults.map(city => (
                                            <li key={city.id} onClick={() => selectCity(city)} className="p-2 hover:bg-blue-900/50 cursor-pointer text-sm text-gray-300 border-b border-gray-700 last:border-0">
                                                {city.name}, {city.admin1}, {city.country_code}
                                            </li>
                                        ))}
                                    </ul>
                                )}

                                <div className="space-y-2 text-sm text-gray-400 bg-gray-900/50 p-4 rounded border border-gray-700">
                                    <p><strong>Selected:</strong> {sysSettings.weather_city || "None"}</p>
                                    <p><strong>Lat:</strong> {sysSettings.weather_lat}</p>
                                    <p><strong>Lon:</strong> {sysSettings.weather_lon}</p>
                                </div>
                            </div>

                            {/* Save Button (Full Width) */}
                            <div className="md:col-span-2">
                                <button onClick={saveSettings} className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-4 rounded-lg shadow-lg flex items-center justify-center gap-2 transition-all">
                                    <Save size={20} /> SAVE ALL SETTINGS
                                </button>
                            </div>

                        </div>
                    )}

                </div>
            </div>
        </div>
    );
};