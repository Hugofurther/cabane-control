import React, { useState, useEffect, useRef } from 'react';
import { X, ChevronLeft, ChevronRight, Droplets, Wind, Thermometer, Calendar, ArrowUp } from 'lucide-react';

// Helper: Degrees to Cardinal
const getCardinal = (deg) => {
    const val = Math.floor((deg / 45) + 0.5);
    const arr = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
    return arr[val % 8];
};

export const WeatherModal = ({ isOpen, onClose, weatherData, initialIndex }) => {
    const [currentIndex, setCurrentIndex] = useState(initialIndex || 0);
    const [isPaused, setIsPaused] = useState(false);
    const rotationTimer = useRef(null);

    // ✅ FIX: Only sync index when OPENING. Ignore parent updates while open.
    useEffect(() => {
        if (isOpen) {
            setCurrentIndex(initialIndex || 0);
            setIsPaused(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen]);

    // Rotation Logic
    useEffect(() => {
        // If closed, paused, or not enough data, stop timer
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

    // Manual Navigation (Always Pauses)
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
                        <img
                            src={`https://openweathermap.org/img/wn/${current.weather[0].icon}@4x.png`}
                            // ✅ MODIFIED: Grayscale + Brightness 200% = Pure White Icon
                            className="w-24 h-24 filter grayscale brightness-200 drop-shadow-[0_0_10px_rgba(255,255,255,0.5)]"
                            alt="icon"
                        />
                        <div className="text-7xl font-bold text-white tracking-tighter">{Math.round(current.main.temp)}°</div>
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-xs font-bold text-gray-300">
                        <div className="bg-white/10 rounded p-2 flex flex-col items-center">
                            <Thermometer size={16} className="text-red-400 mb-1" />
                            <span>{Math.round(current.main.feels_like)}°</span>
                            <span className="text-gray-500">FEELS LIKE</span>
                        </div>
                        <div className="bg-white/10 rounded p-2 flex flex-col items-center">
                            <div className="flex items-center gap-1 mb-1">
                                <Wind size={16} className="text-gray-400" />
                                {/* ✅ MODIFIED: Bold White Arrow */}
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
                    </div>
                </div>

                <div className="flex-grow overflow-y-auto bg-gray-800 p-4 space-y-3">
                    <h3 className="text-xs font-bold text-gray-500 uppercase flex items-center gap-2 mb-2 sticky top-0 bg-gray-800 py-2 z-10"><Calendar size={14} /> 5-Day Forecast</h3>
                    {Object.entries(dailyForecast).slice(0, 5).map(([day, items]) => {
                        const maxTemp = Math.max(...items.map(i => i.main.temp));
                        const minTemp = Math.min(...items.map(i => i.main.temp));
                        const midItem = items[Math.floor(items.length / 2)];
                        return (
                            <div key={day} className="flex items-center justify-between bg-gray-700/50 p-3 rounded-lg border border-gray-600">
                                <div className="w-12 font-bold text-gray-200">{day}</div>
                                <div className="flex items-center gap-2 flex-grow justify-center">
                                    <img
                                        src={`https://openweathermap.org/img/wn/${midItem.weather[0].icon}.png`}
                                        // ✅ MODIFIED: Pure White Icons in List
                                        className="w-8 h-8 filter grayscale brightness-200"
                                        alt="icon"
                                    />
                                    <span className="text-xs text-gray-400 font-bold uppercase w-20">{midItem.weather[0].main}</span>
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