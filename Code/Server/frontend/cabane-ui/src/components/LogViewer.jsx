import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { X, ScrollText, RefreshCw, Download, Filter, Calendar } from 'lucide-react';
import { useSocket } from '../contexts/SocketContext';

const API_URL = import.meta.env.PROD ? '' : (import.meta.env.VITE_API_URL || 'http://localhost:3000');

export const LogViewer = ({ isOpen, onClose }) => {
    const { socket } = useSocket();
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(false);

    const [dateFilter, setDateFilter] = useState({ mode: 'ALL', start: '', end: '' });
    const [userFilter, setUserFilter] = useState('ALL');
    const [typeFilter, setTypeFilter] = useState('ALL');
    const [msgSearch, setMsgSearch] = useState('');

    const fetchLogs = async (silent = false) => {
        if (!silent) setLoading(true);
        const token = localStorage.getItem('cabane_token');
        try {
            const res = await axios.get(`${API_URL}/api/logs?limit=1000`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            setLogs(res.data);
        } catch (e) { console.error(e); }
        finally { if (!silent) setLoading(false); }
    };

    useEffect(() => { if (isOpen) fetchLogs(); }, [isOpen]);

    useEffect(() => {
        if (!socket || !isOpen) return;
        const handleNewLog = (newLog) => setLogs(prev => [newLog, ...prev]);
        socket.on('NEW_LOG', handleNewLog);
        return () => socket.off('NEW_LOG', handleNewLog);
    }, [socket, isOpen]);

    const filteredLogs = useMemo(() => {
        return logs.filter(log => {
            if (dateFilter.mode !== 'ALL') {
                const logTime = new Date(log.timestamp).getTime();

                if (dateFilter.mode === 'EXACT' && dateFilter.start) {
                    const day = new Date(log.timestamp).toISOString().slice(0, 10);
                    if (day !== dateFilter.start) return false;
                }
                else if (dateFilter.mode === 'AFTER' && dateFilter.start) {
                    const startT = new Date(dateFilter.start).getTime();
                    if (logTime < startT) return false;
                }
                else if (dateFilter.mode === 'BEFORE' && dateFilter.start) {
                    // Includes the selected day (end of day)
                    const endT = new Date(dateFilter.start).setHours(23, 59, 59, 999);
                    if (logTime > endT) return false;
                }
                else if (dateFilter.mode === 'RANGE' && dateFilter.start && dateFilter.end) {
                    const startT = new Date(dateFilter.start).getTime();
                    const endT = new Date(dateFilter.end).setHours(23, 59, 59, 999);
                    if (logTime < startT || logTime > endT) return false;
                }
            }

            if (userFilter !== 'ALL' && (log.username || 'SYSTEM') !== userFilter) return false;
            if (typeFilter !== 'ALL' && log.type !== typeFilter) return false;
            if (msgSearch && !log.message.toLowerCase().includes(msgSearch.toLowerCase())) return false;

            return true;
        });
    }, [logs, dateFilter, userFilter, typeFilter, msgSearch]);

    const uniqueUsers = useMemo(() => ['ALL', ...new Set(logs.map(l => l.username || 'SYSTEM'))], [logs]);
    const uniqueTypes = useMemo(() => ['ALL', ...new Set(logs.map(l => l.type))], [logs]);

    const downloadCSV = () => {
        if (filteredLogs.length === 0) return;
        const headers = ["Time", "User", "Type", "Message"];
        const rows = filteredLogs.map(log => [
            new Date(log.timestamp).toLocaleString(),
            log.username || "SYSTEM",
            log.type,
            `"${log.message.replace(/"/g, '""')}"`
        ]);
        const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `logs_export.csv`;
        link.click();
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-[60] p-4 backdrop-blur-sm">
            <div className="bg-cabane-panel border border-gray-600 rounded-xl shadow-2xl w-full max-w-6xl overflow-hidden flex flex-col max-h-[90vh]">

                <div className="flex justify-between items-center p-4 border-b border-gray-700 bg-gray-800">
                    <h2 className="text-xl font-black text-gray-200 flex items-center gap-2">
                        <ScrollText className="text-yellow-500" size={24} /> LIVE LOGS
                    </h2>
                    <div className="flex gap-2">
                        <button onClick={downloadCSV} className="flex items-center gap-2 px-3 py-2 rounded bg-blue-900/50 border border-blue-800 text-blue-300 hover:bg-blue-800 hover:text-white text-xs font-bold"><Download size={16} /> Export</button>
                        <button onClick={onClose} className="text-gray-400 hover:text-white"><X size={28} /></button>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-5 gap-4 p-4 bg-gray-900 border-b border-gray-700 text-sm">

                    {/* Date Filter (Spans 2 cols) */}
                    <div className="flex flex-col gap-1 md:col-span-2">
                        <label className="text-xs font-bold text-gray-500 flex items-center gap-1"><Calendar size={10} /> DATE</label>
                        <div className="flex gap-1">
                            <select value={dateFilter.mode} onChange={e => setDateFilter({ ...dateFilter, mode: e.target.value })} className="bg-gray-800 border border-gray-600 rounded p-1 text-white text-xs outline-none">
                                <option value="ALL">All</option>
                                <option value="EXACT">On</option>
                                <option value="AFTER">After</option>
                                <option value="BEFORE">Before</option>
                                <option value="RANGE">Range</option>
                            </select>
                            <input type="date" value={dateFilter.start} onChange={e => setDateFilter({ ...dateFilter, start: e.target.value })} className="bg-gray-800 border border-gray-600 rounded p-1 text-white flex-grow text-xs" disabled={dateFilter.mode === 'ALL'} />
                            {dateFilter.mode === 'RANGE' && (
                                <>
                                    <span className="text-gray-500 self-center">-</span>
                                    <input type="date" value={dateFilter.end} onChange={e => setDateFilter({ ...dateFilter, end: e.target.value })} className="bg-gray-800 border border-gray-600 rounded p-1 text-white flex-grow text-xs" />
                                </>
                            )}
                        </div>
                    </div>

                    <div className="flex flex-col gap-1">
                        <label className="text-xs font-bold text-gray-500 flex items-center gap-1"><Filter size={10} /> USER</label>
                        <select value={userFilter} onChange={e => setUserFilter(e.target.value)} className="bg-gray-800 border border-gray-600 rounded p-1 text-white outline-none w-full">{uniqueUsers.map(u => <option key={u} value={u}>{u}</option>)}</select>
                    </div>

                    <div className="flex flex-col gap-1">
                        <label className="text-xs font-bold text-gray-500 flex items-center gap-1"><Filter size={10} /> TYPE</label>
                        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="bg-gray-800 border border-gray-600 rounded p-1 text-white outline-none w-full">{uniqueTypes.map(t => <option key={t} value={t}>{t}</option>)}</select>
                    </div>

                    <div className="flex flex-col gap-1">
                        <label className="text-xs font-bold text-gray-500 flex items-center gap-1"><Filter size={10} /> MESSAGE</label>
                        <input type="text" placeholder="Search..." value={msgSearch} onChange={e => setMsgSearch(e.target.value)} className="bg-gray-800 border border-gray-600 rounded p-1 text-white outline-none w-full" />
                    </div>
                </div>

                <div className="overflow-y-auto flex-grow p-0 font-mono text-xs md:text-sm">
                    <table className="w-full text-left">
                        <thead className="bg-gray-800/50 text-gray-500 sticky top-0 z-10">
                            <tr><th className="p-3 w-48">Timestamp</th><th className="p-3 w-32">User</th><th className="p-3 w-24">Type</th><th className="p-3">Message</th></tr>
                        </thead>
                        <tbody className="divide-y divide-gray-700/50">
                            {filteredLogs.map(log => (
                                <tr key={log.id} className="hover:bg-gray-700/30 transition-colors animate-in fade-in duration-300">
                                    <td className="p-3 text-gray-400 whitespace-nowrap">{new Date(log.timestamp).toLocaleString()}</td>
                                    <td className="p-3 font-bold text-blue-400">{log.username || "SYSTEM"}</td>
                                    <td className="p-3">
                                        <span className={`px-2 py-0.5 rounded text-[10px] border ${log.type === 'CONTROL' ? 'border-red-900 bg-red-900/20 text-red-400' : log.type === 'ALARM' ? 'border-orange-900 bg-orange-900/20 text-orange-400' : 'border-gray-700 bg-gray-800 text-gray-400'}`}>{log.type}</span>
                                    </td>
                                    <td className="p-3 text-gray-300">{log.message}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};