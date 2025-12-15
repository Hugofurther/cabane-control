import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Settings, Mail, StickyNote, Activity, LogOut, Cloud } from 'lucide-react';
import axios from 'axios';
import { SocketProvider, useSocket } from './contexts/SocketContext';
import { StationCard } from './components/StationCard';
import { UserSettings } from './components/UserSettings';
import { NotificationBanner } from './components/NotificationBanner';
import { AuthPage } from './components/AuthPage';
import { MessageDrawer } from './components/MessageDrawer/index';
import { ShareModal } from './components/MessageDrawer/ShareModal';
import { Clock } from './components/Clock';
import { Weather } from './components/Weather';
import { FlashViewer } from './components/FlashViewer';
import { PANEL_LAYOUT } from './config/stations';
import { ModalProvider } from './contexts/ModalContext';
import { GlobalModal } from './components/GlobalModal';
import { AutoLockProvider } from './contexts/AutoLockContext';
import { LockScreen } from './components/LockScreen';
import { useTranslation } from 'react-i18next'; // 1. Import

console.log("🚀 CABANE UI VERSION: 4.6 - REMINDER LOGIC FIX");

const VACUUM_INDICES = [2, 3, 9, 14, 17];
const BUZZER_SWITCH_IDX = 21;
const API_URL = import.meta.env.PROD ? '' : (import.meta.env.VITE_API_URL || 'http://localhost:3000');

