const { getKlines } = require("../utils/binance");

const deepScan = async (symbol, interval = "1h", limit = 100) => {
    const klines = await getKlines(symbol, interval, limit);
    if (!klines || klines.length === 0) {
        return { accumulation: 0, fvg: null };
    }

    // Simple Accumulation/Distribution (example: sum of volume)
    const accumulation = klines.reduce((sum, kline) => sum + parseFloat(kline[5]), 0); // kline[5] is volume

    // FVG Detection (simplified for direct entry)
    let fvg = null;
    for (let i = 2; i < klines.length; i++) {
        const high2 = parseFloat(klines[i-2][2]);
        const low2 = parseFloat(klines[i-2][3]);
        const high1 = parseFloat(klines[i-1][2]);
        const low1 = parseFloat(klines[i-1][3]);
        const high0 = parseFloat(klines[i][2]);
        const low0 = parseFloat(klines[i][3]);

        // Bullish FVG: Low of current candle > High of 2 candles ago
        if (low0 > high2 && low1 > high2) {
            fvg = { type: "BULLISH", low: high2, high: low0 };
            break;
        }
        // Bearish FVG: High of current candle < Low of 2 candles ago
        else if (high0 < low2 && high1 < low2) {
            fvg = { type: "BEARISH", low: high0, high: low2 };
            break;
        }
    }

    return { accumulation, fvg };
};

module.exports = { deepScan };
