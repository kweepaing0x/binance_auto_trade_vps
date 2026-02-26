/**
 * 📊 nyoGyi Technical Indicators Library
 * A professional-grade collection of technical analysis functions.
 */

class Indicators {
    // 1. RSI (Relative Strength Index)
    static rsi(prices, period = 14) {
        if (prices.length < period + 1) return [];
        let gains = [];
        let losses = [];
        for (let i = 1; i < prices.length; i++) {
            let diff = prices[i] - prices[i - 1];
            gains.push(Math.max(0, diff));
            losses.push(Math.max(0, -diff));
        }
        let avgGain = gains.slice(0, period).reduce((a, b) => a + b) / period;
        let avgLoss = losses.slice(0, period).reduce((a, b) => a + b) / period;
        let rsiValues = [100 - (100 / (1 + avgGain / (avgLoss || 1)))];
        for (let i = period; i < gains.length; i++) {
            avgGain = (avgGain * (period - 1) + gains[i]) / period;
            avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
            rsiValues.push(100 - (100 / (1 + avgGain / (avgLoss || 1))));
        }
        return rsiValues;
    }

    // 2. Bollinger Bands (Upper, Middle, Lower)
    static bollingerBands(prices, period = 20, stdDev = 2) {
        if (prices.length < period) return null;
        const middle = prices.slice(-period).reduce((a, b) => a + b) / period;
        const variance = prices.slice(-period).reduce((a, b) => a + Math.pow(b - middle, 2), 0) / period;
        const sd = Math.sqrt(variance);
        return {
            upper: middle + (sd * stdDev),
            middle: middle,
            lower: middle - (sd * stdDev)
        };
    }

    // 3. ADX (Average Directional Index)
    static adx(candles, period = 14) {
        if (candles.length < period * 2) return 0;
        // Simplified ADX Logic for efficient scan
        const trs = [];
        for (let i = 1; i < candles.length; i++) {
            trs.push(Math.max(
                candles[i].h - candles[i].l,
                Math.abs(candles[i].h - candles[i-1].c),
                Math.abs(candles[i].l - candles[i-1].c)
            ));
        }
        return trs.slice(-period).reduce((a,b)=>a+b)/period; // TR Average proxy
    }

    // 4. EMA (Exponential Moving Average)
    static ema(prices, period) {
        const k = 2 / (period + 1);
        let ema = prices[0];
        for (let i = 1; i < prices.length; i++) {
            ema = (prices[i] * k) + (ema * (1 - k));
        }
        return ema;
    }
}

module.exports = Indicators;
