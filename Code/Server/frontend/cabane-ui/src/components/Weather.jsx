import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { CloudSun, Loader2, Thermometer } from 'lucide-react';
import { useSocket } from '../contexts/SocketContext';

export const Weather = () => {
    const { siteSettings } = useSocket();
    const [weather, setWeather] = useState(null);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        const fetchWeather = async () => {
            // Only fetch if lat/lon exist
            if (!siteSettings.weather_lat || !siteSettings.weather_lon) return;

            setLoading(true);
            try {
                const url = `https://api.open-meteo.com/v1/forecast?latitude=${siteSettings.weather_lat}&longitude=${siteSettings.weather_lon}&current=temperature_2m,apparent_temperature&temperature_unit=celsius`;
                const res = await axios.get(url);
                setWeather(res.data.current);
            } catch (e) {
                console.error("Weather fetch failed", e);
            } finally {
                setLoading(false);
            }
        };

        fetchWeather();
        // Refresh every 15 minutes
        const timer = setInterval(fetchWeather, 15 * 60 * 1000);
        return () => clearInterval(timer);
    }, [siteSettings.weather_lat, siteSettings.weather_lon]);

    if (!siteSettings.weather_lat) return null;

    return (
        <div className="flex flex-col items-center justify-center text-gray-300">
            {loading && !weather ? (
                <Loader2 className="animate-spin text-gray-500" size={20} />
            ) : weather ? (
                <>
                    <div className="flex items-center gap-2 text-2xl font-black text-white tracking-widest">
                        <Thermometer size={24} className="text-orange-500" />
                        {Math.round(weather.temperature_2m)}°C
                    </div>
                    <div className="text-[10px] font-bold uppercase text-gray-500 tracking-wider flex items-center gap-1">
                        <CloudSun size={12} />
                        Feels {Math.round(weather.apparent_temperature)}° | {siteSettings.weather_city?.split(',')[0]}
                    </div>
                </>
            ) : (
                <span className="text-xs text-red-900">Weather Error</span>
            )}
        </div>
    );
};