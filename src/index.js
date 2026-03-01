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
    TP_ROI: 0.01, // Take Profit at 1% price move (20% ROI at 20x leverage)
    SL_ROI: 0.01,     // -1% SL (20% risk at 20x leverage)
    BE_PROFIT: 0.005, // Move SL to entry at 0.5% profit (10% ROI at 20x leverage)
    WATCHLIST_PATH: './watchlist.json',
    WATCHLIST_EXPIRY_DAYS: 5,
    STATE_PATH: './engine_state.json',
    BASE_URL: 'https://fapi.binance.com' // Futures API
};

let state = {
    mode: 'SCANNING', // SCANNING, IN_POSITION
    activeSymbol: null,
    lastMorningScan: null,
    lastScalpScan: null,
    pnl: 0,
    watchlist: [], // { symbol: 'BTCUSDT', expiry: timestamp }
    breakEvenHit: false, // Track if SL has been moved to break-even
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
        const res = await axios.get(`https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
        return res.data.map(k => ({ t: k[0], o: parseFloat(k[1]), h: parseFloat(k[2]), l: parseFloat(k[3]), c: parseFloat(k[4]), v: parseFloat(k[5]) }));
    } catch (e) { return []; }
}

const saveState = () => {
    fs.writeFileSync(CONFIG.STATE_PATH, JSON.stringify(state, null, 2));
};

const loadState = () => {
    if (fs.existsSync(CONFIG.STATE_PATH)) {
        state = JSON.parse(fs.readFileSync(CONFIG.STATE_PATH, 'utf8'));
        // Ensure numeric values are parsed correctly if they were strings
        if (state.currentPosition) {
            state.currentPosition.entryPrice = parseFloat(state.currentPosition.entryPrice);
            state.currentPosition.sl = parseFloat(state.currentPosition.sl);
            state.currentPosition.tp = parseFloat(state.currentPosition.tp);
        }
    }
    if (fs.existsSync(CONFIG.WATCHLIST_PATH)) {
        state.watchlist = JSON.parse(fs.readFileSync(CONFIG.WATCHLIST_PATH, 'utf8'));
    }
};

const saveWatchlist = () => {
    fs.writeFileSync(CONFIG.WATCHLIST_PATH, JSON.stringify(state.watchlist, null, 2));
};

const loadWatchlist = () => {
    if (fs.existsSync(CONFIG.WATCHLIST_PATH)) {
        return JSON.parse(fs.readFileSync(CONFIG.WATCHLIST_PATH, 'utf8'));
    }
    return [];
};

// --- PHASE 1: MORNING SPIKE SCAN (UTC 04:00) ---
async function runMorningScan() {
    console.log("\n[UTC 04:00] 🔍 Executing Morning 15m Volume Spike Filter...");
    const res = await axios.get("https://fapi.binance.com/fapi/v1/ticker/24hr");
    const pairs = res.data.filter(t => t.symbol.endsWith("USDT"));
    
    let newCandidates = [];
    for (const p of pairs.slice(0, 50)) { // Limit to first 50 for efficiency
        const k15m = await getKlines(p.symbol, "15m", 10); // Use 15m klines
        if (k15m.length < 10) continue;
        const avgV = k15m.slice(0,-1).reduce((s, x) => s + x.v, 0)/9;
        if (k15m[k15m.length-1].v > avgV * 3) { // 3x average volume spike
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
    const expiryTime = now + CONFIG.WATCHLIST_EXPIRY_DAYS * 24 * 60 * 60 * 1000; // 5 days expiry

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
    console.log(`Morning scan complete. Watchlist size: ${state.watchlist.length}`);
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
        console.log(`Checking ${symbol} for scalp opportunity...`);

        // 1. 4H Trend Filter (Macro Trend)
        const k4h = await getKlines(symbol, '4h', 50); // Need enough data for EMA 50
        if (k4h.length < 50) continue;
        const prices4h = k4h.map(k => k.c);
        const ema50_4h = Indicators.ema(prices4h, 50); 
        if (ema50_4h.length === 0) continue;
        const lastEma50_4h = ema50_4h[ema50_4h.length - 1];
        const lastPrice4h = prices4h[prices4h.length - 1];

        let tradeDirection = null;
        if (lastPrice4h > lastEma50_4h) {
            tradeDirection = 'LONG';
        } else if (lastPrice4h < lastEma50_4h) {
            tradeDirection = 'SHORT';
        } else {
            console.log(`[4H Filter] Skipping ${symbol}: Price is neutral to 4H EMA 50 proxy.`);
            continue;
        }

        // 2. 5m EMA Crossover Check
        const k5m = await getKlines(symbol, '5m', 30); // Need enough data for EMA 21
        if (k5m.length < 21) continue; 

        const prices5m = k5m.map(k => k.c); // Closing prices
        const ema8_5m = Indicators.ema(prices5m, 8);
        const ema21_5m = Indicators.ema(prices5m, 21);

        if (ema8_5m.length === 0 || ema21_5m.length === 0) continue;

        const lastEma8_5m = ema8_5m[ema8_5m.length - 1];
        const prevEma8_5m = ema8_5m[ema8_5m.length - 2];
        const lastEma21_5m = ema21_5m[ema21_5m.length - 1];
        const prevEma21_5m = ema21_5m[ema21_5m.length - 2];

        // Check for EMA 8/21 crossover
        let emaCrossSignal = null;
        if (prevEma8_5m <= prevEma21_5m && lastEma8_5m > lastEma21_5m) {
            emaCrossSignal = 'BULLISH';
        } else if (prevEma8_5m >= prevEma21_5m && lastEma8_5m < lastEma21_5m) {
            emaCrossSignal = 'BEARISH';
        }

        if (!emaCrossSignal) {
            console.log(`${symbol}: No EMA crossover.`);
            continue;
        }

        // 3. FVG Confirmation (on 5m candles)
        const { fvg } = await DeepScan.deepScan(symbol, '5m', 50); // Check FVG on 5m candles
        let hasFvgConfirmation = false;

        if (emaCrossSignal === 'BULLISH' && tradeDirection === 'LONG' && fvg && fvg.type === 'BULLISH') {
            hasFvgConfirmation = true;
        } else if (emaCrossSignal === 'BEARISH' && tradeDirection === 'SHORT' && fvg && fvg.type === 'BEARISH') {
            hasFvgConfirmation = true;
        }

        if (!hasFvgConfirmation) {
            console.log(`${symbol}: No FVG confirmation for ${emaCrossSignal} setup.`);
            continue;
        }

        // All conditions met, execute trade
        console.log(`Opportunity found for ${symbol}: ${emaCrossSignal} with ${tradeDirection} trend and FVG confirmation.`);
        await executeTrade(symbol, tradeDirection === 'LONG' ? 'BUY' : 'SELL', prices5m[prices5m.length - 1]);
        break; // Only one trade at a time
    }
}

async function executeTrade(symbol, side, entryPrice) {
    console.log(`🚀 Executing ${side} trade for ${symbol} at ${entryPrice}...`);

    // Set leverage
    await binanceRequest('POST', '/fapi/v1/leverage', { symbol, leverage: CONFIG.LEVERAGE });

    // Calculate quantity based on USDT amount and entry price
    const quantity = (CONFIG.TRADE_AMOUNT_USDT * CONFIG.LEVERAGE) / entryPrice;

    // Place LIMIT order (for simplicity, using market for now in backtest logic)
    // In live trading, you'd use a LIMIT order for better entry control
    // const order = await placeOrder(symbol, side, 'LIMIT', 'GTC', quantity.toFixed(pair.quantityPrecision), entryPrice.toFixed(pair.pricePrecision));
    
    // For backtesting purposes, assume market order fills at entryPrice
    state.currentPosition = {
        symbol,
        side,
        entryPrice,
        entryTime: Date.now(),
        sl: side === 'BUY' ? entryPrice * (1 - CONFIG.SL_ROI) : entryPrice * (1 + CONFIG.SL_ROI),
        tp: side === 'BUY' ? entryPrice * (1 + CONFIG.TP_ROI) : entryPrice * (1 - CONFIG.TP_ROI),
        be_hit: false,
    };
    console.log('Trade executed:', state.currentPosition);
    saveState();
}

async function monitorPosition() {
    if (!state.currentPosition) return;

    const { symbol, side, entryPrice, sl, tp, be_hit } = state.currentPosition;
    console.log(`Monitoring ${symbol} (${side}). Entry: ${entryPrice.toFixed(4)}, SL: ${sl.toFixed(4)}, TP: ${tp.toFixed(4)}`);

    const klines = await getKlines(symbol, '1m', 2); // Get last 2 candles
    if (klines.length < 2) return;

    const currentPrice = klines[klines.length - 1].c;
    const currentHigh = klines[klines.length - 1].h;
    const currentLow = klines[klines.length - 1].l;

    let positionClosed = false;

    // Check Take Profit
    if ((side === 'BUY' && currentHigh >= tp) || (side === 'SELL' && currentLow <= tp)) {
        console.log(`TAKE PROFIT for ${symbol} (${side}) at ${currentPrice.toFixed(4)}`);
        // In live trading, close position here
        state.currentPosition = null;
        positionClosed = true;
    }

    // Check Stop Loss / Break-Even
    if (!positionClosed) {
        if ((side === 'BUY' && currentLow <= sl) || (side === 'SELL' && currentHigh >= sl)) {
            console.log(`STOP LOSS / BREAK-EVEN for ${symbol} (${side}) at ${currentPrice.toFixed(4)}`);
            // In live trading, close position here
            state.currentPosition = null;
            positionClosed = true;
        }
    }

    // Move Stop Loss to Break-Even
    if (!positionClosed && !be_hit) {
        const profit_pct = side === 'BUY' 
            ? (currentHigh - entryPrice) / entryPrice 
            : (entryPrice - currentLow) / entryPrice;

        if (profit_pct >= CONFIG.BE_PROFIT) {
            state.currentPosition.sl = entryPrice; // Move SL to entry price
            state.currentPosition.be_hit = true;
            console.log(`SL moved to Break-Even for ${symbol} (${side}).`);
        }
    }

    saveState();
}

// --- MAIN ENGINE LOOP ---
const runEngine = async () => {
    loadState();
    console.log('nyoGyi Trading Engine Started.');
    console.log('Current State:', state);

    setInterval(async () => {
        const now = new Date();
        const utcHours = now.getUTCHours();
        const utcMinutes = now.getUTCMinutes();

        // Run Morning Scan at UTC 04:00
        if (utcHours === 4 && utcMinutes === 0 && (Date.now() - (state.lastMorningScan || 0) > 60 * 60 * 1000)) { // Run once per hour around 04:00 UTC
            if (!state.currentPosition) { // Only scan if no open position
                state.scanLock = true;
                console.log('Triggering morning scan...');
                await runMorningScan();
                state.lastMorningScan = Date.now();
                state.scanLock = false;
            }
        }

        // Run Scalp Logic at specified UTC hours (8, 12, 16, 20, 0, 4) and if no open position
        const scalpHours = [0, 4, 8, 12, 16, 20];
        if (scalpHours.includes(utcHours) && utcMinutes === 0 && (Date.now() - (state.lastScalpScan || 0) > 60 * 60 * 1000)) { // Run once per hour around specified UTC hours
            if (!state.currentPosition) { // Only scan if no open position
                state.scanLock = true;
                console.log('Triggering scalp logic...');
                await runScalpLogic();
                state.lastScalpScan = Date.now();
                state.scanLock = false;
            }
        }

        // Always monitor current position if one exists
        if (state.currentPosition) {
            await monitorPosition();
        }

    }, 15 * 1000); // Run every 15 seconds
};

runEngine();