function Dashboard() {
  const { t } = useTranslation(); // 2. Hook
  const {
    socket, systemState, takeControl, releaseToServer, releaseToCabane, logout, isConnected, user, siteSettings
  } = useSocket();

  const canInteract = systemState.controller === 'USER' && systemState.currentUser === user?.username;

  // UI State
  const [showSettings, setShowSettings] = useState(false);
  const [showMessageDrawer, setShowMessageDrawer] = useState(false);
  const [notification, setNotification] = useState(null);
  const [flashMessages, setFlashMessages] = useState([]);

  // Audio & Notification State
  const [alarmDismissed, setAlarmDismissed] = useState(false);
  const [reminderDismissed, setReminderDismissed] = useState(false);

  // Share State
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [shareTargetNote, setShareTargetNote] = useState(null);
  const [userList, setUserList] = useState([]);
  const [groupList, setGroupList] = useState([]);

  const [unreadCount, setUnreadCount] = useState(0);
  const [hasNotes, setHasNotes] = useState(false);

  const audioCtx = useRef(null);
  const chirpTimerRef = useRef(null);

  // ✅ NEW: Screen Size Detection
  const [isLargeScreen, setIsLargeScreen] = useState(window.innerWidth >= 1024);

  useEffect(() => {
    const handleResize = () => setIsLargeScreen(window.innerWidth >= 1024);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // --- 1. FETCH DIRECTORY ---
  useEffect(() => {
    if (user) {
      const token = localStorage.getItem('cabane_token');
      axios.get(`${API_URL}/api/users/directory`, { headers: { Authorization: `Bearer ${token}` } })
        .then(res => { if (Array.isArray(res.data)) setUserList(res.data); })
        .catch(e => console.error("User fetch error:", e));

      axios.get(`${API_URL}/api/conversations`, { headers: { Authorization: `Bearer ${token}` } })
        .then(res => { if (Array.isArray(res.data)) setGroupList(res.data.filter(c => c.type === 'GROUP')); })
        .catch(e => console.error("Group fetch error:", e));
    }
  }, [user]);

  // --- 2. LOCAL ALARM & RUNNING LOGIC ---
  const { isAlarmActive, isChirpActive, alarmSources, alarmType } = useMemo(() => {
    const { virtualSwitches, physicalSwitches, stationFeedback, controller, stationOnline } = systemState;
    const activeSwitches = controller === 'CABANE' ? physicalSwitches : virtualSwitches;

    let vacuumAlarm = false;
    let burglarAlarm = false;
    let sources = [];

    // A. Check Vacuum Pumps
    PANEL_LAYOUT.forEach(row => {
      row.cards.forEach(card => {
        card.controls.forEach(ctrl => {
          if (VACUUM_INDICES.includes(ctrl.idx)) {
            const st = ctrl.fb?.st;
            const bit = ctrl.fb?.bit;
            if (st !== undefined && stationOnline[st]) {
              const isOn = !!activeSwitches[ctrl.idx];
              const isFeedbackOff = ((stationFeedback[st] >> bit) & 1) === 1;

              if (isOn && isFeedbackOff) {
                vacuumAlarm = true;
                sources.push(`${card.name} - ${ctrl.label}`);
              }
            }
          }
        });
      });
    });

    // B. Check Burglar Alarm
    const burgSt = parseInt(siteSettings.burglar_station) || 0;
    if (burgSt === 2 && stationOnline[2] && ((stationFeedback[2] >> 4) & 1)) {
      burglarAlarm = true;
      sources.push("INTRUSION DETECTED: STATION 2");
    }
    if (burgSt === 3 && stationOnline[3] && ((stationFeedback[3] >> 4) & 1)) {
      burglarAlarm = true;
      sources.push("INTRUSION DETECTED: STATION 3");
    }

    const overallAlarm = vacuumAlarm || burglarAlarm;

    // C. Check Buzzer/Chirp
    const buzzerOn = !!activeSwitches[BUZZER_SWITCH_IDX];

    // ✅ CHANGED: Chirp if No Alarm AND Buzzer Muted.
    // This covers:
    // 1. System Running + Muted
    // 2. System Stopped + Muted (Reminder to re-arm)
    const chirp = !overallAlarm && !buzzerOn;

    // Determine type for Banner
    let type = 'INFO';
    if (burglarAlarm) type = 'BURGLAR';
    else if (vacuumAlarm) type = 'ALARM';

    return {
      isAlarmActive: overallAlarm,
      isChirpActive: chirp,
      alarmSources: sources,
      alarmType: type
    };
  }, [systemState, siteSettings.burglar_station]);

  // --- AUDIO LOGIC ---
  const playTone = (type) => {
    const saved = localStorage.getItem('cabane_settings');
    const s = saved ? JSON.parse(saved) : { soundEnabled: true, vibrationEnabled: true };
    if (s.vibrationEnabled && navigator.vibrate) navigator.vibrate(type === 'SIREN' ? [500, 200, 500] : 100);
    if (user?.settings?.soundEnabled === false) return;

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

  const wakeAudio = () => { if (audioCtx.current && audioCtx.current.state === 'suspended') audioCtx.current.resume(); };

  // --- FLASH LOGIC ---
  const checkFlashMessages = async () => {
    if (!user) return 0;
    const token = localStorage.getItem('cabane_token');
    try {
      const res = await axios.get(`${API_URL}/api/messages`, { headers: { Authorization: `Bearer ${token}` } });
      const msgs = res.data;
      const urgentUnacked = msgs.filter(m => m.priority === 'URGENT' && m.is_ack_by_me === 0 && String(m.sender_id) !== String(user.id));
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

  useEffect(() => {
    if (!socket) return;
    const handleNewMessage = (msg) => {
      if (msg.recipient_id && String(msg.recipient_id) !== String(user?.id)) return;
      if (msg.priority === 'URGENT' && String(msg.sender_id) !== String(user?.id)) {
        const soundOn = user?.settings?.flashSoundEnabled !== false;
        checkFlashMessages().then((count) => { if (count > 0 && soundOn) playTone('CHIRP'); });
      }
    };
    const handleUpdateMessage = (data) => { if (data.priority === 'NORMAL') setFlashMessages(prev => prev.filter(m => m.id !== data.id)); };
    socket.on('NEW_MESSAGE', handleNewMessage);
    socket.on('UPDATE_MESSAGE', handleUpdateMessage);
    return () => {
      socket.off('NEW_MESSAGE', handleNewMessage);
      socket.off('UPDATE_MESSAGE', handleUpdateMessage);
    };
  }, [socket, user]);

  // --- SOUND LOOP ---
  useEffect(() => {
    if (chirpTimerRef.current) clearInterval(chirpTimerRef.current);
    const sirenMs = (user?.settings?.appSirenSilence || 5) * 1000 + 1000;
    const chirpMs = (user?.settings?.appChirpInterval || 2) * 60 * 1000;

    let intervalId = null;
    if (isAlarmActive) {
      playTone('SIREN');
      intervalId = setInterval(() => playTone('SIREN'), sirenMs);
    } else if (isChirpActive) {
      playTone('CHIRP');
      intervalId = setInterval(() => playTone('CHIRP'), chirpMs);
    }
    chirpTimerRef.current = intervalId;
    return () => { if (intervalId) clearInterval(intervalId); };
  }, [isAlarmActive, isChirpActive, user?.settings]);

  // --- 🔔 NOTIFICATION LOGIC ---
  useEffect(() => {
    if (isAlarmActive) {
      if (!alarmDismissed) {
        setNotification({
          type: alarmType,
          message: alarmSources.length ? alarmSources.join('\n') : "SYSTEM ALARM"
        });
      } else {
        setNotification(null);
      }
    }
    else if (isChirpActive) {
      setAlarmDismissed(false); // Clear alarm dismiss when alarm clears
      if (!reminderDismissed) {
        setNotification({ type: 'INFO', message: "System Active but Buzzer MUTED." });
      } else {
        setNotification(null);
      }
    }
    else {
      setAlarmDismissed(false);
      setReminderDismissed(false);
      setNotification(null);
    }
  }, [isAlarmActive, isChirpActive, alarmSources, alarmDismissed, reminderDismissed, alarmType]);

  const handleUnreadChange = (unread, notes) => { setUnreadCount(unread); if (notes !== null) setHasNotes(notes > 0); };

  // --- HELPER: CHECK IF CARD IS DISABLED ---
  const isCardDisabled = (card) => {
    if (!card.stationIds || card.stationIds.length === 0) return false;
    try {
      const disabledList = JSON.parse(siteSettings.disabled_stations || '[]');
      // Returns true only if ALL stations in this card are disabled
      return card.stationIds.every(id => disabledList.includes(id));
    } catch (e) { return false; }
  };

  // --- RENDER ---
  return (
    <div className="min-h-screen bg-cabane-dark text-white p-4 md:p-8 pt-20" onClick={wakeAudio} onTouchStart={wakeAudio}>

      {notification && (
        <NotificationBanner
          type={notification.type}
          message={notification.message}
          onDismiss={() => {
            if (notification.type === 'ALARM' || notification.type === 'BURGLAR') setAlarmDismissed(true);
            if (notification.type === 'INFO') setReminderDismissed(true);
            setNotification(null);
          }}
        />
      )}

      {flashMessages.length > 0 && (
        <FlashViewer
          messages={flashMessages}
          onDismiss={handleDismissFlash}
          onClose={() => setFlashMessages([])}
          onShare={(noteData) => { setShareTargetNote(noteData); setShareModalOpen(true); }}
        />
      )}

      {shareModalOpen && shareTargetNote && (
        <ShareModal
          note={shareTargetNote}
          users={userList.filter(u => u.id !== user?.id)}
          groups={groupList}
          isFlash={true}
          onClose={() => setShareModalOpen(false)}
        />
      )}

      {/* HEADER */}
      <div className="flex flex-col xl:flex-row justify-between items-center mb-10 border-b border-gray-700 pb-6 gap-6 relative z-[50]">
        {/* ... (Header Content Same as Before) ... */}
        {/* Left Status */}
        <div className="flex flex-col gap-1 items-center xl:items-start min-w-[250px]">
          <h1 className="text-3xl font-black tracking-widest text-gray-100 leading-none mb-1">CABANE CONTROL</h1>
          <div className="flex items-center gap-3 text-xs font-bold tracking-wider uppercase">
            {user?.settings?.showMainStatus && (
              <>
                <div className={`flex items-center gap-1 ${systemState.mainControllerOnline ? 'text-green-400' : 'text-red-500 animate-pulse'}`}>
                  <Activity size={12} /> {systemState.mainControllerOnline ? t('nav.cabane_online') : t('nav.cabane_offline')}
                </div>
                <span className="text-gray-700">|</span>
              </>
            )}
            <div className="flex items-center gap-2 text-gray-400">
              <span className={`w-2 h-2 rounded-full shadow ${isConnected ? 'bg-green-500 shadow-green-500/50' : 'bg-red-500 shadow-red-500/50'}`}></span>
              <span>{isConnected ? t('nav.user_online') : t('nav.connecting')}</span>
            </div>
          </div>
          <div className={`font-mono font-bold text-sm mt-1 ${systemState.controller === 'CABANE' ? 'text-yellow-500' : 'text-blue-400'}`}>
            {t('nav.master')}: {systemState.controller === 'USER' ? (systemState.currentUser || 'USER') : systemState.controller}
          </div>
        </div>

        {/* Center */}
        <div className="flex-grow flex flex-col items-center justify-center gap-2">
          <Clock />
          <Weather />
        </div>

        {/* Right Actions */}
        <div className="flex gap-3 items-center min-w-[250px] justify-end">
          {systemState.currentUser !== user?.username && (
            user?.can_control ?
              <button onClick={takeControl} className="px-6 py-3 rounded bg-blue-600 hover:bg-blue-500 text-white font-bold uppercase shadow-lg shadow-blue-900/50 transition-all whitespace-nowrap shrink-0">{t('dashboard.take_control')}</button>
              : <div className="px-4 py-3 rounded bg-gray-800 text-gray-500 font-bold text-xs uppercase border border-gray-700 cursor-not-allowed whitespace-nowrap shrink-0">{t('dashboard.view_only')}</div>
          )}

          {systemState.controller === 'USER' && systemState.currentUser === user?.username && (
            <div className="flex gap-2 shrink-0">
              <button onClick={releaseToServer} className="px-3 py-3 rounded bg-yellow-600 hover:bg-yellow-500 text-white font-bold uppercase shadow-lg transition-all whitespace-nowrap flex items-center gap-1 text-xs"><Cloud size={16} /> ➜ {t('common.server') || 'SERVER'}</button>
              {systemState.mainControllerOnline && <button onClick={releaseToCabane} className="px-3 py-3 rounded bg-red-600 hover:bg-red-500 text-white font-bold uppercase shadow-lg transition-all whitespace-nowrap flex items-center gap-1 text-xs"><Cloud size={16} /> ➜ {t('common.cabane') || 'CABANE'}</button>}
            </div>
          )}

          <button onClick={() => setShowMessageDrawer(true)} className={`p-3 rounded transition-colors relative shrink-0 ${unreadCount > 0 ? 'bg-red-900/50 text-red-400 animate-pulse border border-red-500' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`} title={t('nav.messages')}><Mail size={20} />{unreadCount > 0 && <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-600 rounded-full text-[10px] flex items-center justify-center text-white font-bold">{unreadCount}</span>}</button>
          {hasNotes && <div className="text-yellow-400 animate-pulse shrink-0" title="You have reminders"><StickyNote size={20} /></div>}

          <div className="flex items-center gap-0 bg-gray-800 rounded-lg border border-gray-700 ml-2 overflow-hidden group hover:border-gray-500 shrink-0">
            <button onClick={() => setShowSettings(true)} className="px-4 py-3 text-xs text-gray-300 font-bold border-r border-gray-700 flex items-center gap-2 hover:bg-gray-700 hover:text-white transition-colors" title={t('nav.settings')}><Settings size={16} className="text-blue-400" /> {user?.username || "GUEST"}
            </button>
            <button onClick={logout} className="p-3 hover:bg-red-900/50 text-gray-400 hover:text-red-400 transition-colors" title={t('nav.logout')}><LogOut size={18} /></button>
          </div>
        </div>
      </div>

      {/* GRID */}
      <div className="flex flex-col gap-6 max-w-7xl mx-auto">
        {PANEL_LAYOUT.map((row) => {
          // Filter cards in this row based on settings
          const visibleCards = row.cards.filter(card => {
            if (!isCardDisabled(card)) return true; // Always show enabled

            // If disabled, check user preference
            if (isLargeScreen) return user?.settings?.showDisabledLarge !== false;
            return user?.settings?.showDisabledSmall !== false;
          });

          // If no cards are visible in this row, don't render the row
          if (visibleCards.length === 0) return null;

          return (
            <div key={row.id} className={`grid gap-6 ${row.cols}`}>
              {visibleCards.map((card, i) => (
                <StationCard key={i} card={card} isRemote={canInteract} />
              ))}
            </div>
          );
        })}
      </div>

      <UserSettings isOpen={showSettings} onClose={() => setShowSettings(false)} />
      <MessageDrawer isOpen={showMessageDrawer} onClose={() => setShowMessageDrawer(false)} onUnreadChange={handleUnreadChange} />
    </div>
  );
}

const SplashScreen = () => (<div className="min-h-screen bg-cabane-dark flex items-center justify-center"><div className="flex flex-col items-center gap-4"><div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div><h2 className="text-gray-400 font-mono tracking-widest animate-pulse">CONNECTING...</h2></div></div>);
const MainLayout = () => { const { user, authLoading } = useSocket(); if (authLoading) return <SplashScreen />; if (!user) return <AuthPage />; return <Dashboard />; };
export default function App() {
  const { t } = useTranslation();
  return (<ModalProvider><SocketProvider><AutoLockProvider><MainLayout /><GlobalModal /><LockScreen /></AutoLockProvider></SocketProvider></ModalProvider>);
}