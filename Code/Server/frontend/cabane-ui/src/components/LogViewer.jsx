import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import axios from 'axios';
import { X, RefreshCw, Terminal, Loader2, Download, Search, Filter, ArrowUpDown, Calendar, User, ChevronDown } from 'lucide-react';
import { clsx } from 'clsx';

const API_URL = import.meta.env.PROD ? '' : (import.meta.env.VITE_API_URL || 'http://localhost:3000');

export const LogViewer = ({ embedded, isOpen, onClose }) => {
    const [logs, setLogs] = useState([]);
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(false);

    // Filters
    const [dateRange, setDateRange] = useState({ start: '', end: '' });
    const [typeFilter, setTypeFilter] = useState('ALL');
    const [userFilter, setUserFilter] = useState('ALL');
    const [msgSearch, setMsgSearch] = useState('');
    const [sortAsc, setSortAsc] = useState(false);

    // UI States
    const [showDateMenu, setShowDateMenu] = useState(false);
    const [showUserMenu, setShowUserMenu] = useState(false);
    const [userSearch, setUserSearch] = useState('');

    const dateMenuRef = useRef(null);
    const userMenuRef = useRef(null);

    const fetchLogs = useCallback(async () => {
        setLoading(true);
        const token = localStorage.getItem('cabane_token');
        try {
            const resLogs = await axios.get(`${API_URL}/api/logs?limit=1000`, { headers: { Authorization: `Bearer ${token}` } });
            setLogs(Array.isArray(resLogs.data) ? resLogs.data : []);

            const resUsers = await axios.get(`${API_URL}/api/users/directory`, { headers: { Authorization: `Bearer ${token}` } });
            setUsers(Array.isArray(resUsers.data) ? resUsers.data : []);
        } catch (e) {
            console.error("Log fetch failed", e);
            setLogs([]);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (isOpen || embedded) fetchLogs();
    }, [isOpen, embedded, fetchLogs]);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (dateMenuRef.current && !dateMenuRef.current.contains(event.target)) setShowDateMenu(false);
            if (userMenuRef.current && !userMenuRef.current.contains(event.target)) setShowUserMenu(false);
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    // --- FILTER LOGIC ---
    const filteredLogs = useMemo(() => {
        if (!Array.isArray(logs)) return [];

        return logs.filter(log => {
            const logDate = new Date(log.timestamp);

            // 1. Date Range
            if (dateRange.start) {
                // "After Date": Log must be >= Start 00:00:00
                const startDate = new Date(dateRange.start);
                if (logDate < startDate) return false;
            }
            if (dateRange.end) {
                // "Before Date": Log must be <= End 23:59:59
                // We accomplish this by setting the limit to the NEXT day at 00:00:00
                const endDate = new Date(dateRange.end);
                endDate.setDate(endDate.getDate() + 1);
                if (logDate >= endDate) return false;
            }

            // 2. Type
            if (typeFilter !== 'ALL' && log.type !== typeFilter) return false;

            // 3. User
            if (userFilter !== 'ALL') {
                if (String(log.user_id) !== String(userFilter)) return false;
            }

            // 4. Message Search
            if (msgSearch) {
                const safeMsg = (log.message || '').toLowerCase();
                if (!safeMsg.includes(msgSearch.toLowerCase())) return false;
            }

            return true;
        }).sort((a, b) => {
            const dateA = new Date(a.timestamp).getTime();
            const dateB = new Date(b.timestamp).getTime();
            return sortAsc ? dateA - dateB : dateB - dateA;
        });
    }, [logs, dateRange, typeFilter, userFilter, msgSearch, sortAsc]);

    // --- EXPORT ---
    const handleExport = () => {
        const headers = ["Timestamp", "Type", "User", "Message"];
        const rows = filteredLogs.map(l => [
            new Date(l.timestamp).toLocaleString(),
            l.type,
            l.username || 'SYSTEM',
            `"${(l.message || '').replace(/"/g, '""')}"`
        ]);

        const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', `cabane_logs_${new Date().toISOString().slice(0, 10)}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const getTypeColor = (type) => {
        switch (type) {
            case 'ALARM': return 'text-red-500';
            case 'AUTH': return 'text-blue-400';
            case 'CONTROL': return 'text-yellow-400';
            case 'SYSTEM': return 'text-purple-400';
            default: return 'text-gray-400';
        }
    };

    const selectedUserName = userFilter === 'ALL' ? 'All Users' : (users.find(u => String(u.id) === String(userFilter))?.username || 'Unknown');

    const content = (
        <div className={clsx("flex flex-col bg-gray-900 border-gray-700 overflow-hidden", embedded ? "h-full border-0" : "bg-cabane-panel border rounded-xl shadow-2xl w-full max-w-5xl max-h-[85vh]")} onClick={e => e.stopPropagation()}>

            {!embedded && (
                <div className="flex justify-between items-center p-5 border-b border-gray-700 bg-gray-800 shrink-0">
                    <h2 className="text-xl font-black text-gray-200 flex items-center gap-3"><Terminal size={24} className="text-yellow-500" /> SYSTEM LOGS</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-white"><X size={28} /></button>
                </div>
            )}

            {/* TOOLBAR */}
            <div className="flex flex-col xl:flex-row gap-3 p-3 bg-gray-900 border-b border-gray-800 shrink-0 text-xs">

                {/* FILTERS */}
                <div className="flex flex-wrap gap-2 items-center flex-grow">

                    {/* 1. DATE FILTER POPOVER */}
                    <div className="relative" ref={dateMenuRef}>
                        <button
                            onClick={() => setShowDateMenu(!showDateMenu)}
                            className={`flex items-center gap-2 px-3 py-2 rounded border transition-colors ${dateRange.start || dateRange.end ? 'bg-blue-900/30 border-blue-500 text-blue-300' : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white'}`}
                        >
                            <Calendar size={14} />
                            <span>{(dateRange.start || dateRange.end) ? 'Date Filter' : 'Date Range'}</span>
                            <ChevronDown size={12} />
                        </button>
                        {showDateMenu && (
                            <div className="absolute top-full left-0 mt-2 bg-gray-800 border border-gray-600 rounded-lg shadow-xl p-4 z-50 w-64 flex flex-col gap-3">
                                <div>
                                    <label className="block text-[10px] uppercase font-bold text-gray-500 mb-1">After (Start)</label>
                                    <input type="date" value={dateRange.start} onChange={e => setDateRange({ ...dateRange, start: e.target.value })} className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-white" />
                                </div>
                                <div>
                                    <label className="block text-[10px] uppercase font-bold text-gray-500 mb-1">Before (End)</label>
                                    <input type="date" value={dateRange.end} onChange={e => setDateRange({ ...dateRange, end: e.target.value })} className="w-full bg-gray-900 border border-gray-700 rounded p-2 text-white" />
                                </div>
                                <button onClick={() => { setDateRange({ start: '', end: '' }); setShowDateMenu(false); }} className="w-full py-1 bg-red-900/20 text-red-400 rounded hover:bg-red-900/40 font-bold">Clear Date Filter</button>
                            </div>
                        )}
                    </div>

                    {/* 2. TYPE FILTER */}
                    <div className="relative">
                        <Filter className="absolute left-2.5 top-2.5 text-gray-500" size={14} />
                        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="bg-gray-800 border border-gray-700 rounded pl-8 pr-8 py-2 text-white outline-none appearance-none cursor-pointer hover:border-gray-600">
                            <option value="ALL">All Types</option>
                            <option value="ALARM">Alarms</option>
                            <option value="CONTROL">Control</option>
                            <option value="AUTH">Auth</option>
                            <option value="SYSTEM">System</option>
                        </select>
                        <ChevronDown size={12} className="absolute right-2.5 top-3 text-gray-500 pointer-events-none" />
                    </div>

                    {/* 3. USER FILTER */}
                    <div className="relative" ref={userMenuRef}>
                        <button onClick={() => setShowUserMenu(!showUserMenu)} className={`flex items-center gap-2 px-3 py-2 rounded border transition-colors ${userFilter !== 'ALL' ? 'bg-blue-900/30 border-blue-500 text-blue-300' : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-white'}`}>
                            <User size={14} />
                            <span className="max-w-[100px] truncate">{selectedUserName}</span>
                            <ChevronDown size={12} />
                        </button>
                        {showUserMenu && (
                            <div className="absolute top-full left-0 mt-2 bg-gray-800 border border-gray-600 rounded-lg shadow-xl p-2 z-50 w-56 flex flex-col gap-2">
                                <div className="relative">
                                    <Search className="absolute left-2 top-2 text-gray-500" size={12} />
                                    <input type="text" placeholder="Search user..." value={userSearch} onChange={e => setUserSearch(e.target.value)} className="w-full bg-gray-900 border border-gray-700 rounded pl-7 p-1.5 text-xs text-white" autoFocus />
                                </div>
                                <div className="max-h-48 overflow-y-auto space-y-1">
                                    <button onClick={() => { setUserFilter('ALL'); setShowUserMenu(false); }} className={`w-full text-left px-2 py-1.5 rounded text-xs ${userFilter === 'ALL' ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-700'}`}>All Users</button>
                                    {users.filter(u => (u.username || '').toLowerCase().includes(userSearch.toLowerCase())).map(u => (
                                        <button key={u.id} onClick={() => { setUserFilter(u.id); setShowUserMenu(false); }} className={`w-full text-left px-2 py-1.5 rounded text-xs ${String(userFilter) === String(u.id) ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-700'}`}>
                                            {u.username}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* 4. SEARCH */}
                    <div className="relative flex-grow min-w-[150px]">
                        <Search className="absolute left-2.5 top-2.5 text-gray-500" size={14} />
                        <input type="text" placeholder="Search messages..." value={msgSearch} onChange={e => setMsgSearch(e.target.value)} className="w-full bg-gray-800 border border-gray-700 rounded pl-8 p-2 text-white outline-none focus:border-blue-500" />
                    </div>
                </div>

                {/* ACTIONS */}
                <div className="flex gap-2 border-l border-gray-800 pl-3 shrink-0">
                    <button onClick={() => setSortAsc(!sortAsc)} className="p-2 bg-gray-800 border border-gray-700 rounded text-gray-400 hover:text-white" title={sortAsc ? "Oldest First" : "Newest First"}><ArrowUpDown size={16} /></button>
                    <button onClick={handleExport} className="p-2 bg-blue-900/30 border border-blue-800 rounded text-blue-400 hover:text-white hover:bg-blue-800" title="Export CSV"><Download size={16} /></button>
                    <button onClick={fetchLogs} className="p-2 hover:bg-gray-800 rounded text-gray-400 hover:text-white transition-colors" title="Refresh"><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /></button>
                </div>
            </div>

            {/* Log Table */}
            <div className="flex-grow overflow-y-auto p-0 font-mono text-xs">
                {loading && logs.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-gray-500 gap-2"><Loader2 size={32} className="animate-spin text-blue-500" /><span>Loading System Logs...</span></div>
                ) : (
                    <table className="w-full text-left border-collapse">
                        <thead className="bg-gray-900 text-gray-500 sticky top-0 z-10 shadow-sm">
                            <tr><th className="p-3 w-40">TIMESTAMP</th><th className="p-3 w-24">TYPE</th><th className="p-3 w-32">USER</th><th className="p-3">MESSAGE</th></tr>
                        </thead>
                        <tbody className="divide-y divide-gray-800">
                            {filteredLogs.map((log) => {
                                let dateStr = "Invalid Date";
                                try { dateStr = new Date(log.timestamp).toLocaleString(); } catch (e) { }
                                return (
                                    <tr key={log.id} className="hover:bg-gray-800/50 transition-colors">
                                        <td className="p-3 text-gray-500 whitespace-nowrap">{dateStr}</td>
                                        <td className={`p-3 font-bold ${getTypeColor(log.type)}`}>{log.type}</td>
                                        <td className="p-3 text-gray-300">{log.username || 'SYSTEM'}</td>
                                        <td className="p-3 text-gray-300 break-all">{log.message}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                )}
                {!loading && filteredLogs.length === 0 && <div className="p-8 text-center text-gray-500 italic">No logs found matching criteria.</div>}
            </div>
        </div>
    );

    if (embedded) return content;

    return (
        <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-[60] p-4 backdrop-blur-sm" onClick={onClose}>
            {content}
        </div>
    );
};