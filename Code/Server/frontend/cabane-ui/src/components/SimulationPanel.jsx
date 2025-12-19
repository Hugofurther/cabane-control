import React, { useState, useEffect } from 'react';
import { Settings, ToggleLeft, ToggleRight, X, Activity, Cpu } from 'lucide-react';
import axios from 'axios';
import { useSocket } from '../contexts/SocketContext';
import { useModal } from '../contexts/ModalContext';

const API_URL = import.meta.env.PROD ? '' : (import.meta.env.VITE_API_URL || 'http://localhost:3000');

export const SimulationPanel = ({ isOpen, onClose }) => {
    const { socket } = useSocket();
    const { showAlert } = useModal();
    const [simState, setSimState] = useState(null);

    // Poll for status
    useEffect(() => {
        if (!isOpen) return;
        const fetch = async () => {
            const token = localStorage.getItem('cabane_token');
            try {
                const res = await axios.get(`${API_URL}/api/simulation/status`, { headers: { Authorization: `Bearer ${token}` } });
                setSimState(res.data);
            } catch (e) { }
        };
        fetch();
        const timer = setInterval(fetch, 500); // Polling is fine for test tools
        return () => clearInterval(timer);
    }, [isOpen]);

    if (!isOpen || !simState) return null;

    const token = localStorage.getItem('cabane_token');

    const toggleAuto = async (id, currentVal) => {
        await axios.post(`${API_URL}/api/simulation/station/auto`, { id, auto: !currentVal }, { headers: { Authorization: `Bearer ${token}` } });
    };

    const toggleInput = async (id, bit, currentVal) => {
        // currentVal is bit state: 0=ON, 1=OFF.
        // We want to set it to logical ON (true) or OFF (false)
        // If current bit is 0 (ON), we want to turn it OFF (false)
        const newValue = (currentVal === 1);
        await axios.post(`${API_URL}/api/simulation/station/input`, { id, bit, value: newValue }, { headers: { Authorization: `Bearer ${token}` } });
    };

    return (
        <div className="fixed inset-0 bg-black/90 z-[80] overflow-y-auto p-4 animate-in fade-in">
            <div className="max-w-6xl mx-auto space-y-6">

                {/* HEADER */}
                <div className="flex justify-between items-center border-b border-gray-700 pb-4">
                    <div className="flex items-center gap-4">
                        <Cpu size={32} className="text-purple-500" />
                        <div>
                            <h2 className="text-2xl font-black text-white tracking-widest">HARDWARE SIMULATOR</h2>
                            <p className="text-sm text-gray-400">Virtual Station Controllers</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 bg-gray-800 hover:bg-gray-700 rounded-full text-white"><X /></button>
                </div>

                {/* GLOBAL CONTROL */}
                {!simState.active && (
                    <div className="bg-red-900/20 border border-red-500/50 p-4 rounded-lg text-center">
                        <p className="text-red-300 font-bold mb-2">Simulation Mode is Disabled</p>
                        <button
                            onClick={async () => {
                                await axios.post(`${API_URL}/api/simulation/toggle`, { active: true }, { headers: { Authorization: `Bearer ${token}` } });
                            }}
                            className="bg-red-600 hover:bg-red-500 text-white px-6 py-2 rounded font-bold"
                        >
                            ENABLE SIMULATION
                        </button>
                    </div>
                )}

                {/* STATIONS GRID */}
                <div className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 ${!simState.active ? 'opacity-50 pointer-events-none' : ''}`}>
                    {simState.stations.map((st) => (
                        <div key={st.id} className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden shadow-xl">
                            {/* Station Header */}
                            <div className="bg-gray-900 p-3 border-b border-gray-700 flex justify-between items-center">
                                <h3 className="font-bold text-gray-200">STATION {st.id}</h3>
                                <button
                                    onClick={() => toggleAuto(st.id, st.auto)}
                                    className={`text-[10px] font-bold px-2 py-1 rounded border ${st.auto ? 'bg-blue-600 border-blue-500 text-white' : 'bg-gray-700 border-gray-600 text-gray-400'}`}
                                >
                                    AUTO FEEDBACK: {st.auto ? 'ON' : 'OFF'}
                                </button>
                            </div>

                            <div className="p-4 grid grid-cols-2 gap-4">
                                {/* RELAYS (Outputs) */}
                                <div>
                                    <p className="text-[10px] text-gray-500 uppercase font-bold mb-2">Relays (Commands)</p>
                                    <div className="space-y-2">
                                        {[0, 1, 2, 3, 4, 5, 6, 7].map(bit => {
                                            const isOn = (st.relays >> bit) & 1;
                                            return (
                                                <div key={bit} className="flex items-center gap-2">
                                                    <Settings
                                                        size={20}
                                                        className={`transition-all duration-500 ${isOn ? 'text-green-400 animate-spin' : 'text-gray-600'}`}
                                                    />
                                                    <span className={`text-xs ${isOn ? 'text-white' : 'text-gray-600'}`}>Relay {bit}</span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>

                                {/* INPUTS (Feedback) */}
                                <div>
                                    <p className="text-[10px] text-gray-500 uppercase font-bold mb-2">Inputs (Feedback)</p>
                                    <div className="space-y-2">
                                        {[0, 1, 2, 3, 4, 5, 6, 7].map(bit => {
                                            // 0 = Active/ON, 1 = Idle/OFF
                                            const rawBit = (st.inputs >> bit) & 1;
                                            const isActive = (rawBit === 0);

                                            return (
                                                <div
                                                    key={bit}
                                                    className={`flex items-center justify-between p-1.5 rounded border cursor-pointer ${isActive ? 'bg-green-900/30 border-green-600' : 'bg-gray-900/50 border-gray-700'}`}
                                                    onClick={() => !st.auto && toggleInput(st.id, bit, rawBit)}
                                                >
                                                    <span className={`text-xs font-mono ${isActive ? 'text-green-400' : 'text-gray-500'}`}>Input {bit}</span>
                                                    {isActive ? <ToggleRight size={18} className="text-green-400" /> : <ToggleLeft size={18} className="text-gray-600" />}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>

            </div>
        </div>
    );
};