import React, { useState, useEffect } from 'react';
import { CloudSun, Loader2, Thermometer, MapPin, Wind, Droplets, ArrowUp } from 'lucide-react';
import { useSocket } from '../contexts/SocketContext';

export const Weather = () => {
    const { weatherData, siteSettings, user } = useSocket();
    const [currentIndex, setCurrentIndex] = useState(0);

    const isF = user?.settings?.tempUnit === 'F';

    // Safe Parsing of interval
    const rotIntervalMs = (parseInt(siteSettings?.weather_rotation_interval) || 10) * 1000;

    // Rotation Logic
    useEffect(() => {
        if (!weatherData || weatherData.length <= 1) return;
        const timer = setInterval(() => {
            setCurrentIndex(prev => (prev + 1) % weatherData.length);
        }, rotIntervalMs);
        return () => clearInterval(timer);
    }, [weatherData, rotIntervalMs]);

    // Safety Check: If no data, show loading or nothing
    if (!weatherData || weatherData.length === 0) {
        return (
            <div className="flex items-center justify-center text-gray-500 text-xs h-12">
                {siteSettings?.weather_locations && <Loader2 className="animate-spin" />}
            </div>
        );
    }

    // Safe Access
    const currentCity = weatherData[currentIndex];
    const w = currentCity?.data;

    // Double Safety Check
    if (!currentCity || !w) return null;

    // --- FORMATTING ---
    const formatTemp = (tempC) => {
        if (tempC == null) return '--';
        const val = isF ? (tempC * 9 / 5) + 32 : tempC;
        return Math.round(val);
    };

    const formatWind = (speedKmh) => {
        if (speedKmh == null) return '--';
        const val = isF ? speedKmh * 0.621371 : speedKmh;
        return Math.round(val) + (isF ? 'mph' : 'km/h');
    };

    const formatPrecip = (mm) => {
        if (mm == null) return '--';
        if (isF) {
            const inches = mm * 0.0393701;
            return inches < 0.1 && inches > 0 ? '<0.1"' : inches.toFixed(1) + '"';
        }
        return mm + 'mm';
    };

    return (
        <div className="flex flex-col items-center justify-center text-gray-300 animate-in fade-in duration-700">
            <div className="flex items-center gap-4">

                {/* 1. Main Temp */}
                <div className="flex items-center text-3xl font-black text-white tracking-widest">
                    <Thermometer size={28} className="text-orange-500 mr-1" />
                    {formatTemp(w.temperature_2m)}°{isF ? 'F' : 'C'}
                </div>

                {/* 2. Info Stack */}
                <div className="flex flex-col items-start justify-center border-l border-gray-600 pl-4 h-12 min-w-[140px] gap-0.5">

                    {/* Line A: Feels Like */}
                    <div className="text-[10px] font-bold uppercase text-gray-400 tracking-wider flex items-center gap-1">
                        <CloudSun size={10} />
                        Feels {formatTemp(w.apparent_temperature)}°
                    </div>

                    {/* Line B: Wind & Precip */}
                    <div className="text-[10px] font-bold uppercase text-gray-300 tracking-wider flex items-center gap-3">
                        <div className="flex items-center gap-1">
                            <Wind size={10} className="text-cyan-400" />
                            {formatWind(w.wind_speed_10m)}
                            <ArrowUp size={10} style={{ transform: `rotate(${w.wind_direction_10m}deg)` }} />
                        </div>
                        <div className="flex items-center gap-1">
                            <Droplets size={10} className="text-blue-400" />
                            {formatPrecip(w.precipitation)}
                        </div>
                    </div>

                    {/* Line C: Location */}
                    <div className="text-[10px] font-bold uppercase text-blue-400 tracking-wider flex items-center gap-1 truncate max-w-[250px]">
                        <MapPin size={10} />
                        {currentCity.name.split(',')[0]}
                    </div>
                </div>
            </div>
        </div>
    );
};