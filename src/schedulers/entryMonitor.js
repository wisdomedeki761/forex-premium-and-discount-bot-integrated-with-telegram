import logger from '../utils/logger.js';
import SuperTrendCalculator from '../indicators/supertrend.js';
import derivClient from '../apis/deriv.js';
import bybitClient from '../apis/bybit.js';
import zoneManager from '../utils/zoneManager.js';
import telegramClient from '../apis/telegram.js';
import { saveEntrySignal, getNextSignalId } from '../db/firestore.js';

/**
 * Entry Monitor
 * Monitors pairs for SuperTrend trend changes on 15-minute timeframe
 */
class EntryMonitor {
  constructor() {
    this.monitoringPairs = new Map(); // Map<symbol, { chatId, zoneType, exchange, startedAt, lastCandleTimestamp }>
    this.supertrend = new SuperTrendCalculator(5, 3); // ATR period 5, multiplier 3
    this.checkInterval = 60000; // Check every 60 seconds to see if new candle formed
    this.intervalId = null;
  }

  /**
   * Start monitoring
   */
  start() {
    if (this.intervalId) {
      logger.warn('Entry monitor already running');
      return;
    }

    logger.info('Starting entry monitor...');
    this.intervalId = setInterval(() => this.checkForNewCandles(), this.checkInterval);
    
    // Run immediately
    setTimeout(() => this.checkForNewCandles(), 5000);
    
    logger.success('✅ Entry monitor started (checking for new 15m candles)');
  }

  /**
   * Stop monitoring
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      logger.info('Entry monitor stopped');
    }
  }

  /**
   * Add a pair to monitoring
   */
  async addPair(symbol, exchange, zoneType, chatId) {
    try {
      // Normalize symbol
      const normalizedSymbol = this.normalizeSymbol(symbol, exchange);
      
      // Check if zone exists
      const zone = await zoneManager.getActiveZone(normalizedSymbol);
      if (!zone) {
        throw new Error(`No active zone found for ${normalizedSymbol}`);
      }

      // Fetch 15-minute candles to check current trend
      const candles15M = await this.fetch15MCandles(normalizedSymbol, exchange);
      if (!candles15M || candles15M.length < 10) {
        throw new Error(`Insufficient 15-minute data for ${normalizedSymbol}`);
      }

      const supertrendResult = this.supertrend.getLatest(candles15M);
      if (!supertrendResult) {
        throw new Error(`Could not calculate SuperTrend for ${normalizedSymbol}`);
      }

      const currentTrend = supertrendResult.trend; // 1 = uptrend, -1 = downtrend

      // Check if zone type matches expected trend
      // Discount zone should wait for uptrend (trend change from -1 to 1)
      // Premium zone should wait for downtrend (trend change from 1 to -1)
      if (zoneType === 'discount' && currentTrend === 1) {
        // Discount + uptrend = complex, use manual entry
        return {
          success: false,
          message: '⚠️ Complex setup detected. Use manual entry.\n\n' +
                   'Discount zone is active, but 15-minute SuperTrend is already in uptrend.\n' +
                   'This creates a complex scenario - consider manual entry instead.'
        };
      }

      if (zoneType === 'premium' && currentTrend === -1) {
        // Premium + downtrend = complex, use manual entry
        return {
          success: false,
          message: '⚠️ Complex setup detected. Use manual entry.\n\n' +
                   'Premium zone is active, but 15-minute SuperTrend is already in downtrend.\n' +
                   'This creates a complex scenario - consider manual entry instead.'
        };
      }

      // Get the latest candle timestamp
      const latestCandle = candles15M[candles15M.length - 1];
      const lastCandleTimestamp = latestCandle.timestamp || latestCandle.openTime || Date.now();

      // Add to monitoring
      this.monitoringPairs.set(normalizedSymbol, {
        symbol: normalizedSymbol,
        exchange,
        zoneType,
        chatId,
        startedAt: new Date().toISOString(),
        lastTrend: currentTrend,
        lastCandleTimestamp: lastCandleTimestamp
      });

      logger.info(`Added ${normalizedSymbol} to entry monitoring (${zoneType} zone, current trend: ${currentTrend === 1 ? 'uptrend' : 'downtrend'})`);

      return {
        success: true,
        message: `✅ Monitoring ${this.getDisplayName(normalizedSymbol, exchange)} for entry signal.\n\n` +
                 `Zone: ${zoneType === 'discount' ? '🟢 DISCOUNT' : '🔴 PREMIUM'}\n` +
                 `Current 15m trend: ${currentTrend === 1 ? '🟢 UPTREND' : '🔴 DOWNTREND'}\n` +
                 `Waiting for trend change...`
      };
    } catch (error) {
      logger.error(`Error adding pair to monitoring: ${error.message}`);
      return {
        success: false,
        message: `❌ Error: ${error.message}`
      };
    }
  }

  /**
   * Remove a pair from monitoring
   */
  removePair(symbol) {
    const normalizedSymbol = this.normalizeSymbol(symbol);
    this.monitoringPairs.delete(normalizedSymbol);
    logger.info(`Removed ${normalizedSymbol} from entry monitoring`);
  }

