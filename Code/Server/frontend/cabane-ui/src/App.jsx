import React, { useState, useEffect, useRef } from 'react';
import { Settings } from 'lucide-react';
import { SocketProvider, useSocket } from './contexts/SocketContext';
import { StationCard } from './components/StationCard';
import { UserSettings } from './components/UserSettings'; // New Component
import { PANEL_LAYOUT } from './config/stations';

function Dashboard() {
  // 1. Get Data from Context
  const {
    systemState,
    takeControl,
    releaseToServer,
    releaseToCabane,
    isConnected,
    user
  } = useSocket();

  // Logic: Am I driving?
  const canInteract = systemState.controller !== 'CABANE';

  // 2. Local State for Settings Modal
  const [showSettings, setShowSettings] = useState(false);

  // 3. Audio Logic Refs
  const audioCtx = useRef(null);

  // --- AUDIO SYNTHESIZER HELPER ---
  const playTone = (type) => {
    // Read settings from LocalStorage
    const savedSettings = localStorage.getItem('cabane_settings');
    const settings = savedSettings
      ? JSON.parse(savedSettings)
      : { soundEnabled: true, vibrationEnabled: true }; // Defaults

    // VIBRATION
    if (settings.vibrationEnabled && navigator.vibrate) {
      // Pattern: Siren = Pulse, Chirp = Short
      navigator.vibrate(type === 'SIREN' ? [500, 200, 500] : 100);
    }

    // AUDIO
    if (!settings.soundEnabled) return;

    // Initialize Audio Context (Browsers require this after user interaction)
    if (!audioCtx.current) {
      audioCtx.current = new (window.AudioContext || window.webkitAudioContext)();
    }

    // Create Oscillator (Sound Generator)
    const osc = audioCtx.current.createOscillator();
    const gain = audioCtx.current.createGain();

    osc.connect(gain);
    gain.connect(audioCtx.current.destination);

    const now = audioCtx.current.currentTime;

    if (type === 'SIREN') {
      // Alarm Sound: Sawtooth wave rising in pitch
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.linearRampToValueAtTime(880, now + 0.5);

      gain.gain.setValueAtTime(0.1, now);
      gain.gain.linearRampToValueAtTime(0, now + 1.0);

      osc.start(now);
      osc.stop(now + 1.0);
    }
    else if (type === 'CHIRP') {
      // Chirp Sound: High pitch sine beep
      osc.type = 'sine';
      osc.frequency.setValueAtTime(2000, now);
      osc.frequency.exponentialRampToValueAtTime(1000, now + 0.1);

      gain.gain.setValueAtTime(0.05, now);
      gain.gain.linearRampToValueAtTime(0, now + 0.15);

      osc.start(now);
      osc.stop(now + 0.15);
    }
  };

  // --- WATCHER: LISTEN FOR BUZZER STATUS CHANGES ---
  useEffect(() => {
    // The Pi Server calculates status: 'OFF', 'SIREN', or 'CHIRP'
    const status = systemState.buzzerStatus;

    if (status === 'SIREN') {
      // Loop the siren sound every 1.5 seconds while status is SIREN
      playTone('SIREN');
      const interval = setInterval(() => playTone('SIREN'), 1500);
      return () => clearInterval(interval);
    }
    else if (status === 'CHIRP') {
      // Play once
      playTone('CHIRP');
    }
  }, [systemState.buzzerStatus]);


  // --- RENDER ---
  return (
    <div className="min-h-screen bg-cabane-dark text-white p-4 md:p-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-center mb-8 border-b border-gray-700 pb-4 gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-widest text-gray-100">CABANE CONTROL</h1>
          <div className="flex items-center gap-3 text-sm mt-1">
            <span className={`w-3 h-3 rounded-full shadow ${isConnected ? 'bg-green-500 shadow-green-500/50' : 'bg-red-500 shadow-red-500/50'}`}></span>
            <span className="text-gray-400 uppercase tracking-wide">{isConnected ? "Online" : "Connecting..."}</span>
            <span className="text-gray-600">|</span>
            <span className={`font-mono font-bold ${systemState.controller === 'CABANE' ? 'text-yellow-500' : 'text-blue-400'}`}>
              MASTER: {systemState.controller}
              {systemState.currentUser ? ` (${systemState.currentUser})` : ''}
            </span>
          </div>
        </div>

        <div className="flex gap-3 items-center">
          {/* Settings Button */}
          <button
            onClick={() => setShowSettings(true)}
            className="p-3 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors"
            title="Alarm Settings"
          >
            <Settings size={20} />
          </button>

          {/* Control Buttons */}
          {systemState.currentUser !== user?.username && (
            <button
              onClick={takeControl}
              className="px-6 py-3 rounded bg-blue-600 hover:bg-blue-500 text-white font-bold uppercase shadow-lg shadow-blue-900/50 transition-all"
            >
              Take Control
            </button>
          )}

          {systemState.controller === 'USER' && systemState.currentUser === user?.username && (
            <>
              <button
                onClick={releaseToServer}
                className="px-4 py-3 rounded bg-yellow-600 hover:bg-yellow-500 text-white font-bold uppercase shadow-lg transition-all"
              >
                Release (Hold)
              </button>
              <button
                onClick={releaseToCabane}
                className="px-4 py-3 rounded bg-red-600 hover:bg-red-500 text-white font-bold uppercase shadow-lg transition-all"
              >
                To Cabane
              </button>
            </>
          )}
        </div>
      </div>

      {/* Main Grid */}
      <div className="flex flex-col gap-6 max-w-7xl mx-auto">
        {PANEL_LAYOUT.map((row) => (
          <div key={row.id} className={`grid gap-6 ${row.cols}`}>
            {row.cards.map((card, i) => (
              <StationCard
                key={i}
                card={card}
                isRemote={canInteract}
              />
            ))}
          </div>
        ))}
      </div>

      {/* Settings Modal */}
      <UserSettings isOpen={showSettings} onClose={() => setShowSettings(false)} />
    </div>
  );
}

// Wrapper
export default function App() {
  return (
    <SocketProvider>
      <Dashboard />
    </SocketProvider>
  );
}