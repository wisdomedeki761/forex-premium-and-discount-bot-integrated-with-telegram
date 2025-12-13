/**
 * SuperTrend Indicator Calculator
 * Based on TradingView SuperTrend indicator
 * 
 * Parameters:
 * - ATR Period: 5
 * - ATR Multiplier: 3
 * - Source: (H+L)/2
 */
export class SuperTrendCalculator {
  constructor(atrPeriod = 5, atrMultiplier = 3) {
    this.atrPeriod = atrPeriod;
    this.atrMultiplier = atrMultiplier;
  }

  /**
   * Calculate True Range (TR) for a candle
   */
  calculateTR(candle, previousCandle) {
    if (!previousCandle) {
      return candle.high - candle.low;
    }

    const hl = candle.high - candle.low;
    const hc = Math.abs(candle.high - previousCandle.close);
    const lc = Math.abs(candle.low - previousCandle.close);

    return Math.max(hl, hc, lc);
  }

  /**
   * Calculate ATR (Average True Range)
   */
  calculateATR(candles) {
    if (candles.length < this.atrPeriod + 1) {
      return null;
    }

    const trs = [];
    for (let i = 1; i < candles.length; i++) {
      trs.push(this.calculateTR(candles[i], candles[i - 1]));
    }

    // Simple Moving Average of TR
    const sum = trs.slice(-this.atrPeriod).reduce((a, b) => a + b, 0);
    return sum / this.atrPeriod;
  }

  /**
   * Calculate source (H+L)/2
   */
  calculateSource(candle) {
    return (candle.high + candle.low) / 2;
  }

  /**
   * Calculate SuperTrend values for all candles
   * Returns array of { trend, upLine, dnLine, signal }
   * trend: 1 = uptrend, -1 = downtrend
   */
  calculate(candles) {
    if (!candles || candles.length < this.atrPeriod + 1) {
      return null;
    }

    const results = [];
    let previousTrend = 1; // Default to uptrend
    let previousUp = null;
    let previousDn = null;

    for (let i = this.atrPeriod; i < candles.length; i++) {
      const periodCandles = candles.slice(i - this.atrPeriod, i + 1);
      const atr = this.calculateATR(periodCandles);
      
      if (!atr) {
        results.push({ trend: previousTrend, upLine: previousUp, dnLine: previousDn, signal: null });
        continue;
      }

      const currentCandle = candles[i];
      const source = this.calculateSource(currentCandle);
      
      // Calculate basic up and down bands
      const basicUp = source - (this.atrMultiplier * atr);
      const basicDn = source + (this.atrMultiplier * atr);

      // Calculate final up and down bands
      let finalUp = basicUp;
      let finalDn = basicDn;

      if (i > this.atrPeriod && previousUp !== null && previousDn !== null) {
        const prevCandle = candles[i - 1];
        
        // Final up band: max(basicUp, previousUp) if close > previousUp, else basicUp
        if (prevCandle.close > previousUp) {
          finalUp = Math.max(basicUp, previousUp);
        } else {
          finalUp = basicUp;
        }

        // Final down band: min(basicDn, previousDn) if close < previousDn, else basicDn
        if (prevCandle.close < previousDn) {
          finalDn = Math.min(basicDn, previousDn);
        } else {
          finalDn = basicDn;
        }
      }

      // Determine trend
      let trend = previousTrend;
      if (i > this.atrPeriod && previousUp !== null && previousDn !== null) {
        const prevCandle = candles[i - 1];
        if (previousTrend === -1 && prevCandle.close > previousDn) {
          trend = 1;
        } else if (previousTrend === 1 && prevCandle.close < previousUp) {
          trend = -1;
        }
      }

      // Detect trend change signal
      let signal = null;
      if (i > this.atrPeriod && trend !== previousTrend) {
        signal = trend === 1 ? 'buy' : 'sell';
      }

      results.push({
        trend,
        upLine: trend === 1 ? finalUp : null,
        dnLine: trend === -1 ? finalDn : null,
        signal,
        atr,
        source
      });

      previousTrend = trend;
      previousUp = finalUp;
      previousDn = finalDn;
    }

    return results;
  }

  /**
   * Get the latest SuperTrend values
   * Returns { trend, upLine, dnLine, signal, atr, source }
   */
  getLatest(candles) {
    const results = this.calculate(candles);
    if (!results || results.length === 0) {
      return null;
    }
    return results[results.length - 1];
  }

  /**
   * Check if trend changed in the latest candle
   * Returns { changed: boolean, newTrend: number, signal: string, stopLoss: number }
   */
  checkTrendChange(candles) {
    const results = this.calculate(candles);
    if (!results || results.length < 2) {
      return { changed: false };
    }

    const latest = results[results.length - 1];
    const previous = results[results.length - 2];

    if (latest.trend !== previous.trend) {
      return {
        changed: true,
        newTrend: latest.trend,
        signal: latest.signal,
        stopLoss: latest.trend === 1 ? latest.upLine : latest.dnLine,
        upLine: latest.upLine,
        dnLine: latest.dnLine
      };
    }

    return { changed: false };
  }
}

export default SuperTrendCalculator;

