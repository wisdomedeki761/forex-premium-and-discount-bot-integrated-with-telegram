import cron from 'node-cron';
import { v4 as uuidv4 } from 'uuid';
import bybitClient from '../apis/bybit.js';
import derivClient from '../apis/deriv.js';
import telegramClient from '../apis/telegram.js';
import { saveCandles, saveSignal } from '../db/firestore.js';
import stateManager from '../utils/stateManager.js';
import calculator from '../indicators/calculator.js';
import logger from '../utils/logger.js';

class ConfirmationMonitor {
  /**
   * Start the 1m confirmation monitor
   */
  start() {
    // Run immediately
    setTimeout(() => this.check(), 10000);

    // Schedule to run every 1 minute
    cron.schedule('* * * * *', () => {
      this.check();
    });

    logger.success('1m confirmation monitor started (runs every 1 minute)');
  }

  /**
   * Check confirmations for all waiting pairs
   */
  async check() {
    try {
      const waitingPairs = stateManager.getWaitingPairs();

      if (waitingPairs.length === 0) {
        return;
      }

      logger.info(`🔍 Checking 1m confirmations for ${waitingPairs.length} pairs`);

      let confirmed = 0;

      for (const state of waitingPairs) {
        try {
          const result = await this.checkPairConfirmation(state);
          if (result) confirmed++;
        } catch (error) {
          logger.error(`Error checking confirmation for ${state.symbol}:`, error.message);
        }
      }

      if (confirmed > 0) {
        logger.success(`✅ Confirmed ${confirmed} signals`);
      }
    } catch (error) {
      logger.error('Error in confirmation monitor:', error.message);
    }
  }

  /**
   * Check 1m confirmation for a pair
   */
  async checkPairConfirmation(state) {
    const { symbol, exchange, signalType } = state;

    try {
      // Get 1m candles
      let candles;
      if (exchange === 'bybit') {
        candles = await bybitClient.getKlines(symbol, '1', 100);
      } else if (exchange === 'deriv' || exchange === 'forex') {
        candles = await derivClient.getCandles(symbol, 60, 100); // 60s = 1m
      }

      if (!candles || candles.length < 70) {
        logger.debug(`Not enough 1m candles for ${symbol}`);
        return false;
      }

      // Save candles
      await saveCandles(symbol, '1m', candles);

      // Calculate current indicators
      const currentIndicators = calculator.calculate(candles);
      if (!currentIndicators) {
        return false;
      }

      // Calculate previous indicators (excluding last candle)
      const previousCandles = candles.slice(0, -1);
      const previousIndicators = calculator.calculate(previousCandles);
      if (!previousIndicators) {
        return false;
      }

      // Update 1m indicator values
      await stateManager.updateState(symbol, exchange, {
        last1mEma38: currentIndicators.ema38,
        last1mEma62: currentIndicators.ema62
      });

      // Check for confirmation
      let confirmed = false;

      if (signalType === 'BUY') {
        // Check if EMA38 crossed above EMA62
        confirmed = currentIndicators.ema38 > currentIndicators.ema62 &&
          (previousIndicators.ema38 <= previousIndicators.ema62 ||
            currentIndicators.ema38 > currentIndicators.ema62);
      } else if (signalType === 'SELL') {
        // Check if EMA38 crossed below EMA62
        confirmed = currentIndicators.ema38 < currentIndicators.ema62 &&
          (previousIndicators.ema38 >= previousIndicators.ema62 ||
            currentIndicators.ema38 < currentIndicators.ema62);
      }

      if (confirmed) {
        const currentPrice = candles[candles.length - 1].close;

        logger.success(`🎯 ${signalType} signal confirmed for ${symbol} at $${currentPrice.toFixed(2)}`);

        // Create signal
        const signal = {
          id: uuidv4(),
          symbol,
          exchange,
          signalType,
          entryPrice: currentPrice,
          currentPrice,
          pnlPercent: 0,
          sentAt: Date.now(),
          status: 'active'
        };

        // Save to Firestore
        await saveSignal(signal);

        // Update state to active
        await stateManager.setActive(symbol, signal.id, currentPrice, signalType);

        // Send Telegram notification
        await telegramClient.sendSignal(signal);

        return true;
      }

      // Check for invalidation
      let invalidated = false;

      if (signalType === 'BUY') {
        invalidated = currentIndicators.ema38 < currentIndicators.ema62;
      } else if (signalType === 'SELL') {
        invalidated = currentIndicators.ema38 > currentIndicators.ema62;
      }

      if (invalidated) {
        logger.warn(`⚠️ ${signalType} signal invalidated for ${symbol}: EMA reversed on 1m`);
        await stateManager.resetState(symbol);
        return false;
      }

      return false;
    } catch (error) {
      logger.error(`Error checking confirmation for ${symbol}:`, error.message);
      return false;
    }
  }
}

export default new ConfirmationMonitor();
