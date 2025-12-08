# 📊 Premium/Discount Zone Trading Bot v2.0

**Professional Smart Money Concepts Zone Detection • AI-Powered Market Analysis • Economic News Integration**

[![Status](https://img.shields.io/badge/Status-Operational-success)]()
[![Version](https://img.shields.io/badge/Version-2.0-blue)]()
[![License](https://img.shields.io/badge/License-MIT-green)]()

---

## 📋 Table of Contents

- [Overview](#-overview)
- [Key Features](#-key-features)
- [What Are Premium/Discount Zones?](#-what-are-premiumdiscount-zones)
- [Installation](#-installation)
- [Configuration](#-configuration)
- [Quick Start](#-quick-start)
- [Telegram Commands](#-telegram-commands)
- [How to Use](#-how-to-use)
- [Architecture](#-architecture)
- [API Integrations](#-api-integrations)
- [Deployment](#-deployment)
- [Troubleshooting](#-troubleshooting)
- [Documentation](#-documentation)
- [Support](#-support)

---

## 🎯 Overview

The **Premium/Discount Zone Trading Bot** is an advanced automated trading signal system that detects potential reversal zones using Smart Money Concepts (SMC). It monitors forex, cryptocurrency, and synthetic pairs across multiple exchanges, providing real-time zone detection, AI-powered analysis, and economic news integration.

### What This Bot Does

- 🔍 **Detects Premium/Discount Zones** using EMA cascading patterns and Stochastic RSI
- 📊 **Multi-Timeframe Analysis** with comprehensive market data (4H, 1H, 15M)
- 🤖 **AI-Powered Analysis** with entry, stop loss, and take profit recommendations
- 📰 **Economic Calendar** integration with automated news broadcasts
- 🔔 **Telegram Notifications** for zones, news, and analysis
- 📈 **Multi-Exchange Support** (Deriv, Bybit, Binance, Kraken)

---

## ✨ Key Features

### 🎯 Zone Detection System

- **Hourly Scans** on 1-hour timeframe
- **Smart Money Concepts** methodology
- **Multi-Exchange Monitoring** (Forex, Crypto, Synthetic pairs)
- **Zone Lifecycle Management** (Active → Expired → History)
- **Consolidated Hourly Reports** with organized zone listings

### 🤖 AI-Powered Analysis

- **Comprehensive Market Data** (30+ data points per analysis)
- **Multi-Timeframe Analysis** (4H, 1H, 15M candles)
- **Technical Indicators** (RSI, MACD, CCI, Stochastic RSI, Bollinger Bands, ATR)
- **Support/Resistance Detection** with strength ratings
- **Market Structure Analysis** (Higher highs/lower lows, swing points)
- **Entry/TP/SL Recommendations** with confluence factors
- **Plain Text Output** for easy reading

### 📰 Economic News Integration

- **Daily Morning Summary** at 06:00 UTC
- **1-Hour-Before Alerts** for high/medium impact events
- **Pair-Specific Filtering** based on monitored currencies
- **FCS API Integration** for economic calendar data
- **Automated Broadcasting** to subscribed channels

### 🔔 Telegram Integration

- **Real-Time Notifications** for zone detections
- **Rich Command Interface** with 20+ commands
- **AI Chat Assistant** for market questions
- **Subscription Management** for groups/channels
- **Owner Privileges** (unlimited AI requests)

### 📊 Advanced Market Analysis

- **Multi-Timeframe Data** (60 x 4H, 168 x 1H, 96 x 15M candles)
- **Technical Indicators** across timeframes
- **Support/Resistance Zones** with strength ratings (1-5)
- **Market Session Detection** (Tokyo, London, New York)
- **Volume Analysis** and order flow insights
- **Daily Summaries** (last 5 days)
- **Risk Management Parameters** (ATR-based calculations)

---

## 🎓 What Are Premium/Discount Zones?

### 🟢 DISCOUNT ZONE (Buy/Long Opportunity)

**Characteristics:**
- Price trading **below** EMAs (20, 38, 62)
- Stochastic RSI **< 30** (oversold territory)
- Price at **discount** relative to fair value
- Smart Money accumulation area
- Potential **BUY/LONG** setup when structure confirms uptrend

**Detection Criteria:**
- EMA alignment: EMA20 < EMA38 < EMA62 (bearish order)
- Stochastic RSI K < 30
- Price below all EMAs
- Market structure showing potential reversal

### 🔴 PREMIUM ZONE (Sell/Short Opportunity)

**Characteristics:**
- Price trading **above** EMAs (20, 38, 62)
- Stochastic RSI **> 70** (overbought territory)
- Price at **premium** relative to fair value
- Smart Money distribution area
- Potential **SELL/SHORT** setup when structure confirms downtrend

**Detection Criteria:**
- EMA alignment: EMA20 > EMA38 > EMA62 (bullish order)
- Stochastic RSI K > 70
- Price above all EMAs
- Market structure showing potential reversal

### Methodology

Zones are detected using **Smart Money Concepts (SMC)** on 1-hour timeframe, combining:
- **EMA Cascading Patterns** (20, 38, 62 periods)
- **Stochastic RSI** (14, 14, 3, 3)
- **Market Structure Analysis** (swing highs/lows)
- **Multi-Timeframe Confluence**

---

## 🚀 Installation

### Prerequisites

- **Node.js** v18+ (recommended: v20+)
- **npm** or **yarn**
- **Telegram Bot Token** ([Get one here](https://t.me/BotFather))
- **Firebase Project** with Firestore enabled
- **API Keys** (see Configuration section)

### Step 1: Clone Repository

```bash
git clone <repository-url>
cd "node versionof signal bot"
```

### Step 2: Install Dependencies

```bash
npm install
```

### Step 3: Environment Configuration

Create a `.env` file in the root directory:

```bash
cp .env.example .env
# Edit .env with your credentials
```

### Step 4: Configure Firebase

1. Download Firebase service account key
2. Save as `firebase-key.json` in root directory
3. Ensure Firestore is enabled in Firebase Console

### Step 5: Start Bot

**Development:**
```bash
npm run dev
```

**Production (PM2):**
```bash
npm run pm2:start
```

---

## ⚙️ Configuration

### Required Environment Variables

```env
# Telegram Bot
TELEGRAM_BOT_TOKEN=your_bot_token_here
TELEGRAM_OWNER_CHAT_ID=your_telegram_user_id
TELEGRAM_BROADCAST_CHANNEL_ID=optional_channel_id

# Firebase
FIREBASE_PROJECT_ID=your_project_id
FIREBASE_CLIENT_EMAIL=your_service_account_email
FIREBASE_PRIVATE_KEY=your_private_key

# OpenRouter AI (Optional but recommended)
OPENROUTER_API_KEYS=key1,key2,key3
OPENROUTER_MODELS=model1,model2,model3

# FCS API (Economic News)
FCS_API_KEY=your_fcs_api_key

# API Proxies (Optional - for blocked regions)
BINANCE_PROXY_URL=https://your-worker.workers.dev
BYBIT_PROXY_URL=https://your-worker.workers.dev
KRAKEN_PROXY_URL=https://your-worker.workers.dev
```

### API Keys Setup

#### 1. Telegram Bot Token
- Visit [@BotFather](https://t.me/BotFather) on Telegram
- Send `/newbot` and follow instructions
- Copy the token to `TELEGRAM_BOT_TOKEN`

#### 2. Firebase Setup
- Go to [Firebase Console](https://console.firebase.google.com/)
- Create new project or use existing
- Enable Firestore Database
- Go to Project Settings → Service Accounts
- Generate new private key
- Save as `firebase-key.json`

#### 3. OpenRouter AI (Optional)
- Visit [OpenRouter.ai](https://openrouter.ai/)
- Sign up for free account
- Get API key from dashboard
- Add to `OPENROUTER_API_KEYS` (comma-separated for multiple keys)

#### 4. FCS API (Economic News)
- Visit [FCS API](https://fcsapi.com/)
- Sign up for free account
- Get API key from dashboard
- Add to `FCS_API_KEY`

#### 5. Cloudflare Workers (For API Blocking)
- See [CLOUDFLARE_QUICK_START.md](CLOUDFLARE_QUICK_START.md)
- Deploy proxy workers for Bybit/Binance/Kraken
- Add worker URLs to `.env`

---

## 🚀 Quick Start

### 1. Start the Bot

```bash
# Development mode (with auto-reload)
npm run dev

# Production mode (PM2)
npm run pm2:start
```

### 2. Check Status

```bash
# View PM2 status
npm run pm2:status

# View logs
npm run pm2:logs

# Monitor in real-time
npm run pm2:monit
```

### 3. Test in Telegram

Send these commands to your bot:

```
/start          # Welcome message and setup guide
/status         # Check bot status and monitored pairs
/subscribe      # Subscribe to zone notifications
/active_signals # View all active zones
/eurusd        # Get AI analysis for EUR/USD
/news          # View today's economic events
```

### 4. Verify Zone Detection

- Bot runs hourly scans automatically
- Zones are detected and broadcasted to subscribers
- Check `/active_signals` to see detected zones
- Use pair commands (`/eurusd`, `/btcusdt`) for AI analysis

---

## 📱 Telegram Commands

### Zone Detection Commands

| Command | Description |
|---------|-------------|
| `/active_signals` | View all active premium/discount zones |
| `/history` | Show today's expired zones |
| `/status` | Bot status, monitored pairs, and zone count |
| `/trending` | Browse trending cryptocurrency pairs |
| `/managepairs` | Manage monitored pairs (owner only) |

### Subscription Management

| Command | Description |
|---------|-------------|
| `/subscribe` | Enable zone notifications |
| `/unsubscribe` | Disable notifications |
| `/getchatid` | Get chat/channel ID for setup |

### AI-Powered Analysis

**Forex Pairs:**
- `/eurusd` - EUR/USD analysis
- `/gbpusd` - GBP/USD analysis
- `/usdjpy` - USD/JPY analysis
- `/audusd` - AUD/USD analysis
- `/usdcad` - USD/CAD analysis
- `/xauusd` - Gold (XAU/USD) analysis

**Crypto Pairs:**
- `/btcusdt` - BTC/USDT analysis
- `/ethusdt` - ETH/USDT analysis
- `/alchusdt` - ALCH/USDT analysis
- Or use `/trending` to see all pairs, then type `/SYMBOL`

**AI Assistant:**
- `/ask [QUESTION]` - Get AI market analysis
  - Example: `/ask What is the current trend for EURUSD?`
  - Example: `/ask Volatility 50 (1s) Index`
- `/mystats` - View your AI usage statistics

### Economic News

| Command | Description |
|---------|-------------|
| `/news` | View today's high-impact economic events |

**Auto-Broadcasts:**
- Daily summary at **06:00 UTC**
- 1-hour alerts before high/medium impact events

### Help & Information

| Command | Description |
|---------|-------------|
| `/help` | Show comprehensive help message |
| `/start` | Welcome message and setup guide |

---

## 💡 How to Use

### Step 1: Analysis & Confirmation

1. **Review Zone Signals**
   - Use `/active_signals` to see all detected zones
   - Check zone type (Discount = 🟢, Premium = 🔴)
   - Note the price level and pair

2. **Conduct Your Own Analysis**
   - Review the pair's chart on your trading platform
   - Confirm the zone aligns with your analysis
   - Check for additional confluence factors

3. **Get AI Insights**
   - Use pair commands (`/eurusd`, `/btcusdt`) for comprehensive analysis
   - Use `/ask` for specific questions about the setup
   - Review AI recommendations for entry, TP, and SL

### Step 2: Wait for Confirmation

⚠️ **DO NOT enter immediately when a zone appears!**

1. **Wait for Structure Break (BOS)**
   - Look for a clear break of structure
   - Confirm price is moving in the expected direction
   - Verify the zone is being respected

2. **Confirm Trend Change**
   - Ensure trend aligns with zone direction
   - Discount zones need uptrend confirmation
   - Premium zones need downtrend confirmation

3. **Price Action Confirmation**
   - Look for candlestick patterns (pin bars, engulfing, etc.)
   - Check volume for confirmation
   - Wait for rejection or breakout confirmation

### Step 3: Entry Execution

1. **Enter After Confirmation**
   - Enter only after structure break and trend confirmation
   - Use the AI-recommended entry level or your own analysis
   - Ensure proper risk management

2. **Risk Management**
   - Set stop loss beyond zone boundaries
   - Use proper position sizing (1-2% risk per trade)
   - Set take profit at key resistance/support levels
   - Consider partial profits at TP1, move SL to breakeven

3. **Trade Management**
   - Monitor price action after entry
   - Adjust stop loss as trade moves in your favor
   - Take partial profits at key levels
   - Let winners run, cut losers quickly

### ⚠️ Important Notes

- **Zones are potential reversal areas, not guaranteed entries**
- **Always wait for price action confirmation before trading**
- **Never risk more than you can afford to lose**
- **Use proper risk management on every trade**
- **Combine bot signals with your own analysis**

---

## 🏗️ Architecture

### Project Structure

```
├── src/
│   ├── index.js                    # Main entry point
│   ├── config.js                   # Configuration management
│   │
│   ├── apis/                       # External API integrations
│   │   ├── telegram.js            # Telegram bot client
│   │   ├── deriv.js               # Deriv WebSocket API
│   │   ├── bybit.js               # Bybit REST API
│   │   ├── binance.js             # Binance REST API
│   │   ├── kraken.js              # Kraken REST API
│   │   ├── ai.js                  # OpenRouter AI client
│   │   ├── news.js                # Economic news (FCS API)
│   │   └── dataAggregator.js      # Data aggregation utility
│   │
│   ├── schedulers/                 # Automated scanning tasks
│   │   ├── zoneScanner.js        # Hourly zone detection
│   │   ├── trendingScanner.js    # Daily trending pairs
│   │   └── newsScanner.js         # News broadcasting
│   │
│   ├── indicators/                 # Technical indicators
│   │   ├── ema.js                 # EMA calculations
│   │   ├── stochRsi.js            # Stochastic RSI
│   │   └── premiumDiscountCalculator.js  # Zone detection logic
│   │
│   ├── utils/                      # Utilities
│   │   ├── zoneManager.js         # Zone state management
│   │   ├── advancedMarketAnalysis.js  # Comprehensive market analysis
│   │   ├── stateManager.js        # Pair state management
│   │   └── logger.js              # Winston logger
│   │
│   └── db/                         # Database layer
│       ├── firestore.js           # Firestore operations
│       ├── subscriptions.js       # Subscription management
│       └── aiRequests.js          # AI request tracking
│
├── cloudflare-workers/              # API proxy workers
│   ├── bybit-proxy.js
│   ├── binance-proxy.js
│   └── kraken-proxy.js
│
├── Test scripts/                    # Testing utilities
├── MD files/                        # Documentation
├── .env                            # Environment variables
├── firebase-key.json               # Firebase credentials
└── package.json                    # Dependencies
```

### Core Components

#### 1. Zone Scanner (`src/schedulers/zoneScanner.js`)
- Runs hourly scans on 1H timeframe
- Detects premium/discount zones
- Manages zone lifecycle
- Sends consolidated zone messages

#### 2. Telegram Client (`src/apis/telegram.js`)
- Handles all bot commands
- Manages subscriptions
- Broadcasts notifications
- AI integration interface

#### 3. Advanced Market Analysis (`src/utils/advancedMarketAnalysis.js`)
- Multi-timeframe data preparation
- Technical indicator calculations
- Support/resistance detection
- Comprehensive market data formatting

#### 4. AI Client (`src/apis/ai.js`)
- OpenRouter API integration
- Multiple model fallback
- Rate limiting
- Plain text output formatting

#### 5. News Scanner (`src/schedulers/newsScanner.js`)
- Daily morning summaries
- 1-hour-before alerts
- Pair-specific filtering
- Automated broadcasting

---

## 🔌 API Integrations

### Trading Exchanges

| Exchange | Purpose | API Type | Status |
|----------|---------|----------|--------|
| **Deriv** | Forex & Synthetic pairs | WebSocket | ✅ Active |
| **Bybit** | Cryptocurrency pairs | REST API | ✅ Active |
| **Binance** | Cryptocurrency backup | REST API | ✅ Active |
| **Kraken** | Cryptocurrency backup | REST API | ✅ Active |

### Data Providers

| Provider | Purpose | Status |
|----------|---------|--------|
| **FCS API** | Economic calendar | ✅ Active |
| **OpenRouter** | AI analysis | ✅ Active |
| **Firebase Firestore** | Database | ✅ Active |

### API Proxies

- **Cloudflare Workers** - For API blocking solutions
- Supports Bybit, Binance, Kraken proxies
- Global CDN for reliable access

---

## 🚀 Deployment

### Local Development

```bash
# Install dependencies
npm install

# Start in development mode
npm run dev
```

### Production Deployment (PM2)

```bash
# Start bot
npm run pm2:start

# Check status
npm run pm2:status

# View logs
npm run pm2:logs

# Restart bot
npm run pm2:restart

# Stop bot
npm run pm2:stop
```

### VPS Deployment

**What transfers automatically:**
- ✅ Cloudflare Workers (global CDN)
- ✅ Firebase/Firestore (cloud database)
- ✅ All APIs (cloud-based)

**On VPS:**
```bash
# Clone repository
git clone <repository-url>
cd "node versionof signal bot"

# Install dependencies
npm install

# Configure .env file
nano .env

# Upload firebase-key.json

# Start with PM2
npm run pm2:start
```

**Full VPS Guide:** See [COMPLETE_SETUP_GUIDE.md](COMPLETE_SETUP_GUIDE.md#vps-deployment-guide)

### Docker Deployment (Optional)

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
CMD ["npm", "start"]
```

---

## 🔧 Troubleshooting

### Common Issues

#### Bot Not Responding

**Check:**
```bash
# View logs
npm run pm2:logs

# Check status
npm run pm2:status

# Verify bot token
echo $TELEGRAM_BOT_TOKEN
```

**Solution:**
- Verify `TELEGRAM_BOT_TOKEN` is correct
- Check bot is added to group/channel as admin
- Ensure bot has permission to send messages

#### Zones Not Detecting

**Check:**
```bash
# Check monitored pairs
/status

# Verify pairs are configured
/managepairs
```

**Solution:**
- Ensure pairs are added to monitoring list
- Check Firestore connection
- Verify API keys are valid

#### Crypto API Blocked

**Error:** `❌ getaddrinfo ENOTFOUND api.kraken.com`

**Solution:**
- Use Cloudflare Workers proxy
- See [CLOUDFLARE_QUICK_START.md](CLOUDFLARE_QUICK_START.md)
- Deploy proxy workers (5 minutes, FREE)

#### AI Not Working

**Check:**
```bash
# Verify API keys
echo $OPENROUTER_API_KEYS

# Check usage limits
/mystats
```

**Solution:**
- Verify `OPENROUTER_API_KEYS` is set
- Check API key is valid
- Ensure models are configured
- Check rate limits (3/day for users, unlimited for owner)

#### Firebase Connection Issues

**Error:** `Firebase Admin initialization failed`

**Solution:**
- Verify `firebase-key.json` exists
- Check `FIREBASE_PROJECT_ID` matches
- Ensure Firestore is enabled
- Verify service account permissions

### Debug Mode

Enable verbose logging:
```bash
# Set log level
export LOG_LEVEL=debug

# Restart bot
npm run pm2:restart
```

---

## 📚 Documentation

### Quick References

| Document | Purpose |
|----------|---------|
| **[QUICK_START.md](QUICK_START.md)** | ⭐ Quick reference guide |
| **[COMPLETE_SETUP_GUIDE.md](COMPLETE_SETUP_GUIDE.md)** | Full setup instructions |
| **[CLOUDFLARE_QUICK_START.md](CLOUDFLARE_QUICK_START.md)** | API proxy setup (5 min) |
| **[TELEGRAM_COMMANDS.md](MD files/TELEGRAM_COMMANDS.md)** | Complete command reference |
| **[MONITORING_STATUS.md](MD files/MONITORING_STATUS.md)** | What's being monitored |

### Feature Documentation

- **Zone Detection:** See `src/schedulers/zoneScanner.js`
- **AI Analysis:** See `src/apis/ai.js` and `src/utils/advancedMarketAnalysis.js`
- **News Integration:** See `src/schedulers/newsScanner.js`
- **Telegram Commands:** See `src/apis/telegram.js`

---

## 🆘 Support

### Getting Help

1. **Check Documentation**
   - Review this README
   - Check [QUICK_START.md](QUICK_START.md)
   - See [TELEGRAM_COMMANDS.md](MD files/TELEGRAM_COMMANDS.md)

2. **Check Logs**
   ```bash
   npm run pm2:logs
   ```

3. **Verify Configuration**
   - Check `.env` file
   - Verify API keys
   - Test Firebase connection

4. **Common Solutions**
   - Restart bot: `npm run pm2:restart`
   - Check API status
   - Verify network connectivity

### Reporting Issues

When reporting issues, please include:
- Error messages from logs
- Steps to reproduce
- Configuration (without sensitive keys)
- Bot version and Node.js version

---

## 📊 Bot Status

**Current Status:** 🟢 OPERATIONAL

**Monitoring:**
- ✅ Forex pairs (EUR/USD, GBP/USD, USD/JPY, AUD/USD, USD/CAD, Gold)
- ✅ Deriv/Synthetic pairs (Volatility indices)
- ✅ Cryptocurrency pairs (Dynamic trending selection)

**Features:**
- ✅ Zone detection (Hourly scans)
- ✅ AI analysis (Multi-timeframe, comprehensive data)
- ✅ Economic news (Daily summaries + alerts)
- ✅ Telegram integration (All commands functional)
- ✅ Multi-exchange support (Deriv, Bybit, Binance, Kraken)

**Uptime:** 24/7 automated monitoring

---

## 🎯 Roadmap

### Planned Features

- [ ] Multi-timeframe zone detection (4H, Daily)
- [ ] Backtesting capabilities
- [ ] Performance analytics dashboard
- [ ] Custom indicator support
- [ ] Webhook integrations
- [ ] Mobile app notifications

---

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

---

## 🙏 Acknowledgments

- **Smart Money Concepts** methodology
- **OpenRouter** for AI capabilities
- **FCS API** for economic calendar data
- **Firebase** for cloud database
- **Cloudflare** for API proxy solutions

---

## 📞 Contact

For questions, support, or feature requests:
- Check documentation first
- Review troubleshooting section
- Check logs for errors

---

**Built for Professional Smart Money Trading**

*Always trade responsibly. Past performance does not guarantee future results.*

---

**Last Updated:** December 2024  
**Version:** 2.0.0  
**Status:** Production Ready ✅
