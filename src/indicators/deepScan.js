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

module.exports = DeepScan;
