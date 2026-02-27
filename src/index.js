import axios from 'axios';
import fs from 'fs';
import crypto from 'crypto';
import Indicators from './indicators/technical.js';
import DeepScan from './indicators/deepScan.js';

/**
 * 🏆 NYOGYI ULTIMATE TRADING ENGINE v5.0 (THE MASTER BRAIN)
 * 
 * Logic flow:
 * 1. UTC 04:00: 5m Volume Spike Scan -> Deep Scan -> Watchlist
 * 2. UTC 08:00+ (4h intervals): Scalp Scan (1H Trend + 15m Sniper)
 * 3. Lock System: Stop all scans if Order/Position is active.
 * 4. Real-time PnL: Stream PnL to user when in position.
 * 5. Auto-Reset: Restart cycle after exit.
 */

const CONFIG = {
    API_KEY: process.env.BINANCE_API_KEY || '',
    API_SECRET: process.env.BINANCE_API_SECRET || '',
    CAPITAL: 30,
    MARGIN: 15,
    LEVERAGE: 20,
    TP_ROI_HIGH: 0.20, // 20%
    TP_ROI_LOW: 0.10,  // 10%
    SL_ROI: -0.20,     // -20%
    WATCHLIST_PATH: './watchlist.json',
    WATCHLIST_EXPIRY_DAYS: 5,
    STATE_PATH: './engine_state.json',
    BASE_URL: 'https://fapi.binance.com' // Futures API
};

let state = {
    mode: 'SCANNING', // SCANNING, PENDING_ORDER, IN_POSITION
    activeSymbol: null,
    lastP1Run: null,
    lastScalpRun: null,
    pnl: 0,
    watchlist: [] // { symbol: 'BTCUSDT', expiry: timestamp }
};

// --- HELPER: SIGNED API REQUESTS ---
async function binanceRequest(method, endpoint, params = {}) {
    const timestamp = Date.now();
    const query = new URLSearchParams({ ...params, timestamp }).toString();
    const signature = crypto.createHmac('sha256', CONFIG.API_SECRET).update(query).digest('hex');
    try {
        const res = await axios({
            method,
            url: `${CONFIG.BASE_URL}${endpoint}?${query}&signature=${signature}`,
            headers: { 'X-MBX-APIKEY': CONFIG.API_KEY }
        });
        return res.data;
    } catch (e) {
        console.error(`API Error (${endpoint}):`, e.response?.data || e.message);
        return null;
    }
}

