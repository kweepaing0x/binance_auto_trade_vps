# 🏆 nyoGyi Ultimate Trading Engine v5.0

A professional-grade crypto trading system designed for **Accumulation Sniping** and **Automated Scalping**. Built for execution on AWS VPS with high-frequency monitoring and real-time PnL reporting.

## 🚀 Key Features

- **Multi-Phase Pipeline:**
    - **Phase 1 (UTC 04:00):** Global market filter using 5m Volume Spikes.
    - **Phase 2 (Deep Scan):** Automated 24h accumulation and range analysis.
    - **Phase 3 (UTC 08:00+):** 4-hour recurring scalp cycles (1H Trend + 15m Momentum).
- **Embedded Indicators:** Full custom implementation of RSI, Bollinger Bands, ADX, and EMA.
- **Safety Locks:** Automated "Scan Lock" when a position or order is active.
- **Real-time Monitoring:** Direct API connection for live PnL and position tracking.

## 📁 Repository Structure

```text
nyogyi-ultimate-trader/
├── src/
│   ├── indicators/
│   │   ├── technical.js      # RSI, BB, ADX, EMA core logic
│   │   └── deepScan.js       # Accumulation & Prediction engine
│   ├── strategy/
│   │   └── timelineEngine.js # The UTC 4/8 execution logic
│   ├── execution/
│   │   └── binanceTrader.js  # API-signed order execution
│   └── index.js              # System master controller
├── .env.example              # API Key template
├── package.json              # System dependencies
└── README.md                 # Documentation
```

## 🛠️ Installation & Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/ykweepaing0x
   /nyogyi-ultimate-trader.git
   cd nyogyi-ultimate-trader
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure Environment:**
   Edit `.env` with your Binance API Key and Secret.

4. **Run with PM2 (Recommended):**
   ```bash
   pm2 start src/index.js --name "nyogyi-engine"
   ```

## 🐻 nyoGyi Principles
- **"I do not predict. I react."**
- **Facts > Sentiment.**
- **Capital protection is Priority #1.**

---
*Disclaimer: Trading involves risk. Use this system at your own discretion.*
