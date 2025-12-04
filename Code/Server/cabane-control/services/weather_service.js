// ============================================================
// 🌦️ WEATHER SERVICE (Server-Side Fetcher)
// ============================================================
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./cabane.db');

let ioRef = null;
let locations = [];
let weatherCache = []; // Stores the latest successful data
let updateIntervalMs = 15 * 60 * 1000; // Default 15m

// 429 Protection
let isBanned = false;
let banReleaseTime = 0;
let fetchTimer = null;

function init(io) {
    ioRef = io;
    reloadSettings();
}

function reloadSettings() {
    // Load locations and interval from DB
    db.all("SELECT key, value FROM system_settings WHERE key IN ('weather_locations', 'weather_update_interval')", (err, rows) => {
        if (rows) {
            rows.forEach(row => {
                if (row.key === 'weather_locations') {
                    try { locations = JSON.parse(row.value); } catch (e) { locations = []; }
                }
                if (row.key === 'weather_update_interval') {
                    updateIntervalMs = (parseInt(row.value) || 15) * 60 * 1000;
                }
            });
        }
        // Restart Loop
        startFetchLoop();
    });
}

function startFetchLoop() {
    if (fetchTimer) clearInterval(fetchTimer);

    // Run immediately, then on interval
    performFetch();
    fetchTimer = setInterval(performFetch, updateIntervalMs);
}

async function performFetch() {
    if (locations.length === 0) return;

    // 1. Check 429 Ban
    if (isBanned) {
        const now = Date.now();
        if (now < banReleaseTime) {
            console.log(`[WEATHER] API Banned. Waiting until ${new Date(banReleaseTime).toLocaleTimeString()}`);
            return;
        } else {
            console.log("[WEATHER] Ban lifted. Resuming fetches.");
            isBanned = false;
        }
    }

    console.log("[WEATHER] Fetching data for", locations.length, "cities...");
    const newCache = [];

    // 2. Fetch Data
    for (const loc of locations) {
        // Small delay between requests to be nice to the API
        await new Promise(r => setTimeout(r, 500));

        try {
            const lat = parseFloat(loc.lat);
            const lon = parseFloat(loc.lon);
            if (isNaN(lat) || isNaN(lon)) continue;

            const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,apparent_temperature,wind_speed_10m,wind_direction_10m,precipitation&temperature_unit=celsius&wind_speed_unit=kmh&precipitation_unit=mm`;

            const response = await fetch(url);

            if (response.status === 429) {
                console.error("[WEATHER] 429 Too Many Requests! Pausing for 1 hour.");
                isBanned = true;
                banReleaseTime = Date.now() + (60 * 60 * 1000); // 1 Hour
                return; // Stop fetching immediately
            }

            if (!response.ok) {
                console.error(`[WEATHER] HTTP Error ${response.status} for ${loc.name}`);
                continue;
            }

            const data = await response.json();

            // Structure data for Frontend
            newCache.push({
                name: loc.name,
                data: data.current,
                timestamp: Date.now()
            });

        } catch (e) {
            console.error("[WEATHER] Network Error:", e.message);
        }
    }

    // 3. Update Cache & Broadcast
    if (newCache.length > 0) {
        weatherCache = newCache;
        if (ioRef) ioRef.emit('WEATHER_UPDATE', weatherCache);
        console.log("[WEATHER] Update sent to clients.");
    }
}

// Helper to send current cache to new clients immediately
function sendCurrentTo(socket) {
    if (weatherCache.length > 0) {
        socket.emit('WEATHER_UPDATE', weatherCache);
    }
}

module.exports = { init, reloadSettings, sendCurrentTo };