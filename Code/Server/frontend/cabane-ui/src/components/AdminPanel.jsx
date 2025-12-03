import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { X, Check, Trash2, Shield, User, Globe } from 'lucide-react';

const API_URL = import.meta.env.PROD ? '' : (import.meta.env.VITE_API_URL || 'http://localhost:3000');

export const AdminPanel = ({ isOpen, onClose }) => {
    const [activeTab, setActiveTab] = useState('USERS');
    const [users, setUsers] = useState([]);
    const [timezone, setTimezone] = useState('UTC');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const timezones = [
        { label: "UTC", value: "UTC" },
        { label: "Montréal, QC (EST)", value: "America/Montreal" },
        { label: "Drummondville, QC (EST)", value: "America/Montreal" },
        { label: "Sainte-Brigitte-des-Saults, QC (EST)", value: "America/Montreal" },
        { label: "New York (EST)", value: "America/New_York" },
        { label: "Paris (CET)", value: "Europe/Paris" }
    ];

    const fetchData = async () => {
        setLoading(true);
        const token = localStorage.getItem('cabane_token');
        try {
            const resUsers = await axios.get(`${API_URL}/api/users`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            setUsers(resUsers.data);

            const resSettings = await axios.get(`${API_URL}/api/settings/timezone`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            if (resSettings.data.timezone) setTimezone(resSettings.data.timezone);
            setError('');
        } catch (e) { setError("Failed to load admin data."); }
        finally { setLoading(false); }
    };

    useEffect(() => { if (isOpen) fetchData(); }, [isOpen]);

    // --- ACTIONS ---
    const approveUser = async (userId) => {
        const token = localStorage.getItem('cabane_token');
        try {
            await axios.post(`${API_URL}/api/users/approve`, { userId }, {
                headers: { Authorization: `Bearer ${token}` }
            });
            fetchData();
        } catch (e) { alert("Failed"); }
    };

    const togglePermission = async (userId, type, currentValue) => {
        const token = localStorage.getItem('cabane_token');
        try {
            await axios.post(`${API_URL}/api/users/permission`,
                { userId, type, value: !currentValue },
                { headers: { Authorization: `Bearer ${token}` } }
            );
            fetchData();
        } catch (e) { alert("Failed"); }
    };

    const deleteUser = async (userId) => {
        if (!confirm("Delete this user?")) return;
        const token = localStorage.getItem('cabane_token');
        try {
            await axios.post(`${API_URL}/api/users/delete`, { userId }, {
                headers: { Authorization: `Bearer ${token}` }
            });
            fetchData();
        } catch (e) { alert(e.response?.data?.error || "Failed"); }
    };

    const saveTimezone = async () => {
        const token = localStorage.getItem('cabane_token');
        try {
            await axios.post(`${API_URL}/api/settings/timezone`, { timezone }, {
                headers: { Authorization: `Bearer ${token}` }
            });
            alert("Timezone saved.");
            onClose(); // Dismiss panel on save
        } catch (e) { alert("Failed to save timezone"); }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-[60] p-4 backdrop-blur-sm">
            <div className="bg-cabane-panel border border-gray-600 rounded-xl shadow-2xl w-full max-w-5xl overflow-hidden flex flex-col max-h-[90vh]">

                <div className="flex justify-between items-center p-4 border-b border-gray-700 bg-gray-800">
                    <h2 className="text-xl font-black text-gray-200 flex items-center gap-3 tracking-wide">
                        <Shield className="text-blue-500" size={24} /> ADMINISTRATION
                    </h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-white"><X size={28} /></button>
                </div>

                <div className="flex border-b border-gray-700 bg-gray-900">
                    <button onClick={() => setActiveTab('USERS')} className={`flex-1 py-3 text-sm font-bold uppercase tracking-wide ${activeTab === 'USERS' ? 'bg-gray-800 text-blue-400 border-t-2 border-blue-500' : 'text-gray-500 hover:text-white'}`}>User Management</button>
                    <button onClick={() => setActiveTab('SYSTEM')} className={`flex-1 py-3 text-sm font-bold uppercase tracking-wide ${activeTab === 'SYSTEM' ? 'bg-gray-800 text-blue-400 border-t-2 border-blue-500' : 'text-gray-500 hover:text-white'}`}>System Settings</button>
                </div>

                <div className="flex-grow overflow-y-auto p-0">
                    {activeTab === 'USERS' && (
                        <table className="w-full text-left border-collapse">
                            <thead className="bg-gray-900/50 text-gray-400 text-xs uppercase font-mono sticky top-0 z-10">
                                <tr>
                                    <th className="p-4">User</th><th className="p-4">Role</th><th className="p-4">Status</th><th className="p-4 text-center">Control</th><th className="p-4 text-center">Logs</th><th className="p-4 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-700">
                                {users.map(user => (
                                    <tr key={user.id} className="hover:bg-gray-700/50">
                                        <td className="p-4 font-bold text-gray-200">{user.username} <br /><span className="text-xs text-gray-500 font-normal">{user.email}</span></td>
                                        <td className="p-4 text-sm text-gray-400">{user.role}</td>
                                        <td className="p-4">{user.status === 'ACTIVE' ? <span className="text-green-400 font-bold text-xs">ACTIVE</span> : <span className="text-yellow-400 font-bold text-xs">PENDING</span>}</td>
                                        <td className="p-4 text-center"><button onClick={() => togglePermission(user.id, 'control', user.can_control)} className={`px-2 py-1 rounded text-xs font-bold border w-20 ${user.can_control ? 'bg-blue-900/50 text-blue-400 border-blue-800' : 'bg-gray-800 text-gray-500 border-gray-700'}`}>{user.can_control ? "GRANTED" : "DENIED"}</button></td>
                                        <td className="p-4 text-center"><button onClick={() => togglePermission(user.id, 'logs', user.can_view_logs)} className={`px-2 py-1 rounded text-xs font-bold border w-20 ${user.can_view_logs ? 'bg-yellow-900/50 text-yellow-400 border-yellow-800' : 'bg-gray-800 text-gray-500 border-gray-700'}`}>{user.can_view_logs ? "VIEWER" : "HIDDEN"}</button></td>
                                        <td className="p-4 flex justify-end gap-2 items-center">
                                            {user.status === 'PENDING' && <button onClick={() => approveUser(user.id)} className="p-2 bg-green-700 hover:bg-green-600 rounded text-white shadow"><Check size={16} /></button>}
                                            {user.username !== 'admin' && <button onClick={() => deleteUser(user.id)} className="p-2 bg-gray-700 hover:bg-red-900/80 text-gray-400 hover:text-red-200 rounded"><Trash2 size={16} /></button>}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                    {activeTab === 'SYSTEM' && (
                        <div className="p-8 flex flex-col items-center h-full">
                            <div className="bg-gray-800 p-8 rounded-lg border border-gray-700 shadow-lg w-full max-w-lg">
                                <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2"><Globe size={20} className="text-blue-500" /> System Timezone</h3>
                                <select value={timezone} onChange={(e) => setTimezone(e.target.value)} className="w-full bg-gray-900 border border-gray-600 rounded p-3 text-white mb-6 outline-none">
                                    {timezones.map(tz => <option key={tz.value} value={tz.value}>{tz.label}</option>)}
                                </select>
                                <button onClick={saveTimezone} className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded shadow-lg">Save Configuration</button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};