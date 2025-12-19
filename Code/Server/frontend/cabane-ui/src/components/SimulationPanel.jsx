import React, { useState, useEffect } from 'react';
import { Settings, Link, Unlink, X, Cpu, Power, Save, ToggleLeft, ToggleRight, Wifi, WifiOff, Eye, EyeOff } from 'lucide-react';
import axios from 'axios';
import { clsx } from 'clsx';
import { useSocket } from '../contexts/SocketContext';

const API_URL = import.meta.env.PROD ? '' : (import.meta.env.VITE_API_URL || 'http://localhost:3000');

const SimToggle = ({ checked, onChange, disabled }) => (
    <div onClick={() => !disabled && onChange(!checked)} className={clsx("w-8 h-4 rounded-full p-0.5 cursor-pointer transition-colors relative", disabled ? "opacity-50 cursor-not-allowed bg-gray-700" : (checked ? "bg-green-500" : "bg-gray-600"))}>
        <div className={clsx("w-3 h-3 bg-white rounded-full shadow-sm transform transition-transform", checked ? "translate-x-4" : "translate-x-0")} />
    </div>
);

export const SimulationPanel = ({ isOpen, onClose }) => {
    const { socket, takeControl } = useSocket(); // ✅ Get takeControl
    const [simData, setSimData] = useState(null);
    const [tempName, setTempName] = useState("");
    const [editing, setEditing] = useState(null);

    useEffect(() => { if (isOpen) fetchStatus(); }, [isOpen]);

    useEffect(() => {
        if (!socket || !isOpen) return;
        const handleStatus = (data) => setSimData(data);
        const handleUpdate = (update) => {
            setSimData(prev => {
                if (!prev) return null;
                const newState = [...prev.state];
                newState[update.id] = { ...newState[update.id], ...update };
                return { ...prev, state: newState };
            });
        };
        socket.on('SIM_STATUS', handleStatus);
        socket.on('SIM_UPDATE', handleUpdate);
        return () => { socket.off('SIM_STATUS', handleStatus); socket.off('SIM_UPDATE', handleUpdate); };
    }, [socket, isOpen]);

    const fetchStatus = async () => {
        const token = localStorage.getItem('cabane_token');
        try { const res = await axios.get(`${API_URL}/api/simulation/status`, { headers: { Authorization: `Bearer ${token}` } }); setSimData(res.data); } catch (e) { }
    };

    if (!isOpen || !simData) return null;
    const token = localStorage.getItem('cabane_token');
    const { active, config, state } = simData;

    const toggleGlobal = async () => {
        // ✅ NEW: Automatically take control if starting simulation
        if (!active) {
            takeControl();
        }

        await axios.post(`${API_URL}/api/simulation/toggle`, { active: !active }, { headers: { Authorization: `Bearer ${token}` } });
    };

    const toggleConnection = async (id) => { await axios.post(`${API_URL}/api/simulation/station/connection`, { id }, { headers: { Authorization: `Bearer ${token}` } }); };

    const updateRelay = async (stId, rIdx, updates) => {
        const newConfig = [...config];
        Object.assign(newConfig[stId].relays[rIdx], updates);
        setSimData(prev => ({ ...prev, config: newConfig }));
        await axios.post(`${API_URL}/api/simulation/relay/config`, { id: stId, bit: rIdx, updates }, { headers: { Authorization: `Bearer ${token}` } });
    };

    const toggleManualInput = async (stId, bit) => { await axios.post(`${API_URL}/api/simulation/input/toggle`, { id: stId, bit }, { headers: { Authorization: `Bearer ${token}` } }); };
    const saveName = (stId, rIdx) => { if (tempName.trim()) updateRelay(stId, rIdx, { name: tempName }); setEditing(null); };

    return (
        <div className="fixed inset-0 bg-black/95 z-[80] overflow-y-auto p-4 animate-in fade-in flex justify-center">
            <div className="w-full max-w-[1400px] space-y-6 pb-20">
                <div className="flex justify-between items-center border-b border-gray-700 pb-4 bg-gray-900 sticky top-0 z-20 p-4 rounded-lg shadow-xl">
                    <div className="flex items-center gap-4">
                        <Cpu size={32} className={active ? "text-green-500" : "text-gray-500"} />
                        <div><h2 className="text-2xl font-black text-white tracking-widest">HARDWARE SIMULATOR</h2><div className="flex gap-2 text-xs"><span className="text-gray-400">Mode: {active ? <span className="text-green-400 font-bold">ACTIVE (Isolated)</span> : "DISABLED"}</span></div></div>
                    </div>
                    <div className="flex items-center gap-4">
                        <button onClick={toggleGlobal} className={`px-6 py-2 rounded font-bold flex items-center gap-2 ${active ? 'bg-red-600 hover:bg-red-500 text-white' : 'bg-green-600 hover:bg-green-500 text-white'}`}><Power size={18} /> {active ? "STOP SIMULATION" : "START SIMULATION"}</button>
                        <button onClick={onClose} className="p-2 bg-gray-800 hover:bg-gray-700 rounded-full text-white"><X /></button>
                    </div>
                </div>

                <div className={`grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6 ${!active ? 'opacity-40 pointer-events-none grayscale' : ''}`}>
                    {config.map((stConfig, stIdx) => {
                        const stState = state[stIdx];
                        const isConnected = stState.connected;
                        return (
                            <div key={stIdx} className={`bg-gray-800 border rounded-xl overflow-hidden shadow-xl flex flex-col transition-opacity ${isConnected ? 'border-gray-700' : 'border-red-900/50 opacity-75'}`}>
                                <div className="bg-gray-900 p-3 border-b border-gray-700 flex justify-between items-center">
                                    <div className="flex items-center gap-2"><h3 className="font-bold text-gray-200">STATION {stIdx}</h3>{!isConnected && <span className="text-[10px] bg-red-900 text-red-200 px-1 rounded">OFFLINE</span>}</div>
                                    <button onClick={() => toggleConnection(stIdx)} className={`p-1.5 rounded ${isConnected ? 'text-green-500 hover:bg-green-900/20' : 'text-red-500 hover:bg-red-900/20'}`} title="Toggle Connection">{isConnected ? <Wifi size={18} /> : <WifiOff size={18} />}</button>
                                </div>
                                <div className="p-0 overflow-x-auto">
                                    <table className="w-full text-left text-xs">
                                        <thead className="bg-gray-900/50 text-gray-500 font-mono uppercase"><tr><th className="p-2 w-8">#</th><th className="p-2 w-8">En</th><th className="p-2">Device Name</th><th className="p-2 w-32">Feedback Src</th><th className="p-2 w-8 text-center">Link</th><th className="p-2 w-10 text-center">Sim</th></tr></thead>
                                        <tbody className="divide-y divide-gray-700">
                                            {stConfig.relays.map((r, rIdx) => {
                                                const relayOn = (stState.relayMask >> rIdx) & 1;
                                                const targetInputState = state[r.targetSt] || { inputMask: 0xFF };
                                                const inputOff = (targetInputState.inputMask >> r.targetBit) & 1;
                                                const inputActive = !inputOff;
                                                const isEditing = editing?.stId === stIdx && editing?.rIdx === rIdx;
                                                const isEn = r.enabled !== false;

                                                return (
                                                    <tr key={rIdx} className={`transition-colors ${!isEn ? 'opacity-30' : (relayOn ? 'bg-blue-900/10' : 'hover:bg-gray-700/30')}`}>
                                                        <td className="p-2 font-mono text-gray-500 flex items-center gap-1">{rIdx + 1}<div className={`w-2 h-2 rounded-full ${relayOn ? 'bg-green-400 shadow-[0_0_5px_lime]' : 'bg-gray-700'}`} /></td>
                                                        <td className="p-2">
                                                            <button onClick={() => updateRelay(stIdx, rIdx, { enabled: !isEn })} className={isEn ? "text-green-400" : "text-gray-600"}>{isEn ? <Eye size={14} /> : <EyeOff size={14} />}</button>
                                                        </td>
                                                        <td className="p-2" onClick={() => isEn && (setEditing({ stId: stIdx, rIdx }), setTempName(r.name))}>
                                                            {isEditing ? (
                                                                <input autoFocus className="bg-black text-white w-full border border-blue-500 rounded px-1" value={tempName} onChange={e => setTempName(e.target.value)} onBlur={() => saveName(stIdx, rIdx)} onKeyDown={e => e.key === 'Enter' && saveName(stIdx, rIdx)} />
                                                            ) : (<span className={relayOn ? "text-white font-bold" : "text-gray-400"}>{r.name}</span>)}
                                                        </td>
                                                        <td className="p-2">
                                                            <div className="flex gap-1">
                                                                <select disabled={!isEn} className="bg-gray-800 text-white border border-gray-600 rounded text-[10px] w-12 disabled:opacity-50" value={r.targetSt} onChange={(e) => updateRelay(stIdx, rIdx, { targetSt: parseInt(e.target.value) })}>{[0, 1, 2, 3, 4, 5].map(i => <option key={i} value={i}>ST{i}</option>)}</select>
                                                                <select disabled={!isEn} className="bg-gray-800 text-white border border-gray-600 rounded text-[10px] w-12 disabled:opacity-50" value={r.targetBit} onChange={(e) => updateRelay(stIdx, rIdx, { targetBit: parseInt(e.target.value) })}>{[0, 1, 2, 3, 4, 5, 6].map(i => <option key={i} value={i}>IN{i + 1}</option>)}</select>
                                                            </div>
                                                        </td>
                                                        <td className="p-2 text-center"><button disabled={!isEn} onClick={() => updateRelay(stIdx, rIdx, { linked: !r.linked })}>{r.linked ? <Link size={14} className="text-blue-400" /> : <Unlink size={14} className="text-gray-600" />}</button></td>
                                                        <td className="p-2 flex justify-center"><SimToggle checked={inputActive} disabled={r.linked || !isConnected} onChange={() => toggleManualInput(r.targetSt, r.targetBit)} /></td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};