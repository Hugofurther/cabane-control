import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { CloudSun, Loader2, Thermometer, MapPin, Wind, Droplets, ArrowUp } from 'lucide-react';
import { useSocket } from '../contexts/SocketContext';

export const Weather = () => {
    const { siteSettings, user } = useSocket();
    const [weather, setWeather] = useState(null);
    const [loading, setLoading] = useState(false);
    const [locIndex, setLocIndex] = useState(0);

    const isF = user?.settings?.tempUnit === 'F';

    // 1. Parse Locations
    const locations = React.useMemo(() => {
        if (siteSettings.weather_locations) {
            try { return JSON.parse(siteSettings.weather_locations); } catch (e) { return []; }
        }
        if (siteSettings.weather_lat) {
            return [{ name: siteSettings.weather_city, lat: siteSettings.weather_lat, lon: siteSettings.weather_lon }];
        }
        return [];
    }, [siteSettings]);

    const rotIntervalMs = (parseInt(siteSettings.weather_rotation_interval) || 10) * 1000;
    const updateIntervalMs = (parseInt(siteSettings.weather_update_interval) || 15) * 60 * 1000;

    const currentLoc = locations[locIndex];

    // 2. Rotation Logic
    useEffect(() => {
        if (locations.length <= 1) return;
        const timer = setInterval(() => {
            setLocIndex(prev => (prev + 1) % locations.length);
        }, rotIntervalMs);
        return () => clearInterval(timer);
    }, [locations, rotIntervalMs]);

    // 3. Fetch Logic (Added Wind & Precip params)
    useEffect(() => {
        const fetchWeather = async () => {
            if (!currentLoc) return;

            setLoading(true);
            try {
                // We fetch 'wind_speed_10m', 'wind_direction_10m', 'precipitation'
                const url = `https://api.open-meteo.com/v1/forecast?latitude=${currentLoc.lat}&longitude=${currentLoc.lon}&current=temperature_2m,apparent_temperature,wind_speed_10m,wind_direction_10m,precipitation&temperature_unit=celsius&wind_speed_unit=kmh&precipitation_unit=mm`;
                const res = await axios.get(url);
                setWeather(res.data.current);
            } catch (e) {
                console.error("Weather error", e);
            } finally {
                setLoading(false);
            }
        };

        fetchWeather();
        const timer = setInterval(fetchWeather, updateIntervalMs);
        return () => clearInterval(timer);
    }, [currentLoc, updateIntervalMs]);

    if (!currentLoc) return null;

    // --- FORMATTING HELPERS ---

    const formatTemp = (tempC) => {
        if (tempC === undefined) return '--';
        const val = isF ? (tempC * 9 / 5) + 32 : tempC;
        return Math.round(val);
    };

    const formatWind = (speedKmh) => {
        if (speedKmh === undefined) return '--';
        // Convert km/h to mph if Imperial
        const val = isF ? speedKmh * 0.621371 : speedKmh;
        return Math.round(val) + (isF ? 'mph' : 'km/h');
    };

    const formatPrecip = (mm) => {
        if (mm === undefined) return '--';
        // Convert mm to inches if Imperial
        if (isF) {
            const inches = mm * 0.0393701;
            return inches < 0.1 && inches > 0 ? '<0.1"' : inches.toFixed(1) + '"';
        }
        return mm + 'mm';
    };

    return (
        <div className="flex flex-col items-center justify-center text-gray-300 animate-in fade-in duration-700">
            {loading && !weather ? (
                <Loader2 className="animate-spin text-gray-500" size={20} />
            ) : weather ? (
                <div className="flex items-center gap-4">

                    {/* 1. Main Temp */}
                    <div className="flex items-center text-3xl font-black text-white tracking-widest">
                        <Thermometer size={28} className="text-orange-500 mr-1" />
                        {formatTemp(weather.temperature_2m)}°{isF ? 'F' : 'C'}
                    </div>

                    {/* 2. Info Stack */}
                    <div className="flex flex-col items-start justify-center border-l border-gray-600 pl-4 h-12 min-w-[140px] gap-0.5">

                        {/* Line A: Feels Like */}
                        <div className="text-[10px] font-bold uppercase text-gray-400 tracking-wider flex items-center gap-1">
                            <CloudSun size={10} />
                            Feels {formatTemp(weather.apparent_temperature)}°
                        </div>

                        {/* Line B: Wind & Precip */}
                        <div className="text-[10px] font-bold uppercase text-gray-300 tracking-wider flex items-center gap-3">
                            {/* Wind with Rotated Arrow */}
                            <div className="flex items-center gap-1">
                                <Wind size={10} className="text-cyan-400" />
                                {formatWind(weather.wind_speed_10m)}
                                <ArrowUp size={10} style={{ transform: `rotate(${weather.wind_direction_10m}deg)` }} />
                            </div>
                            {/* Precip */}
                            <div className="flex items-center gap-1">
                                <Droplets size={10} className="text-blue-400" />
                                {formatPrecip(weather.precipitation)}
                            </div>
                        </div>

                        {/* Line C: Location */}
                        <div className="text-[10px] font-bold uppercase text-blue-400 tracking-wider flex items-center gap-1 truncate max-w-[250px]">
                            <MapPin size={10} />
                            {currentLoc.name?.split(',')[0]}
                        </div>
                    </div>
                </div>
            ) : (
                <span className="text-xs text-red-900">Weather Error</span>
            )}
        </div>
    );
};