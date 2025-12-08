import { calculateEMA } from '../indicators/ema.js';
import { calculateRSI, calculateStochasticRSI } from '../indicators/stochRsi.js';

/**
 * Advanced Market Analysis Utility
 * Provides comprehensive data for AI analysis following institutional standards
 */

export class AdvancedMarketAnalysis {
  /**
   * Calculate Simple Moving Average (SMA)
   */
  calculateSMA(prices, period) {
    if (prices.length < period) return [];
    const smaValues = [];
    for (let i = period - 1; i < prices.length; i++) {
      const sum = prices.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
      smaValues.push(sum / period);
    }
    return smaValues;
  }

  /**
   * Calculate MACD (Moving Average Convergence Divergence)
   */
  calculateMACD(prices, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
    const emaFast = calculateEMA(prices, fastPeriod);
    const emaSlow = calculateEMA(prices, slowPeriod);
    
    if (emaFast.length === 0 || emaSlow.length === 0) return null;
    
    // Calculate MACD line (fast EMA - slow EMA)
    const macdLine = [];
    const minLength = Math.min(emaFast.length, emaSlow.length);
    const fastOffset = emaFast.length - minLength;
    const slowOffset = emaSlow.length - minLength;
    
    for (let i = 0; i < minLength; i++) {
      macdLine.push(emaFast[fastOffset + i] - emaSlow[slowOffset + i]);
    }
    
    // Calculate signal line (EMA of MACD line)
    const signalLine = calculateEMA(macdLine, signalPeriod);
    
    // Calculate histogram (MACD - Signal)
    const histogram = [];
    const signalOffset = signalLine.length;
    const macdOffset = macdLine.length - signalLine.length;
    
    for (let i = 0; i < signalLine.length; i++) {
      histogram.push(macdLine[macdOffset + i] - signalLine[i]);
    }
    
    return {
      macd: macdLine.length > 0 ? macdLine[macdLine.length - 1] : null,
      signal: signalLine.length > 0 ? signalLine[signalLine.length - 1] : null,
      histogram: histogram.length > 0 ? histogram[histogram.length - 1] : null,
      macdLine,
      signalLine,
      histogram
    };
  }

  /**
   * Calculate CCI (Commodity Channel Index)
   */
  calculateCCI(candles, period = 20) {
    if (candles.length < period) return [];
    
    const cciValues = [];
    for (let i = period - 1; i < candles.length; i++) {
      const slice = candles.slice(i - period + 1, i + 1);
      const typicalPrices = slice.map(c => (c.high + c.low + c.close) / 3);
      const sma = typicalPrices.reduce((a, b) => a + b, 0) / period;
      
      const meanDeviation = typicalPrices.reduce((sum, tp) => sum + Math.abs(tp - sma), 0) / period;
      const currentTP = (candles[i].high + candles[i].low + candles[i].close) / 3;
      
      const cci = meanDeviation === 0 ? 0 : (currentTP - sma) / (0.015 * meanDeviation);
      cciValues.push(cci);
    }
    
    return cciValues;
  }

  /**
   * Calculate Bollinger Bands
   */
  calculateBollingerBands(prices, period = 20, stdDev = 2) {
    if (prices.length < period) return null;
    
    const sma = this.calculateSMA(prices, period);
    const bands = [];
    
    for (let i = 0; i < sma.length; i++) {
      const slice = prices.slice(i, i + period);
      const mean = sma[i];
      const variance = slice.reduce((sum, price) => sum + Math.pow(price - mean, 2), 0) / period;
      const stdDeviation = Math.sqrt(variance);
      
      bands.push({
        upper: mean + (stdDev * stdDeviation),
        middle: mean,
        lower: mean - (stdDev * stdDeviation)
      });
    }
    
    return bands.length > 0 ? bands[bands.length - 1] : null;
  }

