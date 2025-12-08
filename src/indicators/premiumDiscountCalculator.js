import { calculateEMA } from './ema.js';

/**
 * Premium/Discount Zone Calculator
 * Uses 1-hour timeframe with cascading EMAs and Stochastic
 */
export class PremiumDiscountCalculator {
  constructor() {
    this.ema20Period = 20;
    this.ema9Period = 9;
    this.ema62Period = 62;
    this.ema38Period = 38;
    this.stochPeriod = 14;
    this.stochKSmoothing = 1;
    this.stochDSmoothing = 3;
  }

  /**
   * Calculate cascading EMAs
   * EMA20 on close
   * EMA9 on close -> EMA62 on EMA9 values
   * EMA9 on close -> EMA38 on EMA9 values
   */
  calculateCascadingEMAs(closePrices) {
    if (!closePrices || closePrices.length === 0) {
      return null;
    }

    // EMA20 on close prices
    const ema20Values = calculateEMA(closePrices, this.ema20Period);
    if (ema20Values.length === 0) return null;

    // First EMA9 on close prices
    const ema9_base1 = calculateEMA(closePrices, this.ema9Period);
    if (ema9_base1.length === 0) return null;

    // EMA62 on the first EMA9 values (cascading)
    const ema62Values = calculateEMA(ema9_base1, this.ema62Period);
    if (ema62Values.length === 0) return null;

    // Second EMA9 on close prices (fresh calculation)
    const ema9_base2 = calculateEMA(closePrices, this.ema9Period);
    if (ema9_base2.length === 0) return null;

    // EMA38 on the second EMA9 values (cascading)
    const ema38Values = calculateEMA(ema9_base2, this.ema38Period);
    if (ema38Values.length === 0) return null;

    return {
      ema20: ema20Values[ema20Values.length - 1],
      ema38: ema38Values[ema38Values.length - 1],
      ema62: ema62Values[ema62Values.length - 1],
      ema20Values,
      ema38Values,
      ema62Values
    };
  }

  /**
   * Calculate Stochastic Oscillator
   * Period = 14, K smoothing = 1, D smoothing = 3
   */
  calculateStochastic(candles) {
    if (!candles || candles.length < this.stochPeriod) {
      return null;
    }

    const stochValues = [];

    // Calculate %K for each period
    for (let i = this.stochPeriod - 1; i < candles.length; i++) {
      const periodCandles = candles.slice(i - this.stochPeriod + 1, i + 1);
      const high = Math.max(...periodCandles.map(c => c.high));
      const low = Math.min(...periodCandles.map(c => c.low));
      const close = candles[i].close;

      // %K = (Close - Low) / (High - Low) * 100
      const k = high === low ? 50 : ((close - low) / (high - low)) * 100;
      stochValues.push(k);
    }

    // K smoothing = 1 means no smoothing, use raw %K values
    const kValues = stochValues;

    // D smoothing = 3 means simple moving average of %K over 3 periods
    const dValues = [];
    for (let i = this.stochDSmoothing - 1; i < kValues.length; i++) {
      const sum = kValues.slice(i - this.stochDSmoothing + 1, i + 1).reduce((a, b) => a + b, 0);
      dValues.push(sum / this.stochDSmoothing);
    }

    return {
      k: kValues[kValues.length - 1],
      d: dValues.length > 0 ? dValues[dValues.length - 1] : null,
      kValues,
      dValues
    };
  }

