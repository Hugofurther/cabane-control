import React, { useState, useEffect } from 'react';
import { clsx } from 'clsx';
import { RockerSwitch } from './controls/RockerSwitch';
import { HaloButton } from './controls/HaloButton';
import { useSocket } from '../contexts/SocketContext';

// Helper to format duration
const formatDuration = (ms) => {
    if (!ms) return "00:00";
    const seconds = Math.floor(ms / 1000);
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    if (m > 99) return "> 99m";
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

export const StationCard = ({ card, isRemote }) => {
    const { systemState, toggleSwitch } = useSocket();

    const [, setTick] = useState(0);

    useEffect(() => {
        const timer = setInterval(() => setTick(t => t + 1), 1000);
        return () => clearInterval(timer);
    }, []);

    // --- 1. OFFLINE LOGIC ---
    const offlineLabels = [];
    let isAnyOffline = false;

    if (card.stationIds) {
        card.stationIds.forEach(id => {
            if (!systemState.stationOnline[id]) {
                isAnyOffline = true;
                const lastSeen = systemState.stationLastSeen[id];
                let labelText = "";

                if (lastSeen === 0) {
                    labelText = `ST${id} NEVER CONNECTED`;
                } else {
                    const diff = Date.now() - lastSeen;
                    labelText = `ST${id} OFFLINE ${formatDuration(diff)}`;
                }

                offlineLabels.push(labelText);
            }
        });
    }

    const isFullOffline = card.stationIds &&
        card.stationIds.length > 0 &&
        offlineLabels.length === card.stationIds.length;

    const isThermostat = card.name.includes("THERMOSTAT");
    const showOfflineLabel = isAnyOffline && !isThermostat;

    // --- 2. STYLING ---
    let bgClass = "bg-cabane-panel border-gray-700 shadow-lg";
    let textClass = "text-gray-400 border-gray-700";

    if (isFullOffline) {
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

            {showOfflineLabel && (
                <div className="absolute top-2 right-2 flex flex-col gap-1 items-end z-20">
                    {offlineLabels.map(lbl => (
                        <span key={lbl} className="text-red-500 text-[10px] font-black font-mono border border-red-500/50 bg-gray-900/80 px-2 py-0.5 rounded shadow-sm whitespace-nowrap">
                            {lbl}
                        </span>
                    ))}
                </div>
            )}

            <h3 className={clsx("font-black tracking-widest text-lg mb-2 border-b-2 pb-2 text-center whitespace-pre-line h-16 flex items-center justify-center", textClass)}>
                {card.name}
            </h3>

            <div className={clsx(
                "flex flex-wrap gap-x-6 gap-y-6 justify-center items-center flex-grow my-auto",
                (isFullOffline && isThermostat) && "pointer-events-none grayscale opacity-50"
            )}>
                {card.controls.map((ctrl) => {

                    const targetSt = ctrl.targetSt ?? ctrl.fb?.st ?? card.stationIds?.[0];
                    const isThisControlOffline = targetSt !== undefined && !systemState.stationOnline[targetSt];

                    const virtualOn = isThisControlOffline ? false : !!systemState.virtualSwitches[ctrl.idx];
                    const physicalOn = !!systemState.physicalSwitches[ctrl.idx];
                    const isLocked = !isRemote || isThisControlOffline;

                    // Define props WITHOUT the key
                    const props = {
                        label: ctrl.label,
                        idx: ctrl.idx,
                        feedback: ctrl.fb,
                        special: ctrl.special,
                        isLocked: isLocked,
                        isActive: isRemote && !isThisControlOffline,
                    };

                    if (ctrl.type === 'button') {
                        return (
                            <HaloButton
                                key={ctrl.idx} // ✅ Key is explicit here
                                {...props}
                                onPress={() => handleToggle(ctrl.idx, true)}
                                onRelease={() => handleToggle(ctrl.idx, false)}
                            />
                        );
                    } else {
                        return (
                            <RockerSwitch
                                key={ctrl.idx} // ✅ Key is explicit here
                                {...props}
                                isOn={virtualOn}
                                physicalOn={physicalOn}
                                onChange={(val) => handleToggle(ctrl.idx, val)}
                            />
                        );
                    }
                })}
            </div>
        </div>
    );
};