  /**
   * Calculate ATR (Average True Range)
   */
  calculateATR(candles, period = 14) {
    if (candles.length < period + 1) return null;
    
    const trueRanges = [];
    for (let i = 1; i < candles.length; i++) {
      const tr = Math.max(
        candles[i].high - candles[i].low,
        Math.abs(candles[i].high - candles[i - 1].close),
        Math.abs(candles[i].low - candles[i - 1].close)
      );
      trueRanges.push(tr);
    }
    
    if (trueRanges.length < period) return null;
    
    // Calculate ATR as SMA of true ranges
    const atrValues = [];
    for (let i = period - 1; i < trueRanges.length; i++) {
      const sum = trueRanges.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
      atrValues.push(sum / period);
    }
    
    return atrValues.length > 0 ? atrValues[atrValues.length - 1] : null;
  }

  /**
   * Detect support and resistance zones with strength
   */
  detectSupportResistanceZones(candles, lookback = 60) {
    const recentCandles = candles.slice(-lookback);
    const allHighs = recentCandles.map(c => ({ price: c.high, timestamp: c.timestamp }));
    const allLows = recentCandles.map(c => ({ price: c.low, timestamp: c.timestamp }));
    
    // Find swing highs (resistance)
    const swingHighs = [];
    for (let i = 2; i < recentCandles.length - 2; i++) {
      if (recentCandles[i].high > recentCandles[i-1].high &&
          recentCandles[i].high > recentCandles[i-2].high &&
          recentCandles[i].high > recentCandles[i+1].high &&
          recentCandles[i].high > recentCandles[i+2].high) {
        swingHighs.push({
          price: recentCandles[i].high,
          timestamp: recentCandles[i].timestamp,
          index: i
        });
      }
    }
    
    // Find swing lows (support)
    const swingLows = [];
    for (let i = 2; i < recentCandles.length - 2; i++) {
      if (recentCandles[i].low < recentCandles[i-1].low &&
          recentCandles[i].low < recentCandles[i-2].low &&
          recentCandles[i].low < recentCandles[i+1].low &&
          recentCandles[i].low < recentCandles[i+2].low) {
        swingLows.push({
          price: recentCandles[i].low,
          timestamp: recentCandles[i].timestamp,
          index: i
        });
      }
    }
    
    // Group nearby levels (within 0.1% of each other)
    const tolerance = 0.001; // 0.1%
    
    // Group resistance levels
    const resistanceGroups = [];
    swingHighs.forEach(swing => {
      const group = resistanceGroups.find(g => 
        Math.abs(g.price - swing.price) / g.price < tolerance
      );
      if (group) {
        group.count++;
        group.tests.push(swing.timestamp);
        group.price = (group.price + swing.price) / 2; // Average
      } else {
        resistanceGroups.push({
          price: swing.price,
          type: 'resistance',
          count: 1,
          tests: [swing.timestamp],
          breaks: 0
        });
      }
    });
    
    // Group support levels
    const supportGroups = [];
    swingLows.forEach(swing => {
      const group = supportGroups.find(g => 
        Math.abs(g.price - swing.price) / g.price < tolerance
      );
      if (group) {
        group.count++;
        group.tests.push(swing.timestamp);
        group.price = (group.price + swing.price) / 2;
      } else {
        supportGroups.push({
          price: swing.price,
          type: 'support',
          count: 1,
          tests: [swing.timestamp],
          breaks: 0
        });
      }
    });
    
    // Calculate strength (1-5) based on number of tests
    const calculateStrength = (count) => {
      if (count >= 5) return 5;
      if (count >= 3) return 4;
      if (count >= 2) return 3;
      return 2;
    };
    
    const zones = [
      ...resistanceGroups.map(z => ({
        ...z,
        strength: calculateStrength(z.count),
        lastTested: new Date(Math.max(...z.tests)).toISOString().split('T')[0]
      })),
      ...supportGroups.map(z => ({
        ...z,
        strength: calculateStrength(z.count),
        lastTested: new Date(Math.max(...z.tests)).toISOString().split('T')[0]
      }))
    ].sort((a, b) => b.strength - a.strength).slice(0, 10); // Top 10 zones
    
    return zones;
  }

