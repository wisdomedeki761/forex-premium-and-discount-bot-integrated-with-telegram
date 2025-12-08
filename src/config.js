import dotenv from 'dotenv';
dotenv.config();

export const config = {
  firebase: {
    projectId: process.env.FIREBASE_PROJECT_ID,
    privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    keyPath: process.env.FIREBASE_KEY_PATH
  },

  binance: {
    restUrl: 'https://api.binance.com',
    wsUrl: 'wss://stream.binance.com:9443',
    proxyUrl: process.env.BINANCE_PROXY_URL || null
  },

  bybit: {
    apiKey: process.env.BYBIT_API_KEY || '',
    apiSecret: process.env.BYBIT_API_SECRET || '',
    testnet: process.env.BYBIT_TESTNET === 'true',
    restUrl: process.env.BYBIT_TESTNET === 'true'
      ? 'https://api-testnet.bybit.com'
      : 'https://api.bybit.com',
    wsUrl: process.env.BYBIT_TESTNET === 'true'
      ? 'wss://stream-testnet.bybit.com/v5/public/spot'
      : 'wss://stream.bybit.com/v5/public/spot',
    proxyUrl: process.env.BYBIT_PROXY_URL || null
  },

  kraken: {
    proxyUrl: process.env.KRAKEN_PROXY_URL || null
  },

  deriv: {
    appId: process.env.DERIV_APP_ID,
    wsUrl: `wss://ws.derivws.com/websockets/v3?app_id=${process.env.DERIV_APP_ID}`
  },

  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    ownerChatId: process.env.OWNER_CHAT_ID,
    broadcastChannelId: process.env.BROADCAST_CHANNEL_ID || null
    // No chatId needed - bot auto-detects via /subscribe command
    // broadcastChannelId is optional - sends ALL signals without subscription
  },

  alphaVantage: {
    apiKey: process.env.ALPHA_VANTAGE_API_KEY
  },

  twelveData: {
    apiKey: process.env.TWELVE_DATA_API_KEY
  },

  finnhub: {
    apiKey: process.env.FINNHUB_API_KEY
  },

  fcs: {
    apiKey: process.env.FCS_API_KEY
  },

  newsApi: {
    apiKey: process.env.NEWS_API_KEY
  },

  openRouter: {
    apiKeys: process.env.OPENROUTER_API_KEYS?.split(',').map(k => k.trim()) || [],
    models: [
      "x-ai/grok-4.1-fast:free",
      "tngtech/deepseek-r1t2-chimera:free",
      "z-ai/glm-4.5-air:free",
      "tngtech/deepseek-r1t-chimera:free",
      "deepseek/deepseek-chat-v3-0324:free",
      "deepseek/deepseek-r1-0528:free",
      "google/gemma-3-27b-it:free",
      "meituan/longcat-flash-chat:free",
      "openai/gpt-oss-20b:free",
      "qwen/qwen3-235b-a22b:free",
      "nousresearch/hermes-3-llama-3.1-405b:free",
      "qwen/qwen3-30b-a3b:free"
    ]
  },

  trading: {
    trendingThresholdMin: parseFloat(process.env.TRENDING_THRESHOLD_MIN) || 5.0,
    trendingThresholdMax: parseFloat(process.env.TRENDING_THRESHOLD_MAX) || 50.0,
    rsiOversoldLevel: parseFloat(process.env.RSI_OVERSOLD_LEVEL) || 25.0,
    rsiOverboughtLevel: parseFloat(process.env.RSI_OVERBOUGHT_LEVEL) || 75.0,
    candleHistorySize: parseInt(process.env.CANDLE_HISTORY_SIZE) || 1000,
    monitoringUpdateInterval: parseInt(process.env.MONITORING_UPDATE_INTERVAL) || 1800,
    forexPairs: process.env.FOREX_PAIRS?.split(',').map(p => p.trim()) || [],
    derivPairs: process.env.DERIV_PAIRS?.split(',').map(p => p.trim()) || []
  },

  logging: {
    level: process.env.LOG_LEVEL || 'info'
  },

  proxy: {
    url: process.env.PROXY_URL || null,
    enabled: !!process.env.PROXY_URL
  }
};

export default config;
