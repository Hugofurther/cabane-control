// ============================================================
// 🌦️ WEATHER SERVICE (OpenWeatherMap)
// ============================================================
const axios = require('axios');
const db = require('sqlite3').verbose();
const database = new db.Database('./cabane.db');

let ioRef = null;
let intervalRef = null;

// Configuration
let config = {
    apiKey: '', // stored in system_settings as 'weather_api_key'
    locations: [],
    updateIntervalMin: 15, // User preference
    rotationIntervalSec: 10
};

// State
let weatherData = []; // Array of { location, current, forecast }
let currentIndex = 0;
let rotationTimer = null;

// Rate Limits (OpenWeatherMap Free Tier)
// 60 calls/min, 1M calls/month (~23 calls/min continuous)
const SAFE_CALLS_PER_MIN = 20;

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
                if (row.key === 'weather_update_interval') config.updateIntervalMin = parseInt(row.value) || 15;
            });

            // Recalculate safe interval and restart
            startService();
        }
    });
}

function reloadSettings() {
    loadSettings();
}

function calculateSafeInterval() {
    const numLocs = config.locations.length;
    if (numLocs === 0) return config.updateIntervalMin;

    // 2 calls per location (Current + Forecast)
    const callsPerCycle = numLocs * 2;

    // Max cycles per minute to stay under SAFE_CALLS_PER_MIN
    const maxCyclesPerMin = SAFE_CALLS_PER_MIN / callsPerCycle;

    // Minimum safe interval in minutes
    const minSafeIntervalMin = Math.ceil(1 / maxCyclesPerMin);

    console.log(`[Weather] Cities: ${numLocs}, Calls/Cycle: ${callsPerCycle}. Calc Min Interval: ${minSafeIntervalMin}m.`);

    // Return the larger of the two: User Pref or Safety Limit
    return Math.max(config.updateIntervalMin, minSafeIntervalMin);
}

function startService() {
    if (intervalRef) clearInterval(intervalRef);
    if (rotationTimer) clearInterval(rotationTimer);

    if (!config.apiKey || config.locations.length === 0) {
        console.log("[Weather] Missing API Key or Locations. Service Paused.");
        return;
    }

    const safeIntervalMin = calculateSafeInterval();
    console.log(`[Weather] Starting Update Loop every ${safeIntervalMin} minutes.`);

    // Initial Fetch
    fetchAllWeather();

    // Schedule Fetch
    intervalRef = setInterval(fetchAllWeather, safeIntervalMin * 60 * 1000);
}

async function fetchAllWeather() {
    if (!config.apiKey) return;

    const results = [];

    // Serial fetching to avoid bursting requests
    for (const loc of config.locations) {
        try {
            // 1. Current Weather
            const currentUrl = `https://api.openweathermap.org/data/2.5/weather?lat=${loc.lat}&lon=${loc.lon}&units=metric&appid=${config.apiKey}`;
            const resCurrent = await axios.get(currentUrl);

            // 2. 5-Day Forecast
            const forecastUrl = `https://api.openweathermap.org/data/2.5/forecast?lat=${loc.lat}&lon=${loc.lon}&units=metric&appid=${config.apiKey}`;
            const resForecast = await axios.get(forecastUrl);

            results.push({
                locationName: loc.name,
                current: resCurrent.data,
                forecast: resForecast.data
            });

            // Small delay between calls to be polite
            await new Promise(r => setTimeout(r, 200));

        } catch (e) {
            console.error(`[Weather] Failed for ${loc.name}:`, e.message);
        }
    }

    weatherData = results;
    broadcastData();
}

function broadcastData() {
    if (ioRef) {
        // Send the FULL array so the frontend can handle the detailed modal logic
        ioRef.emit('WEATHER_FULL_UPDATE', weatherData);
    }
}

function sendCurrentTo(socket) {
    socket.emit('WEATHER_FULL_UPDATE', weatherData);
}

module.exports = { init, reloadSettings, sendCurrentTo };