import React, { useState, useEffect } from 'react';
import { useSocket } from '../contexts/SocketContext';
import { WeatherModal } from './WeatherModal';
import { Settings, Wind, Droplets, Thermometer, CloudRain } from 'lucide-react';

export const Weather = () => {
    const { weatherData, siteSettings, user } = useSocket();
    const [index, setIndex] = useState(0);
    const [isModalOpen, setIsModalOpen] = useState(false);

    // Auto-Rotate Logic
    useEffect(() => {
        if (!weatherData || weatherData.length === 0) return;

        const intervalSec = parseInt(siteSettings?.weather_rotation_interval) || 10;

        const timer = setInterval(() => {
            setIndex(prev => (prev + 1) % weatherData.length);
        }, intervalSec * 1000);

        return () => clearInterval(timer);
    }, [weatherData, siteSettings]);

    // --- EMPTY STATE ---
    if (!weatherData || weatherData.length === 0) {
        return (
            <div className="flex items-center gap-2 bg-red-900/20 px-3 py-2 rounded-lg border border-red-900/50">
                <Settings size={14} className="text-red-400 animate-spin-slow" />
                <span className="text-[10px] font-bold text-red-300">
                    {user?.role === 'ADMIN' ? "MISSING API KEY" : "WEATHER OFFLINE"}
                </span>
            </div>
        );
    }

    // --- DATA PREP ---
    const safeIndex = index >= weatherData.length ? 0 : index;
    const currentCity = weatherData[safeIndex];
    if (!currentCity || !currentCity.current) return null;

    const curr = currentCity.current;
    const temp = Math.round(curr.main.temp);
    const feels = Math.round(curr.main.feels_like);
    const wind = Math.round(curr.wind.speed * 3.6); // km/h
    const iconCode = curr.weather[0].icon;

    // logic: show rain volume if raining, otherwise humidity
    const rain = curr.rain ? (curr.rain['1h'] || 0) : 0;
    const showRain = rain > 0;
    const secondaryMetric = showRain ? `${rain}mm` : `${curr.main.humidity}%`;
    const SecondaryIcon = showRain ? CloudRain : Droplets;

    return (
        <>
            <div
                onClick={() => setIsModalOpen(true)}
                className="flex items-center gap-3 bg-gray-800/80 px-4 py-2 rounded-lg border border-gray-700 cursor-pointer hover:bg-gray-700 hover:border-blue-500 transition-all group select-none min-w-[260px] max-w-[320px]"
            >
                {/* 1. LEFT: Icon & Big Temp (Fixed Width, No Shrink) */}
                <div className="flex items-center gap-1 flex-shrink-0">
                    <img
                        src={`https://openweathermap.org/img/wn/${iconCode}.png`}
                        alt="weather"
                        className="w-10 h-10 drop-shadow-sm filter brightness-110"
                    />
                    <span className="text-3xl font-black text-white leading-none group-hover:text-blue-300 transition-colors">
                        {temp}°
                    </span>
                </div>

                {/* Divider */}
                <div className="w-px h-9 bg-gray-600/50 flex-shrink-0 mx-1"></div>

                {/* 2. RIGHT: Stacked Details (Flexible Width) */}
                <div className="flex flex-col justify-center gap-0.5 min-w-0 flex-grow">

                    {/* Row 1: Feels Like */}
                    <div className="flex items-center gap-1 text-[10px] text-gray-400">
                        <Thermometer size={10} className="text-red-400" />
                        <span className="font-bold">Feels {feels}°</span>
                    </div>

                    {/* Row 2: Wind | Precip/Humidity */}
                    <div className="flex items-center gap-2 text-[10px] font-mono text-gray-300">
                        <div className="flex items-center gap-1">
                            <Wind size={10} className="text-blue-300" />
                            <span>{wind}k</span>
                        </div>
                        <span className="text-gray-600 text-[8px]">|</span>
                        <div className="flex items-center gap-1">
                            <SecondaryIcon size={10} className="text-cyan-400" />
                            <span>{secondaryMetric}</span>
                        </div>
                    </div>

                    {/* Row 3: Location (Truncates properly) */}
                    <div className="text-[10px] font-black uppercase tracking-wide text-gray-200 truncate w-full" title={currentCity.locationName}>
                        {currentCity.locationName}
                    </div>
                </div>
            </div>

            <WeatherModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                weatherData={weatherData}
                initialIndex={safeIndex}
            />
        </>
    );
};