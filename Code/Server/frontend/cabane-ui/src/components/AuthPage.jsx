import React, { useState, useEffect } from 'react';
import { useSocket } from '../contexts/SocketContext';
import { Lock, User, Mail, ArrowRight, AlertTriangle, CheckCircle, Eye, EyeOff, Loader2 } from 'lucide-react';
import axios from 'axios';

export const AuthPage = () => {
    const { login, register } = useSocket();

    // Get API URL for direct axios calls (Forgot/Reset/Verify)
    const API_URL = import.meta.env.PROD ? '' : (import.meta.env.VITE_API_URL || 'http://localhost:3000');

    // Modes: 'LOGIN', 'REGISTER', 'FORGOT', 'RESET'
    const [mode, setMode] = useState('LOGIN');

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [successMsg, setSuccessMsg] = useState('');
    const [showPassword, setShowPassword] = useState(false);

    // Form State
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [email, setEmail] = useState('');

    // Check URL for tokens (Verification or Reset)
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const token = params.get('token');

        if (window.location.pathname === '/reset-password' && token) {
            setMode('RESET');
        } else if (window.location.pathname === '/verify-email' && token) {
            verifyEmail(token);
        }
    }, []);

    const verifyEmail = async (token) => {
        try {
            await axios.post(`${API_URL}/api/auth/verify`, { token });
            setSuccessMsg("Email verified! Waiting for Admin approval.");
            setMode('LOGIN');
            window.history.replaceState({}, document.title, "/");
        } catch (e) {
            setError(e.response?.data?.error || "Verification failed or link expired.");
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setSuccessMsg('');
        setLoading(true);

        try {
            if (mode === 'REGISTER') {
                const res = await register(username, email, password);
                if (res.success) {
                    setSuccessMsg("Account created! Please check your email to verify.");
                    setMode('LOGIN');
                    setPassword('');
                } else {
                    setError(res.error);
                }
            }
            else if (mode === 'LOGIN') {
                const success = await login(username, password);
                if (!success) setError("Invalid credentials or Account not approved.");
            }
            else if (mode === 'FORGOT') {
                await axios.post(`${API_URL}/api/auth/forgot-password`, { email });
                setSuccessMsg("If account exists, reset link sent.");
                setMode('LOGIN');
            }
            else if (mode === 'RESET') {
                const params = new URLSearchParams(window.location.search);
                const token = params.get('token');
                await axios.post(`${API_URL}/api/auth/reset-password`, { token, newPassword: password });
                setSuccessMsg("Password updated. Please login.");
                setMode('LOGIN');
                window.history.pushState({}, document.title, "/");
            }
        } catch (e) {
            setError(e.response?.data?.error || "Request failed.");
        }

        setLoading(false);
    };

    return (
        <div className="min-h-screen bg-cabane-dark flex items-center justify-center p-4">
            <div className="bg-cabane-panel border border-gray-700 w-full max-w-md p-8 rounded-xl shadow-2xl relative overflow-hidden">

                <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-600 to-green-500"></div>

                <div className="mb-8 text-center">
                    <h1 className="text-3xl font-black tracking-widest text-gray-100 mb-2">CABANE CONTROL</h1>
                    <p className="text-gray-500 text-sm font-mono uppercase">
                        {mode === 'LOGIN' && "Secure Access Terminal"}
                        {mode === 'REGISTER' && "New Operator Request"}
                        {mode === 'FORGOT' && "Password Recovery"}
                        {mode === 'RESET' && "Set New Password"}
                    </p>
                </div>

                {error && <div className="mb-6 bg-red-900/30 border border-red-800 text-red-200 p-3 rounded flex items-center gap-3 text-sm"><AlertTriangle size={18} /> {error}</div>}
                {successMsg && <div className="mb-6 bg-green-900/30 border border-green-800 text-green-200 p-3 rounded flex items-center gap-3 text-sm"><CheckCircle size={18} /> {successMsg}</div>}

                <form onSubmit={handleSubmit} className="flex flex-col gap-5">

                    {/* USERNAME (Login/Register Only) */}
                    {(mode === 'LOGIN' || mode === 'REGISTER') && (
                        <div className="relative group">
                            <User className="absolute left-3 top-3 text-gray-500 group-focus-within:text-blue-400" size={20} />
                            <input
                                type="text"
                                placeholder={mode === 'REGISTER' ? "Username" : "Username or Email"}
                                value={username}
                                onChange={e => setUsername(e.target.value)}
                                className="w-full bg-gray-950 border border-gray-700 rounded-lg p-3 pl-10 text-white outline-none focus:border-blue-500 transition-colors"
                                required
                                autoComplete="username"
                                autoCapitalize="none"
                            />
                        </div>
                    )}

                    {/* EMAIL (Register/Forgot Only) */}
                    {(mode === 'REGISTER' || mode === 'FORGOT') && (
                        <div className="relative group">
                            <Mail className="absolute left-3 top-3 text-gray-500 group-focus-within:text-blue-400" size={20} />
                            <input
                                type="email"
                                placeholder="Email Address"
                                value={email}
                                onChange={e => setEmail(e.target.value)}
                                className="w-full bg-gray-950 border border-gray-700 rounded-lg p-3 pl-10 text-white outline-none focus:border-blue-500 transition-colors"
                                required
                                autoComplete="email"
                            />
                        </div>
                    )}

                    {/* PASSWORD (Login/Register/Reset Only) */}
                    {(mode !== 'FORGOT') && (
                        <div className="flex flex-col gap-1">
                            <div className="relative group">
                                <Lock className="absolute left-3 top-3 text-gray-500 group-focus-within:text-blue-400" size={20} />
                                <input
                                    type={showPassword ? "text" : "password"}
                                    placeholder={mode === 'RESET' ? "New Password" : "Password"}
                                    value={password}
                                    onChange={e => setPassword(e.target.value)}
                                    // ✅ FIXED STYLING & IOS ATTRIBUTES
                                    className="w-full bg-gray-950 border border-gray-700 rounded-lg p-3 pl-10 pr-10 text-white outline-none focus:border-blue-500 transition-colors"
                                    required
                                    autoComplete={mode === 'LOGIN' ? "current-password" : "new-password"}
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    className="absolute right-3 top-3 text-gray-500 hover:text-white focus:outline-none"
                                >
                                    {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                                </button>
                            </div>

                            {/* Validation Hint */}
                            {(mode === 'REGISTER' || mode === 'RESET') && (
                                <div className="text-[10px] text-gray-500 px-1">
                                    Req: 8+ chars, 1 Uppercase, 1 Special Char.
                                </div>
                            )}
                        </div>
                    )}

                    <button
                        disabled={loading}
                        className={`mt-4 py-3 rounded-lg font-bold uppercase tracking-wide shadow-lg transition-all flex items-center justify-center gap-2
              ${loading ? 'bg-gray-700 cursor-wait' : 'bg-blue-600 hover:bg-blue-500 hover:shadow-blue-500/30 text-white active:scale-95'}`}
                    >
                        {loading ? <Loader2 className="animate-spin" /> : (
                            mode === 'LOGIN' ? 'Login' :
                                mode === 'REGISTER' ? 'Create Account' :
                                    mode === 'FORGOT' ? 'Send Link' : 'Update Password'
                        )}
                        {!loading && <ArrowRight size={18} />}
                    </button>

                </form>

                {/* NAVIGATION LINKS */}
                <div className="mt-6 flex justify-between text-sm">
                    {mode === 'LOGIN' && (
                        <>
                            <button onClick={() => setMode('FORGOT')} className="text-gray-500 hover:text-white transition-colors">Forgot Password?</button>
                            <button onClick={() => setMode('REGISTER')} className="text-blue-400 hover:text-blue-300 font-bold">Create Account</button>
                        </>
                    )}
                    {mode !== 'LOGIN' && (
                        <button onClick={() => { setMode('LOGIN'); setError(''); }} className="text-gray-500 hover:text-white transition-colors w-full text-center">
                            Back to Login
                        </button>
                    )}
                </div>

            </div>
        </div>
    );
};