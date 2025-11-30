import React from 'react';
import { clsx } from 'clsx';

export const RockerSwitch = ({ label, isOn, physicalOn, isLocked, onChange }) => {

    // Show Ghost if: We are in Remote Mode AND Physical differs from Virtual
    const showGhost = !isLocked && (isOn !== physicalOn);

    return (
        <div className="flex flex-col items-center gap-2">
            {/* Switch Body */}
            <div
                className={clsx(
                    "relative w-12 h-20 bg-gray-800 rounded-lg shadow-inner border-2 border-gray-900 transition-all cursor-pointer",
                    isLocked ? "opacity-50 cursor-not-allowed" : "hover:border-gray-600"
                )}
                onClick={() => !isLocked && onChange(!isOn)}
            >
                {/* The Rocker Part */}
                <div
                    className={clsx(
                        "absolute left-1 w-9 h-8 bg-gradient-to-b from-gray-600 to-gray-800 rounded shadow-md transition-all duration-200",
                        isOn ? "top-1" : "bottom-1"
                    )}
                >
                    {/* LED Indicator - BIGGER & BRIGHTER */}
                    <div className={clsx(
                        "absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded shadow transition-all duration-200",
                        // Shape: Wider bar
                        "w-6 h-3",

                        isOn
                            ? "bg-green-400 shadow-[0_0_10px_3px_rgba(74,222,128,1)] border border-green-200"
                            : "bg-red-500 shadow-[0_0_8px_2px_rgba(239,68,68,0.5)] opacity-80"
                    )}></div>
                </div>

                {/* Ghost Indicator (Shows where the physical switch is) */}
                {showGhost && (
                    <div
                        className={clsx(
                            "absolute left-1 w-9 h-8 border-2 border-dashed border-yellow-500/50 rounded pointer-events-none z-10",
                            physicalOn ? "top-1" : "bottom-1"
                        )}
                        title="Physical Switch Position"
                    />
                )}
            </div>

            {/* Label */}
            <span className="text-xs font-mono text-gray-400 text-center leading-tight w-20">
                {label}
            </span>
        </div>
    );
};