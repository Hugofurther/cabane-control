import React, { useState, useEffect, useMemo } from 'react';
import { clsx } from 'clsx';
import { RockerSwitch } from './controls/RockerSwitch';
import { HaloButton } from './controls/HaloButton';
import { useSocket } from '../contexts/SocketContext';
import { useAutoLock } from '../contexts/AutoLockContext';
import { useTranslation } from 'react-i18next';

const formatDuration = (ms) => {
    if (!ms || ms < 0) return "00:00";
    const seconds = Math.floor(ms / 1000);
    if (seconds < 3600) {
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    if (seconds < 86400) {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        return `${h}h ${m}m`;
    }
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    return `${d}d ${h}h`;
};

export const StationCard = ({ card, isRemote }) => {
    const { systemState, siteSettings, toggleSwitch, simState, user } = useSocket();
    const { isLocked } = useAutoLock();
    const { t } = useTranslation();
    const [, setTick] = useState(0);

    useEffect(() => {
        const timer = setInterval(() => setTick(t => t + 1), 1000);
        return () => clearInterval(timer);
    }, []);

    // ✅ ISOLATION LOGIC
    // If I am the Sim Owner, ignore the global disabled list.
    const isSimMode = simState?.active && simState?.owner === user?.username;

    const disabledList = useMemo(() => {
        if (isSimMode) return []; // In Sim, nothing is disabled unless Sim says so (via connection toggle)
        try { return JSON.parse(siteSettings.disabled_stations || '[]'); } catch (e) { return []; }
    }, [siteSettings.disabled_stations, isSimMode]);

    const offlineLabels = [];
    let isAnyOffline = false;

    if (card.stationIds) {
        card.stationIds.forEach(id => {
            if (disabledList.includes(id)) {
                offlineLabels.push(`ST${id} ${t('common.disabled').toUpperCase()}`);
                isAnyOffline = true;
            }
            else if (!systemState.stationOnline[id]) {
                isAnyOffline = true;
                const lastSeen = systemState.stationLastSeen[id];
                let labelText = lastSeen === 0 ?
                    `ST${id} ${t('station.never_connected')}` :
                    `ST${id} ${t('station.offline')} ${formatDuration(Date.now() - lastSeen)}`;
                offlineLabels.push(labelText);
            }
        });
    }

    const isFullOffline = card.stationIds && card.stationIds.length > 0 && offlineLabels.length === card.stationIds.length;
    const isThermostat = card.name.includes("THERMOSTAT") || card.name.includes("station_names.th");
    const showOfflineLabel = isAnyOffline && !isThermostat;

    const isBuzzerCard = card.controls.some(c => c.idx === 21 || c.special === 'BUZZER');

    let bgClass = "bg-cabane-panel border-gray-700 shadow-lg";
    let textClass = "text-gray-400 border-gray-700";
    let zIndexClass = "relative";

    if (isLocked && isBuzzerCard && isRemote) {
        bgClass = "bg-gray-900 border-red-500/50 shadow-[0_0_30px_rgba(220,38,38,0.3)]";
        textClass = "text-gray-200 border-gray-600";
        zIndexClass = "z-[45] relative";
    }
    else if (isFullOffline) {
        bgClass = "bg-gray-800 border-gray-800 opacity-60";
        textClass = "text-red-900 border-gray-800";
    }
    else if (isRemote) {
        bgClass = "bg-gray-400 border-gray-500 shadow-xl";
        textClass = "text-gray-900 border-gray-600";
    }

    const handleToggle = (idx, val) => toggleSwitch(idx, val);

    return (
        <div className={clsx("border rounded-lg p-4 flex flex-col transition-all duration-500 min-h-[220px]", bgClass, card.span, zIndexClass)}>

            {showOfflineLabel && (
                <div className="absolute top-2 right-2 flex flex-col gap-1 items-end z-20 pointer-events-none">
                    {offlineLabels.map(lbl => (
                        <span key={lbl} className={`text-[10px] font-black font-mono border px-2 py-0.5 rounded shadow-sm whitespace-nowrap ${lbl.includes(t('common.disabled').toUpperCase()) ? "text-orange-500 border-orange-500/50 bg-orange-900/20" : "text-red-500 border-red-500/50 bg-gray-900/80"}`}>
                            {lbl}
                        </span>
                    ))}
                </div>
            )}

            <h3 className={clsx("font-black tracking-widest text-lg mb-0 border-b-2 pb-2 text-center whitespace-pre-line min-h-[3.5rem] flex items-center justify-center", textClass)}>
                {t(card.name)}
            </h3>

            <div className={clsx("flex flex-wrap gap-4 justify-center items-start flex-grow mt-6", (isFullOffline && isThermostat) && "pointer-events-none grayscale opacity-50")}>
                {card.controls.map((ctrl) => {
                    const targetSt = ctrl.targetSt ?? ctrl.fb?.st ?? card.stationIds?.[0];
                    let isDisabled = targetSt !== undefined && disabledList.includes(targetSt);

                    if (ctrl.idx === 22) isDisabled = disabledList.includes(1);
                    else if (ctrl.idx === 23) isDisabled = disabledList.includes(4);

                    const isOffline = targetSt !== undefined && !systemState.stationOnline[targetSt];
                    const isControlUnavailable = isDisabled || isOffline;

                    const virtualOn = !!systemState.virtualSwitches[ctrl.idx];
                    const physicalOn = !!systemState.physicalSwitches[ctrl.idx];
                    const isLockedControl = (!isRemote || isControlUnavailable);

                    const props = {
                        label: null,
                        idx: ctrl.idx,
                        feedback: ctrl.fb,
                        special: ctrl.special,
                        isLocked: isLockedControl,
                        isActive: isRemote && !isControlUnavailable,
                    };

                    return (
                        <div key={ctrl.idx} className="flex flex-col items-center gap-2 w-24">
                            <div className="h-24 flex items-center justify-center">
                                {ctrl.type === 'button' ? (
                                    <HaloButton {...props} onPress={() => handleToggle(ctrl.idx, true)} onRelease={() => handleToggle(ctrl.idx, false)} />
                                ) : (
                                    <RockerSwitch {...props} isOn={virtualOn} physicalOn={physicalOn} onChange={(val) => handleToggle(ctrl.idx, val)} />
                                )}
                            </div>
                            <div className="h-10 flex items-start justify-center">
                                <span className={clsx("text-xs font-bold text-center leading-tight uppercase", (isRemote || (isLocked && isBuzzerCard)) ? "text-gray-800" : "text-gray-400")}>
                                    {t(ctrl.label)}
                                </span>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};