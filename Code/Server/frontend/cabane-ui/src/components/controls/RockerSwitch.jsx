import React from 'react';
import { clsx } from 'clsx';
import { useLedState } from '../../hooks/useLedState';

export const RockerSwitch = ({ label, idx, feedback, special, isOn, physicalOn, isLocked, isActive, onChange }) => {
    const ledColor = useLedState(idx, feedback, special);
    const showGhost = !isLocked && (isOn !== physicalOn);

    return (
        <div className="flex flex-col items-center gap-3 group">
            <div
                className={clsx(
                    "relative w-14 h-24 rounded-lg shadow-inner border-2 transition-all duration-300",
                    // Switch Body always stays Dark Industrial for contrast against the card
                    "bg-gray-700 border-gray-600",
                    !isLocked ? "cursor-pointer hover:border-gray-400 hover:bg-gray-650" : "opacity-90 cursor-not-allowed"
                )}
                onClick={() => !isLocked && onChange(!isOn)}
            >
                {/* Rocker Body */}
                <div
                    className={clsx(
                        "absolute left-1 w-11 h-10 rounded shadow-md transition-all duration-200",
                        "bg-gradient-to-b from-gray-500 to-gray-800",
                        isOn ? "top-1" : "bottom-1"
                    )}
                >
                    {/* LED Indicator */}
                    <div className={clsx(
                        "absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded shadow transition-all duration-300 w-6 h-3",

                        // Green
                        ledColor === 'green' && "bg-green-500 shadow-[0_0_8px_2px_rgba(34,197,94,0.9)] border border-green-300",

                        // Red (Solid)
                        ledColor === 'red' && "bg-red-600 shadow-[0_0_8px_1px_rgba(239,68,68,0.7)] border border-red-400",

                        // Off
                        ledColor === 'off' && "bg-gray-900 opacity-50",

                        // ✅ NEW: Blink Red (Alarm)
                        ledColor === 'blink-red' && "animate-alarm border border-red-400"
                    )}></div>
                </div>

                {/* Ghost */}
                {showGhost && (
                    <div className={clsx("absolute left-1 w-11 h-10 border-2 border-dashed border-yellow-400/90 rounded pointer-events-none z-10", physicalOn ? "top-1" : "bottom-1")} />
                )}
            </div>

            {/* Label: Fixed height for alignment */}
            <span className={clsx(
                "text-xs font-black font-mono text-center leading-tight w-24 whitespace-pre-line uppercase tracking-wide",
                // ALIGNMENT FIX: Fixed height (h-8) + Flex Center to handle 1 vs 2 lines
                "h-8 flex items-start justify-center pt-1",
                isActive ? "text-gray-900 drop-shadow-sm" : "text-gray-300 group-hover:text-white"
            )}>
                {label}
            </span>
        </div>
    );
};