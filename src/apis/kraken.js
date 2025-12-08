import axios from 'axios';
import config from '../config.js';
import logger from '../utils/logger.js';

/**
 * Kraken API Client for Crypto Data
 * Free public API - no authentication needed
 * Supports Cloudflare Worker proxy to bypass DNS/ISP blocking
 */
export class KrakenClient {
  constructor() {
    // Use Cloudflare Worker proxy if configured, otherwise direct API
    const proxyUrl = config.kraken?.proxyUrl || process.env.KRAKEN_PROXY_URL;
    this.baseUrl = proxyUrl || 'https://api.kraken.com/0/public';
    this.timeout = 10000;

    if (proxyUrl) {
      logger.info('✅ Kraken: Using Cloudflare Worker proxy');
    }
  }

  /**
   * Get all available trading pairs
   */
  async getAssetPairs() {
    try {
      const response = await axios.get(`${this.baseUrl}/AssetPairs`, {
        timeout: this.timeout
      });

      if (response.data.error && response.data.error.length > 0) {
        throw new Error(response.data.error[0]);
      }

      return response.data.result;
    } catch (error) {
      logger.error('Failed to fetch Kraken asset pairs:', error.message);
      throw error;
    }
  }

  /**
   * Get ticker information for all pairs
   */
  async getAllTickers() {
    try {
      const response = await axios.get(`${this.baseUrl}/Ticker`, {
        timeout: this.timeout
      });

      if (response.data.error && response.data.error.length > 0) {
        throw new Error(response.data.error[0]);
      }

      const tickers = [];
      const data = response.data.result;

      for (const [pair, ticker] of Object.entries(data)) {
        // Filter for USDT pairs only
        if (!pair.includes('USDT')) continue;

        const lastPrice = parseFloat(ticker.c[0]); // Last trade price
        const openPrice = parseFloat(ticker.o); // Open price (24h)
        const changePercent = ((lastPrice - openPrice) / openPrice) * 100;

        tickers.push({
          symbol: pair.replace('USDT', '/USDT'),
          lastPrice,
          priceChangePercent: changePercent,
          volume: parseFloat(ticker.v[1]) // 24h volume
        });
      }

      return tickers;
    } catch (error) {
      logger.error('Failed to fetch Kraken tickers:', error.message);
      throw error;
    }
  }

  /**
   * Get OHLC (candlestick) data for a pair
   * @param {string} pair - Trading pair (e.g., 'BTCUSDT')
   * @param {number} interval - Interval in minutes (1, 5, 15, 30, 60, 240, 1440)
   * @param {number} limit - Number of candles to fetch
   */
  async getKlines(pair, interval, limit = 200) {
    try {
      // Convert pair format: BTCUSDT -> XBTUSDT (Kraken uses XBT for BTC)
      let krakenPair = pair.replace('/USDT', 'USDT');
      if (krakenPair.startsWith('BTC')) {
        krakenPair = krakenPair.replace('BTC', 'XBT');
      }

      // Convert interval to Kraken format (minutes)
      const intervalMap = {
        '1': 1,
        '5': 5,
        '15': 15,
        '30': 30,
        '60': 60,
        '240': 240,
        '1440': 1440
      };

      const krakenInterval = intervalMap[interval] || 60;

      const response = await axios.get(`${this.baseUrl}/OHLC`, {
        params: {
          pair: krakenPair,
          interval: krakenInterval
        },
        timeout: this.timeout
      });

      if (response.data.error && response.data.error.length > 0) {
        throw new Error(response.data.error[0]);
      }

      // Get the pair data (first key in result)
      const pairKey = Object.keys(response.data.result).find(k => k !== 'last');
      if (!pairKey) {
        throw new Error('No data returned for pair');
      }

      const ohlcData = response.data.result[pairKey];

      // Convert to standard format
      const candles = ohlcData.slice(-limit).map(candle => ({
        openTime: candle[0] * 1000, // Convert to milliseconds
        open: parseFloat(candle[1]),
        high: parseFloat(candle[2]),
        low: parseFloat(candle[3]),
        close: parseFloat(candle[4]),
        volume: parseFloat(candle[6]),
        closeTime: candle[0] * 1000 + (krakenInterval * 60 * 1000)
      }));

      return candles;
    } catch (error) {
      logger.error(`Failed to fetch Kraken klines for ${pair}:`, error.message);
      throw error;
    }
  }

  /**
   * Close connection (not needed for REST API)
   */
  close() {
    // No persistent connection for REST API
    logger.debug('Kraken client closed (REST API)');
  }
}

export default new KrakenClient();
