import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { X, Check, Trash2, Shield, User, Clock } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export const AdminPanel = ({ isOpen, onClose }) => {
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    // Fetch Users on Load
    const fetchUsers = async () => {
        setLoading(true);
        const token = localStorage.getItem('cabane_token');
        try {
            const res = await axios.get(`${API_URL}/api/users`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            setUsers(res.data);
        } catch (e) {
            setError("Failed to load users. Are you Admin?");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (isOpen) fetchUsers();
    }, [isOpen]);

    // Actions
    const approveUser = async (userId) => {
        const token = localStorage.getItem('cabane_token');
        try {
            await axios.post(`${API_URL}/api/users/approve`, { userId }, {
                headers: { Authorization: `Bearer ${token}` }
            });
            // Refresh list
            fetchUsers();
        } catch (e) {
            alert("Failed to approve user");
        }
    };

    const deleteUser = async (userId) => {
        if (!confirm("Are you sure you want to delete this user? This cannot be undone.")) return;

        const token = localStorage.getItem('cabane_token');
        try {
            await axios.post(`${API_URL}/api/users/delete`, { userId }, {
                headers: { Authorization: `Bearer ${token}` }
            });
            // Refresh the list on success
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
                                    <th className="p-4">Registered</th>
                                    <th className="p-4 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-700">
                                {users.map(user => (
                                    <tr key={user.id} className="hover:bg-gray-700/50 transition-colors">
                                        <td className="p-4 font-bold text-gray-200 flex items-center gap-2">
                                            <User size={16} className="text-gray-500" />
                                            {user.username}
                                            <span className="text-xs text-gray-500 font-normal ml-1">({user.email})</span>
                                        </td>
                                        <td className="p-4 text-sm text-gray-400">{user.role}</td>
                                        <td className="p-4">
                                            {user.status === 'ACTIVE' ? (
                                                <span className="px-2 py-1 rounded bg-green-900/50 text-green-400 text-xs font-bold border border-green-800">ACTIVE</span>
                                            ) : (
                                                <span className="px-2 py-1 rounded bg-yellow-900/50 text-yellow-400 text-xs font-bold border border-yellow-800 animate-pulse">PENDING</span>
                                            )}
                                        </td>
                                        <td className="p-4 text-xs text-gray-500 font-mono">
                                            {new Date(user.created_at).toLocaleDateString()}
                                        </td>
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