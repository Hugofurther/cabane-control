import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { X, ScrollText, RefreshCw } from 'lucide-react';

// API URL Logic
const API_URL = import.meta.env.PROD ? '' : (import.meta.env.VITE_API_URL || 'http://localhost:3000');

export const LogViewer = ({ isOpen, onClose }) => {
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(false);

    const fetchLogs = async () => {
        setLoading(true);
        const token = localStorage.getItem('cabane_token');
        try {
            const res = await axios.get(`${API_URL}/api/logs`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            setLogs(res.data);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (isOpen) fetchLogs();
    }, [isOpen]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-[60] p-4 backdrop-blur-sm">
            <div className="bg-cabane-panel border border-gray-600 rounded-xl shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[80vh]">

                {/* Header */}
                <div className="flex justify-between items-center p-4 border-b border-gray-700 bg-gray-800">
                    <h2 className="text-xl font-black text-gray-200 flex items-center gap-2">
                        <ScrollText className="text-yellow-500" size={24} />
                        SYSTEM LOGS
                    </h2>
                    <div className="flex gap-2">
                        <button onClick={fetchLogs} className="p-2 hover:bg-gray-700 rounded text-gray-400">
                            <RefreshCw size={20} className={loading ? "animate-spin" : ""} />
                        </button>
                        <button onClick={onClose} className="text-gray-400 hover:text-white">
                            <X size={28} />
                        </button>
                    </div>
                </div>

                {/* Log Table */}
                <div className="overflow-y-auto flex-grow p-0 font-mono text-xs md:text-sm">
                    <table className="w-full text-left">
                        <thead className="bg-gray-900 text-gray-500 sticky top-0">
                            <tr>
                                <th className="p-3 w-40">Time</th>
                                <th className="p-3 w-32">User</th>
                                <th className="p-3 w-24">Type</th>
                                <th className="p-3">Message</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-700/50">
                            {logs.map(log => (
                                <tr key={log.id} className="hover:bg-gray-700/30">
                                    <td className="p-3 text-gray-400">
                                        {new Date(log.timestamp).toLocaleString()}
                                    </td>
                                    <td className="p-3 text-blue-400 font-bold">
                                        {log.username || "SYSTEM"}
                                    </td>
                                    <td className="p-3">
                                        <span className={`px-2 py-0.5 rounded text-[10px] border ${log.type === 'CONTROL' ? 'border-red-900 bg-red-900/20 text-red-400' :
                                                log.type === 'AUTH' ? 'border-green-900 bg-green-900/20 text-green-400' :
                                                    'border-gray-700 bg-gray-800 text-gray-400'
                                            }`}>
                                            {log.type}
                                        </span>
                                    </td>
                                    <td className="p-3 text-gray-300">
                                        {log.message}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {logs.length === 0 && !loading && (
                        <div className="p-8 text-center text-gray-500">No logs found.</div>
                    )}
                </div>
            </div>
        </div>
    );
};