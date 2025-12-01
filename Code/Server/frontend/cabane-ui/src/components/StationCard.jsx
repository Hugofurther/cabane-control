import React from 'react';
import { clsx } from 'clsx';
import { RockerSwitch } from './controls/RockerSwitch';
import { HaloButton } from './controls/HaloButton';
import { useSocket } from '../contexts/SocketContext';

export const StationCard = ({ card, isRemote }) => {
    const { systemState, toggleSwitch } = useSocket();

    // 1. Check Offline Status
    let isOffline = false;
    if (card.stationIds && card.stationIds.length > 0) {
        isOffline = card.stationIds.some(id => !systemState.stationOnline[id]);
    }

    // 2. Background Logic
    let bgClass = "bg-cabane-panel border-gray-700 shadow-lg";
    let textClass = "text-gray-400 border-gray-700";

    if (isOffline) {
        bgClass = "bg-gray-800 border-gray-800 opacity-60";
        textClass = "text-red-900 border-gray-800";
    }
    else if (isRemote) {
        bgClass = "bg-gray-400 border-gray-500 shadow-xl";
        textClass = "text-gray-900 border-gray-600";
    }

    const handleToggle = (idx, val) => toggleSwitch(idx, val);

    return (
        <div className={clsx("border rounded-lg p-4 flex flex-col transition-colors duration-500 relative min-h-[160px]", bgClass, card.span)}>

            {isOffline && (
                <div className="absolute top-2 right-2 text-red-500 text-xs font-bold font-mono border border-red-500 px-1 rounded">
                    OFFLINE
                </div>
            )}

            <h3 className={clsx("font-black tracking-widest text-lg mb-2 border-b-2 pb-2 text-center whitespace-pre-line h-16 flex items-center justify-center", textClass)}>
                {card.name}
            </h3>

            {/* ALIGNMENT FIX: flex-grow + items-center + my-auto */}
            <div className={clsx(
                "flex flex-wrap gap-x-6 gap-y-6 justify-center items-center flex-grow my-auto",
                isOffline && "pointer-events-none grayscale"
            )}>
                {card.controls.map((ctrl) => {
                    // ... (Mapping logic remains the same) ...
                    const virtualOn = !!systemState.virtualSwitches[ctrl.idx];
                    const physicalOn = !!systemState.physicalSwitches[ctrl.idx];

                    if (ctrl.type === 'button') {
                        return (
                            <HaloButton
                                key={ctrl.idx}
                                label={ctrl.label}
                                idx={ctrl.idx}
                                feedback={ctrl.fb}
                                isLocked={!isRemote || isOffline}
                                isActive={isRemote && !isOffline}
                                onPress={() => handleToggle(ctrl.idx, true)}
                                onRelease={() => handleToggle(ctrl.idx, false)}
                            />
                        );
                    } else {
                        return (
                            <RockerSwitch
                                key={ctrl.idx}
                                label={ctrl.label}
                                idx={ctrl.idx}
                                feedback={ctrl.fb}
                                special={ctrl.special}
                                isOn={virtualOn}
                                physicalOn={physicalOn}
                                isLocked={!isRemote || isOffline}
                                isActive={isRemote && !isOffline}
                                onChange={(val) => handleToggle(ctrl.idx, val)}
                            />
                        );
                    }
                })}
            </div>
        </div>
    );
};
