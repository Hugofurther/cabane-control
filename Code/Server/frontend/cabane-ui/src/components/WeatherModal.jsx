import React, { useState, useEffect, useRef } from 'react';
import { X, ChevronLeft, ChevronRight, Droplets, Wind, Thermometer, Calendar, ArrowUp, CloudRain, Snowflake } from 'lucide-react';

const getCardinal = (deg) => {
    const val = Math.floor((deg / 45) + 0.5);
    const arr = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
    return arr[val % 8];
};

export const WeatherModal = ({ isOpen, onClose, weatherData, initialIndex }) => {
    const [currentIndex, setCurrentIndex] = useState(initialIndex || 0);
    const [isPaused, setIsPaused] = useState(false);
    const rotationTimer = useRef(null);

    useEffect(() => {
        if (isOpen) {
            setCurrentIndex(initialIndex || 0);
            setIsPaused(false);
        }
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen || isPaused || weatherData.length <= 1) return;
        rotationTimer.current = setInterval(() => {
            setCurrentIndex(prev => (prev + 1) % weatherData.length);
        }, 5000);
        return () => clearInterval(rotationTimer.current);
    }, [isOpen, isPaused, weatherData.length]);

    if (!isOpen || weatherData.length === 0) return null;

    const data = weatherData[currentIndex];
    const current = data.current;
    const forecast = data.forecast;

    const handleContentClick = (e) => { e.stopPropagation(); setIsPaused(!isPaused); };
    const handleNext = (e) => { e.stopPropagation(); setCurrentIndex((prev) => (prev + 1) % weatherData.length); setIsPaused(true); };
    const handlePrev = (e) => { e.stopPropagation(); setCurrentIndex((prev) => (prev - 1 + weatherData.length) % weatherData.length); setIsPaused(true); };

    const dailyForecast = forecast.list.reduce((acc, item) => {
        const date = new Date(item.dt * 1000).toLocaleDateString(undefined, { weekday: 'short' });
        if (!acc[date]) acc[date] = [];
        acc[date].push(item);
        return acc;
    }, {});

    const windSpeed = Math.round(current.wind.speed * 3.6);
    const windDeg = current.wind.deg || 0;
    const windDir = getCardinal(windDeg);

    // ✅ PRECIPITATION LOGIC (CURRENT)
    // OpenWeatherMap returns rain/snow object with '1h' or '3h' keys
    const rain3h = current.rain ? (current.rain['3h'] || current.rain['1h'] || 0) : 0;
    const snow3h = current.snow ? (current.snow['3h'] || current.snow['1h'] || 0) : 0;
    const hasPrecip = rain3h > 0 || snow3h > 0;

    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[70] flex items-center justify-center p-4 animate-in fade-in" onClick={onClose}>
            <div className="bg-gray-900 border border-gray-700 w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden relative flex flex-col max-h-[85vh]" onClick={handleContentClick}>

                <button onClick={onClose} className="absolute top-4 right-4 z-50 p-2 bg-black/40 hover:bg-red-600 rounded-full text-white transition-colors"><X size={20} /></button>

                {isPaused && (
                    <>
                        <button onClick={handlePrev} className="absolute left-2 top-1/2 -translate-y-1/2 p-3 bg-black/50 hover:bg-blue-600 text-white rounded-full z-50"><ChevronLeft size={32} /></button>
                        <button onClick={handleNext} className="absolute right-2 top-1/2 -translate-y-1/2 p-3 bg-black/50 hover:bg-blue-600 text-white rounded-full z-50"><ChevronRight size={32} /></button>
                        <div className="absolute top-4 left-4 bg-yellow-500/90 text-black text-[10px] font-black px-2 py-1 rounded uppercase tracking-wider z-50">Paused</div>
                    </>
                )}

                <div className="bg-gradient-to-b from-blue-900 to-gray-900 p-8 text-center relative shrink-0">
                    <h2 className="text-2xl font-black text-white tracking-widest uppercase mb-1">{data.locationName}</h2>
                    <p className="text-blue-300 text-sm font-bold uppercase mb-6">{current.weather[0].description}</p>

                    <div className="flex justify-center items-center gap-6 mb-6">
                        <img className="w-24 h-24 filter grayscale brightness-200 drop-shadow-[0_0_10px_rgba(255,255,255,0.5)]" src={`https://openweathermap.org/img/wn/${current.weather[0].icon}@4x.png`} alt="icon" />
                        <div className="text-7xl font-bold text-white tracking-tighter">{Math.round(current.main.temp)}°</div>
                    </div>

                    {/* ✅ DYNAMIC GRID: Adapts based on data availability */}
                    <div className={`grid ${hasPrecip ? 'grid-cols-4' : 'grid-cols-3'} gap-2 text-xs font-bold text-gray-300`}>
                        <div className="bg-white/10 rounded p-2 flex flex-col items-center">
                            <Thermometer size={16} className="text-red-400 mb-1" />
                            <span>{Math.round(current.main.feels_like)}°</span>
                            <span className="text-gray-500">FEELS LIKE</span>
                        </div>
                        <div className="bg-white/10 rounded p-2 flex flex-col items-center">
                            <div className="flex items-center gap-1 mb-1">
                                <Wind size={16} className="text-gray-400" />
                                <div style={{ transform: `rotate(${windDeg + 180}deg)` }} className="transition-transform duration-700">
                                    <ArrowUp size={16} strokeWidth={3} className="text-white drop-shadow-md" />
                                </div>
                            </div>
                            <span>{windSpeed} km/h {windDir}</span>
                            <span className="text-gray-500">WIND</span>
                        </div>
                        <div className="bg-white/10 rounded p-2 flex flex-col items-center">
                            <Droplets size={16} className="text-cyan-400 mb-1" />
                            <span>{current.main.humidity}%</span>
                            <span className="text-gray-500">HUMIDITY</span>
                        </div>

                        {/* ✅ NEW: PRECIPITATION BLOCK */}
                        {hasPrecip && (
                            <div className="bg-white/10 rounded p-2 flex flex-col items-center border border-blue-500/30 shadow-[inset_0_0_10px_rgba(59,130,246,0.2)]">
                                {snow3h > 0 ? (
                                    <>
                                        <Snowflake size={16} className="text-white mb-1 animate-pulse" />
                                        <span>{snow3h}mm</span>
                                        <span className="text-gray-400">SNOW (3h)</span>
                                    </>
                                ) : (
                                    <>
                                        <CloudRain size={16} className="text-blue-400 mb-1 animate-pulse" />
                                        <span>{rain3h}mm</span>
                                        <span className="text-gray-400">RAIN (3h)</span>
                                    </>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                <div className="flex-grow overflow-y-auto bg-gray-800 p-4 space-y-3">
                    <h3 className="text-xs font-bold text-gray-500 uppercase flex items-center gap-2 mb-2 sticky top-0 bg-gray-800 py-2 z-10"><Calendar size={14} /> 5-Day Forecast</h3>
                    {Object.entries(dailyForecast).slice(0, 5).map(([day, items]) => {
                        const maxTemp = Math.max(...items.map(i => i.main.temp));
                        const minTemp = Math.min(...items.map(i => i.main.temp));
                        const midItem = items[Math.floor(items.length / 2)];

                        // ✅ CALCULATE DAILY VOLUMES
                        const rainTotal = items.reduce((acc, i) => acc + (i.rain?.['3h'] || 0), 0);
                        const snowTotal = items.reduce((acc, i) => acc + (i.snow?.['3h'] || 0), 0);

                        return (
                            <div key={day} className="flex items-center justify-between bg-gray-700/50 p-3 rounded-lg border border-gray-600">
                                <div className="w-12 font-bold text-gray-200">{day}</div>

                                <div className="flex items-center gap-2 flex-grow justify-start pl-4">
                                    <img className="w-8 h-8 filter grayscale brightness-200" src={`https://openweathermap.org/img/wn/${midItem.weather[0].icon}.png`} alt="icon" />
                                    <div className="flex flex-col">
                                        <span className="text-xs text-gray-400 font-bold uppercase">{midItem.weather[0].main}</span>

                                        {/* ✅ DISPLAY VOLUME IF EXISTS */}
                                        {(rainTotal > 0 || snowTotal > 0) && (
                                            <div className="flex items-center gap-2 text-[10px] font-mono mt-0.5">
                                                {rainTotal > 0 && <span className="text-blue-300 flex items-center gap-0.5"><CloudRain size={8} />{rainTotal.toFixed(1)}mm</span>}
                                                {snowTotal > 0 && <span className="text-white flex items-center gap-0.5"><Snowflake size={8} />{snowTotal.toFixed(1)}mm</span>}
                                            </div>
                                        )}
                                    </div>
                                </div>

                                <div className="flex gap-3 text-sm font-mono font-bold">
                                    <span className="text-white">{Math.round(maxTemp)}°</span>
                                    <span className="text-gray-500">{Math.round(minTemp)}°</span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};