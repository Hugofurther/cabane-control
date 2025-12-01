import React, { useState, useEffect, useRef } from 'react';
import { Settings } from 'lucide-react';
import { SocketProvider, useSocket } from './contexts/SocketContext';
import { StationCard } from './components/StationCard';
import { UserSettings } from './components/UserSettings';
import { NotificationBanner } from './components/NotificationBanner';
import { PANEL_LAYOUT } from './config/stations';

const VACUUM_INDICES = [2, 3, 9, 14, 17];

function Dashboard() {
  const {
    systemState,
    takeControl,
    releaseToServer,
    releaseToCabane,
    isConnected,
    user
  } = useSocket();

  const canInteract = systemState.controller !== 'CABANE';
  const [showSettings, setShowSettings] = useState(false);
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

  // --- EFFECT 1: AUDIO LOOP (Purely Sound) ---
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

  // --- EFFECT 2: NOTIFICATIONS (Visuals + Auto Dismiss) ---
  useEffect(() => {
    // 1. Auto-Dismiss ALARM if condition cleared
    if (!systemState.globalVacuumAlarm) {
      setNotification(prev => (prev?.type === 'ALARM' ? null : prev));
    }

    // 2. Auto-Dismiss REMINDER if Buzzer enabled
    if (systemState.buzzerEnabled) {
      setNotification(prev => (prev?.type === 'INFO' ? null : prev));
    }

    // 3. Trigger ALARM Banner
    if (systemState.buzzerStatus === 'SIREN') {
      const culprits = getAlarmSources();
      const msg = culprits.length > 0
        ? `VACUUM LOSS DETECTED:\n${culprits.join('\n')}`
        : "VACUUM SYSTEM ALARM";

      // Only set if not already set (prevents flickering if we wanted to be strict)
      // But setting it every cycle ensures it reappears if user closed it but didn't fix it.
      setNotification({ type: 'ALARM', message: msg });
    }

    // 4. Trigger REMINDER Banner
    if (systemState.buzzerStatus === 'CHIRP') {
      setNotification({
        type: 'INFO',
        message: "System is Active but Buzzer is MUTED.\nPlease enable the Buzzer switch."
      });
    }

  }, [systemState.globalVacuumAlarm, systemState.buzzerStatus, systemState.buzzerEnabled]);

  return (
    <div className="min-h-screen bg-cabane-dark text-white p-4 md:p-8 pt-20">

      {notification && (
        <NotificationBanner
          type={notification.type}
          message={notification.message}
          onDismiss={() => setNotification(null)}
        />
      )}

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
          <button onClick={() => setShowSettings(true)} className="p-3 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors">
            <Settings size={20} />
          </button>

          {systemState.currentUser !== user?.username && (
            <button onClick={takeControl} className="px-6 py-3 rounded bg-blue-600 hover:bg-blue-500 text-white font-bold uppercase shadow-lg shadow-blue-900/50 transition-all">
              Take Control
            </button>
          )}

          {systemState.controller === 'USER' && systemState.currentUser === user?.username && (
            <>
              <button onClick={releaseToServer} className="px-4 py-3 rounded bg-yellow-600 hover:bg-yellow-500 text-white font-bold uppercase shadow-lg transition-all">
                Release (Hold)
              </button>
              <button onClick={releaseToCabane} className="px-4 py-3 rounded bg-red-600 hover:bg-red-500 text-white font-bold uppercase shadow-lg transition-all">
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
              <StationCard key={i} card={card} isRemote={canInteract} />
            ))}
          </div>
        ))}
      </div>

      <UserSettings isOpen={showSettings} onClose={() => setShowSettings(false)} />
    </div>
  );
}

export default function App() {
  return (
    <SocketProvider>
      <Dashboard />
    </SocketProvider>
  );
}