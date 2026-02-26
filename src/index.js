import axios from 'axios';
import fs from 'fs';
import crypto from 'crypto';

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
    TP_ROI: 20,
    SL_ROI: -15,
    WATCHLIST_PATH: './refined_watchlist.json',
    STATE_PATH: './engine_state.json',
    BASE_URL: 'https://fapi.binance.com' // Futures API
};

let state = {
    mode: 'SCANNING', // SCANNING, PENDING_ORDER, IN_POSITION
    activeSymbol: null,
    lastP1Run: null,
    lastScalpRun: null,
    pnl: 0
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
    console.log("\n[UTC 04:00] 🔍 Executing Morning Volume Spike Filter...");
    const res = await axios.get('https://api.binance.com/api/v3/ticker/24hr');
    const pairs = res.data.filter(t => t.symbol.endsWith('USDT') && parseFloat(t.quoteVolume) > 5000000);
    
    let candidates = [];
    for (const p of pairs.slice(0, 50)) {
        const k5m = await getKlines(p.symbol, '5m', 10);
        const avgV = k5m.slice(0,-1).reduce((s, x) => s + x.v, 0)/9;
        if (k5m[k5m.length-1].v > avgV * 3) {
            // DEEP SCAN: Check 24h stability (Accumulation)
            const k1h = await getKlines(p.symbol, '1h', 24);
            const range = ((Math.max(...k1h.map(x=>x.h)) - Math.min(...k1h.map(x=>x.l))) / Math.min(...k1h.map(x=>x.l))) * 100;
            if (range < 6) {
                candidates.push(p.symbol);
                console.log(`⭐ Watchlist Gold: ${p.symbol} (Range: ${range.toFixed(2)}%)`);
            }
        }
    }
    fs.writeFileSync(CONFIG.WATCHLIST_PATH, JSON.stringify(candidates));
}

// --- PHASE 3: 4H SCALP & EXECUTION ---
async function runScalpLogic() {
    if (!fs.existsSync(CONFIG.WATCHLIST_PATH)) return;
    const watchlist = JSON.parse(fs.readFileSync(CONFIG.WATCHLIST_PATH));
    console.log(`\n🏹 Scalp Check (${watchlist.length} pairs)...`);

    for (const s of watchlist) {
        const k1h = await getKlines(s, '1h', 3);
        const k15m = await getKlines(s, '15m', 3);
        
        // TREND ANALYSIS
        const isUpTrend = k1h[2].c > k1h[1].c;
        const isEntrySignal = k15m[2].c > k15m[1].c && k15m[2].c > k15m[2].h * 0.998;

        if (isUpTrend && isEntrySignal) {
            console.log(`🎯 SNIPER FOUND: LONG ${s} at ${k15m[2].c}`);
            await executeTrade(s, 'BUY', k15m[2].c);
            break; // Stop scanning once we initiate an order
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
    saveState();
}

async function monitorPosition() {
    if (!state.activeSymbol) return;
    const pos = await binanceRequest('GET', '/fapi/v2/positionRisk', { symbol: state.activeSymbol });
    if (pos && pos[0]) {
        const amt = parseFloat(pos[0].positionAmt);
        if (amt !== 0) {
            state.mode = 'IN_POSITION';
            state.pnl = pos[0].unRealizedProfit;
            console.log(`\r[LIVE PNL] ${state.activeSymbol}: ${state.pnl} USDT          `);
        } else if (state.mode === 'IN_POSITION') {
            console.log("\n✅ Position Closed. Resetting Cycle.");
            state.mode = 'SCANNING';
            state.activeSymbol = null;
        }
    }
    saveState();
}

// --- CORE ENGINE LOOP ---
function saveState() { fs.writeFileSync(CONFIG.STATE_PATH, JSON.stringify(state)); }

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

    if (h % 4 === 0 && h >= 8) {
        const key = `${now.getUTCDate()}-${h}`;
        if (state.lastScalpRun !== key) {
            await runScalpLogic();
            state.lastScalpRun = key;
        }
    }
}, 15000);

console.log("🚀 nyoGyi Master Engine v5.0 Online. Monitoring UTC 4/8/12/16/20/0 slots.");
