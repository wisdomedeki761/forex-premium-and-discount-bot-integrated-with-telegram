import cron from 'node-cron';
import bybitClient from '../apis/bybit.js';
import derivClient from '../apis/deriv.js';
import telegramClient from '../apis/telegram.js';
import { saveCandles, saveSignal } from '../db/firestore.js';
import stateManager from '../utils/stateManager.js';
import calculator from '../indicators/calculator.js';
import config from '../config.js';
import logger from '../utils/logger.js';

class ActiveMonitor {
  /**
   * Start the active signal monitor (every 30 minutes)
   */
  start() {
    // Run immediately after 2 minutes
    setTimeout(() => this.monitor(), 120000);

    // Schedule to run every 30 minutes
    cron.schedule('*/30 * * * *', () => {
      this.monitor();
    });

    logger.success('Active signal monitor started (runs every 30 minutes)');
  }

  /**
   * Monitor all active signals
   */
  async monitor() {
    try {
      const activePairs = stateManager.getActivePairs();

      if (activePairs.length === 0) {
        return;
      }

      logger.info(`📊 Monitoring ${activePairs.length} active signals`);

      let updatesSet = 0;
      let exited = 0;

      for (const state of activePairs) {
        try {
          const result = await this.monitorPair(state);
          if (result === 'update') updatesSet++;
          if (result === 'exit') exited++;
        } catch (error) {
          logger.error(`Error monitoring ${state.symbol}:`, error.message);
        }
      }

      logger.success(`Monitoring completed: ${updatesSet} updates, ${exited} exits`);
    } catch (error) {
      logger.error('Error in active monitor:', error.message);
    }
  }

  /**
   * Monitor individual pair
   */
  async monitorPair(state) {
    const { symbol, exchange, signalType, entryPrice, signalId, lastUpdateSent } = state;

    try {
      // Get 1m candles
      let candles;
      if (exchange === 'bybit') {
        candles = await bybitClient.getKlines(symbol, '1', 100);
      } else if (exchange === 'deriv' || exchange === 'forex') {
        candles = await derivClient.getCandles(symbol, 60, 100);
      }

      if (!candles || candles.length < 70) {
        return null;
      }

      const currentPrice = candles[candles.length - 1].close;

      // Calculate current indicators
      const currentIndicators = calculator.calculate(candles);
      if (!currentIndicators) {
        return null;
      }

      // Calculate previous indicators
      const previousCandles = candles.slice(0, -1);
      const previousIndicators = calculator.calculate(previousCandles);
      if (!previousIndicators) {
        return null;
      }

      // Calculate PnL
      let pnlPercent = 0;
      if (signalType === 'BUY') {
        pnlPercent = ((currentPrice - entryPrice) / entryPrice) * 100;
      } else if (signalType === 'SELL') {
        pnlPercent = ((entryPrice - currentPrice) / entryPrice) * 100;
      }

      // Create signal object
      const signal = {
        id: signalId,
        symbol,
        exchange,
        signalType,
        entryPrice,
        currentPrice,
        pnlPercent,
        sentAt: state.sentAt,
        status: 'active'
      };

      // Check for exit condition
      let shouldExit = false;
      let exitReason = '';

      if (signalType === 'BUY') {
        // Exit if EMA38 crosses below EMA62
        shouldExit = calculator.checkEmaCrossoverBearish(currentIndicators, previousIndicators);
        if (shouldExit) {
          exitReason = 'EMA38 crossed below EMA62';
        }
      } else if (signalType === 'SELL') {
        // Exit if EMA38 crosses above EMA62
        shouldExit = calculator.checkEmaCrossoverBullish(currentIndicators, previousIndicators);
        if (shouldExit) {
          exitReason = 'EMA38 crossed above EMA62';
        }
      }

      if (shouldExit) {
        logger.info(`🚪 Exit condition met for ${symbol}: ${exitReason} | Final PnL: ${pnlPercent.toFixed(2)}%`);

        // Update signal to closed
        signal.status = 'closed';
        signal.exitReason = exitReason;
        signal.closedAt = Date.now();
        await saveSignal(signal);

        // Reset state
        await stateManager.resetState(symbol);

        // Send exit notification
        await telegramClient.sendExit(signal, exitReason);

        return 'exit';
      }

      // Send update if 30 minutes passed since last update
      const now = Date.now();
      const updateInterval = config.trading.monitoringUpdateInterval * 1000; // Convert to ms

      if (!lastUpdateSent || (now - lastUpdateSent) >= updateInterval) {
        logger.info(`📈 Sending update for ${symbol}: Entry $${entryPrice.toFixed(2)} → Current $${currentPrice.toFixed(2)} | PnL: ${pnlPercent.toFixed(2)}%`);

        // Update signal in Firestore
        await saveSignal(signal);

        // Update last update sent time
        await stateManager.updateState(symbol, exchange, {
          lastUpdateSent: now
        });

        // Send Telegram update
        await telegramClient.sendUpdate(signal);

        return 'update';
      }

      return null;
    } catch (error) {
      logger.error(`Error monitoring ${symbol}:`, error.message);
      return null;
    }
  }
}

export default new ActiveMonitor();
