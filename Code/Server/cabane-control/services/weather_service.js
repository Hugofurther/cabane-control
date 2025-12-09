// ============================================================
// 🌦️ WEATHER SERVICE (OpenWeatherMap - Optimized)
// ============================================================
const axios = require('axios');
const db = require('sqlite3').verbose();
const database = new db.Database('./cabane.db');

let ioRef = null;
let intervalCurrentRef = null;
let intervalForecastRef = null;

// Configuration
let config = {
    apiKey: '',
    apiLimitMin: 60,
    apiLimitMonth: 1000000,
    locations: [],
    updateIntervalCurrent: 15,
    updateIntervalForecast: 60,
};

// Data Store
let weatherCache = {};

function init(io) {
    ioRef = io;
    loadSettings();
}

function loadSettings() {
    database.all("SELECT key, value FROM system_settings", (err, rows) => {
        if (rows) {
            rows.forEach(row => {
                if (row.key === 'weather_api_key') config.apiKey = row.value;
                if (row.key === 'weather_locations') {
                    try { config.locations = JSON.parse(row.value); } catch (e) { }
                }
                if (row.key === 'weather_update_interval') config.updateIntervalCurrent = parseInt(row.value) || 15;
                if (row.key === 'weather_update_interval_forecast') config.updateIntervalForecast = parseInt(row.value) || 60;

                if (row.key === 'weather_api_limit_min') config.apiLimitMin = parseInt(row.value) || 60;
                if (row.key === 'weather_api_limit_month') config.apiLimitMonth = parseInt(row.value) || 1000000;
            });

            startService();
        }
    });
}

function reloadSettings() {
    loadSettings();
}

function calculateSafeIntervals() {
    const activeLocs = config.locations.filter(l => l.enabled).length;
    if (activeLocs === 0) return { current: 9999, forecast: 9999 };

    const safeLimitMin = config.apiLimitMin * 0.9;

    // Check Minute Limit
    const callsPerMin = (activeLocs / config.updateIntervalCurrent) + (activeLocs / config.updateIntervalForecast);

    // Check Monthly Limit (Approx 43200 mins/month)
    const totalMonthlyCalls = callsPerMin * 43200;
    const safeLimitMonth = config.apiLimitMonth * 0.95;

    let ratio = 1;

    if (callsPerMin > safeLimitMin) {
        ratio = Math.max(ratio, callsPerMin / safeLimitMin);
    }
    if (totalMonthlyCalls > safeLimitMonth) {
        console.warn(`[Weather] Exceeds Monthly Limit! Throttling.`);
        ratio = Math.max(ratio, totalMonthlyCalls / safeLimitMonth);
    }

    return {
        current: Math.ceil(config.updateIntervalCurrent * ratio),
        forecast: Math.ceil(config.updateIntervalForecast * ratio)
    };
}

function startService() {
    if (intervalCurrentRef) clearInterval(intervalCurrentRef);
    if (intervalForecastRef) clearInterval(intervalForecastRef);

    const activeLocations = config.locations.filter(l => l.enabled);

    if (!config.apiKey || activeLocations.length === 0) {
        ioRef?.emit('WEATHER_FULL_UPDATE', []);
        return;
    }

    // Force immediate broadcast to remove disabled items from UI
    broadcastData();

    const safe = calculateSafeIntervals();
    console.log(`[Weather] Active: ${activeLocations.length}. Freq: ${safe.current}m / ${safe.forecast}m.`);

    fetchWeatherData('BOTH');

    intervalCurrentRef = setInterval(() => fetchWeatherData('CURRENT'), safe.current * 60 * 1000);
    intervalForecastRef = setInterval(() => fetchWeatherData('FORECAST'), safe.forecast * 60 * 1000);
}

async function fetchWeatherData(type) {
    if (!config.apiKey) return;
    const activeLocations = config.locations.filter(l => l.enabled);

    for (const loc of activeLocations) {
        const key = `${loc.lat},${loc.lon}`;
        if (!weatherCache[key]) weatherCache[key] = { locationName: loc.name, current: null, forecast: null };

        try {
            if (type === 'BOTH' || type === 'CURRENT') {
                const url = `https://api.openweathermap.org/data/2.5/weather?lat=${loc.lat}&lon=${loc.lon}&units=metric&appid=${config.apiKey}`;
                const res = await axios.get(url);
                weatherCache[key].current = res.data;
            }

            if (type === 'BOTH' || type === 'FORECAST') {
                const url = `https://api.openweathermap.org/data/2.5/forecast?lat=${loc.lat}&lon=${loc.lon}&units=metric&appid=${config.apiKey}`;
                const res = await axios.get(url);
                weatherCache[key].forecast = res.data;
            }

            await new Promise(r => setTimeout(r, 100));

        } catch (e) {
            console.error(`[Weather] Error for ${loc.name}:`, e.message);
        }
    }

    broadcastData();
}

function broadcastData() {
    if (!ioRef) return;

    // ✅ CRITICAL FIX: Only send data for currently ENABLED locations
    // This filters out "Cached but Disabled" cities
    const activeCoords = new Set(config.locations.filter(l => l.enabled).map(l => `${l.lat},${l.lon}`));

    const dataArray = Object.entries(weatherCache)
        .filter(([key, val]) => activeCoords.has(key) && val.current && val.forecast)
        .map(([key, val]) => val);

    ioRef.emit('WEATHER_FULL_UPDATE', dataArray);
}

function sendCurrentTo(socket) {
    // Same filter logic for new connections
    const activeCoords = new Set(config.locations.filter(l => l.enabled).map(l => `${l.lat},${l.lon}`));
    const dataArray = Object.entries(weatherCache)
        .filter(([key, val]) => activeCoords.has(key) && val.current && val.forecast)
        .map(([key, val]) => val);

    socket.emit('WEATHER_FULL_UPDATE', dataArray);
}

module.exports = { init, reloadSettings, sendCurrentTo };