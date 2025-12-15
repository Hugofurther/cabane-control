import React, { useState, useEffect } from 'react';
import { Lock, Unlock, Loader2, X } from 'lucide-react';
import { useAutoLock } from '../contexts/AutoLockContext';
import { useSocket } from '../contexts/SocketContext';
import { useTranslation } from 'react-i18next'; // ✅ Import

export const LockScreen = () => {
    const { t } = useTranslation(); // ✅ Hook
    const { isLocked, lockMethod, unlockScreen } = useAutoLock();
    const { login, user } = useSocket();

    const [showModal, setShowModal] = useState(false);
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!isLocked) {
            setShowModal(false);
            setPassword('');
            setError('');
        }
    }, [isLocked]);

    if (!isLocked) return null;

    const handleUnlock = async (e) => {
        e?.preventDefault();

        if (lockMethod === 'SIMPLE') {
            unlockScreen();
            return;
        }

        if (lockMethod === 'PASSWORD') {
            if (!password) return;
            setLoading(true);
            setError('');

            const success = await login(user.username, password);
            setLoading(false);
            if (success) {
                setPassword('');
                unlockScreen();
            } else {
                setError(t('lock.incorrect'));
            }
        }
    };

    return (
        // 1. INVISIBLE OVERLAY
        // z-[40] covers the grid (z-0) but sits below the Header (z-50) and StationCard Buzzer (z-45)
        <div
            className="fixed inset-0 z-[40] cursor-default"
            onClick={() => setShowModal(true)}
        >

            {/* 2. UNLOCK MODAL (Only appears when clicked) */}
            {showModal && (
                <div className="fixed inset-0 bg-black/40 backdrop-blur-[1px] flex items-center justify-center p-4 animate-in fade-in duration-200 z-[150]">
                    <div
                        onClick={(e) => e.stopPropagation()}
                        className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl p-8 w-full max-w-sm relative flex flex-col items-center gap-6"
                    >
                        <button
                            onClick={(e) => { e.stopPropagation(); setShowModal(false); }}
                            className="absolute top-4 right-4 text-gray-500 hover:text-white transition-colors"
                        >
                            <X size={24} />
                        </button>

                        <div className="p-4 rounded-full bg-gray-800/50 border border-gray-700 shadow-xl">
                            <Lock size={32} className="text-blue-500" />
                        </div>

                        <h2 className="text-xl font-bold text-white tracking-wide">{t('lock.locked')}</h2>

                        {lockMethod === 'PASSWORD' ? (
                            <form onSubmit={handleUnlock} className="w-full space-y-4">
                                <input
                                    type="password"
                                    autoFocus
                                    placeholder={t('lock.enter_password')}
                                    value={password}
                                    onChange={e => setPassword(e.target.value)}
                                    className="w-full bg-gray-950 border border-gray-600 rounded-lg p-3 text-center text-white text-lg tracking-widest outline-none focus:border-blue-500 transition-all placeholder-gray-600"
                                />
                                {error && <p className="text-red-400 text-sm text-center font-bold animate-pulse">{error}</p>}
                                <button
                                    type="submit"
                                    disabled={loading}
                                    className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-lg shadow-lg flex items-center justify-center gap-2 transition-transform active:scale-95"
                                >
                                    {loading ? <Loader2 className="animate-spin" /> : <><Unlock size={20} /> {t('lock.unlock')}</>}
                                </button>
                            </form>
                        ) : (
                            <button
                                onClick={handleUnlock}
                                className="w-full px-8 py-3 bg-gray-700 hover:bg-gray-600 text-white font-bold rounded-lg border border-gray-500 hover:border-white transition-all flex items-center justify-center gap-2"
                            >
                                <Unlock size={20} /> {t('lock.resume')}
                            </button>
                        )}

                        <div className="text-gray-600 text-[10px] font-mono uppercase tracking-widest">
                            {user?.username}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};