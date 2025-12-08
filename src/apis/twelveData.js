import axios from 'axios';
import config from '../config.js';
import logger from '../utils/logger.js';

/**
 * Twelve Data API Client
 * Free tier: 800 requests/day
 */
export class TwelveDataClient {
  constructor() {
    this.apiKey = config.twelveData?.apiKey;
    this.baseUrl = 'https://api.twelvedata.com';
  }

  /**
   * Get real-time quote
   */
  async getQuote(symbol) {
    if (!this.apiKey) {
      throw new Error('Twelve Data API key not configured');
    }

    try {
      const cleanSymbol = this.formatSymbol(symbol);

      const response = await axios.get(`${this.baseUrl}/quote`, {
        params: {
          symbol: cleanSymbol,
          apikey: this.apiKey
        }
      });

      if (response.data.code === 429) {
        throw new Error('Rate limit exceeded');
      }

      if (response.data.status === 'error') {
        throw new Error(response.data.message || 'API error');
      }

      return {
        symbol: response.data.symbol,
        price: parseFloat(response.data.close),
        open: parseFloat(response.data.open),
        high: parseFloat(response.data.high),
        low: parseFloat(response.data.low),
        volume: parseFloat(response.data.volume),
        change: parseFloat(response.data.change),
        changePercent: parseFloat(response.data.percent_change),
        timestamp: response.data.timestamp
      };
    } catch (error) {
      logger.error(`Twelve Data quote error for ${symbol}:`, error.message);
      throw error;
    }
  }

  /**
   * Get technical indicators
   */
  async getIndicators(symbol, interval = '15min') {
    if (!this.apiKey) {
      throw new Error('Twelve Data API key not configured');
    }

    try {
      const cleanSymbol = this.formatSymbol(symbol);

      // Get multiple indicators in parallel
      const [rsi, macd, ema] = await Promise.all([
        this.getRSI(cleanSymbol, interval),
        this.getMACD(cleanSymbol, interval),
        this.getEMA(cleanSymbol, interval, 20)
      ]);

      return {
        symbol: cleanSymbol,
        interval,
        rsi: rsi?.values?.[0]?.rsi,
        macd: macd?.values?.[0],
        ema20: ema?.values?.[0]?.ema,
        timestamp: Date.now()
      };
    } catch (error) {
      logger.error(`Twelve Data indicators error for ${symbol}:`, error.message);
      throw error;
    }
  }

  /**
   * Get RSI
   */
  async getRSI(symbol, interval = '15min', timePeriod = 14) {
    const response = await axios.get(`${this.baseUrl}/rsi`, {
      params: {
        symbol,
        interval,
        time_period: timePeriod,
        apikey: this.apiKey,
        outputsize: 1
      }
    });

    return response.data;
  }

  /**
   * Get MACD
   */
  async getMACD(symbol, interval = '15min') {
    const response = await axios.get(`${this.baseUrl}/macd`, {
      params: {
        symbol,
        interval,
        apikey: this.apiKey,
        outputsize: 1
      }
    });

    return response.data;
  }

  /**
   * Get EMA
   */
  async getEMA(symbol, interval = '15min', timePeriod = 20) {
    const response = await axios.get(`${this.baseUrl}/ema`, {
      params: {
        symbol,
        interval,
        time_period: timePeriod,
        apikey: this.apiKey,
        outputsize: 1
      }
    });

    return response.data;
  }

  /**
   * Format symbol for API
   */
  formatSymbol(symbol) {
    // Remove frx prefix
    let clean = symbol.replace(/^frx/i, '');

    // Convert EURUSD to EUR/USD for forex
    if (clean.length === 6 && /^[A-Z]{6}$/.test(clean)) {
      return `${clean.substring(0, 3)}/${clean.substring(3, 6)}`;
    }

    return clean;
  }

  /**
   * Check if configured
   */
  isConfigured() {
    return !!this.apiKey;
  }
}

export default new TwelveDataClient();
