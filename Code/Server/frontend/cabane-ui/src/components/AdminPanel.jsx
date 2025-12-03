import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { X, Check, Trash2, Shield, User, Globe, MapPin, Search, Save, HardDrive } from 'lucide-react';

// Fix Mixed Content / API URL
const API_URL = import.meta.env.PROD ? '' : (import.meta.env.VITE_API_URL || 'http://localhost:3000');

export const AdminPanel = ({ isOpen, onClose }) => {
    const [activeTab, setActiveTab] = useState('USERS');
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    // System Settings State
    const [sysSettings, setSysSettings] = useState({
        timezone: 'UTC',
        weather_city: '',
        weather_lat: '',
        weather_lon: ''
    });
    const [diskUsage, setDiskUsage] = useState('-%'); // New State for Disk
    const [citySearch, setCitySearch] = useState('');
    const [cityResults, setCityResults] = useState([]);

    // Common Timezones
    const timezones = [
        { label: "Montréal, QC (EST)", value: "America/Montreal" },
        { label: "Drummondville, QC (EST)", value: "America/Montreal" },
        { label: "Sainte-Brigitte-des-Saults, QC (EST)", value: "America/Montreal" },
        { label: "New York (EST)", value: "America/New_York" },
        { label: "Paris (CET)", value: "Europe/Paris" },
        { label: "UTC", value: "UTC" }
    ];

    // --- FETCH DATA ---
    const fetchData = async () => {
        setLoading(true);
        const token = localStorage.getItem('cabane_token');
        try {
            // 1. Fetch Users
            const resUsers = await axios.get(`${API_URL}/api/users`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            setUsers(resUsers.data);

            // 2. Fetch Settings
            const resSettings = await axios.get(`${API_URL}/api/system/settings`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            setSysSettings(prev => ({ ...prev, ...resSettings.data }));

            // 3. Fetch Disk Usage (New)
            const resStatus = await axios.get(`${API_URL}/api/system/status`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            setDiskUsage(resStatus.data.diskUsage || 'Unknown');

            setError('');
        } catch (e) {
            setError("Failed to load admin data.");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (isOpen) fetchData();
    }, [isOpen]);

    // --- USER ACTIONS ---

    const approveUser = async (userId) => {
        const token = localStorage.getItem('cabane_token');
        try {
            await axios.post(`${API_URL}/api/users/approve`, { userId }, {
                headers: { Authorization: `Bearer ${token}` }
            });
            fetchData();
        } catch (e) { alert("Failed to approve user"); }
    };

    const togglePermission = async (userId, type, currentValue) => {
        const token = localStorage.getItem('cabane_token');
        try {
            await axios.post(`${API_URL}/api/users/permission`,
                { userId, type, value: !currentValue },
                { headers: { Authorization: `Bearer ${token}` } }
            );
            fetchData();
        } catch (e) { alert("Failed to update permission"); }
    };

    const deleteUser = async (userId) => {
        if (!confirm("Are you sure you want to delete this user? This cannot be undone.")) return;
        const token = localStorage.getItem('cabane_token');
        try {
            await axios.post(`${API_URL}/api/users/delete`, { userId }, {
                headers: { Authorization: `Bearer ${token}` }
            });
            fetchData();
        } catch (e) { alert(e.response?.data?.error || "Failed to delete user"); }
    };

    // --- SETTINGS ACTIONS ---

    const searchCity = async () => {
        if (!citySearch) return;
        try {
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
        setCityResults([]);
        setCitySearch('');
    };

    const saveSettings = async () => {
        const token = localStorage.getItem('cabane_token');
        try {
            await axios.post(`${API_URL}/api/system/settings`, sysSettings, {
                headers: { Authorization: `Bearer ${token}` }
            });
            alert("Settings saved.");
            window.location.reload(); // Reload app to apply changes
        } catch (e) { alert("Failed to save settings"); }
    };

    if (!isOpen) return null;

    return (
        // Backdrop Click to Close
        <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-[60] p-4 backdrop-blur-sm" onClick={onClose}>

            {/* Stop Propagation */}
            <div className="bg-cabane-panel border border-gray-600 rounded-xl shadow-2xl w-full max-w-5xl overflow-hidden flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>

                {/* Header */}
                <div className="flex justify-between items-center p-5 border-b border-gray-700 bg-gray-800">
                    <h2 className="text-xl font-black text-gray-200 flex items-center gap-3 tracking-wide">
                        <Shield className="text-blue-500" size={24} />
                        ADMINISTRATION
                    </h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
                        <X size={28} />
                    </button>
                </div>

                {/* Tabs */}
                <div className="flex border-b border-gray-700 bg-gray-900">
                    <button
                        onClick={() => setActiveTab('USERS')}
                        className={`flex-1 py-3 text-sm font-bold uppercase tracking-wide transition-colors ${activeTab === 'USERS' ? 'bg-gray-800 text-blue-400 border-t-2 border-blue-500' : 'text-gray-500 hover:text-white'}`}
                    >
                        User Management
                    </button>
                    <button
                        onClick={() => setActiveTab('SYSTEM')}
                        className={`flex-1 py-3 text-sm font-bold uppercase tracking-wide transition-colors ${activeTab === 'SYSTEM' ? 'bg-gray-800 text-blue-400 border-t-2 border-blue-500' : 'text-gray-500 hover:text-white'}`}
                    >
                        System Settings
                    </button>
                </div>

                {/* Content */}
                <div className="flex-grow overflow-y-auto p-0">

                    {/* --- USERS TAB --- */}
                    {activeTab === 'USERS' && (
                        loading ? (
                            <div className="p-8 text-center text-gray-500 animate-pulse">Loading User Database...</div>
                        ) : (
                            <table className="w-full text-left border-collapse">
                                <thead className="bg-gray-900/50 text-gray-400 text-xs uppercase font-mono sticky top-0 z-10">
                                    <tr>
                                        <th className="p-4">User</th>
                                        <th className="p-4">Role</th>
                                        <th className="p-4">Status</th>
                                        <th className="p-4 text-center">Control</th>
                                        <th className="p-4 text-center">Logs</th>
                                        <th className="p-4 text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-700">
                                    {users.map(user => (
                                        <tr key={user.id} className="hover:bg-gray-700/50 transition-colors">
                                            <td className="p-4 font-bold text-gray-200">{user.username} <br /><span className="text-xs text-gray-500 font-normal">{user.email}</span></td>
                                            <td className="p-4 text-sm text-gray-400">{user.role}</td>
                                            <td className="p-4">
                                                {user.status === 'ACTIVE'
                                                    ? <span className="px-2 py-1 rounded bg-green-900/50 text-green-400 text-xs font-bold border border-green-800">ACTIVE</span>
                                                    : <span className="px-2 py-1 rounded bg-yellow-900/50 text-yellow-400 text-xs font-bold border border-yellow-800 animate-pulse">PENDING</span>}
                                            </td>
                                            <td className="p-4 text-center">
                                                <button onClick={() => togglePermission(user.id, 'control', user.can_control)}
                                                    className={`px-2 py-1 rounded text-xs font-bold border transition-colors w-20 ${user.can_control ? 'bg-blue-900/50 text-blue-400 border-blue-800' : 'bg-gray-800 text-gray-500 border-gray-700'}`}>
                                                    {user.can_control ? "GRANTED" : "DENIED"}
                                                </button>
                                            </td>
                                            <td className="p-4 text-center">
                                                <button onClick={() => togglePermission(user.id, 'logs', user.can_view_logs)}
                                                    className={`px-2 py-1 rounded text-xs font-bold border transition-colors w-20 ${user.can_view_logs ? 'bg-yellow-900/50 text-yellow-400 border-yellow-800' : 'bg-gray-800 text-gray-500 border-gray-700'}`}>
                                                    {user.can_view_logs ? "VIEWER" : "HIDDEN"}
                                                </button>
                                            </td>
                                            <td className="p-4 flex justify-end gap-2 items-center">
                                                {user.status === 'PENDING' && <button onClick={() => approveUser(user.id)} className="p-2 bg-green-700 hover:bg-green-600 rounded text-white shadow"><Check size={16} /></button>}
                                                {user.username !== 'admin' && <button onClick={() => deleteUser(user.id)} className="p-2 bg-gray-700 hover:bg-red-900/80 text-gray-400 hover:text-red-200 rounded"><Trash2 size={16} /></button>}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )
                    )}

                    {/* --- SYSTEM TAB --- */}
                    {activeTab === 'SYSTEM' && (
                        <div className="p-8 grid grid-cols-1 md:grid-cols-2 gap-6">

                            {/* Timezone Card */}
                            <div className="bg-gray-800 p-6 rounded-lg border border-gray-700 shadow-lg h-fit">
                                <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                                    <Globe size={20} className="text-blue-500" /> Timezone
                                </h3>
                                <select value={sysSettings.timezone} onChange={(e) => setSysSettings({ ...sysSettings, timezone: e.target.value })} className="w-full bg-gray-900 border border-gray-600 rounded p-3 text-white mb-2 outline-none">
                                    {timezones.map(tz => <option key={tz.label} value={tz.value}>{tz.label}</option>)}
                                </select>
                            </div>

                            {/* Disk Usage Card (New) */}
                            <div className="bg-gray-800 p-6 rounded-lg border border-gray-700 shadow-lg h-fit">
                                <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                                    <HardDrive size={20} className="text-purple-500" /> Server Storage
                                </h3>
                                <div className="text-3xl font-mono font-black text-white flex items-baseline gap-2">
                                    {diskUsage} <span className="text-sm text-gray-500 font-sans font-bold">USED</span>
                                </div>
                                <div className="w-full bg-gray-700 rounded-full h-2.5 mt-3 overflow-hidden">
                                    <div
                                        className="bg-purple-600 h-2.5 rounded-full transition-all duration-500"
                                        style={{ width: diskUsage !== 'Unknown' ? diskUsage : '0%' }}
                                    ></div>
                                </div>
                            </div>

                            {/* Weather Location Card */}
                            <div className="bg-gray-800 p-6 rounded-lg border border-gray-700 shadow-lg md:col-span-2">
                                <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                                    <MapPin size={20} className="text-green-500" /> Weather Location
                                </h3>

                                <div className="flex gap-2 mb-4">
                                    <input
                                        type="text"
                                        placeholder="Search City..."
                                        value={citySearch}
                                        onChange={e => setCitySearch(e.target.value)}
                                        onKeyDown={e => e.key === 'Enter' && searchCity()} // ✅ Enter Key Support
                                        className="flex-grow bg-gray-900 border border-gray-600 rounded p-2 text-white outline-none"
                                    />
                                    <button onClick={searchCity} className="p-2 bg-blue-600 rounded text-white hover:bg-blue-500"><Search size={20} /></button>
                                </div>

                                {cityResults.length > 0 && (
                                    <ul className="mb-4 bg-gray-900 border border-gray-600 rounded max-h-40 overflow-y-auto">
                                        {cityResults.map(city => (
                                            <li key={city.id} onClick={() => selectCity(city)} className="p-2 hover:bg-blue-900/50 cursor-pointer text-sm text-gray-300 border-b border-gray-700 last:border-0">
                                                {city.name}, {city.admin1}, {city.country_code}
                                            </li>
                                        ))}
                                    </ul>
                                )}

                                <div className="grid grid-cols-3 gap-4 text-sm text-gray-400 bg-gray-900/50 p-4 rounded border border-gray-700">
                                    <div><span className="text-gray-600 text-xs uppercase font-bold block">City</span>{sysSettings.weather_city || "None"}</div>
                                    <div><span className="text-gray-600 text-xs uppercase font-bold block">Lat</span>{sysSettings.weather_lat}</div>
                                    <div><span className="text-gray-600 text-xs uppercase font-bold block">Lon</span>{sysSettings.weather_lon}</div>
                                </div>
                            </div>

                            {/* Save Button */}
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