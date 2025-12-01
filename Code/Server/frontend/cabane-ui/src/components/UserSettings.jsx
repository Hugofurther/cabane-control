import React, { useState, useEffect } from 'react';
import { Settings, X, Volume2, BellOff, Smartphone } from 'lucide-react';

export const UserSettings = ({ isOpen, onClose }) => {
    // Load settings from LocalStorage or Default
    const [settings, setSettings] = useState(() => {
        const saved = localStorage.getItem('cabane_settings');
        return saved ? JSON.parse(saved) : {
            soundEnabled: true,
            vibrationEnabled: true,
            volume: 1.0
        };
    });

    useEffect(() => {
        localStorage.setItem('cabane_settings', JSON.stringify(settings));
        // Dispatch event so App.jsx picks up changes immediately
        window.dispatchEvent(new Event('storage'));
    }, [settings]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
            <div className="bg-cabane-panel border border-gray-600 rounded-lg shadow-2xl w-full max-w-md overflow-hidden">

                <div className="flex justify-between items-center p-4 border-b border-gray-700 bg-gray-800">
                    <h2 className="text-xl font-bold text-gray-200 flex items-center gap-2">
                        <Settings size={20} /> Alarm Settings
                    </h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-white"><X size={24} /></button>
                </div>

                <div className="p-6 flex flex-col gap-6">

                    {/* Sound Toggle */}
                    <div className="flex justify-between items-center">
                        <div className="flex items-center gap-3">
                            <div className={`p-2 rounded-full ${settings.soundEnabled ? 'bg-green-900/50 text-green-400' : 'bg-gray-700 text-gray-500'}`}>
                                {settings.soundEnabled ? <Volume2 /> : <BellOff />}
                            </div>
                            <div>
                                <div className="font-bold text-gray-200">Audio Alarm</div>
                                <div className="text-xs text-gray-500">Play siren/chirp on this device</div>
                            </div>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                            <input type="checkbox" className="sr-only peer" checked={settings.soundEnabled}
                                onChange={e => setSettings({ ...settings, soundEnabled: e.target.checked })} />
                            <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                        </label>
                    </div>

                    {/* Vibration Toggle */}
                    <div className="flex justify-between items-center">
                        <div className="flex items-center gap-3">
                            <div className={`p-2 rounded-full ${settings.vibrationEnabled ? 'bg-purple-900/50 text-purple-400' : 'bg-gray-700 text-gray-500'}`}>
                                <Smartphone />
                            </div>
                            <div>
                                <div className="font-bold text-gray-200">Vibration</div>
                                <div className="text-xs text-gray-500">Vibrate device on alarm</div>
                            </div>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                            <input type="checkbox" className="sr-only peer" checked={settings.vibrationEnabled}
                                onChange={e => setSettings({ ...settings, vibrationEnabled: e.target.checked })} />
                            <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                        </label>
                    </div>

                </div>
            </div>
        </div>
    );
};