import React from 'react';
import { AlertTriangle, Info, X } from 'lucide-react';
import { useModal } from '../contexts/ModalContext';

export const GlobalModal = () => {
    const { modalConfig, hideModal } = useModal();

    if (!modalConfig) return null;

    const { type, title, message, onConfirm, onCancel, isDestructive } = modalConfig;

    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden transform scale-100 transition-all" onClick={e => e.stopPropagation()}>

                {/* Header */}
                <div className="p-5 border-b border-gray-800 flex items-center gap-3 bg-gray-850">
                    {isDestructive ? <AlertTriangle className="text-red-500" size={24} /> : <Info className="text-blue-500" size={24} />}
                    <h3 className="text-lg font-bold text-white">{title}</h3>
                </div>

                {/* Body */}
                <div className="p-6 text-gray-300 text-sm leading-relaxed whitespace-pre-wrap">
                    {message}
                </div>

                {/* Footer */}
                <div className="p-4 bg-gray-850 border-t border-gray-800 flex justify-end gap-3">
                    {type === 'CONFIRM' && (
                        <button
                            onClick={onCancel}
                            className="px-4 py-2 rounded-lg text-sm font-bold text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
                        >
                            Cancel
                        </button>
                    )}

                    <button
                        onClick={onConfirm}
                        className={`px-6 py-2 rounded-lg text-sm font-bold text-white shadow-lg transition-all transform active:scale-95 ${isDestructive
                                ? 'bg-red-600 hover:bg-red-500 shadow-red-900/20'
                                : 'bg-blue-600 hover:bg-blue-500 shadow-blue-900/20'
                            }`}
                    >
                        {type === 'ALERT' ? 'OK' : (isDestructive ? 'Confirm' : 'Yes')}
                    </button>
                </div>
            </div>
        </div>
    );
};