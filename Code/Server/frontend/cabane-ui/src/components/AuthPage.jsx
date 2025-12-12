import React, { useState } from 'react';
import { useSocket } from '../contexts/SocketContext';
import { Lock, Mail, User, ArrowRight, Loader2, AlertTriangle } from 'lucide-react';

export const AuthPage = () => {
    const { login, register } = useSocket();
    const [isLogin, setIsLogin] = useState(true);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const [formData, setFormData] = useState({ username: '', email: '', password: '' });

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        // Basic Validation
        if (!formData.username || !formData.password) {
            setError("Missing fields"); setLoading(false); return;
        }
        if (!isLogin && !formData.email) {
            setError("Email required"); setLoading(false); return;
        }

        let res;
        if (isLogin) {
            res = await login(formData.username, formData.password);
            if (!res) setError("Invalid credentials or account pending.");
        } else {
            res = await register(formData.username, formData.email, formData.password);
            if (!res.success) setError(res.error || "Registration failed.");
            else {
                alert("Registration successful! Please check your email.");
                setIsLogin(true);
            }
        }
        setLoading(false);
    };

    return (
        <div className="min-h-screen bg-cabane-dark flex items-center justify-center p-4">
            <div className="w-full max-w-md bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl overflow-hidden">

                {/* Header */}
                <div className="p-8 bg-gray-800 text-center border-b border-gray-700">
                    <h1 className="text-3xl font-black text-white tracking-widest mb-2">CABANE</h1>
                    <p className="text-blue-400 text-xs font-bold uppercase tracking-wide">Control System Access</p>
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit} className="p-8 space-y-5">
                    {error && (
                        <div className="bg-red-900/30 border border-red-500/50 p-3 rounded flex items-center gap-3 text-red-200 text-sm">
                            <AlertTriangle size={18} /> {error}
                        </div>
                    )}

                    <div className="space-y-4">
                        <div className="relative">
                            <User className="absolute left-3 top-3 text-gray-500" size={18} />
                            <input
                                type="text"
                                placeholder="Username"
                                value={formData.username}
                                onChange={e => setFormData({ ...formData, username: e.target.value })}
                                className="w-full bg-gray-950 border border-gray-700 rounded-lg py-2.5 pl-10 text-white outline-none focus:border-blue-500 transition-colors"
                                autoComplete="username"
                                autoCapitalize="none"
                            />
                        </div>

                        {!isLogin && (
                            <div className="relative animate-in slide-in-from-top-2">
                                <Mail className="absolute left-3 top-3 text-gray-500" size={18} />
                                <input
                                    type="email"
                                    placeholder="Email Address"
                                    value={formData.email}
                                    onChange={e => setFormData({ ...formData, email: e.target.value })}
                                    className="w-full bg-gray-950 border border-gray-700 rounded-lg py-2.5 pl-10 text-white outline-none focus:border-blue-500 transition-colors"
                                    autoComplete="email"
                                />
                            </div>
                        )}

                        <div className="relative">
                            <Lock className="absolute left-3 top-3 text-gray-500" size={18} />
                            <input
                                type="password"
                                placeholder="Password"
                                value={formData.password}
                                onChange={e => setFormData({ ...formData, password: e.target.value })}
                                // 👇 This restores the dark mode styling
                                className="w-full bg-gray-950 border border-gray-700 rounded-lg py-2.5 pl-10 text-white outline-none focus:border-blue-500 transition-colors"
                                // 👇 This is the iOS fix
                                autoComplete={isLogin ? "current-password" : "new-password"}
                            />
                        </div>
                    </div>

                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-lg shadow-lg shadow-blue-900/20 flex items-center justify-center gap-2 transition-all active:scale-95"
                    >
                        {loading ? <Loader2 className="animate-spin" /> : (isLogin ? "LOGIN" : "CREATE ACCOUNT")}
                    </button>
                </form>

                {/* Footer */}
                <div className="p-4 bg-gray-950 border-t border-gray-800 text-center">
                    <button
                        onClick={() => { setIsLogin(!isLogin); setError(''); }}
                        className="text-xs text-gray-500 hover:text-white font-bold uppercase transition-colors flex items-center justify-center gap-1 mx-auto"
                    >
                        {isLogin ? "New User? Register" : "Have an account? Login"} <ArrowRight size={12} />
                    </button>
                </div>
            </div>
        </div>
    );
};