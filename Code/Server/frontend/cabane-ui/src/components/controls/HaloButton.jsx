import React from 'react';
import { clsx } from 'clsx';

export const HaloButton = ({ label, color = 'green', isLocked, onPress, onRelease }) => {

    return (
        <div className="flex flex-col items-center gap-2">
            <button
                className={clsx(
                    "relative w-14 h-14 rounded-full border-4 border-gray-800 transition-all duration-100 flex items-center justify-center",
                    isLocked ? "opacity-50 cursor-not-allowed bg-gray-700" : "active:scale-95",

                    // Default State
                    !isLocked && "bg-gray-700 hover:bg-gray-600",

                    // Active State (Pressing) - Make it GLOW
                    !isLocked && color === 'green' && "active:bg-green-900 active:border-green-500 active:shadow-[0_0_20px_rgba(34,197,94,0.6)]",
                    !isLocked && color === 'red' && "active:bg-red-900 active:border-red-500 active:shadow-[0_0_20px_rgba(239,68,68,0.6)]"
                )}

                onPointerDown={() => !isLocked && onPress && onPress()}
                onPointerUp={() => !isLocked && onRelease && onRelease()}
                onPointerLeave={() => !isLocked && onRelease && onRelease()} // Safety if drag out
            >
                {/* Center Light - NOW BRIGHTER */}
                <div className={clsx(
                    "w-8 h-8 rounded-full shadow-md transition-all duration-200",
                    // Use same "lit" style as rocker if you want it to look "Ready"
                    // Or if it represents status (which implies feedback):
                    // Let's assume Green = Ready/Safe
                    color === 'green'
                        ? "bg-green-500 shadow-[0_0_8px_rgba(74,222,128,0.8)] border-2 border-green-800"
                        : "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)] border-2 border-red-800"
                )} />
            </button>

            <span className="text-xs font-mono text-gray-400 text-center leading-tight w-20">
                {label}
            </span>
        </div>
    );
};