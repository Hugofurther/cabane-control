import React, { useState } from 'react';
import { Play, X, List, CheckCircle } from 'lucide-react';
import axios from 'axios';
import { useModal } from '../contexts/ModalContext';
import { useTranslation } from 'react-i18next'; // ✅ Import

const API_URL = import.meta.env.PROD ? '' : (import.meta.env.VITE_API_URL || 'http://localhost:3000');

export const AutomationModal = ({ isOpen, onClose }) => {
    const { showConfirm, showAlert } = useModal();
    const { t } = useTranslation();

    if (!isOpen) return null;

    const handleStart = () => {
        showConfirm({
            title: t('automation.start_title') || "Start Drainage?",
            message: t('automation.start_desc') || "This will start all 3 drainage branches independently.",
            isDestructive: false,
            onConfirm: async () => {
                try {
                    const token = localStorage.getItem('cabane_token');
                    await axios.post(`${API_URL}/api/automation/start`, {}, { headers: { Authorization: `Bearer ${token}` } });
                    onClose();
                } catch (e) { showAlert("Error", "Failed to start."); }
            }
        });
    };

    const BranchInfo = ({ num, label, steps }) => (
        <div className="bg-gray-800 p-3 rounded border border-gray-700">
            <h4 className="text-xs font-bold text-gray-400 mb-2 uppercase">{label}</h4>
            <div className="space-y-1">
                {steps.map((s, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs text-gray-500">
                        <div className="w-1.5 h-1.5 rounded-full bg-gray-600" />
                        <span>{s}</span>
                    </div>
                ))}
            </div>
        </div>
    );

    return (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-[1px] z-[70] flex items-center justify-center p-4 animate-in fade-in" onClick={onClose}>
            <div className="bg-gray-900 border border-gray-700 w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>

                <div className="p-5 border-b border-gray-800 flex justify-between items-center bg-gray-850">
                    <h3 className="text-lg font-bold text-white flex items-center gap-2">
                        <List className="text-purple-400" /> Pipeline Drainage
                    </h3>
                    <button onClick={onClose}><X size={24} className="text-gray-400 hover:text-white" /></button>
                </div>

                <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
                    <p className="text-sm text-gray-300">The system will execute these 3 parallel branches:</p>

                    <BranchInfo num={1} label="Branch 1: Main Pipeline (ST1-ST2-ST3)" steps={[
                        "Step 1: Start Pumps & Drain T2 (Wait for ST3)",
                        "Step 2: Drain ST2-ST3 (Wait for ST2)",
                        "Step 3: Drain ST1-ST2 (Wait for ST1)",
                        "Step 4: Drain T1 (Timer)",
                        "Step 5: Finish (Enable TH1)"
                    ]} />

                    <BranchInfo num={2} label="Branch 2: Station 4" steps={[
                        "Step 1: Start Pump (Wait for ST4)",
                        "Step 2: Drain Cabane->ST4 (Timer)",
                        "Step 3: Finish (Enable TH2)"
                    ]} />

                    <BranchInfo num={3} label="Branch 3: Station 5" steps={[
                        "Step 1: Start Pump (Wait for ST5)",
                        "Step 2: Drain ST5->Cabane (Timer)",
                        "Step 3: Finish"
                    ]} />

                    <button
                        onClick={handleStart}
                        className="w-full py-3 mt-4 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded-lg shadow-lg flex items-center justify-center gap-2 transition-transform active:scale-95"
                    >
                        <Play size={18} /> START SEQUENCE
                    </button>
                </div>
            </div>
        </div>
    );
};