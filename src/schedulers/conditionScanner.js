import cron from 'node-cron';
import bybitClient from '../apis/bybit.js';
import derivClient from '../apis/deriv.js';
import { saveCandles } from '../db/firestore.js';
import stateManager from '../utils/stateManager.js';
import calculator from '../indicators/calculator.js';
import config from '../config.js';
import logger from '../utils/logger.js';
import trendingScanner from './trendingScanner.js';

class ConditionScanner {
  /**
   * Start the 15m condition scanner
   */
  start() {
    // Run immediately on startup
    setTimeout(() => this.scan(), 5000);

    // Schedule to run every 15 minutes
    cron.schedule('*/15 * * * *', () => {
      this.scan();
    });

    logger.success('15m condition scanner started (runs every 15 minutes)');
  }

  /**
   * Scan all trending pairs for conditions
   */
  async scan() {
    try {
      logger.info('🔍 Running 15m condition scan...');

      // Get trending crypto pairs
      const cryptoPairs = trendingScanner.getActiveCryptoPairs();

      // Get forex/deriv pairs (static list)
      const allPairs = [
        ...cryptoPairs.map(s => ({ symbol: s, exchange: 'bybit' })),
        ...config.trading.forexPairs.map(s => ({ symbol: s, exchange: 'forex' })),
        ...config.trading.derivPairs.map(s => ({ symbol: s, exchange: 'deriv' }))
      ];

      logger.info(`Scanning ${allPairs.length} pairs for 15m conditions`);

      let conditionsMet = 0;

      for (const { symbol, exchange } of allPairs) {
        try {
          const result = await this.scanPair(symbol, exchange);
          if (result) conditionsMet++;
        } catch (error) {
          logger.error(`Error scanning ${symbol}:`, error.message);
        }
      }

      logger.success(`15m scan completed: ${conditionsMet} conditions met`);
    } catch (error) {
      logger.error('Error in 15m condition scan:', error.message);
    }
  }

  /**
   * Scan individual pair for 15m conditions
   */
  async scanPair(symbol, exchange) {
    try {
      // Get 15m candles
      let candles;
      if (exchange === 'bybit') {
        candles = await bybitClient.getKlines(symbol, '15', 200);
      } else if (exchange === 'deriv' || exchange === 'forex') {
        candles = await derivClient.getCandles(symbol, 900, 200); // 900s = 15m
      }

      if (!candles || candles.length < 100) {
        logger.debug(`Not enough candles for ${symbol}`);
        return false;
      }

      // Save candles
      await saveCandles(symbol, '15m', candles);

      // Calculate indicators
      const indicators = calculator.calculate(candles);
      if (!indicators) {
        logger.debug(`Cannot calculate indicators for ${symbol}`);
        return false;
      }

      // Get current state
      const currentState = await stateManager.getState(symbol);

      // Update indicator values in state
      await stateManager.updateState(symbol, exchange, {
        last15mEma38: indicators.ema38,
        last15mEma62: indicators.ema62,
        last15mStochK: indicators.stochRsiK
      });

      // Check if already in waiting or active state
      if (currentState && (currentState.state === 'waiting' || currentState.state === 'active')) {
        // Validate existing state
        return await this.validateState(symbol, indicators, currentState);
      }

      // Check for new buy condition
      if (calculator.checkBuyCondition(indicators, config.trading.rsiOversoldLevel)) {
        logger.info(`✅ BUY condition met for ${symbol}: EMA38=${indicators.ema38.toFixed(2)} > EMA62=${indicators.ema62.toFixed(2)}, StochRSI=${indicators.stochRsiK.toFixed(2)}`);

        await stateManager.setWaiting(
          symbol,
          exchange,
          'BUY',
          indicators.ema38,
          indicators.ema62
        );

        return true;
      }

      // Check for new sell condition
      if (calculator.checkSellCondition(indicators, config.trading.rsiOverboughtLevel)) {
        logger.info(`✅ SELL condition met for ${symbol}: EMA38=${indicators.ema38.toFixed(2)} < EMA62=${indicators.ema62.toFixed(2)}, StochRSI=${indicators.stochRsiK.toFixed(2)}`);

        await stateManager.setWaiting(
          symbol,
          exchange,
          'SELL',
          indicators.ema38,
          indicators.ema62
        );

        return true;
      }

      return false;
    } catch (error) {
      logger.error(`Error in scanPair for ${symbol}:`, error.message);
      return false;
    }
  }

  /**
   * Validate existing waiting state
   */
  async validateState(symbol, indicators, state) {
    if (state.state !== 'waiting') {
      return false;
    }

    const signalType = state.signalType;

    // Check if condition is still valid
    let isValid = false;
    if (signalType === 'BUY') {
      isValid = calculator.isBuyConditionValid(indicators);
    } else if (signalType === 'SELL') {
      isValid = calculator.isSellConditionValid(indicators);
    }

    if (!isValid) {
      logger.warn(`⚠️ Invalidating ${signalType} signal for ${symbol}: EMA condition reversed`);
      await stateManager.resetState(symbol);
      return false;
    }

    return true;
  }
}

export default new ConditionScanner();
