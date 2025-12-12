import React, { useState, useEffect, useRef } from 'react';
import { Settings, Mail, StickyNote, Activity, LogOut } from 'lucide-react';
import axios from 'axios';
import { SocketProvider, useSocket } from './contexts/SocketContext';
import { StationCard } from './components/StationCard';
import { UserSettings } from './components/UserSettings';
import { NotificationBanner } from './components/NotificationBanner';
import { AuthPage } from './components/AuthPage';
import { MessageDrawer } from './components/MessageDrawer';
import { Clock } from './components/Clock';
import { Weather } from './components/Weather';
import { FlashViewer } from './components/FlashViewer';
import { PANEL_LAYOUT } from './config/stations';
import { ModalProvider } from './contexts/ModalContext';
import { GlobalModal } from './components/GlobalModal';

console.log("🚀 CABANE UI VERSION: 3.6 - WORKING ON NOTES");

const VACUUM_INDICES = [2, 3, 9, 14, 17];
const API_URL = import.meta.env.PROD ? '' : (import.meta.env.VITE_API_URL || 'http://localhost:3000');

function Dashboard() {
  const {
    socket, systemState, takeControl, releaseToServer, releaseToCabane, logout, isConnected, user
  } = useSocket();

  const canInteract = systemState.controller === 'USER' &&
    systemState.currentUser === user?.username;

  // UI State
  const [showSettings, setShowSettings] = useState(false);
  const [showMessageDrawer, setShowMessageDrawer] = useState(false);

  const [notification, setNotification] = useState(null);
  const [flashMessages, setFlashMessages] = useState([]);

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

              // Only trigger if commanded ON but feedback OFF
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

  // --- FLASH MESSAGE LOGIC ---
  const checkFlashMessages = async () => {
    if (!user) return 0;
    const token = localStorage.getItem('cabane_token');
    try {
      const res = await axios.get(`${API_URL}/api/messages`, { headers: { Authorization: `Bearer ${token}` } });
      const msgs = res.data;

      const urgentUnacked = msgs.filter(m =>
        m.priority === 'URGENT' &&
        m.is_ack_by_me === 0 &&
        String(m.sender_id) !== String(user.id)
      );

      setFlashMessages(urgentUnacked);
      return urgentUnacked.length;
    } catch (e) { return 0; }
  };

  const handleDismissFlash = async (msgId) => {
    setFlashMessages(prev => prev.filter(m => m.id !== msgId));
    const token = localStorage.getItem('cabane_token');
    try {
      await axios.post(`${API_URL}/api/messages/downgrade`, { messageId: msgId }, { headers: { Authorization: `Bearer ${token}` } });
      await axios.post(`${API_URL}/api/messages/read`, { messageIds: [msgId] }, { headers: { Authorization: `Bearer ${token}` } });
    } catch (e) { console.error(e); }
  };

  // Poll for Flash Messages
  useEffect(() => {
    if (!socket) return;

    const handleNewMessage = (msg) => {
      if (msg.recipient_id && String(msg.recipient_id) !== String(user?.id)) return;

      if (msg.priority === 'URGENT' && String(msg.sender_id) !== String(user?.id)) {
        // ✅ CHECK SETTING: Default to true if undefined
        const soundOn = user?.settings?.flashSoundEnabled !== false;

        checkFlashMessages().then((count) => {
          if (count > 0 && soundOn) playTone('CHIRP');
        });
      }
    };


    const handleUpdateMessage = (data) => {
      if (data.priority === 'NORMAL') {
        setFlashMessages(prev => prev.filter(m => m.id !== data.id));
      }
    };

    socket.on('NEW_MESSAGE', handleNewMessage);
    socket.on('UPDATE_MESSAGE', handleUpdateMessage);

    return () => {
      socket.off('NEW_MESSAGE', handleNewMessage);
      socket.off('UPDATE_MESSAGE', handleUpdateMessage);
    };
  }, [socket, user]);

  // --- EFFECT: BUZZER & ALARMS ---
  useEffect(() => {
    if (systemState.buzzerStatus === 'SIREN') {
      playTone('SIREN');
      const i = setInterval(() => playTone('SIREN'), 1500);
      return () => clearInterval(i);
    } else if (systemState.buzzerStatus === 'CHIRP') playTone('CHIRP');
  }, [systemState.buzzerStatus]);

  useEffect(() => {
    if (!systemState.globalVacuumAlarm) setNotification(prev => (prev?.type === 'ALARM' ? null : prev));
    if (systemState.buzzerEnabled) setNotification(prev => (prev?.type === 'INFO' ? null : prev));

    if (systemState.buzzerStatus === 'SIREN') {
      const culprits = getAlarmSources();
      setNotification({ type: 'ALARM', message: culprits.length ? `VACUUM LOSS:\n${culprits.join('\n')}` : "VACUUM ALARM" });
    }
    if (systemState.buzzerStatus === 'CHIRP') {
      setNotification({ type: 'INFO', message: "System Active but Buzzer MUTED." });
    }
  }, [systemState.globalVacuumAlarm, systemState.buzzerStatus, systemState.buzzerEnabled]);

  const handleUnreadChange = (unread, notes) => {
    setUnreadCount(unread);
    if (notes !== null) setHasNotes(notes > 0);
  };

  // --- RENDER ---
  return (
    <div className="min-h-screen bg-cabane-dark text-white p-4 md:p-8 pt-20" onClick={wakeAudio} onTouchStart={wakeAudio}>

      {notification && <NotificationBanner type={notification.type} message={notification.message} onDismiss={() => setNotification(null)} />}

      {flashMessages.length > 0 && (
        <FlashViewer
          messages={flashMessages}
          onDismiss={handleDismissFlash}
          onClose={() => setFlashMessages([])}
        />
      )}

      {/* HEADER */}
      <div className="flex flex-col xl:flex-row justify-between items-center mb-10 border-b border-gray-700 pb-6 gap-6">

        {/* LEFT: Status */}
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

        {/* CENTER: Clock & Weather */}
        <div className="flex-grow flex flex-col items-center justify-center gap-2">
          <Clock />
          <Weather />
        </div>

        {/* RIGHT: Actions */}
        <div className="flex gap-3 items-center min-w-[250px] justify-end">

          {/* Messages */}
          <button
            onClick={() => setShowMessageDrawer(true)}
            className={`p-3 rounded transition-colors relative ${unreadCount > 0 ? 'bg-red-900/50 text-red-400 animate-pulse border border-red-500' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
            title="Messages"
          >
            <Mail size={20} />
            {unreadCount > 0 && <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-600 rounded-full text-[10px] flex items-center justify-center text-white font-bold">{unreadCount}</span>}
          </button>

          {hasNotes && <div className="text-yellow-400 animate-pulse" title="You have reminders"><StickyNote size={20} /></div>}

          {/* Controls */}
          {systemState.currentUser !== user?.username && (
            user?.can_control ?
              <button onClick={takeControl} className="px-6 py-3 rounded bg-blue-600 hover:bg-blue-500 text-white font-bold uppercase shadow-lg shadow-blue-900/50 transition-all whitespace-nowrap">Take Control</button>
              : <div className="px-4 py-3 rounded bg-gray-800 text-gray-500 font-bold text-xs uppercase border border-gray-700 cursor-not-allowed whitespace-nowrap">View Only</div>
          )}

          {systemState.controller === 'USER' && systemState.currentUser === user?.username && (
            <div className="flex gap-2">
              <button onClick={releaseToServer} className="px-4 py-3 rounded bg-yellow-600 hover:bg-yellow-500 text-white font-bold uppercase shadow-lg transition-all whitespace-nowrap">Hold</button>

              {/* Hide release button if physical master is offline to prevent accidents */}
              {systemState.mainControllerOnline && (
                <button onClick={releaseToCabane} className="px-4 py-3 rounded bg-red-600 hover:bg-red-500 text-white font-bold uppercase shadow-lg transition-all whitespace-nowrap">Release</button>
              )}
            </div>
          )}

          {/* User Settings (Mega Menu) */}
          <div className="flex items-center gap-0 bg-gray-800 rounded-lg border border-gray-700 ml-2 overflow-hidden group hover:border-gray-500">
            <button onClick={() => setShowSettings(true)} className="px-4 py-3 text-xs text-gray-300 font-bold border-r border-gray-700 flex items-center gap-2 hover:bg-gray-700 hover:text-white transition-colors" title="Settings">
              <Settings size={16} className="text-blue-400" /> {user?.username || "GUEST"}
            </button>
            <button onClick={logout} className="p-3 hover:bg-red-900/50 text-gray-400 hover:text-red-400 transition-colors" title="Logout">
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </div>

      {/* GRID */}
      <div className="flex flex-col gap-6 max-w-7xl mx-auto">
        {PANEL_LAYOUT.map((row) => (
          <div key={row.id} className={`grid gap-6 ${row.cols}`}>
            {row.cards.map((card, i) => <StationCard key={i} card={card} isRemote={canInteract} />)}
          </div>
        ))}
      </div>

      {/* MODALS */}
      <UserSettings isOpen={showSettings} onClose={() => setShowSettings(false)} />
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
  return (
    <ModalProvider>
      <SocketProvider>
        <MainLayout />
        <GlobalModal />
      </SocketProvider>
    </ModalProvider>
  );
}