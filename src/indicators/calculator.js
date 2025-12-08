import { getLatestEMA } from './ema.js';
import { getLatestStochRSI } from './stochRsi.js';

export class IndicatorCalculator {
  constructor() {
    this.ema38Period = 38;
    this.ema62Period = 62;
    this.rsiPeriod = 14;
    this.stochPeriod = 14;
    this.kPeriod = 3;
    this.dPeriod = 3;
  }

  /**
   * Calculate all indicators for candles
   * @param {Array} candles - Array of candle objects
   * @returns {Object|null} Indicator values
   */
  calculate(candles) {
    if (!candles || candles.length === 0) {
      return null;
    }

    const closePrices = candles.map(c => c.close);
    const minRequired = Math.max(
      this.ema62Period,
      this.rsiPeriod + this.stochPeriod + this.kPeriod + this.dPeriod
    );

    if (closePrices.length < minRequired) {
      return null;
    }

    const ema38 = getLatestEMA(closePrices, this.ema38Period);
    const ema62 = getLatestEMA(closePrices, this.ema62Period);
    const stochRsi = getLatestStochRSI(
      closePrices,
      this.rsiPeriod,
      this.stochPeriod,
      this.kPeriod,
      this.dPeriod
    );

    if (ema38 === null || ema62 === null || stochRsi === null) {
      return null;
    }

    return {
      ema38,
      ema62,
      stochRsiK: stochRsi.k,
      stochRsiD: stochRsi.d
    };
  }

  /**
   * Check if buy condition is met
   */
  checkBuyCondition(indicators, oversoldLevel) {
    return indicators.ema38 > indicators.ema62 && indicators.stochRsiK < oversoldLevel;
  }

  /**
   * Check if sell condition is met
   */
  checkSellCondition(indicators, overboughtLevel) {
    return indicators.ema38 < indicators.ema62 && indicators.stochRsiK > overboughtLevel;
  }

  /**
   * Check if EMA crossover occurred (bullish)
   */
  checkEmaCrossoverBullish(current, previous) {
    return current.ema38 > current.ema62 && previous.ema38 <= previous.ema62;
  }

  /**
   * Check if EMA crossover occurred (bearish)
   */
  checkEmaCrossoverBearish(current, previous) {
    return current.ema38 < current.ema62 && previous.ema38 >= previous.ema62;
  }

  /**
   * Check if buy condition is still valid
   */
  isBuyConditionValid(indicators) {
    return indicators.ema38 > indicators.ema62;
  }

  /**
   * Check if sell condition is still valid
   */
  isSellConditionValid(indicators) {
    return indicators.ema38 < indicators.ema62;
  }
}

export default new IndicatorCalculator();
