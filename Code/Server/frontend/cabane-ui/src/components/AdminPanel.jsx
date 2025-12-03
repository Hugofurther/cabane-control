import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { X, Check, Trash2, Shield, User } from 'lucide-react';

// ✅ FIX: Use relative path in PROD to avoid Mixed Content errors
const API_URL = import.meta.env.PROD ? '' : (import.meta.env.VITE_API_URL || 'http://localhost:3000');

export const AdminPanel = ({ isOpen, onClose }) => {
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    // --- FETCH USERS ---
    const fetchUsers = async () => {
        setLoading(true);
        const token = localStorage.getItem('cabane_token');
        try {
            const res = await axios.get(`${API_URL}/api/users`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            setUsers(res.data);
            setError('');
        } catch (e) {
            setError("Failed to load users. Are you Admin?");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (isOpen) fetchUsers();
    }, [isOpen]);

    // --- ACTIONS ---

    const approveUser = async (userId) => {
        const token = localStorage.getItem('cabane_token');
        try {
            await axios.post(`${API_URL}/api/users/approve`, { userId }, {
                headers: { Authorization: `Bearer ${token}` }
            });
            fetchUsers(); // Refresh
        } catch (e) {
            alert("Failed to approve user");
        }
    };

    const togglePermission = async (userId, type, currentValue) => {
        const token = localStorage.getItem('cabane_token');
        try {
            await axios.post(`${API_URL}/api/users/permission`,
                { userId, type, value: !currentValue }, // type: 'control' or 'logs'
                { headers: { Authorization: `Bearer ${token}` } }
            );
            fetchUsers();
        } catch (e) {
            alert("Failed to update permission");
        }
    };

    const deleteUser = async (userId) => {
        if (!confirm("Are you sure you want to delete this user? This cannot be undone.")) return;

        const token = localStorage.getItem('cabane_token');
        try {
            await axios.post(`${API_URL}/api/users/delete`, { userId }, {
                headers: { Authorization: `Bearer ${token}` }
            });
            fetchUsers();
        } catch (e) {
            alert(e.response?.data?.error || "Failed to delete user");
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-[60] p-4 backdrop-blur-sm">
            <div className="bg-cabane-panel border border-gray-600 rounded-xl shadow-2xl w-full max-w-5xl overflow-hidden flex flex-col max-h-[90vh]">

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

                {/* Content */}
                <div className="p-0 overflow-y-auto flex-grow">
                    {loading ? (
                        <div className="p-8 text-center text-gray-500 animate-pulse">Loading User Database...</div>
                    ) : error ? (
                        <div className="p-8 text-center text-red-400">{error}</div>
                    ) : (
                        <table className="w-full text-left border-collapse">
                            <thead className="bg-gray-900/50 text-gray-400 text-xs uppercase font-mono sticky top-0">
                                <tr>
                                    <th className="p-4">User</th>
                                    <th className="p-4">Role</th>
                                    <th className="p-4">Status</th>
                                    <th className="p-4">Logs</th>
                                    <th className="p-4">Control</th>
                                    <th className="p-4">Registered</th>
                                    <th className="p-4 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-700">
                                {users.map(user => (
                                    <tr key={user.id} className="hover:bg-gray-700/50 transition-colors">
                                        {/* Username & Email */}
                                        <td className="p-4 font-bold text-gray-200 flex items-center gap-2">
                                            <User size={16} className="text-gray-500" />
                                            {user.username}
                                            <span className="text-xs text-gray-500 font-normal ml-1">({user.email})</span>
                                        </td>

                                        {/* Role */}
                                        <td className="p-4 text-sm text-gray-400">{user.role}</td>

                                        {/* Account Status */}
                                        <td className="p-4">
                                            {user.status === 'ACTIVE' ? (
                                                <span className="px-2 py-1 rounded bg-green-900/50 text-green-400 text-xs font-bold border border-green-800">ACTIVE</span>
                                            ) : (
                                                <span className="px-2 py-1 rounded bg-yellow-900/50 text-yellow-400 text-xs font-bold border border-yellow-800 animate-pulse">PENDING</span>
                                            )}
                                        </td>

                                        {/* Control Permission */}
                                        <td className="p-4">
                                            <button
                                                onClick={() => togglePermission(user.id, 'control', user.can_control)}
                                                className={`px-2 py-1 rounded text-xs font-bold border transition-colors w-20 ${user.can_control
                                                    ? 'bg-blue-900/50 text-blue-400 border-blue-800 hover:bg-blue-800 hover:text-white'
                                                    : 'bg-gray-700 text-gray-500 border-gray-600 hover:bg-gray-600'
                                                    }`}
                                            >
                                                {user.can_control ? "CONTROL" : "NO CTRL"}
                                            </button>
                                        </td>

                                        {/* NEW: Logs Permission */}
                                        <td className="p-4">
                                            <button
                                                onClick={() => togglePermission(user.id, 'logs', user.can_view_logs)}
                                                className={`px-2 py-1 rounded text-xs font-bold border transition-colors w-20 ${user.can_view_logs
                                                    ? 'bg-yellow-900/50 text-yellow-400 border-yellow-800 hover:bg-yellow-800 hover:text-white'
                                                    : 'bg-gray-700 text-gray-500 border-gray-600 hover:bg-gray-600'
                                                    }`}
                                            >
                                                {user.can_view_logs ? "VIEWER" : "NO LOGS"}
                                            </button>
                                        </td>

                                        {/* Control Permission Toggle */}
                                        <td className="p-4">
                                            <button
                                                onClick={() => togglePermission(user.id, user.can_control)}
                                                className={`px-2 py-1 rounded text-xs font-bold border transition-colors ${user.can_control
                                                    ? 'bg-blue-900/50 text-blue-400 border-blue-800 hover:bg-blue-800'
                                                    : 'bg-gray-700 text-gray-500 border-gray-600 hover:bg-gray-600'
                                                    }`}
                                            >
                                                {user.can_control ? "GRANTED" : "DENIED"}
                                            </button>
                                        </td>

                                        {/* Registration Date */}
                                        <td className="p-4 text-xs text-gray-500 font-mono">
                                            {new Date(user.created_at).toLocaleDateString()}
                                        </td>

                                        {/* Action Buttons */}
                                        <td className="p-4 flex justify-end gap-2">
                                            {user.status === 'PENDING' && (
                                                <button
                                                    onClick={() => approveUser(user.id)}
                                                    className="p-2 rounded bg-green-700 hover:bg-green-600 text-white shadow transition-all"
                                                    title="Approve User"
                                                >
                                                    <Check size={16} />
                                                </button>
                                            )}
                                            {user.username !== 'admin' && (
                                                <button
                                                    onClick={() => deleteUser(user.id)}
                                                    className="p-2 rounded bg-gray-700 hover:bg-red-900/80 text-gray-400 hover:text-red-200 transition-all"
                                                    title="Delete User"
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>
        </div>
    );
};