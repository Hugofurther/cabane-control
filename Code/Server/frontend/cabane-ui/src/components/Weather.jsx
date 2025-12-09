import React, { useState, useEffect } from 'react';
import { useSocket } from '../contexts/SocketContext';
import { WeatherModal } from './WeatherModal';
import { Settings, Wind, Droplets, Thermometer, CloudRain, ArrowUp } from 'lucide-react';

export const Weather = () => {
    const { weatherData, siteSettings, user } = useSocket();
    const [index, setIndex] = useState(0);
    const [isModalOpen, setIsModalOpen] = useState(false);

    // Auto-Rotate Logic
    useEffect(() => {
        if (!weatherData || weatherData.length === 0) return;

        const intervalSec = parseInt(siteSettings?.weather_rotation_interval) || 10;

        // Don't rotate if only 1 item
        if (weatherData.length <= 1) return;

        const timer = setInterval(() => {
            setIndex(prev => (prev + 1) % weatherData.length);
        }, intervalSec * 1000);

        return () => clearInterval(timer);
    }, [weatherData, siteSettings]);

    // 1. USER PREFERENCE CHECK
    // If user specifically hid it, return NULL (Don't render anything)
    // Default to true if setting is undefined
    if (user?.settings?.showWeather === false) return null;

    // 2. SYSTEM DATA CHECK
    // If Admin disabled all locations (or no key), data is empty.
    // Return NULL to remove it from the main page entirely.
    if (!weatherData || weatherData.length === 0) {
        return null;
    }

    // --- DATA PREP ---
    const safeIndex = index >= weatherData.length ? 0 : index;
    const currentCity = weatherData[safeIndex];
    if (!currentCity || !currentCity.current) return null;

    const curr = currentCity.current;
    const temp = Math.round(curr.main.temp);
    const feels = Math.round(curr.main.feels_like);
    const windSpeed = Math.round(curr.wind.speed * 3.6); // km/h
    const windDeg = curr.wind.deg || 0;
    const iconCode = curr.weather[0].icon;

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
                        // Pure White Icon
                        className="w-10 h-10 filter grayscale brightness-200 drop-shadow-[0_0_5px_rgba(255,255,255,0.4)]"
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
                            <span>{windSpeed}k</span>
                            {/* Bold White Arrow */}
                            <div style={{ transform: `rotate(${windDeg + 180}deg)` }} className="transition-transform duration-700">
                                <ArrowUp size={10} strokeWidth={3} className="text-white" />
                            </div>
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