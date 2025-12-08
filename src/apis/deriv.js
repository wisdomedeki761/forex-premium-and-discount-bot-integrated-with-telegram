import WebSocket from 'ws';
import config from '../config.js';
import logger from '../utils/logger.js';

export class DerivClient {
  constructor() {
    this.wsUrl = config.deriv.wsUrl;
    this.ws = null;
    this.requestId = 1;
    this.connected = false;
    this.reconnecting = false;
  }

  /**
   * Connect to Deriv WebSocket
   */
  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);

      this.ws.on('open', () => {
        logger.info('Deriv WebSocket connected');
        this.connected = true;
        this.reconnecting = false;
        resolve();
      });

      this.ws.on('error', (error) => {
        logger.error('Deriv WebSocket error:', error.message);
        this.connected = false;
        reject(error);
      });

      this.ws.on('close', () => {
        this.connected = false;
        if (!this.reconnecting) {
          logger.warn('Deriv WebSocket closed. Reconnecting in 5s...');
          this.reconnecting = true;
          setTimeout(() => {
            this.reconnecting = false;
            this.connect().catch(() => {
              // Silently fail - already logged in error handler
            });
          }, 5000);
        }
      });
    });
  }

  /**
   * Send request to Deriv WebSocket
   */
  async sendRequest(request) {
    if (!this.connected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket is not connected');
    }

    return new Promise((resolve, reject) => {
      const reqId = this.requestId++;
      request.req_id = reqId;

      const timeout = setTimeout(() => {
        reject(new Error('Request timeout'));
      }, 30000);

      const messageHandler = (data) => {
        try {
          const response = JSON.parse(data.toString());

          if (response.req_id === reqId) {
            clearTimeout(timeout);
            this.ws.removeListener('message', messageHandler);

            if (response.error) {
              reject(new Error(response.error.message));
            } else {
              resolve(response);
            }
          }
        } catch (error) {
          logger.error('Error parsing Deriv response:', error.message);
        }
      };

      this.ws.on('message', messageHandler);
      this.ws.send(JSON.stringify(request));
    });
  }

  /**
   * Get historical candles
   */
  async getCandles(symbol, granularitySeconds, count = 100) {
    try {
      const response = await this.sendRequest({
        ticks_history: symbol,
        adjust_start_time: 1,
        count,
        end: 'latest',
        granularity: granularitySeconds,
        style: 'candles'
      });

      if (!response.candles) {
        return [];
      }

      const timeframe = this.granularityToTimeframe(granularitySeconds);

      return response.candles.map(candle => ({
        timestamp: candle.epoch * 1000, // Convert to milliseconds
        open: parseFloat(candle.open),
        high: parseFloat(candle.high),
        low: parseFloat(candle.low),
        close: parseFloat(candle.close),
        volume: 0, // Deriv doesn't provide volume for forex
        symbol,
        timeframe
      }));
    } catch (error) {
      logger.error(`Failed to fetch Deriv candles for ${symbol}:`, error.message);
      throw error;
    }
  }

  /**
   * Subscribe to live candle updates
   */
  async subscribeCandles(symbols, granularitySeconds, onCandle) {
    for (const symbol of symbols) {
      const subscription = {
        ticks_history: symbol,
        adjust_start_time: 1,
        count: 1,
        end: 'latest',
        granularity: granularitySeconds,
        style: 'candles',
        subscribe: 1
      };

      try {
        await this.sendRequest(subscription);
        logger.debug(`Subscribed to Deriv candles for ${symbol}`);
      } catch (error) {
        logger.error(`Failed to subscribe to ${symbol}:`, error.message);
      }
    }

    // Listen for candle updates
    this.ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());

        if (message.ohlc) {
          const timeframe = this.granularityToTimeframe(granularitySeconds);
          const candle = {
            timestamp: message.ohlc.epoch * 1000,
            open: parseFloat(message.ohlc.open),
            high: parseFloat(message.ohlc.high),
            low: parseFloat(message.ohlc.low),
            close: parseFloat(message.ohlc.close),
            volume: 0,
            symbol: message.ohlc.symbol,
            timeframe
          };

          onCandle(candle);
        }
      } catch (error) {
        logger.error('Error parsing Deriv message:', error.message);
      }
    });
  }

  /**
   * Get all available trading pairs from Deriv, grouped by type
   */
  async getAllPairs() {
    try {
      const response = await this.sendRequest({
        active_symbols: 'brief',
        product_type: 'basic'
      });

      if (!response.active_symbols) {
        return { grouped: {}, all: [] };
      }

      const grouped = {
        forex: [],           // Forex pairs (frx prefix)
        volatility: [],      // Volatility indices (1HZ, R_, CRASH, BOOM, etc.)
        crash_boom: [],      // Crash/Boom indices
        step_indices: [],    // Step indices
        jump_indices: [],    // Jump indices
        range_break: [],     // Range break indices
        commodities: [],     // Commodities
        crypto: [],          // Crypto indices
        other: []           // Other pairs
      };

      const all = [];

      response.active_symbols.forEach(asset => {
        if (asset.exchange_is_open !== 1) return; // Skip closed markets

        const pairInfo = {
          symbol: asset.symbol,
          displayName: asset.display_name,
          market: asset.market,
          submarket: asset.submarket
        };

        all.push(pairInfo);

        // Categorize pairs
        if (asset.symbol.startsWith('frx')) {
          grouped.forex.push(pairInfo);
        } else if (asset.symbol.includes('Crash') || asset.symbol.includes('CRASH')) {
          grouped.crash_boom.push(pairInfo);
        } else if (asset.symbol.includes('Boom') || asset.symbol.includes('BOOM')) {
          grouped.crash_boom.push(pairInfo);
        } else if (asset.symbol.startsWith('1HZ') || asset.symbol.startsWith('R_')) {
          grouped.volatility.push(pairInfo);
        } else if (asset.symbol.includes('Step') || asset.symbol.includes('STEP')) {
          grouped.step_indices.push(pairInfo);
        } else if (asset.symbol.startsWith('JD') || asset.symbol.includes('Jump')) {
          grouped.jump_indices.push(pairInfo);
        } else if (asset.symbol.includes('RB') || asset.symbol.includes('Range')) {
          grouped.range_break.push(pairInfo);
        } else if (asset.market === 'commodities') {
          grouped.commodities.push(pairInfo);
        } else if (asset.market === 'cryptocurrency') {
          grouped.crypto.push(pairInfo);
        } else {
          grouped.other.push(pairInfo);
        }
      });

      return { grouped, all };
    } catch (error) {
      logger.error('Failed to fetch Deriv pairs:', error.message);
      return { grouped: {}, all: [] };
    }
  }

  /**
   * Calculate 24h price change for a symbol
   */
  async get24hChange(symbol) {
    try {
      const candles = await this.getCandles(symbol, 3600, 24); // 24 hourly candles

      if (candles.length < 2) {
        return 0;
      }

      const firstPrice = candles[0].open;
      const lastPrice = candles[candles.length - 1].close;

      return ((lastPrice - firstPrice) / firstPrice) * 100;
    } catch (error) {
      logger.error(`Failed to calculate 24h change for ${symbol}:`, error.message);
      return 0;
    }
  }

  /**
   * Convert granularity seconds to timeframe string
   */
  granularityToTimeframe(seconds) {
    const map = {
      60: '1m',
      300: '5m',
      900: '15m',
      3600: '1h',
      14400: '4h',
      86400: '1d'
    };
    return map[seconds] || `${seconds}s`;
  }

  /**
   * Close WebSocket connection
   */
  close() {
    if (this.ws) {
      this.ws.close();
    }
  }
}

export default new DerivClient();
