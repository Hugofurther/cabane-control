import React from 'react';
import { clsx } from 'clsx';
import { useLedState } from '../../hooks/useLedState';

export const HaloButton = ({ label, idx, feedback, isLocked, isActive, onPress, onRelease }) => {
    const ledColor = useLedState(idx, feedback);

    return (
        <div className="flex flex-col items-center gap-3 group">
            <button
                className={clsx(
                    "relative w-16 h-16 rounded-full border-4 transition-all duration-100 flex items-center justify-center",
                    // Always Dark Body
                    "border-gray-600 bg-gray-700",
                    !isLocked ? "cursor-pointer active:scale-95 hover:border-gray-400" : "opacity-90 cursor-not-allowed",

                    // Halo Effect
                    !isLocked && "active:shadow-xl",
                    !isLocked && ledColor === 'green' && "active:shadow-green-500/60 active:border-green-400",
                    !isLocked && ledColor === 'red' && "active:shadow-red-500/60 active:border-red-400"
                )}
                onPointerDown={() => !isLocked && onPress && onPress()}
                onPointerUp={() => !isLocked && onRelease && onRelease()}
                onPointerLeave={() => !isLocked && onRelease && onRelease()}
            >
                {/* Center Light */}
                <div className={clsx(
                    "w-8 h-8 rounded-full shadow-inner transition-all duration-300 border-2",
                    ledColor === 'green' ? "bg-green-500 border-green-300 shadow-[0_0_12px_rgba(34,197,94,0.9)]" : "bg-red-600 border-red-400 shadow-[0_0_12px_rgba(239,68,68,0.7)]"
                )} />
            </button>

            {/* Label Update: Bigger, Bolder, Dynamic Color */}
            <span className={clsx(
                "text-xs font-black font-mono text-center leading-tight w-24 transition-colors whitespace-pre-line uppercase tracking-wide",
                // Dynamic Color Logic
                isActive ? "text-gray-900 drop-shadow-sm" : "text-gray-300 group-hover:text-white"
            )}>
                {label}
            </span>
        </div>
    );
};