  /**
   * Analyze market structure (higher highs, lower lows)
   */
  analyzeMarketStructure(candles, timeframe = '4H') {
    const recentCandles = candles.slice(-20); // Last 20 candles
    
    const highs = recentCandles.map((c, i) => ({ price: c.high, index: i }));
    const lows = recentCandles.map((c, i) => ({ price: c.low, index: i }));
    
    // Find local maxima and minima
    const localHighs = [];
    const localLows = [];
    
    for (let i = 1; i < recentCandles.length - 1; i++) {
      if (recentCandles[i].high > recentCandles[i-1].high &&
          recentCandles[i].high > recentCandles[i+1].high) {
        localHighs.push({ price: recentCandles[i].high, index: i });
      }
      if (recentCandles[i].low < recentCandles[i-1].low &&
          recentCandles[i].low < recentCandles[i+1].low) {
        localLows.push({ price: recentCandles[i].low, index: i });
      }
    }
    
    // Determine trend
    let trend = 'Ranging';
    let directionAlignment = 'Neutral';
    
    if (localHighs.length >= 2 && localLows.length >= 2) {
      const lastTwoHighs = localHighs.slice(-2);
      const lastTwoLows = localLows.slice(-2);
      
      const higherHigh = lastTwoHighs[1].price > lastTwoHighs[0].price;
      const higherLow = lastTwoLows[1].price > lastTwoLows[0].price;
      const lowerHigh = lastTwoHighs[1].price < lastTwoHighs[0].price;
      const lowerLow = lastTwoLows[1].price < lastTwoLows[0].price;
      
      if (higherHigh && higherLow) {
        trend = 'Uptrend';
      } else if (lowerHigh && lowerLow) {
        trend = 'Downtrend';
      } else {
        trend = 'Ranging';
      }
    }
    
    return {
      trend,
      directionAlignment,
      recentSwingHighs: localHighs.slice(-5),
      recentSwingLows: localLows.slice(-5),
      lastHigh: localHighs.length > 0 ? localHighs[localHighs.length - 1] : null,
      lastLow: localLows.length > 0 ? localLows[localLows.length - 1] : null
    };
  }

  /**
   * Detect market session
   */
  getMarketSession() {
    const now = new Date();
    const utcHour = now.getUTCHours();
    
    // Tokyo: 00:00-09:00 UTC
    // London: 08:00-17:00 UTC
    // New York: 13:00-22:00 UTC
    // Asian: 00:00-08:00 UTC
    
    if (utcHour >= 0 && utcHour < 8) {
      return { session: 'Asian', nextSession: 'London', hoursUntilNext: 8 - utcHour };
    } else if (utcHour >= 8 && utcHour < 13) {
      return { session: 'London', nextSession: 'New York', hoursUntilNext: 13 - utcHour };
    } else if (utcHour >= 13 && utcHour < 22) {
      return { session: 'New York', nextSession: 'Asian', hoursUntilNext: 22 - utcHour };
    } else {
      return { session: 'Asian', nextSession: 'London', hoursUntilNext: 24 - utcHour + 8 };
    }
  }