  /**
   * Check for new 15-minute candles and process trend changes
   */
  async checkForNewCandles() {
    if (this.monitoringPairs.size === 0) {
      return;
    }

    for (const [symbol, monitorData] of this.monitoringPairs.entries()) {
      try {
        // Fetch latest 15-minute candles
        const candles15M = await this.fetch15MCandles(symbol, monitorData.exchange);
        if (!candles15M || candles15M.length === 0) {
          continue;
        }

        // Get the latest candle
        const latestCandle = candles15M[candles15M.length - 1];
        const currentCandleTimestamp = latestCandle.timestamp || latestCandle.openTime;

        // Check if a new candle has formed (timestamp changed)
        if (currentCandleTimestamp > monitorData.lastCandleTimestamp) {
          logger.debug(`New 15m candle detected for ${symbol}, checking trend change...`);
          
          // Update the last candle timestamp
          monitorData.lastCandleTimestamp = currentCandleTimestamp;
          
          // Check for trend change
          await this.checkPair(symbol, monitorData, candles15M);
        }
      } catch (error) {
        logger.error(`Error checking ${symbol}:`, error.message);
      }
    }
  }

  /**
   * Check a single pair for trend change
   * @param {string} symbol - Symbol to check
   * @param {Object} monitorData - Monitoring data
   * @param {Array} candles15M - 15-minute candles (already fetched)
   */
  async checkPair(symbol, monitorData, candles15M) {
    try {
      if (!candles15M || candles15M.length < 10) {
        logger.warn(`Insufficient data for ${symbol}`);
        return;
      }

      // Check for trend change
      const trendChange = this.supertrend.checkTrendChange(candles15M);
      
      if (!trendChange.changed) {
        return; // No trend change yet
      }

      // Verify the trend change matches our expectation
      const expectedTrend = monitorData.zoneType === 'discount' ? 1 : -1; // Discount -> uptrend, Premium -> downtrend
      
      if (trendChange.newTrend !== expectedTrend) {
        logger.debug(`Trend changed to ${trendChange.newTrend} but expected ${expectedTrend} for ${symbol}`);
        monitorData.lastTrend = trendChange.newTrend;
        return;
      }

      // Trend change detected! Send signal
      const latestCandle = candles15M[candles15M.length - 1];
      const currentPrice = latestCandle.close;

      // Get signal ID
      const signalId = await getNextSignalId();

      // Create signal
      const signal = {
        id: signalId,
        symbol,
        exchange: monitorData.exchange,
        zoneType: monitorData.zoneType,
        entryType: trendChange.newTrend === 1 ? 'BUY' : 'SELL',
        currentPrice,
        stopLoss: trendChange.stopLoss,
        supertrendUpLine: trendChange.upLine,
        supertrendDnLine: trendChange.dnLine,
        chatId: monitorData.chatId,
        createdAt: new Date().toISOString(),
        status: 'active'
      };

      // Save to database
      await saveEntrySignal(signal);

      // Send signal to chat
      await this.sendEntrySignal(signal, monitorData);

      // Remove from monitoring (signal sent)
      this.removePair(symbol);

      logger.success(`Entry signal sent for ${symbol}: ${signal.entryType} @ ${currentPrice}`);
    } catch (error) {
      logger.error(`Error checking pair ${symbol}:`, error.message);
    }
  }

  /**
   * Send entry signal to Telegram
   */
  async sendEntrySignal(signal, monitorData) {
    try {
      const displaySymbol = this.getDisplayName(signal.symbol, signal.exchange);
      const emoji = signal.entryType === 'BUY' ? '🟢' : '🔴';
      const entryEmoji = signal.entryType === 'BUY' ? '🟢' : '🔴';

      const message = `<b>Signal ID: #${signal.id}</b>\n\n` +
                     `${entryEmoji} <b>${displaySymbol} ${signal.entryType} ENTRY</b>\n\n` +
                     `💰 Current Price: <code>${signal.currentPrice.toFixed(5)}</code>\n` +
                     `🛑 Stop Loss: <code>${signal.stopLoss.toFixed(5)}</code>\n\n` +
                     `<i>Zone: ${monitorData.zoneType === 'discount' ? '🟢 DISCOUNT' : '🔴 PREMIUM'}</i>`;

      await telegramClient.bot.sendMessage(monitorData.chatId, message, { parse_mode: 'HTML' });
    } catch (error) {
      logger.error(`Error sending entry signal:`, error.message);
    }
  }

  /**
   * Fetch 15-minute candles
   */
  async fetch15MCandles(symbol, exchange) {
    try {
      if (exchange === 'forex' || exchange === 'deriv') {
        // Use Deriv API - 900 seconds = 15 minutes
        return await derivClient.getCandles(symbol, 900, 100);
      } else if (exchange === 'kraken' || exchange === 'crypto') {
        // Use Bybit API for crypto
        return await bybitClient.getKlines(symbol, '15', 100);
      }
      return null;
    } catch (error) {
      logger.error(`Error fetching 15M candles for ${symbol}:`, error.message);
      return null;
    }
  }

  /**
   * Normalize symbol format
   */
  normalizeSymbol(symbol, exchange = null) {
    let normalized = symbol.toUpperCase().replace(/[\/\s]/g, '');
    
    // For forex/deriv, ensure frx prefix
    if (exchange === 'forex' || exchange === 'deriv') {
      if (!normalized.startsWith('FRX') && !normalized.startsWith('1HZ') && !normalized.startsWith('R_')) {
        // Check if it's a forex pair (3+3 chars)
        if (normalized.length === 6 && /^[A-Z]{6}$/.test(normalized)) {
          normalized = 'FRX' + normalized;
        }
      }
    }
    
    return normalized;
  }

  /**
   * Get display name for symbol
   */
  getDisplayName(symbol, exchange) {
    return zoneManager.getDisplayName(symbol, exchange);
  }

  /**
   * Get all monitoring pairs
   */
  getMonitoringPairs() {
    return Array.from(this.monitoringPairs.values());
  }
}

export default new EntryMonitor();

