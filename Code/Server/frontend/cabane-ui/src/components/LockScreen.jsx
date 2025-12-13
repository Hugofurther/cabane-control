import React, { useState, useEffect } from 'react';
import { Lock, Unlock, Loader2, X } from 'lucide-react';
import { useAutoLock } from '../contexts/AutoLockContext';
import { useSocket } from '../contexts/SocketContext';

export const LockScreen = () => {
    const { isLocked, lockMethod, unlockScreen } = useAutoLock();
    const { login, user } = useSocket();

    // UI State
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
                setError('Incorrect Password');
            }
        }
    };

    return (
        // 1. INVISIBLE OVERLAY
        // ✅ CHANGED: z-[40] (Was 100). 
        // This places it ABOVE the Grid (z-0) but BELOW the Header (z-50) and Modals (z-55+).
        // It still captures clicks on the grid area to trigger the modal.
        <div
            className="fixed inset-0 z-[40] cursor-default"
            onClick={() => setShowModal(true)}
        >

            {/* 2. UNLOCK MODAL (Only appears when clicked) */}
            {showModal && (
                // ✅ CHANGED: z-[150] (Was 102). Ensures it pops over EVERYTHING when active.
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200 z-[150]">
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

                        <h2 className="text-xl font-bold text-white tracking-wide">System Locked</h2>

                        {lockMethod === 'PASSWORD' ? (
                            <form onSubmit={handleUnlock} className="w-full space-y-4">
                                <input
                                    type="password"
                                    autoFocus
                                    placeholder="Enter Password..."
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
                                    {loading ? <Loader2 className="animate-spin" /> : <><Unlock size={20} /> UNLOCK</>}
                                </button>
                            </form>
                        ) : (
                            <button
                                onClick={handleUnlock}
                                className="w-full px-8 py-3 bg-gray-700 hover:bg-gray-600 text-white font-bold rounded-lg border border-gray-500 hover:border-white transition-all flex items-center justify-center gap-2"
                            >
                                <Unlock size={20} /> RESUME SESSION
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