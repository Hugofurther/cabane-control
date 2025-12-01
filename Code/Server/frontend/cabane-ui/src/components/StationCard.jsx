import React from 'react';
import { clsx } from 'clsx';
import { RockerSwitch } from './controls/RockerSwitch';
import { HaloButton } from './controls/HaloButton';
import { useSocket } from '../contexts/SocketContext';

export const StationCard = ({ card, isRemote }) => {
    const { systemState, toggleSwitch } = useSocket();

    // --- 1. OFFLINE LOGIC ---
    const offlineStations = [];

    if (card.stationIds) {
        card.stationIds.forEach(id => {
            if (!systemState.stationOnline[id]) {
                offlineStations.push(`ST${id}`);
            }
        });
    }

    const isFullOffline = card.stationIds &&
        card.stationIds.length > 0 &&
        offlineStations.length === card.stationIds.length;

    const isPartialOffline = offlineStations.length > 0 && !isFullOffline;

    // Thermostat Exception: Grey out but NO label
    const isThermostat = card.name.includes("THERMOSTAT");
    const showOfflineLabel = (isFullOffline || isPartialOffline) && !isThermostat;

    // --- 2. STYLING ---
    let bgClass = "bg-cabane-panel border-gray-700 shadow-lg";
    let textClass = "text-gray-400 border-gray-700";

    // If fully offline (or Thermostat offline), dim the card
    if (isFullOffline) {
        bgClass = "bg-gray-800 border-gray-800 opacity-60"; // Dark & Faded
        textClass = "text-red-900 border-gray-800";
    }
    else if (isRemote) {
        bgClass = "bg-gray-400 border-gray-500 shadow-xl"; // Active Control
        textClass = "text-gray-900 border-gray-600";
    }

    const handleToggle = (idx, val) => toggleSwitch(idx, val);

    return (
        <div className={clsx("border rounded-lg p-4 flex flex-col transition-colors duration-500 relative min-h-[160px]", bgClass, card.span)}>

            {/* OFFLINE LABELS (Top Right) */}
            {showOfflineLabel && (
                <div className="absolute top-2 right-2 flex flex-col gap-1 items-end">
                    {offlineStations.map(lbl => (
                        <span key={lbl} className="text-red-600 text-[10px] font-black font-mono border border-red-600 px-1 rounded bg-red-900/10">
                            {lbl} OFFLINE
                        </span>
                    ))}
                </div>
            )}

            <h3 className={clsx("font-black tracking-widest text-lg mb-2 border-b-2 pb-2 text-center whitespace-pre-line h-16 flex items-center justify-center", textClass)}>
                {card.name}
            </h3>

            <div className={clsx(
                "flex flex-wrap gap-x-6 gap-y-6 justify-center items-center flex-grow my-auto",
                // If it's a thermostat and offline, grey out content
                (isFullOffline && isThermostat) && "pointer-events-none grayscale opacity-50"
            )}>
                {card.controls.map((ctrl) => {

                    // --- 3. PER-CONTROL LOGIC ---
                    // Determine which station this control relies on
                    // If 'targetSt' is defined in config, use it (for Logic grouping)
                    // Otherwise use 'fb.st' (Physical wiring)
                    // Default to the card's first station ID if nothing else
                    const targetSt = ctrl.targetSt ?? ctrl.fb?.st ?? card.stationIds?.[0];

                    const isThisControlOffline = targetSt !== undefined && !systemState.stationOnline[targetSt];

                    // Calculate State:
                    // If offline, FORCE VISUAL OFF (false) regardless of actual state
                    const virtualOn = isThisControlOffline ? false : !!systemState.virtualSwitches[ctrl.idx];
                    const physicalOn = !!systemState.physicalSwitches[ctrl.idx];

                    // Lock if: System not remote OR this specific control is offline
                    const isLocked = !isRemote || isThisControlOffline;

                    // Common Props
                    const props = {
                        key: ctrl.idx,
                        label: ctrl.label,
                        idx: ctrl.idx,
                        feedback: ctrl.fb,
                        special: ctrl.special,
                        isLocked: isLocked,
                        isActive: isRemote && !isThisControlOffline, // Only light up if healthy
                    };

                    if (ctrl.type === 'button') {
                        return (
                            <HaloButton
                                {...props}
                                onPress={() => handleToggle(ctrl.idx, true)}
                                onRelease={() => handleToggle(ctrl.idx, false)}
                            />
                        );
                    } else {
                        return (
                            <RockerSwitch
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