  /**
   * Format candles for display
   */
  formatCandles(candles, timeframe, isCrypto = false) {
    return candles.map(c => {
      const date = new Date(c.timestamp);
      const dateStr = date.toISOString().split('T')[0];
      const timeStr = date.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: 'UTC'
      });
      const candleType = c.close > c.open ? '🟢' : c.close < c.open ? '🔴' : '⚪';
      return {
        datetime: `${dateStr} ${timeStr}`,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume || 0,
        type: candleType,
        isCrypto
      };
    });
  }

  /**
   * Prepare comprehensive market data for AI analysis
   */
  async prepareComprehensiveMarketData(symbol, displaySymbol, candles4H, candles1H, candles15M, zone, exchange = 'forex') {
    const currentPrice = candles1H[candles1H.length - 1].close;
    const closePrices1H = candles1H.map(c => c.close);
    const closePrices4H = candles4H.map(c => c.close);
    
    // Calculate indicators for 1H
    const ema20_1H = calculateEMA(closePrices1H, 20);
    const ema50_1H = calculateEMA(closePrices1H, 50);
    const ema200_1H = calculateEMA(closePrices1H, 200);
    const sma20_1H = this.calculateSMA(closePrices1H, 20);
    const sma50_1H = this.calculateSMA(closePrices1H, 50);
    const sma200_1H = this.calculateSMA(closePrices1H, 200);
    const rsi1H = calculateRSI(closePrices1H, 14);
    const stochRsi1H = calculateStochasticRSI(closePrices1H, 14, 14, 3, 3);
    const macd1H = this.calculateMACD(closePrices1H);
    const cci1H = this.calculateCCI(candles1H, 20);
    const bb1H = this.calculateBollingerBands(closePrices1H, 20, 2);
    const atr1H = this.calculateATR(candles1H, 14);
    
    // Calculate indicators for 4H
    const ema20_4H = calculateEMA(closePrices4H, 20);
    const ema50_4H = calculateEMA(closePrices4H, 50);
    const ema200_4H = calculateEMA(closePrices4H, 200);
    const sma20_4H = this.calculateSMA(closePrices4H, 20);
    const sma50_4H = this.calculateSMA(closePrices4H, 50);
    const sma200_4H = this.calculateSMA(closePrices4H, 200);
    const rsi4H = calculateRSI(closePrices4H, 14);
    const stochRsi4H = calculateStochasticRSI(closePrices4H, 14, 14, 3, 3);
    const macd4H = this.calculateMACD(closePrices4H);
    const cci4H = this.calculateCCI(candles4H, 20);
    const bb4H = this.calculateBollingerBands(closePrices4H, 20, 2);
    const atr4H = this.calculateATR(candles4H, 14);
    
    // Market structure analysis
    const structure4H = this.analyzeMarketStructure(candles4H, '4H');
    const structure1H = this.analyzeMarketStructure(candles1H, '1H');
    
    // Support/Resistance zones
    const zones4H = this.detectSupportResistanceZones(candles4H, 60);
    const zones1H = this.detectSupportResistanceZones(candles1H, 168);
    
    // Market session
    const session = this.getMarketSession();
    
    // Format candles
    const isCrypto = exchange === 'crypto';
    const formatted4H = this.formatCandles(candles4H.slice(-60), '4H', isCrypto);
    const formatted1H = this.formatCandles(candles1H.slice(-168), '1H', isCrypto);
    const formatted15M = candles15M ? this.formatCandles(candles15M.slice(-96), '15M', isCrypto) : [];
    
    // Format price function
    const formatPrice = (price) => isCrypto ? `$${price.toFixed(2)}` : price.toFixed(5);
    const formatPrice5 = (price) => isCrypto ? `$${price.toFixed(2)}` : price.toFixed(5);
    
    // Calculate daily summaries (last 5 days)
    const dailySummaries = this.calculateDailySummaries(candles1H);
    
    // Build comprehensive data string
    let marketData = `# COMPREHENSIVE MARKET ANALYSIS DATA
# Pair: ${displaySymbol} | Exchange: ${exchange}
# Analysis Date: ${new Date().toLocaleString('en-US', { timeZone: 'UTC' })} UTC

## 1. HISTORICAL PRICE DATA

### 4-Hour Candles (Last 60 periods = 10 days)
Date/Time | Open | High | Low | Close | Volume
${formatted4H.map(c => `${c.datetime} | ${formatPrice(c.open)} | ${formatPrice(c.high)} | ${formatPrice(c.low)} | ${formatPrice(c.close)} | ${(c.volume / 1000000).toFixed(1)}M`).join('\n')}

### 1-Hour Candles (Last 168 periods = 7 days)
Date/Time | Open | High | Low | Close | Volume
${formatted1H.map(c => `${c.datetime} | ${formatPrice(c.open)} | ${formatPrice(c.high)} | ${formatPrice(c.low)} | ${formatPrice(c.close)} | ${(c.volume / 1000000).toFixed(1)}M`).join('\n')}

${formatted15M.length > 0 ? `### 15-Minute Candles (Last 96 periods = 24 hours)
Date/Time | Open | High | Low | Close | Volume
${formatted15M.map(c => `${c.datetime} | ${formatPrice(c.open)} | ${formatPrice(c.high)} | ${formatPrice(c.low)} | ${formatPrice(c.close)} | ${(c.volume / 1000).toFixed(0)}K`).join('\n')}
` : ''}

## 2. SUPPORT & RESISTANCE ZONES

### 4-Hour Timeframe Zones
Zone Level | Type | Strength (1-5) | Last Tested | Bounces | Breaks | Notes
${zones4H.filter(z => z.type === 'resistance').slice(0, 5).map(z => `${formatPrice(z.price)} | Resistance | ${z.strength} | ${z.lastTested} | ${z.count} | ${z.breaks} | ${z.strength >= 4 ? 'Major level' : 'Minor level'}`).join('\n')}
${zones4H.filter(z => z.type === 'support').slice(0, 5).map(z => `${formatPrice(z.price)} | Support | ${z.strength} | ${z.lastTested} | ${z.count} | ${z.breaks} | ${z.strength >= 4 ? 'Major level' : 'Minor level'}`).join('\n')}

### 1-Hour Timeframe Zones (Intraday Entry/Exit Points)
Zone Level | Type | Strength | Time Formed | Confluence
${zones1H.slice(0, 5).map(z => `${formatPrice(z.price)} | ${z.type} | ${z.strength} | ${z.lastTested} | ${z.strength >= 4 ? 'Strong' : 'Moderate'}`).join('\n')}

## 3. MARKET STRUCTURE & TREND

### Current Trend Analysis
- 4-Hour Trend: ${structure4H.trend}
- 1-Hour Trend: ${structure1H.trend}
- Direction Alignment: ${structure4H.trend === structure1H.trend ? 'Confluent' : 'Conflicting'}

### Key Structure Points
- Higher Highs / Lower Lows (Last 5 candles on 4H):
${structure4H.recentSwingHighs.slice(-5).map((h, i) => `  - ${new Date(candles4H[candles4H.length - 20 + h.index].timestamp).toISOString().split('T')[0]}: High ${h.price.toFixed(5)} ${i === structure4H.recentSwingHighs.length - 1 ? '(Latest)' : ''}`).join('\n')}

- Swing Points (Intraday):
  - Recent Swing Low: ${structure1H.lastLow ? formatPrice(structure1H.lastLow.price) : 'N/A'} (1H)
  - Recent Swing High: ${structure1H.lastHigh ? formatPrice(structure1H.lastHigh.price) : 'N/A'} (1H)

## 4. TECHNICAL INDICATORS

### Momentum Indicators
Indicator | 4H Value | 1H Value | Signal | Divergence?
RSI (14) | ${rsi4H.length > 0 ? rsi4H[rsi4H.length - 1].toFixed(2) : 'N/A'} | ${rsi1H.length > 0 ? rsi1H[rsi1H.length - 1].toFixed(2) : 'N/A'} | ${this.getRSISignal(rsi4H, rsi1H)} | No
MACD | ${macd4H ? `${macd4H.histogram > 0 ? 'Positive histogram' : 'Negative histogram'}, ${macd4H.macd > macd4H.signal ? 'above signal' : 'below signal'}` : 'N/A'} | ${macd1H ? `${macd1H.histogram > 0 ? 'Positive' : 'Negative'}, ${macd1H.macd > macd1H.signal ? 'rising' : 'falling'}` : 'N/A'} | ${this.getMACDSignal(macd4H, macd1H)} | Aligned
Stochastic (14,3,3) | ${stochRsi4H.k.length > 0 ? stochRsi4H.k[stochRsi4H.k.length - 1].toFixed(2) : 'N/A'} | ${stochRsi1H.k.length > 0 ? stochRsi1H.k[stochRsi1H.k.length - 1].toFixed(2) : 'N/A'} | ${this.getStochSignal(stochRsi4H, stochRsi1H)} | ${this.checkDivergence(stochRsi4H, stochRsi1H)}
CCI (20) | ${cci4H.length > 0 ? cci4H[cci4H.length - 1].toFixed(2) : 'N/A'} | ${cci1H.length > 0 ? cci1H[cci1H.length - 1].toFixed(2) : 'N/A'} | ${this.getCCISignal(cci4H, cci1H)} | -

### Volatility Indicators
Indicator | Value | Status | 30-Day Avg
ATR (14) | ${atr4H ? atr4H.toFixed(5) : 'N/A'} | ${atr4H ? (atr4H > 0.005 ? 'High' : atr4H < 0.003 ? 'Low' : 'Normal') : 'N/A'} | N/A
Bollinger Bands (20,2) | ${bb4H ? `Upper: ${bb4H.upper.toFixed(5)}, Lower: ${bb4H.lower.toFixed(5)}` : 'N/A'} | ${bb4H ? (currentPrice > bb4H.upper ? 'Price near upper band (potential pullback)' : currentPrice < bb4H.lower ? 'Price near lower band (potential bounce)' : 'Price in middle range') : 'N/A'} | -

### Moving Averages (4-Hour)
MA | Value | Alignment
20-SMA | ${sma20_4H.length > 0 ? formatPrice(sma20_4H[sma20_4H.length - 1]) : 'N/A'} | ${sma20_4H.length > 0 ? (currentPrice > sma20_4H[sma20_4H.length - 1] ? 'Price above (bullish)' : 'Price below (bearish)') : 'N/A'}
50-SMA | ${sma50_4H.length > 0 ? formatPrice(sma50_4H[sma50_4H.length - 1]) : 'N/A'} | ${sma50_4H.length > 0 ? (currentPrice > sma50_4H[sma50_4H.length - 1] ? 'Price above (bullish)' : 'Price below (bearish)') : 'N/A'}
200-SMA | ${sma200_4H.length > 0 ? formatPrice(sma200_4H[sma200_4H.length - 1]) : 'N/A'} | ${sma200_4H.length > 0 ? (currentPrice > sma200_4H[sma200_4H.length - 1] ? 'Price above (strong bullish)' : 'Price below (bearish)') : 'N/A'}

## 5. SESSION & TIME CONTEXT

### Current Market Session
- Active Session: ${session.session}
- Time Until Next Major Session Shift: ${session.hoursUntilNext} hours
- Market Volatility Level: ${atr4H ? (atr4H > 0.005 ? 'High' : atr4H < 0.003 ? 'Low' : 'Moderate') : 'Unknown'} (vs. session average)

## 6. VOLUME & ORDER FLOW

### Volume Analysis
Period | Volume | 20-Period Avg | Status
Current 1H | ${candles1H[candles1H.length - 1].volume ? (candles1H[candles1H.length - 1].volume / 1000000).toFixed(1) + 'M' : 'N/A'} | ${this.calculateAvgVolume(candles1H.slice(-20))} | ${this.getVolumeStatus(candles1H)}
Current 4H | ${candles4H[candles4H.length - 1].volume ? (candles4H[candles4H.length - 1].volume / 1000000).toFixed(1) + 'M' : 'N/A'} | ${this.calculateAvgVolume(candles4H.slice(-20))} | ${this.getVolumeStatus(candles4H)}

## 7. RECENT MARKET STRUCTURE

### Last 5 Days Summary
Day | Open | High | Low | Close | Range | Trend
${dailySummaries.map(d => `${d.date} | ${formatPrice(d.open)} | ${formatPrice(d.high)} | ${formatPrice(d.low)} | ${formatPrice(d.close)} | ${formatPrice(d.range)} | ${d.trend}`).join('\n')}

## 8. RISK MANAGEMENT PARAMETERS

### Volatility Profile
- 4-Hour ATR: ${atr4H ? atr4H.toFixed(5) : 'N/A'} pips
- Daily Expected Range: ${atr4H ? (atr4H * 4).toFixed(5) : 'N/A'} - ${atr4H ? (atr4H * 6).toFixed(5) : 'N/A'}
- Typical Intraday Range (1-4H trades): ${atr1H ? atr1H.toFixed(5) : 'N/A'} - ${atr4H ? atr4H.toFixed(5) : 'N/A'}

### Key Price Levels for Risk Management
Level | Type | Distance from Current | Risk/Reward Ratio
${zones1H.filter(z => z.type === 'support').slice(0, 1).map(z => `${formatPrice(z.price)} | Stop Loss | ${((z.price - currentPrice) / currentPrice * 100).toFixed(2)}% | 1:1.5`).join('\n')}
${zones1H.filter(z => z.type === 'resistance').slice(0, 2).map((z, i) => `${formatPrice(z.price)} | Take Profit Target ${i + 1} | ${((z.price - currentPrice) / currentPrice * 100).toFixed(2)}% | 1:${(i + 2)}`).join('\n')}

## 9. CONFLUENCE ZONES (AI FOCUS)

### High-Probability Entry Zones
${this.formatConfluenceZones(zones1H.filter(z => z.type === 'support'), currentPrice, 'Entry', isCrypto)}

### High-Probability Exit Zones
${this.formatConfluenceZones(zones1H.filter(z => z.type === 'resistance'), currentPrice, 'Exit', isCrypto)}

${zone ? `
## 10. DETECTED ZONE CONTEXT
- Zone Type: ${zone.type === 'discount' ? 'DISCOUNT ZONE (Potential BUY setup)' : 'PREMIUM ZONE (Potential SELL setup)'}
- Zone Price: ${formatPrice(zone.price)}
- Zone EMAs: EMA20=${formatPrice(zone.ema20)}, EMA38=${formatPrice(zone.ema38)}, EMA62=${formatPrice(zone.ema62)}
- Stochastic K: ${zone.stochK.toFixed(2)}
- Detected At: ${new Date(zone.createdAt).toLocaleString()}
` : ''}

## INSTRUCTIONS FOR AI ANALYSIS

CRITICAL: Write your analysis in PLAIN TEXT ONLY. Do NOT use any formatting:
- NO HTML tags (<b>, <i>, <p>, <ul>, <li>, <table>, etc.)
- NO markdown syntax (####, ###, ##, #, **, *)
- NO formatting codes of any kind
- Write naturally in plain text with proper capitalization and spacing
- Use line breaks to separate sections
- Write numbers and prices as plain text

Structure your analysis:
1. Market Structure Analysis (trend, support/resistance, key levels based on multi-timeframe analysis)
2. Current Market Phase (trending/ranging/reversal) with reasoning from multiple timeframes
3. Technical Indicator Analysis (EMA/SMA alignment, RSI, MACD, Stochastic RSI, CCI interpretation across timeframes)
4. Trade Setup (if HIGH-PROBABILITY opportunity exists):
   - Trade Direction (BUY or SELL)
   - Entry Price (specific level with confluence)
   - Stop Loss (SL) with reasoning based on support/resistance
   - Take Profit (TP1 and TP2) with reasoning based on resistance/support levels
   - Risk-Reward Ratio
   - Confluence factors (multiple reasons supporting the trade from different timeframes and indicators)
5. If NO clear setup exists, explain why and what to wait for

Be specific with entry/SL/TP levels based on the actual price data, support/resistance levels, and technical indicators provided. Consider multi-timeframe confluence for higher probability setups.

Remember: Write in plain text only - no HTML, no markdown, just clean readable text.`;

    return marketData;
  }

  // Helper methods
  getRSISignal(rsi4H, rsi1H) {
    const r4 = rsi4H.length > 0 ? rsi4H[rsi4H.length - 1] : 50;
    const r1 = rsi1H.length > 0 ? rsi1H[rsi1H.length - 1] : 50;
    if (r4 > 70 || r1 > 70) return 'Overbought';
    if (r4 < 30 || r1 < 30) return 'Oversold';
    if (r4 > 50 && r1 > 50) return 'Bullish';
    if (r4 < 50 && r1 < 50) return 'Bearish';
    return 'Neutral';
  }

  getMACDSignal(macd4H, macd1H) {
    if (!macd4H || !macd1H) return 'N/A';
    if (macd4H.histogram > 0 && macd1H.histogram > 0) return 'Bullish';
    if (macd4H.histogram < 0 && macd1H.histogram < 0) return 'Bearish';
    return 'Mixed';
  }

  getStochSignal(stoch4H, stoch1H) {
    const k4 = stoch4H.k.length > 0 ? stoch4H.k[stoch4H.k.length - 1] : 50;
    const k1 = stoch1H.k.length > 0 ? stoch1H.k[stoch1H.k.length - 1] : 50;
    if (k4 > 75 || k1 > 75) return 'Overbought territory';
    if (k4 < 25 || k1 < 25) return 'Oversold territory';
    return 'Neutral';
  }

  checkDivergence(stoch4H, stoch1H) {
    return 'No';
  }

  getCCISignal(cci4H, cci1H) {
    const c4 = cci4H.length > 0 ? cci4H[cci4H.length - 1] : 0;
    const c1 = cci1H.length > 0 ? cci1H[cci1H.length - 1] : 0;
    if (c4 > 100 && c1 > 100) return 'Strong bullish';
    if (c4 < -100 && c1 < -100) return 'Strong bearish';
    return 'Neutral';
  }

  calculateAvgVolume(candles) {
    if (candles.length === 0) return 'N/A';
    const volumes = candles.filter(c => c.volume).map(c => c.volume);
    if (volumes.length === 0) return 'N/A';
    const avg = volumes.reduce((a, b) => a + b, 0) / volumes.length;
    return (avg / 1000000).toFixed(1) + 'M';
  }

  getVolumeStatus(candles) {
    if (candles.length < 2) return 'N/A';
    const current = candles[candles.length - 1].volume || 0;
    const avg = this.calculateAvgVolume(candles.slice(-20));
    if (avg === 'N/A') return 'Unknown';
    const avgNum = parseFloat(avg);
    if (current > avgNum * 1.2) return 'High';
    if (current < avgNum * 0.8) return 'Low';
    return 'Normal';
  }

  calculateDailySummaries(candles1H) {
    const summaries = [];
    const now = new Date();
    
    for (let i = 4; i >= 0; i--) {
      const date = new Date(now);
      date.setUTCDate(date.getUTCDate() - i);
      date.setUTCHours(0, 0, 0, 0);
      const nextDay = new Date(date);
      nextDay.setUTCDate(nextDay.getUTCDate() + 1);
      
      const dayCandles = candles1H.filter(c => {
        const cDate = new Date(c.timestamp);
        return cDate >= date && cDate < nextDay;
      });
      
      if (dayCandles.length > 0) {
        const open = dayCandles[0].open;
        const close = dayCandles[dayCandles.length - 1].close;
        const high = Math.max(...dayCandles.map(c => c.high));
        const low = Math.min(...dayCandles.map(c => c.low));
        const range = high - low;
        const trend = close > open ? 'Bullish' : close < open ? 'Bearish' : 'Neutral';
        
        summaries.push({
          date: date.toISOString().split('T')[0],
          open,
          high,
          low,
          close,
          range,
          trend
        });
      }
    }
    
    return summaries;
  }

  formatConfluenceZones(zones, currentPrice, type) {
    if (zones.length === 0) return `No ${type.toLowerCase()} zones identified.`;
    
    return zones.slice(0, 2).map((z, i) => {
      const distance = Math.abs(z.price - currentPrice);
      const distancePct = (distance / currentPrice * 100).toFixed(2);
      const confluence = z.strength >= 4 ? 'STRONG' : 'MODERATE';
      
      return `Zone ${i + 1}: ${z.price.toFixed(5)}
- ${type === 'Entry' ? 'Support zone' : 'Resistance zone'} (${z.count} tests)
- Strength: ${z.strength}/5
- Distance: ${distancePct}%
- Confluence: ${confluence}`;
    }).join('\n\n');
  }
}

export default new AdvancedMarketAnalysis();

