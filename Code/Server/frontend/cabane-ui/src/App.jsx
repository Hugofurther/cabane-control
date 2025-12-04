import React, { useState, useEffect, useRef } from 'react';
import { Shield, LogOut, ScrollText, User, Settings, Mail, StickyNote, Activity } from 'lucide-react';
import axios from 'axios';
import { SocketProvider, useSocket } from './contexts/SocketContext';
import { StationCard } from './components/StationCard';
import { UserSettings } from './components/UserSettings';
import { NotificationBanner } from './components/NotificationBanner';
import { AuthPage } from './components/AuthPage';
import { AdminPanel } from './components/AdminPanel';
import { LogViewer } from './components/LogViewer';
import { MessageDrawer } from './components/MessageDrawer'; // NEW
import { Clock } from './components/Clock';
import { Weather } from './components/Weather';
import { PANEL_LAYOUT } from './config/stations';

const VACUUM_INDICES = [2, 3, 9, 14, 17];
const API_URL = import.meta.env.PROD ? '' : (import.meta.env.VITE_API_URL || 'http://localhost:3000');

function Dashboard() {
  const {
    socket, systemState, takeControl, releaseToServer, releaseToCabane, logout, isConnected, user
  } = useSocket();

  // Strict Logic: "Active Mode" only if I am the specific user driving
  const canInteract = systemState.controller === 'USER' &&
    systemState.currentUser === user?.username;

  // UI State
  const [showSettings, setShowSettings] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [showMessageDrawer, setShowMessageDrawer] = useState(false); // NEW
  const [notification, setNotification] = useState(null);

  // Message State
  const [unreadCount, setUnreadCount] = useState(0);
  const [hasNotes, setHasNotes] = useState(false);

  const audioCtx = useRef(null);

  // --- HELPER: Find Alarm Source ---
  const getAlarmSources = () => {
    const { virtualSwitches, physicalSwitches, stationFeedback, controller } = systemState;
    const sources = [];
    PANEL_LAYOUT.forEach(row => {
      row.cards.forEach(card => {
        card.controls.forEach(ctrl => {
          if (VACUUM_INDICES.includes(ctrl.idx)) {
            const st = ctrl.fb?.st;
            const bit = ctrl.fb?.bit;
            if (st !== undefined && bit !== undefined) {
              const isSwitchOn = (controller === 'CABANE') ? !!physicalSwitches[ctrl.idx] : !!virtualSwitches[ctrl.idx];
              const isFeedbackOn = ((stationFeedback[st] >> bit) & 1) === 0;
              if (isSwitchOn && !isFeedbackOn) {
                sources.push(`${card.name} - ${ctrl.label.replace('\n', ' ')}`);
              }
            }
          }
        });
      });
    });
    return sources;
  };

  // --- AUDIO LOGIC ---
  const playTone = (type) => {
    const saved = localStorage.getItem('cabane_settings');
    const s = saved ? JSON.parse(saved) : { soundEnabled: true, vibrationEnabled: true };

    if (s.vibrationEnabled && navigator.vibrate) {
      navigator.vibrate(type === 'SIREN' ? [500, 200, 500] : 100);
    }
    if (!s.soundEnabled) return;
    if (!audioCtx.current) audioCtx.current = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.current.createOscillator();
    const gain = audioCtx.current.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.current.destination);
    const now = audioCtx.current.currentTime;

    if (type === 'SIREN') {
      osc.type = 'sawtooth'; osc.frequency.setValueAtTime(440, now);
      osc.frequency.linearRampToValueAtTime(880, now + 0.5); gain.gain.setValueAtTime(0.1, now);
      osc.start(now); osc.stop(now + 1.0);
    } else {
      osc.type = 'sine'; osc.frequency.setValueAtTime(2000, now);
      gain.gain.setValueAtTime(0.05, now); osc.start(now); osc.stop(now + 0.15);
    }
  };

  const wakeAudio = () => {
    if (audioCtx.current && audioCtx.current.state === 'suspended') audioCtx.current.resume();
  };

  // --- EFFECT: SOCKET MESSAGE LISTENER ---
  useEffect(() => {
    if (!socket) return;

    const handleNewMessage = (msg) => {
      // Logic to handle notification for Urgent Messages
      // Only trigger if it's NOT from me and it IS Urgent
      if (msg.sender_id !== user?.id && msg.priority === 'URGENT') {
        // Trigger Popup
        setNotification({
          type: 'INFO', // Or 'ALARM' colour if you prefer
          message: `URGENT MESSAGE from ${msg.sender}:\n${msg.content}`
        });

        playTone('CHIRP'); // Sound alert

        // Auto-Dismiss Logic
        const dismissTime = user?.settings?.msgDismissTime || 0;
        if (dismissTime > 0) {
          setTimeout(() => setNotification(null), dismissTime * 1000);
        }
      }
      // The unreadCount is updated by the Drawer's internal polling via handleUnreadChange
      // OR we could increment here, but Drawer sync is safer.
    };

    socket.on('NEW_MESSAGE', handleNewMessage);
    return () => socket.off('NEW_MESSAGE', handleNewMessage);
  }, [socket, user]);

  // --- EFFECT: BUZZER ---
  useEffect(() => {
    if (systemState.buzzerStatus === 'SIREN') {
      playTone('SIREN');
      const i = setInterval(() => playTone('SIREN'), 1500);
      return () => clearInterval(i);
    } else if (systemState.buzzerStatus === 'CHIRP') playTone('CHIRP');
  }, [systemState.buzzerStatus]);

  // --- EFFECT: SYSTEM NOTIFICATIONS ---
  useEffect(() => {
    if (!systemState.globalVacuumAlarm) setNotification(prev => (prev?.type === 'ALARM' ? null : prev));
    if (systemState.buzzerEnabled) setNotification(prev => (prev?.message.includes("Buzzer MUTED") ? null : prev));

    if (systemState.buzzerStatus === 'SIREN') {
      const culprits = getAlarmSources();
      setNotification({ type: 'ALARM', message: culprits.length ? `VACUUM LOSS:\n${culprits.join('\n')}` : "VACUUM ALARM" });
    }
    if (systemState.buzzerStatus === 'CHIRP') {
      setNotification({ type: 'INFO', message: "System Active but Buzzer MUTED." });
    }
  }, [systemState.globalVacuumAlarm, systemState.buzzerStatus, systemState.buzzerEnabled]);

  // Callback from MessageDrawer to update header icons
  const handleUnreadChange = (unread, notes) => {
    setUnreadCount(unread);
    if (notes !== null) setHasNotes(notes > 0);
  };

  // --- RENDER ---
  return (
    <div className="min-h-screen bg-cabane-dark text-white p-4 md:p-8 pt-20" onClick={wakeAudio} onTouchStart={wakeAudio}>

      {notification && <NotificationBanner type={notification.type} message={notification.message} onDismiss={() => setNotification(null)} />}

      {/* Header */}
      <div className="flex flex-col xl:flex-row justify-between items-center mb-10 border-b border-gray-700 pb-6 gap-6">

        <div className="flex flex-col gap-1 items-center xl:items-start min-w-[250px]">
          <h1 className="text-3xl font-black tracking-widest text-gray-100 leading-none mb-1">CABANE CONTROL</h1>

          <div className="flex items-center gap-3 text-xs font-bold tracking-wider uppercase">
            {user?.settings?.showMainStatus && (
              <>
                <div className={`flex items-center gap-1 ${systemState.mainControllerOnline ? 'text-green-400' : 'text-red-500 animate-pulse'}`}>
                  <Activity size={12} /> {systemState.mainControllerOnline ? "CABANE ONLINE" : "CABANE OFFLINE"}
                </div>
                <span className="text-gray-700">|</span>
              </>
            )}
            <div className="flex items-center gap-2 text-gray-400">
              <span className={`w-2 h-2 rounded-full shadow ${isConnected ? 'bg-green-500 shadow-green-500/50' : 'bg-red-500 shadow-red-500/50'}`}></span>
              <span>{isConnected ? "USER ONLINE" : "CONNECTING..."}</span>
            </div>
          </div>
          <div className={`font-mono font-bold text-sm mt-1 ${systemState.controller === 'CABANE' ? 'text-yellow-500' : 'text-blue-400'}`}>
            MASTER: {systemState.controller === 'USER' ? (systemState.currentUser || 'USER') : systemState.controller}
          </div>
        </div>

        <div className="flex-grow flex flex-col items-center justify-center gap-2"><Clock /><Weather /></div>

        <div className="flex gap-3 items-center min-w-[250px] justify-end">
          {user?.role === 'ADMIN' && <button onClick={() => setShowAdmin(true)} className="p-3 rounded bg-gray-700 hover:bg-blue-900 text-blue-400 hover:text-white transition-colors border border-blue-900/30" title="Admin"><Shield size={20} /></button>}
          {(user?.can_view_logs || user?.role === 'ADMIN') && <button onClick={() => setShowLogs(true)} className="p-3 rounded bg-gray-700 hover:bg-gray-600 text-yellow-500 transition-colors" title="Logs"><ScrollText size={20} /></button>}

          {/* MESSAGING BUTTON */}
          <button
            onClick={() => setShowMessageDrawer(true)}
            className={`p-3 rounded transition-colors relative ${unreadCount > 0 ? 'bg-red-900/50 text-red-400 animate-pulse border border-red-500' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
            title="Messages"
          >
            <Mail size={20} />
            {unreadCount > 0 && <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-600 rounded-full text-[10px] flex items-center justify-center text-white font-bold">{unreadCount}</span>}
          </button>

          {/* NOTE INDICATOR */}
          {hasNotes && <div className="text-yellow-400 animate-pulse" title="You have reminders"><StickyNote size={20} /></div>}

          {systemState.currentUser !== user?.username && (
            user?.can_control ?
              <button onClick={takeControl} className="px-6 py-3 rounded bg-blue-600 hover:bg-blue-500 text-white font-bold uppercase shadow-lg shadow-blue-900/50 transition-all whitespace-nowrap">Take Control</button>
              : <div className="px-4 py-3 rounded bg-gray-800 text-gray-500 font-bold text-xs uppercase border border-gray-700 cursor-not-allowed whitespace-nowrap">View Only</div>
          )}

          {systemState.controller === 'USER' && systemState.currentUser === user?.username && (
            <div className="flex gap-2">
              <button onClick={releaseToServer} className="px-4 py-3 rounded bg-yellow-600 hover:bg-yellow-500 text-white font-bold uppercase shadow-lg transition-all whitespace-nowrap">Hold</button>
              <button onClick={releaseToCabane} className="px-4 py-3 rounded bg-red-600 hover:bg-red-500 text-white font-bold uppercase shadow-lg transition-all whitespace-nowrap">Release</button>
            </div>
          )}

          <div className="flex items-center gap-0 bg-gray-800 rounded-lg border border-gray-700 ml-2 overflow-hidden group hover:border-gray-500">
            <button onClick={() => setShowSettings(true)} className="px-4 py-3 text-xs text-gray-300 font-bold border-r border-gray-700 flex items-center gap-2 hover:bg-gray-700 hover:text-white transition-colors" title="Settings"><User size={16} className="text-blue-400" /> {user?.username || "GUEST"}</button>
            <button onClick={logout} className="p-3 hover:bg-red-900/50 text-gray-400 hover:text-red-400 transition-colors" title="Logout"><LogOut size={18} /></button>
          </div>
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
                isRemote={canInteract} // <--- This now carries the strict logic
              />
            ))}
          </div>
        ))}
      </div>

      {/* MODALS */}
      <UserSettings isOpen={showSettings} onClose={() => setShowSettings(false)} />
      <AdminPanel isOpen={showAdmin} onClose={() => setShowAdmin(false)} />
      <LogViewer isOpen={showLogs} onClose={() => setShowLogs(false)} />
      <MessageDrawer isOpen={showMessageDrawer} onClose={() => setShowMessageDrawer(false)} onUnreadChange={handleUnreadChange} />
    </div>
  );
}

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
  return (<SocketProvider> <MainLayout /> </SocketProvider>);
}