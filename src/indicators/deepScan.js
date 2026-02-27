/**
 * 🔍 nyoGyi Deep Scan Module
 * Handles Accumulation detection and range analysis.
 */

class DeepScan {
    /**
     * Accumulation Check
     * Logic: Stable price (low range) + High volume relative to past days.
     */
    static analyzeAccumulation(candles1h) {
        const highs = candles1h.map(c => c.h);
        const lows = candles1h.map(c => c.l);
        const maxPrice = Math.max(...highs);
        const minPrice = Math.min(...lows);
        const rangePercent = ((maxPrice - minPrice) / minPrice) * 100;

        const avgVolume = candles1h.reduce((s, c) => s + c.v, 0) / candles1h.length;
        const currentVolume = candles1h[candles1h.length - 1].v;

        return {
            isStable: rangePercent < 5, // Less than 5% movement in 24h
            range: rangePercent.toFixed(2),
            volStrength: (currentVolume / avgVolume).toFixed(2),
            isAccumulating: rangePercent < 5 && currentVolume > avgVolume * 1.2
        };
    }

    /**
     * Predict Next Hour Direction
     * Based on EMA and Volume trend.
     */
    static predictTrend(candles15m) {
        const last = candles15m[candles15m.length - 1];
        const prev = candles15m[candles15m.length - 2];
        
        if (last.c > prev.c && last.v > prev.v) return 'BULLISH_STRENGTH';
        if (last.c < prev.c && last.v > prev.v) return 'BEARISH_STRENGTH';
        return 'NEUTRAL';
    }
}

    /**
     * Liquidity Check
     * Simple check based on 24h volume.
     */
    static checkLiquidity(quoteVolume, minVolume = 10000000) {
        return parseFloat(quoteVolume) > minVolume;
    }

    /**
     * Fair Value Gap (FVG) Detection
     * Bullish FVG: low[0] > high[2] (candle 0 is current, candle 2 is 2 candles ago)
     * Bearish FVG: high[0] < low[2]
     * Candles array should be ordered from oldest to newest.
     */
    static findFairValueGaps(candles) {
        const fvgs = [];
        if (candles.length < 3) return fvgs;

        for (let i = 2; i < candles.length; i++) {
            const candle0 = candles[i];     // Current candle
            const candle1 = candles[i - 1]; // Middle candle
            const candle2 = candles[i - 2]; // Oldest candle

            // Bullish FVG: Low of candle0 > High of candle2
            if (candle0.l > candle2.h && candle0.l > candle1.h && candle1.l > candle2.h) {
                fvgs.push({ type: 'BULLISH', start: candle2.h, end: candle0.l, candleIndex: i });
            }
            // Bearish FVG: High of candle0 < Low of candle2
            else if (candle0.h < candle2.l && candle0.h < candle1.l && candle1.h < candle2.l) {
                fvgs.push({ type: 'BEARISH', start: candle0.h, end: candle2.l, candleIndex: i });
            }
        }
        return fvgs;
    }
}

module.exports = DeepScan;