  /**
   * Calculate all indicators for premium/discount zone detection
   */
  calculate(candles) {
    if (!candles || candles.length === 0) {
      return null;
    }

    const closePrices = candles.map(c => c.close);

    // Calculate minimum required candles
    // EMA9 + EMA62 needs at least 9 + 62 candles
    const minRequired = this.ema9Period + Math.max(this.ema62Period, this.ema38Period);
    if (closePrices.length < minRequired) {
      return null;
    }

    const emas = this.calculateCascadingEMAs(closePrices);
    const stoch = this.calculateStochastic(candles);

    if (!emas || !stoch) {
      return null;
    }

    return {
      ema20: emas.ema20,
      ema38: emas.ema38,
      ema62: emas.ema62,
      stochK: stoch.k,
      stochD: stoch.d,
      ema20Values: emas.ema20Values,
      ema38Values: emas.ema38Values,
      ema62Values: emas.ema62Values,
      stochKValues: stoch.kValues,
      stochDValues: stoch.dValues
    };
  }

  /**
   * Check if in DISCOUNT zone (BUY opportunity)
   * Conditions:
   * - EMA20 > EMA38 > EMA62 (uptrend structure)
   * - Stochastic %K < 25
   * - EMAs maintain order (no crosses)
   */
  isDiscountZone(indicators) {
    if (!indicators) return false;

    const { ema20, ema38, ema62, stochK } = indicators;

    // Check EMA order: EMA20 > EMA38 > EMA62
    const emaOrder = ema20 > ema38 && ema38 > ema62;

    // Check Stochastic below 25
    const stochOversold = stochK < 25;

    return emaOrder && stochOversold;
  }

  /**
   * Check if in PREMIUM zone (SELL opportunity)
   * Conditions:
   * - EMA20 < EMA38 < EMA62 (downtrend structure)
   * - Stochastic %K > 75
   * - EMAs maintain order (no crosses)
   */
  isPremiumZone(indicators) {
    if (!indicators) return false;

    const { ema20, ema38, ema62, stochK } = indicators;

    // Check EMA order: EMA20 < EMA38 < EMA62
    const emaOrder = ema20 < ema38 && ema38 < ema62;

    // Check Stochastic above 75
    const stochOverbought = stochK > 75;

    return emaOrder && stochOverbought;
  }

  /**
   * Check if discount zone is still valid (EMAs haven't crossed)
   */
  isDiscountZoneValid(indicators) {
    if (!indicators) return false;

    const { ema20, ema38, ema62 } = indicators;

    // EMAs must maintain order: EMA20 > EMA38 > EMA62
    return ema20 > ema38 && ema38 > ema62;
  }

  /**
   * Check if premium zone is still valid (EMAs haven't crossed)
   */
  isPremiumZoneValid(indicators) {
    if (!indicators) return false;

    const { ema20, ema38, ema62 } = indicators;

    // EMAs must maintain order: EMA20 < EMA38 < EMA62
    return ema20 < ema38 && ema38 < ema62;
  }

  /**
   * Check if Stochastic has crossed back (zone exit condition)
   */
  hasStochCrossedBack(currentStochK, previousStochK, zoneType) {
    if (zoneType === 'discount') {
      // Exit discount zone when Stoch crosses above 25
      return previousStochK < 25 && currentStochK >= 25;
    } else if (zoneType === 'premium') {
      // Exit premium zone when Stoch crosses below 75
      return previousStochK > 75 && currentStochK <= 75;
    }
    return false;
  }

  /**
   * Determine zone type and validity
   */
  getZoneStatus(indicators) {
    if (!indicators) {
      return { type: null, valid: false, price: null };
    }

    const isDiscount = this.isDiscountZone(indicators);
    const isPremium = this.isPremiumZone(indicators);

    if (isDiscount) {
      return {
        type: 'discount',
        valid: true,
        price: indicators.ema20,
        ema20: indicators.ema20,
        ema38: indicators.ema38,
        ema62: indicators.ema62,
        stochK: indicators.stochK
      };
    }

    if (isPremium) {
      return {
        type: 'premium',
        valid: true,
        price: indicators.ema20,
        ema20: indicators.ema20,
        ema38: indicators.ema38,
        ema62: indicators.ema62,
        stochK: indicators.stochK
      };
    }

    return { type: null, valid: false, price: null };
  }
}

export default new PremiumDiscountCalculator();
