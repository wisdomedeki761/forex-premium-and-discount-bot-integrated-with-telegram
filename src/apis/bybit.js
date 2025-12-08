import axios from 'axios';
import WebSocket from 'ws';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import config from '../config.js';
import logger from '../utils/logger.js';
import dns from 'dns';

// Configure DNS to use Google's DNS servers (8.8.8.8 and 8.8.4.4)
// This fixes corporate DNS blocking issues
dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);

export class BybitClient {
  constructor() {
    // Use Cloudflare Worker proxy if configured, otherwise direct API
    const proxyUrl = config.bybit?.proxyUrl || process.env.BYBIT_PROXY_URL;
    this.baseUrl = proxyUrl || config.bybit.restUrl;
    this.wsUrl = config.bybit.wsUrl;
    this.ws = null;
    this.subscriptions = new Map();
    this.proxyAgent = this.createProxyAgent();

    if (proxyUrl) {
      logger.info('✅ Bybit: Using Cloudflare Worker proxy');
    } else if (config.proxy.enabled) {
      logger.info(`Bybit: Using proxy ${config.proxy.url}`);
    }
  }

  /**
   * Create proxy agent based on proxy URL protocol
   */
  createProxyAgent() {
    if (!config.proxy.enabled) {
      return null;
    }

    try {
      const proxyUrl = config.proxy.url;

      if (proxyUrl.startsWith('socks')) {
        return new SocksProxyAgent(proxyUrl);
      } else {
        return new HttpsProxyAgent(proxyUrl);
      }
    } catch (error) {
      logger.error('Failed to create proxy agent:', error.message);
      return null;
    }
  }

  /**
   * Get axios config with proxy support
   */
  getAxiosConfig(config = {}) {
    if (this.proxyAgent) {
      return {
        ...config,
        httpAgent: this.proxyAgent,
        httpsAgent: this.proxyAgent
      };
    }
    return config;
  }

  /**
   * Get historical klines (candles)
   */
  async getKlines(symbol, interval, limit = 200) {
    try {
      const url = `${this.baseUrl}/v5/market/kline`;
      const response = await axios.get(url, this.getAxiosConfig({
        params: {
          category: 'spot',
          symbol,
          interval,
          limit
        }
      }));

      if (response.data.retCode !== 0) {
        throw new Error(response.data.retMsg);
      }

      const candles = response.data.result.list.map(item => ({
        timestamp: parseInt(item[0]),
        open: parseFloat(item[1]),
        high: parseFloat(item[2]),
        low: parseFloat(item[3]),
        close: parseFloat(item[4]),
        volume: parseFloat(item[5]),
        symbol,
        timeframe: interval
      }));

      return candles.reverse(); // Bybit returns in descending order
    } catch (error) {
      logger.error(`Failed to fetch klines for ${symbol}:`, error.message);
      throw error;
    }
  }

  /**
   * Get all tickers with 24h price change
   */
  async getAllTickers() {
    try {
      const url = `${this.baseUrl}/v5/market/tickers`;
      const response = await axios.get(url, this.getAxiosConfig({
        params: {
          category: 'spot'
        }
      }));

      if (response.data.retCode !== 0) {
        throw new Error(response.data.retMsg);
      }

      return response.data.result.list.map(item => ({
        symbol: item.symbol,
        lastPrice: parseFloat(item.lastPrice),
        priceChangePercent: parseFloat(item.price24hPcnt) * 100,
        volume: parseFloat(item.volume24h)
      }));
    } catch (error) {
      logger.error('Failed to fetch all tickers:', error.message);
      throw error;
    }
  }

  /**
   * Get ticker for specific symbol
   */
  async getTicker(symbol) {
    try {
      const url = `${this.baseUrl}/v5/market/tickers`;
      const response = await axios.get(url, this.getAxiosConfig({
        params: {
          category: 'spot',
          symbol
        }
      }));

      if (response.data.retCode !== 0) {
        throw new Error(response.data.retMsg);
      }

      const item = response.data.result.list[0];
      return {
        symbol: item.symbol,
        lastPrice: parseFloat(item.lastPrice),
        priceChangePercent: parseFloat(item.price24hPcnt) * 100,
        volume: parseFloat(item.volume24h)
      };
    } catch (error) {
      logger.error(`Failed to fetch ticker for ${symbol}:`, error.message);
      throw error;
    }
  }

  /**
   * Subscribe to WebSocket kline updates
   */
  async subscribeKlines(symbols, intervals, onCandle) {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);

      this.ws.on('open', () => {
        logger.info('Bybit WebSocket connected');

        // Subscribe to kline streams
        symbols.forEach(symbol => {
          intervals.forEach(interval => {
            const topic = `kline.${interval}.${symbol}`;
            this.ws.send(JSON.stringify({
              op: 'subscribe',
              args: [topic]
            }));
            logger.debug(`Subscribed to Bybit ${topic}`);
          });
        });

        resolve();
      });

      this.ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());

          // Handle kline updates
          if (message.topic && message.topic.startsWith('kline')) {
            const [, interval, symbol] = message.topic.split('.');
            const klineData = message.data[0];

            const candle = {
              timestamp: parseInt(klineData.start),
              open: parseFloat(klineData.open),
              high: parseFloat(klineData.high),
              low: parseFloat(klineData.low),
              close: parseFloat(klineData.close),
              volume: parseFloat(klineData.volume),
              symbol,
              timeframe: interval
            };

            onCandle(candle);
          }
        } catch (error) {
          logger.error('Error parsing Bybit WebSocket message:', error.message);
        }
      });

      this.ws.on('error', (error) => {
        logger.error('Bybit WebSocket error:', error.message);
        reject(error);
      });

      this.ws.on('close', () => {
        logger.warn('Bybit WebSocket closed. Reconnecting in 5s...');
        setTimeout(() => this.subscribeKlines(symbols, intervals, onCandle), 5000);
      });

      // Ping/Pong to keep connection alive
      setInterval(() => {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ op: 'ping' }));
        }
      }, 20000);
    });
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

export default new BybitClient();