async function getKlines(symbol, interval, limit) {
    try {
        const res = await axios.get(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
        return res.data.map(k => ({ h: parseFloat(k[2]), l: parseFloat(k[3]), c: parseFloat(k[4]), v: parseFloat(k[5]) }));
    } catch (e) { return []; }
}

// --- PHASE 1: MORNING SPIKE SCAN (UTC 04:00) ---
async function runMorningScan() {
    console.log("\n[UTC 04:00] 🔍 Executing Morning 15m Volume Spike Filter...");
    const res = await axios.get("https://api.binance.com/api/v3/ticker/24hr");
    const pairs = res.data.filter(t => t.symbol.endsWith("USDT") && parseFloat(t.quoteVolume) > 5000000);
    
    let newCandidates = [];
    for (const p of pairs.slice(0, 50)) {
        const k15m = await getKlines(p.symbol, "15m", 10); // Use 15m klines
        if (k15m.length < 10) continue;
        const avgV = k15m.slice(0,-1).reduce((s, x) => s + x.v, 0)/9;
        if (k15m[k15m.length-1].v > avgV * 3) { // 3x average volume spike
            // Add to newCandidates for deep scan later if needed, or directly to watchlist
            newCandidates.push(p.symbol);
            console.log(`Potential candidate from 15m volume spike: ${p.symbol}`);
        }
    }

    // Filter new candidates with Deep Scan (24h stability)
    let refinedCandidates = [];
    for (const symbol of newCandidates) {
        const k1h = await getKlines(symbol, "1h", 24);
        if (k1h.length < 24) continue;
        const range = ((Math.max(...k1h.map(x=>x.h)) - Math.min(...k1h.map(x=>x.l))) / Math.min(...k1h.map(x=>x.l))) * 100;
        if (range < 6) {
            refinedCandidates.push(symbol);
            console.log(`⭐ Watchlist Gold: ${symbol} (Range: ${range.toFixed(2)}%)`);
        }
    }

    // Load existing watchlist, add new candidates, and handle expiry
    let currentWatchlist = loadWatchlist();
    const now = Date.now();
    const expiryTime = now + CONFIG.WATCHLIST_EXPIRY_DAYS * 24 * 60 * 60 * 1000; // 3 days expiry

    for (const symbol of refinedCandidates) {
        const existingIndex = currentWatchlist.findIndex(item => item.symbol === symbol);
        if (existingIndex === -1) {
            currentWatchlist.push({ symbol, expiry: expiryTime });
        } else {
            // Update expiry if already in watchlist
            currentWatchlist[existingIndex].expiry = expiryTime;
        }
    }

    // Filter out expired items
    state.watchlist = currentWatchlist.filter(item => item.expiry > now);
    saveWatchlist();
}

// --- PHASE 3: 4H SCALP & EXECUTION ---
async function runScalpLogic() {
    loadWatchlist(); // Ensure watchlist is loaded and updated
    if (state.watchlist.length === 0) {
        console.log("\n🏹 Scalp Check: Watchlist is empty.");
        return;
    }
    console.log(`\n🏹 Scalp Check (${state.watchlist.length} pairs)...`);

    for (const item of state.watchlist) {
        const symbol = item.symbol;
        // Get 1-hour klines for EMA calculation
        const k1h = await getKlines(symbol, '1h', 30); // Need enough data for EMA 21
        if (k1h.length < 21) continue; // Ensure enough data for EMA 21

        const prices = k1h.map(k => k.c); // Closing prices
        const ema8 = Indicators.ema(prices, 8);
        const ema21 = Indicators.ema(prices, 21);

        if (ema8.length === 0 || ema21.length === 0) continue;

        const lastEma8 = ema8[ema8.length - 1];
        const prevEma8 = ema8[ema8.length - 2];
        const lastEma21 = ema21[ema21.length - 1];
        const prevEma21 = ema21[ema21.length - 2];

        // Check for EMA 8/21 crossover (bullish crossover)
        if (prevEma8 <= prevEma21 && lastEma8 > lastEma21) {
            console.log(`✨ EMA Crossover detected for ${symbol}. Performing Deep Scan...`);
            // Perform Deep Scan (accumulation check) as a confirmation
            const candles1hForDeepScan = await getKlines(symbol, '1h', 24);
            if (candles1hForDeepScan.length < 24) continue;
            const deepScanResult = DeepScan.analyzeAccumulation(candles1hForDeepScan);

            if (deepScanResult.isAccumulating) {
                console.log(`🎯 SNIPER FOUND: LONG ${symbol} at ${k1h[k1h.length-1].c}`);
                await executeTrade(symbol, 'BUY', k1h[k1h.length-1].c);
                break; // Stop scanning once we initiate an order
            }
        }
    }
}

// --- EXECUTION: ORDER & PNL MONITORING ---
async function executeTrade(symbol, side, price) {
    console.log(`🚀 Executing ${side} order for ${symbol}...`);
    // 1. Place Limit Order (Actual API call would go here)
    // For now, we simulate success and move to PENDING_ORDER state
    state.mode = 'PENDING_ORDER';
    state.activeSymbol = symbol;
    state.entryPrice = price;
    state.tpPriceHigh = price * (1 + CONFIG.TP_ROI_HIGH);
    state.tpPriceLow = price * (1 + CONFIG.TP_ROI_LOW);
    state.slPrice = price * (1 + CONFIG.SL_ROI);
    saveState();
}

async function monitorPosition() {
    if (!state.activeSymbol) return;

    // Get current price of active symbol
    const klines = await getKlines(state.activeSymbol, '1m', 1);
    if (klines.length === 0) {
        console.error(`Could not get klines for ${state.activeSymbol} during monitoring.`);
        return;
    }
    const currentPrice = klines[0].c;

    // Check for Take Profit or Stop Loss
    if (currentPrice >= state.tpPriceHigh || currentPrice <= state.slPrice) {
        console.log(`\n🎯 Closing position for ${state.activeSymbol} at ${currentPrice}. TP/SL hit.`);
        // Simulate closing position (actual API call would go here)
        state.mode = 'SCANNING';
        state.activeSymbol = null;
        state.entryPrice = null;
        state.tpPriceHigh = null;
        state.tpPriceLow = null;
        state.slPrice = null;
        state.pnl = 0; // Reset PnL
        saveState();
        return;
    }

    // Check for lower TP if price starts to drop after reaching a certain profit
    // This is a simplified example, more complex trailing stop/partial close logic can be added
    if (currentPrice >= state.tpPriceLow && currentPrice < state.tpPriceHigh) {
        // Optionally, you could implement a trailing stop or move SL to breakeven here
        // For now, we'll just log that it's in the profit zone
        console.log(`[LIVE PNL] ${state.activeSymbol}: In profit zone (${(currentPrice / state.entryPrice - 1) * 100}%)`);
    }

    const pos = await binanceRequest("GET", "/fapi/v2/positionRisk", { symbol: state.activeSymbol });
    if (pos && pos[0]) {
        const amt = parseFloat(pos[0].positionAmt);
        if (amt !== 0) {
            state.mode = "IN_POSITION";
            state.pnl = pos[0].unRealizedProfit;
            console.log(`\r[LIVE PNL] ${state.activeSymbol}: ${state.pnl} USDT          `);
        } else if (state.mode === "IN_POSITION") {
            console.log("\n✅ Position Closed. Resetting Cycle.");
            state.mode = "SCANNING";
            state.activeSymbol = null;
            state.entryPrice = null;
            state.tpPriceHigh = null;
            state.tpPriceLow = null;
            state.slPrice = null;
            state.pnl = 0; // Reset PnL
        }
    }
    saveState();

    // BTC Monitoring (Placeholder - implement actual logic here)
    if (state.mode === 'IN_POSITION' || state.mode === 'PENDING_ORDER') {
        const btcKlines = await getKlines('BTCUSDT', '1m', 1);
        if (btcKlines.length > 0) {
            console.log(`[BTC Monitor] Current BTCUSDT price: ${btcKlines[0].c}`);
            // Add logic here to react to BTC price movements if needed
        }
    }
}

// --- CORE ENGINE LOOP ---
function saveState() { fs.writeFileSync(CONFIG.STATE_PATH, JSON.stringify(state)); }

function loadWatchlist() {
    if (fs.existsSync(CONFIG.WATCHLIST_PATH)) {
        return JSON.parse(fs.readFileSync(CONFIG.WATCHLIST_PATH));
    }
    return [];
}

function saveWatchlist() {
    fs.writeFileSync(CONFIG.WATCHLIST_PATH, JSON.stringify(state.watchlist));
}

setInterval(async () => {
    const now = new Date();
    const h = now.getUTCHours();

    // 1. Monitor active stuff first (Highest priority)
    if (state.mode === 'IN_POSITION' || state.mode === 'PENDING_ORDER') {
        await monitorPosition();
        return; // LOCK: Stop all scanning
    }

    // 2. Scheduled Scans
    if (h === 4 && state.lastP1Run !== now.getUTCDate()) {
        await runMorningScan();
        state.lastP1Run = now.getUTCDate();
    }

    // Trigger runScalpLogic at 8, 12, 16, 20, 00 UTC
    if ((h === 8 || h === 12 || h === 16 || h === 20 || h === 0) && state.lastScalpRun !== `${now.getUTCDate()}-${h}`) {
        await runScalpLogic();
        state.lastScalpRun = `${now.getUTCDate()}-${h}`;
    }
}, 15000);

console.log("🚀 nyoGyi Master Engine v5.0 Online. Monitoring UTC 4/8/12/16/20/0 slots.");
