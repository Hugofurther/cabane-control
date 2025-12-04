import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { CloudSun, Loader2, Thermometer, MapPin } from 'lucide-react';
import { useSocket } from '../contexts/SocketContext';

export const Weather = () => {
    const { siteSettings, user } = useSocket();
    const [weather, setWeather] = useState(null);
    const [loading, setLoading] = useState(false);
    const [locIndex, setLocIndex] = useState(0);

    const isF = user?.settings?.tempUnit === 'F';

    // Parse locations (Support legacy single fields or new JSON array)
    const locations = React.useMemo(() => {
        if (siteSettings.weather_locations) {
            try { return JSON.parse(siteSettings.weather_locations); } catch (e) { return []; }
        }
        // Fallback to legacy single location if array doesn't exist
        if (siteSettings.weather_lat) {
            return [{
                name: siteSettings.weather_city,
                lat: siteSettings.weather_lat,
                lon: siteSettings.weather_lon
            }];
        }
        return [];
    }, [siteSettings]);

    const currentLoc = locations[locIndex];

    // 1. Cycle Locations (Every 10 seconds)
    useEffect(() => {
        if (locations.length <= 1) return;
        const timer = setInterval(() => {
            setLocIndex(prev => (prev + 1) % locations.length);
        }, 10000);
        return () => clearInterval(timer);
    }, [locations]);

    // 2. Fetch Weather (When Location Changes or every 15 mins)
    useEffect(() => {
        const fetchWeather = async () => {
            if (!currentLoc) return;

            setLoading(true);
            try {
                const url = `https://api.open-meteo.com/v1/forecast?latitude=${currentLoc.lat}&longitude=${currentLoc.lon}&current=temperature_2m,apparent_temperature&temperature_unit=celsius`;
                const res = await axios.get(url);
                setWeather(res.data.current);
            } catch (e) {
                console.error("Weather error", e);
            } finally {
                setLoading(false);
            }
        };

        fetchWeather();
        const timer = setInterval(fetchWeather, 15 * 60 * 1000); // 15 min refresh
        return () => clearInterval(timer);
    }, [currentLoc]);

    if (!currentLoc) return null;

    const formatTemp = (tempC) => {
        if (tempC === undefined) return '--';
        const val = isF ? (tempC * 9 / 5) + 32 : tempC;
        return Math.round(val);
    };

    return (
        <div className="flex flex-col items-center justify-center text-gray-300 animate-in fade-in duration-700">
            {loading && !weather ? (
                <Loader2 className="animate-spin text-gray-500" size={20} />
            ) : weather ? (
                <div className="flex items-center gap-3">
                    <div className="flex items-center text-3xl font-black text-white tracking-widest">
                        <Thermometer size={28} className="text-orange-500 mr-1" />
                        {formatTemp(weather.temperature_2m)}°{isF ? 'F' : 'C'}
                    </div>

                    <div className="flex flex-col items-start justify-center border-l border-gray-600 pl-3 h-10 min-w-[100px]">
                        <div className="text-[10px] font-bold uppercase text-gray-400 tracking-wider flex items-center gap-1">
                            <CloudSun size={10} />
                            Feels {formatTemp(weather.apparent_temperature)}°
                        </div>
                        <div className="text-[10px] font-bold uppercase text-blue-400 tracking-wider flex items-center gap-1 truncate max-w-[120px]">
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