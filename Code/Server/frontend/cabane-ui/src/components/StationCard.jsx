import React from 'react';
import { clsx } from 'clsx';
import { RockerSwitch } from './controls/RockerSwitch';
import { HaloButton } from './controls/HaloButton';
import { useSocket } from '../contexts/SocketContext';

export const StationCard = ({ card, isRemote }) => {
    const { systemState, toggleSwitch } = useSocket();

    // 1. Background Logic
    // Remote = Light Grey (Gray-400), Local = Dark Panel
    const bgClass = isRemote
        ? "bg-gray-400 border-gray-500 shadow-xl"
        : "bg-cabane-panel border-gray-700 shadow-lg";

    // Text Color Logic
    const textClass = isRemote ? "text-gray-900 border-gray-600" : "text-gray-400 border-gray-700";

    const handleToggle = (idx, val) => toggleSwitch(idx, val);

    return (
        <div className={clsx("border rounded-lg p-4 flex flex-col transition-colors duration-500", bgClass, card.span)}>

            {/* 2. Title: Bigger (text-lg) and Bolder (font-black) */}
            <h3 className={clsx("font-black tracking-widest text-lg mb-4 border-b-2 pb-2 text-center whitespace-pre-line", textClass)}>
                {card.name}
            </h3>

            <div className="flex flex-wrap gap-x-4 gap-y-6 justify-center">
                {card.controls.map((ctrl) => {
                    const virtualOn = !!systemState.virtualSwitches[ctrl.idx];
                    const physicalOn = !!systemState.physicalSwitches[ctrl.idx];

                    if (ctrl.type === 'button') {
                        return (
                            <HaloButton
                                key={ctrl.idx}
                                label={ctrl.label}
                                idx={ctrl.idx}
                                feedback={ctrl.fb}
                                isLocked={!isRemote}
                                isActive={isRemote}
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
                                isLocked={!isRemote}
                                isActive={isRemote}
                                onChange={(val) => handleToggle(ctrl.idx, val)}
                            />
                        );
                    }
                })}
            </div>
        </div>
    );
};