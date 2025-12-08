import axios from 'axios';
import config from '../config.js';
import logger from '../utils/logger.js';

export class BinanceClient {
  constructor() {
    // Use Cloudflare Worker proxy if configured, otherwise direct API
    const proxyUrl = config.binance?.proxyUrl || process.env.BINANCE_PROXY_URL;
    this.baseUrl = proxyUrl || 'https://api.binance.com/api/v3';
    this.timeout = 10000;

    if (proxyUrl) {
      logger.info('✅ Binance: Using Cloudflare Worker proxy');
    }
  }

  /**
   * Get all 24hr ticker price change statistics
   */
  async getAllTickers() {
    try {
      const url = `${this.baseUrl}/ticker/24hr`;
      const response = await axios.get(url, {
        timeout: this.timeout
      });

      // Filter for USDT pairs only
      const usdtPairs = response.data
        .filter(item => item.symbol.endsWith('USDT'))
        .map(item => ({
          symbol: item.symbol,
          lastPrice: parseFloat(item.lastPrice),
          priceChangePercent: parseFloat(item.priceChangePercent),
          volume: parseFloat(item.volume)
        }));

      return usdtPairs;
    } catch (error) {
      logger.error('Failed to fetch Binance tickers:', error.message);
      throw error;
    }
  }

  /**
   * Get ticker for specific symbol
   */
  async getTicker(symbol) {
    try {
      const url = `${this.baseUrl}/ticker/24hr`;
      const response = await axios.get(url, {
        params: { symbol },
        timeout: this.timeout
      });

      return {
        symbol: response.data.symbol,
        lastPrice: parseFloat(response.data.lastPrice),
        priceChangePercent: parseFloat(response.data.priceChangePercent),
        volume: parseFloat(response.data.volume)
      };
    } catch (error) {
      logger.error(`Failed to fetch ticker for ${symbol}:`, error.message);
      throw error;
    }
  }

  /**
   * Get klines (candlestick data)
   * @param {string} symbol - Trading pair symbol (e.g., 'BTCUSDT')
   * @param {string} interval - Kline interval: 1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 6h, 8h, 12h, 1d, 3d, 1w, 1M
   * @param {number} limit - Number of candles to fetch (max 1000)
   */
  async getKlines(symbol, interval, limit = 200) {
    try {
      const url = `${this.baseUrl}/klines`;
      const response = await axios.get(url, {
        params: {
          symbol,
          interval,
          limit
        },
        timeout: this.timeout
      });

      const candles = response.data.map(item => ({
        timestamp: parseInt(item[0]),
        open: parseFloat(item[1]),
        high: parseFloat(item[2]),
        low: parseFloat(item[3]),
        close: parseFloat(item[4]),
        volume: parseFloat(item[5]),
        symbol,
        timeframe: interval
      }));

      return candles;
    } catch (error) {
      logger.error(`Failed to fetch klines for ${symbol}:`, error.message);
      throw error;
    }
  }
}

export default new BinanceClient();
