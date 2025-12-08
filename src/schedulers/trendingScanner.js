import cron from 'node-cron';
import binanceClient from '../apis/binance.js';
import bybitClient from '../apis/bybit.js';
import derivClient from '../apis/deriv.js';
import { saveTrendingPairs, getManagedPairs } from '../db/firestore.js';
import config from '../config.js';
import logger from '../utils/logger.js';

export class TrendingScanner {
  constructor() {
    this.activeCryptoPairs = [];
  }

  /**
   * Start the trending scanner (runs at 00:00 UTC)
   */
  start() {
    // Run immediately on startup
    this.scan();

    // Schedule to run at 00:00 UTC daily
    cron.schedule('0 0 * * *', () => {
      this.scan();
    }, {
      timezone: 'UTC'
    });

    logger.success('Trending scanner started (runs at 00:00 UTC)');
  }

  /**
   * Scan for trending pairs
   */
  async scan() {
    try {
      logger.info('🔍 Running trending scan...');

      const today = new Date().toISOString().split('T')[0];
      const trendingData = {
        date: today,
        cryptoBullish: [],
        cryptoBearish: [],
        forexQualified: [],
        derivQualified: []
      };

      // Scan crypto pairs
      await this.scanCrypto(trendingData);

      // Scan forex/deriv pairs
      await this.scanForexDeriv(trendingData);

      // Save to Firestore
      await saveTrendingPairs(today, trendingData);

      // Update active pairs list with exchange info
      this.activeCryptoPairs = [
        ...trendingData.cryptoBullish.map(p => ({ symbol: p.symbol, exchange: p.exchange })),
        ...trendingData.cryptoBearish.map(p => ({ symbol: p.symbol, exchange: p.exchange }))
      ];

      logger.success(
        `Trending scan completed: ${trendingData.cryptoBullish.length} bullish, ` +
        `${trendingData.cryptoBearish.length} bearish, ` +
        `${trendingData.forexQualified.length} forex, ` +
        `${trendingData.derivQualified.length} deriv`
      );
    } catch (error) {
      logger.error('Error in trending scan:', error.message);
    }
  }

  /**
   * Scan crypto pairs from Bybit
   */
  async scanCrypto(trendingData) {
    const allBullish = [];
    const allBearish = [];

    // Scan Bybit (Binance blocked by Cloudflare)
    try {
      logger.info('Scanning crypto pairs from Bybit...');
      const bybitTickers = await bybitClient.getAllTickers();

      for (const ticker of bybitTickers) {
        const changePercent = ticker.priceChangePercent;

        if (
          changePercent >= config.trading.trendingThresholdMin &&
          changePercent <= config.trading.trendingThresholdMax
        ) {
          allBullish.push({
            symbol: ticker.symbol,
            changePercent,
            exchange: 'bybit'
          });
        } else if (
          changePercent <= -config.trading.trendingThresholdMin &&
          changePercent >= -config.trading.trendingThresholdMax
        ) {
          allBearish.push({
            symbol: ticker.symbol,
            changePercent,
            exchange: 'bybit'
          });
        }
      }

      logger.info(`Bybit: Found ${allBullish.length} bullish, ${allBearish.length} bearish pairs`);
    } catch (error) {
      if (error.message.includes('ENOTFOUND') || error.message.includes('getaddrinfo')) {
        logger.warn('⚠️ Bybit API unreachable (DNS/Network issue)');
      } else {
        logger.error('Error scanning Bybit:', error.message);
      }
    }

    // Sort and take top 10 from each (professional coverage)
    allBullish.sort((a, b) => b.changePercent - a.changePercent);
    allBearish.sort((a, b) => a.changePercent - b.changePercent);

    trendingData.cryptoBullish = allBullish.slice(0, 10);
    trendingData.cryptoBearish = allBearish.slice(0, 10);

    logger.success(
      `Bybit crypto pairs: ${trendingData.cryptoBullish.length} bullish, ` +
      `${trendingData.cryptoBearish.length} bearish`
    );
  }

  /**
   * Scan forex and deriv pairs
   */
  async scanForexDeriv(trendingData) {
    try {
      logger.info('Scanning forex/deriv pairs...');

      // Get managed pairs from Firestore or fallback to config
      const managedPairs = await getManagedPairs();

      const forexPairs = (managedPairs.forexPairs && managedPairs.forexPairs.length > 0)
        ? managedPairs.forexPairs
        : config.trading.forexPairs || [];

      const derivPairs = (managedPairs.derivPairs && managedPairs.derivPairs.length > 0)
        ? managedPairs.derivPairs
        : config.trading.derivPairs || [];

      // For forex pairs, mark all as qualified (no direct 24h change)
      trendingData.forexQualified = [...forexPairs];

      // For Deriv pairs, check 24h change
      for (const symbol of derivPairs) {
        try {
          const change = await derivClient.get24hChange(symbol);

          if (Math.abs(change) >= config.trading.trendingThresholdMin) {
            trendingData.derivQualified.push(symbol);
            logger.info(`Deriv pair ${symbol} qualified with ${change.toFixed(2)}% change`);
          }
        } catch (error) {
          logger.error(`Error checking Deriv pair ${symbol}:`, error.message);
        }
      }

      logger.info(
        `Found ${trendingData.forexQualified.length} forex and ` +
        `${trendingData.derivQualified.length} deriv qualified pairs`
      );
    } catch (error) {
      logger.error('Error scanning forex/deriv pairs:', error.message);
    }
  }

  /**
   * Get active crypto pairs
   */
  getActiveCryptoPairs() {
    return this.activeCryptoPairs;
  }
}

export default new TrendingScanner();
