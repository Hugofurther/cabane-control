import React, { useState, useEffect, useRef } from 'react';
import { Settings, Shield, LogOut } from 'lucide-react'; // ✅ Import LogOut
import { SocketProvider, useSocket } from './contexts/SocketContext';
import { StationCard } from './components/StationCard';
import { UserSettings } from './components/UserSettings';
import { NotificationBanner } from './components/NotificationBanner';
import { AuthPage } from './components/AuthPage';
import { AdminPanel } from './components/AdminPanel';
import { PANEL_LAYOUT } from './config/stations';

const VACUUM_INDICES = [2, 3, 9, 14, 17];

function Dashboard() {
  const {
    systemState,
    takeControl,
    releaseToServer,
    releaseToCabane,
    logout, // ✅ Destructure logout
    isConnected,
    user
  } = useSocket();

  const canInteract = systemState.controller !== 'CABANE';

  const [showSettings, setShowSettings] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [notification, setNotification] = useState(null);

  const audioCtx = useRef(null);

  // --- HELPER: Find Alarm Source ---
  const getAlarmSources = () => {
    const { virtualSwitches, physicalSwitches, stationFeedback, controller } = systemState;
    const sources = [];

    const checkSwitch = (idx, fbSt, fbBit) => {
      const isSwitchOn = (controller === 'CABANE') ? !!physicalSwitches[idx] : !!virtualSwitches[idx];
      const isFeedbackOn = ((stationFeedback[fbSt] >> fbBit) & 1) === 0;
      return (isSwitchOn && !isFeedbackOn);
    };

    PANEL_LAYOUT.forEach(row => {
      row.cards.forEach(card => {
        card.controls.forEach(ctrl => {
          if (VACUUM_INDICES.includes(ctrl.idx)) {
            const st = ctrl.fb?.st;
            const bit = ctrl.fb?.bit;
            if (st !== undefined && bit !== undefined) {
              if (checkSwitch(ctrl.idx, st, bit)) {
                sources.push(`${card.name} - ${ctrl.label.replace('\n', ' ')}`);
              }
            }
          }
        });
      });
    });
    return sources;
  };

  // --- AUDIO SYNTHESIZER ---
  const playTone = (type) => {
    const savedSettings = localStorage.getItem('cabane_settings');
    const settings = savedSettings ? JSON.parse(savedSettings) : { soundEnabled: true, vibrationEnabled: true };

    if (settings.vibrationEnabled && navigator.vibrate) {
      navigator.vibrate(type === 'SIREN' ? [500, 200, 500] : 100);
    }

    if (!settings.soundEnabled) return;

    if (!audioCtx.current) audioCtx.current = new (window.AudioContext || window.webkitAudioContext)();

    const osc = audioCtx.current.createOscillator();
    const gain = audioCtx.current.createGain();

    osc.connect(gain);
    gain.connect(audioCtx.current.destination);
    const now = audioCtx.current.currentTime;

    if (type === 'SIREN') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.linearRampToValueAtTime(880, now + 0.5);
      gain.gain.setValueAtTime(0.1, now);
      gain.gain.linearRampToValueAtTime(0, now + 1.0);
      osc.start(now);
      osc.stop(now + 1.0);
    } else if (type === 'CHIRP') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(2000, now);
      osc.frequency.exponentialRampToValueAtTime(1000, now + 0.1);
      gain.gain.setValueAtTime(0.05, now);
      gain.gain.linearRampToValueAtTime(0, now + 0.15);
      osc.start(now);
      osc.stop(now + 0.15);
    }
  };

  // --- EFFECTS ---
  useEffect(() => {
    const status = systemState.buzzerStatus;
    if (status === 'SIREN') {
      playTone('SIREN');
      const interval = setInterval(() => playTone('SIREN'), 1500);
      return () => clearInterval(interval);
    } else if (status === 'CHIRP') {
      playTone('CHIRP');
    }
  }, [systemState.buzzerStatus]);

  useEffect(() => {
    if (!systemState.globalVacuumAlarm) {
      setNotification(prev => (prev?.type === 'ALARM' ? null : prev));
    }
    if (systemState.buzzerEnabled) {
      setNotification(prev => (prev?.type === 'INFO' ? null : prev));
    }
    if (systemState.buzzerStatus === 'SIREN') {
      const culprits = getAlarmSources();
      const msg = culprits.length > 0
        ? `VACUUM LOSS DETECTED:\n${culprits.join('\n')}`
        : "VACUUM SYSTEM ALARM";
      setNotification({ type: 'ALARM', message: msg });
    }
    if (systemState.buzzerStatus === 'CHIRP') {
      setNotification({
        type: 'INFO',
        message: "System is Active but Buzzer is MUTED.\nPlease enable the Buzzer switch."
      });
    }
  }, [systemState.globalVacuumAlarm, systemState.buzzerStatus, systemState.buzzerEnabled]);

  // --- RENDER ---
  return (
    <div className="min-h-screen bg-cabane-dark text-white p-4 md:p-8 pt-20">

      {notification && (
        <NotificationBanner
          type={notification.type}
          message={notification.message}
          onDismiss={() => setNotification(null)}
        />
      )}

      {/* HEADER */}
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
          {/* Admin Button */}
          {user?.role === 'ADMIN' && (
            <button
              onClick={() => setShowAdmin(true)}
              className="p-3 rounded bg-gray-700 hover:bg-blue-900 text-blue-400 hover:text-white transition-colors border border-blue-900/30"
              title="User Management"
            >
              <Shield size={20} />
            </button>
          )}

          {/* Settings Button */}
          <button
            onClick={() => setShowSettings(true)}
            className="p-3 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors"
            title="Settings"
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

          {/* Logout Button */}
          <button
            onClick={logout}
            className="p-3 rounded bg-gray-700 hover:bg-red-900/50 text-gray-300 hover:text-red-400 transition-colors border border-transparent hover:border-red-900/30"
            title="Log Out"
          >
            <LogOut size={20} />
          </button>
        </div>
      </div>

      {/* GRID */}
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

      {/* MODALS */}
      <UserSettings isOpen={showSettings} onClose={() => setShowSettings(false)} />
      <AdminPanel isOpen={showAdmin} onClose={() => setShowAdmin(false)} />
    </div>
  );
}

// --- SPLASH & LAYOUT ---
const SplashScreen = () => (
  <div className="min-h-screen bg-cabane-dark flex items-center justify-center">
    <div className="flex flex-col items-center gap-4">
      <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
      <h2 className="text-gray-400 font-mono tracking-widest animate-pulse">CONNECTING...</h2>
    </div>
  </div>
);

const MainLayout = () => {
  const { user, authLoading } = useSocket();
  if (authLoading) return <SplashScreen />;
  if (!user) return <AuthPage />;
  return <Dashboard />;
};

export default function App() {
  return (
    <SocketProvider>
      <MainLayout />
    </SocketProvider>
  );
}