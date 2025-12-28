import binanceClient from '../apis/binance.js';
import bybitClient from '../apis/bybit.js';
import derivClient from '../apis/deriv.js';
import analysisClient from '../apis/analysis.js';
import twelveDataClient from '../apis/twelveData.js';
import finnhubClient from '../apis/finnhub.js';
import newsClient from '../apis/news.js';
import { getPairState } from '../db/firestore.js';
import logger from './logger.js';
import premiumDiscountCalculator from '../indicators/premiumDiscountCalculator.js';

/**
 * Zone Data Aggregator
 * Collects comprehensive data for AI zone analysis
 */
class ZoneDataAggregator {
  constructor() {
    this.cache = new Map();
    this.cacheTTL = 10 * 60 * 1000; // 10 minutes cache
  }

  /**
   * Aggregate comprehensive data for a zone
   */
  async aggregateZoneData(zoneData) {
    try {
      const { symbol, exchange, type, price } = zoneData;
      const cacheKey = `${symbol}_${type}_${Date.now() - (Date.now() % this.cacheTTL)}`;

      // Check cache first
      if (this.cache.has(cacheKey)) {
        logger.debug(`Using cached zone data for ${symbol}`);
        return this.cache.get(cacheKey);
      }

      logger.info(`Aggregating comprehensive data for ${symbol} zone...`);

      // Collect all data in parallel for efficiency
      const [
        multiTimeframeData,
        advancedIndicators,
        fundamentalData,
        botState,
        marketStructure
      ] = await Promise.allSettled([
        this.getMultiTimeframeData(symbol, exchange),
        this.getAdvancedIndicators(symbol, exchange),
        this.getFundamentalData(symbol),
        this.getBotState(symbol),
        this.getMarketStructure(symbol, exchange)
      ]);

      const aggregatedData = {
        symbol,
        exchange,
        zoneType: type,
        entryPrice: price,
        detectedAt: new Date().toISOString(),

        // Multi-timeframe data
        multiTimeframe: multiTimeframeData.status === 'fulfilled' ? multiTimeframeData.value : null,

        // Advanced technical indicators
        indicators: advancedIndicators.status === 'fulfilled' ? advancedIndicators.value : null,

        // Fundamental data
        fundamental: fundamentalData.status === 'fulfilled' ? fundamentalData.value : null,

        // Bot's internal state
        botState: botState.status === 'fulfilled' ? botState.value : null,

        // Market structure analysis
        marketStructure: marketStructure.status === 'fulfilled' ? marketStructure.value : null
      };

      // Cache the result
      this.cache.set(cacheKey, aggregatedData);

      // Clean old cache entries
      this.cleanCache();

      return aggregatedData;

    } catch (error) {
      logger.error(`Error aggregating zone data for ${zoneData.symbol}:`, error.message);
      return null;
    }
  }

  /**
   * Get multi-timeframe candlestick data
   */
  async getMultiTimeframeData(symbol, exchange) {
    try {
      const timeframes = [
        { tf: '1h', count: 200, name: '1H' },
        { tf: '4h', count: 100, name: '4H' },
        { tf: '1d', count: 30, name: '1D' }
      ];

      const results = {};

      for (const { tf, count, name } of timeframes) {
        try {
          let candles;

          // Get candles based on exchange
          if (exchange === 'binance') {
            candles = await binanceClient.getKlines(symbol, tf, count);
          } else if (exchange === 'bybit') {
            candles = await bybitClient.getKlines(symbol, this.mapTimeframe(tf), count);
          } else if (exchange === 'deriv' || exchange === 'forex') {
            const seconds = this.timeframeToSeconds(tf);
            candles = await derivClient.getCandles(symbol, seconds, count);
          }

          if (candles && candles.length > 0) {
            results[name] = {
              candles,
              analysis: this.analyzeCandles(candles, tf)
            };
          }

        } catch (error) {
          logger.warn(`Failed to get ${name} candles for ${symbol}:`, error.message);
        }
      }

      return results;

    } catch (error) {
      logger.error(`Error getting multi-timeframe data for ${symbol}:`, error.message);
      return null;
    }
  }

  /**
   * Analyze candles for trend, strength, etc.
   */
  analyzeCandles(candles, timeframe) {
    if (!candles || candles.length < 20) return null;

    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const volumes = candles.map(c => c.volume || 0);

    // Calculate trend
    const recent = closes.slice(-20);
    const older = closes.slice(-40, -20);
    const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
    const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;
    const trend = recentAvg > olderAvg ? 'bullish' : recentAvg < olderAvg ? 'bearish' : 'sideways';

    // Calculate volatility (ATR-like)
    let volatility = 0;
    for (let i = 1; i < closes.length; i++) {
      const tr = Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i-1]),
        Math.abs(lows[i] - closes[i-1])
      );
      volatility += tr;
    }
    volatility = volatility / (closes.length - 1);

    // Volume analysis
    const avgVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;
    const recentVolume = volumes.slice(-10).reduce((a, b) => a + b, 0) / 10;
    const volumeTrend = recentVolume > avgVolume ? 'increasing' : recentVolume < avgVolume ? 'decreasing' : 'stable';

    // Support/Resistance levels (simple swing points)
    const swingHighs = [];
    const swingLows = [];

    for (let i = 2; i < highs.length - 2; i++) {
      if (highs[i] > highs[i-1] && highs[i] > highs[i-2] && highs[i] > highs[i+1] && highs[i] > highs[i+2]) {
        swingHighs.push(highs[i]);
      }
      if (lows[i] < lows[i-1] && lows[i] < lows[i-2] && lows[i] < lows[i+1] && lows[i] < lows[i+2]) {
        swingLows.push(lows[i]);
      }
    }

    return {
      trend,
      volatility: volatility / closes[closes.length - 1], // Normalized
      volumeTrend,
      avgVolume,
      recentVolume,
      swingHighs: swingHighs.slice(-3), // Last 3 swing highs
      swingLows: swingLows.slice(-3),   // Last 3 swing lows
      currentPrice: closes[closes.length - 1],
      priceRange: {
        high: Math.max(...highs.slice(-20)),
        low: Math.min(...lows.slice(-20))
      }
    };
  }

  /**
   * Get advanced technical indicators
   */
  async getAdvancedIndicators(symbol, exchange) {
    try {
      const results = {};

      // Try Alpha Vantage first
      if (analysisClient.apiKey) {
        try {
          const alphaData = await analysisClient.getTechnicalAnalysis(symbol);
          if (alphaData) results.alphaVantage = alphaData;
        } catch (error) {
          logger.debug(`Alpha Vantage failed for ${symbol}:`, error.message);
        }
      }

      // Try Twelve Data
      if (twelveDataClient.isConfigured()) {
        try {
          const twelveData = await twelveDataClient.getIndicators(symbol);
          if (twelveData) results.twelveData = twelveData;
        } catch (error) {
          logger.debug(`Twelve Data failed for ${symbol}:`, error.message);
        }
      }

      // Calculate additional indicators from our candle data
      try {
        let candles;
        if (exchange === 'binance') {
          candles = await binanceClient.getKlines(symbol, '1h', 100);
        } else if (exchange === 'bybit') {
          candles = await bybitClient.getKlines(symbol, '60', 100);
        } else if (exchange === 'deriv' || exchange === 'forex') {
          candles = await derivClient.getCandles(symbol, 3600, 100);
        }

        if (candles) {
          results.calculated = this.calculateAdvancedIndicators(candles);
        }
      } catch (error) {
        logger.debug(`Calculated indicators failed for ${symbol}:`, error.message);
      }

      return results;

    } catch (error) {
      logger.error(`Error getting advanced indicators for ${symbol}:`, error.message);
      return null;
    }
  }

  /**
   * Calculate advanced indicators from candle data
   */
  calculateAdvancedIndicators(candles) {
    if (!candles || candles.length < 50) return null;

    const closes = candles.map(c => c.close);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);

    // Bollinger Bands
    const period = 20;
    const stdDev = 2;
    const sma20 = closes.slice(-period).reduce((a, b) => a + b, 0) / period;
    const variance = closes.slice(-period).reduce((sum, price) => sum + Math.pow(price - sma20, 2), 0) / period;
    const standardDeviation = Math.sqrt(variance);

    // ATR (Average True Range)
    let atrSum = 0;
    for (let i = 1; i < Math.min(14, candles.length); i++) {
      const tr = Math.max(
        highs[i] - lows[i],
        Math.abs(highs[i] - closes[i-1]),
        Math.abs(lows[i] - closes[i-1])
      );
      atrSum += tr;
    }
    const atr = atrSum / Math.min(14, candles.length - 1);

    // ADX (simplified)
    let adxSum = 0;
    for (let i = 1; i < Math.min(14, candles.length); i++) {
      const dmPlus = highs[i] - highs[i-1] > lows[i-1] - lows[i] ? Math.max(highs[i] - highs[i-1], 0) : 0;
      const dmMinus = lows[i-1] - lows[i] > highs[i] - highs[i-1] ? Math.max(lows[i-1] - lows[i], 0) : 0;
      const tr = Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i-1]), Math.abs(lows[i] - closes[i-1]));

      if (tr > 0) {
        const diPlus = (dmPlus / tr) * 100;
        const diMinus = (dmMinus / tr) * 100;
        const dx = (Math.abs(diPlus - diMinus) / (diPlus + diMinus)) * 100;
        adxSum += dx;
      }
    }
    const adx = adxSum / Math.min(14, candles.length - 1);

    return {
      bollingerBands: {
        upper: sma20 + (standardDeviation * stdDev),
        middle: sma20,
        lower: sma20 - (standardDeviation * stdDev),
        position: (closes[closes.length - 1] - sma20) / (standardDeviation * stdDev) // Z-score like position
      },
      atr: atr / closes[closes.length - 1], // Normalized ATR
      adx,
      volatility: standardDeviation / sma20, // Coefficient of variation
      trendStrength: adx > 25 ? 'strong' : adx > 20 ? 'moderate' : 'weak'
    };
  }

  /**
   * Get fundamental data
   */
  async getFundamentalData(symbol) {
    try {
      const results = {};

      // Economic calendar
      if (newsClient.apiKey) {
        try {
          const calendar = await newsClient.getTodayNews();
          if (calendar) results.economicCalendar = calendar;
        } catch (error) {
          logger.debug(`Economic calendar failed for ${symbol}:`, error.message);
        }
      }

      // Market news
      if (finnhubClient.isConfigured()) {
        try {
          const news = await finnhubClient.getMarketNews('forex');
          if (news) results.marketNews = news.slice(0, 5); // Limit to 5 recent news
        } catch (error) {
          logger.debug(`Market news failed for ${symbol}:`, error.message);
        }
      }

      // Currency analysis (basic)
      results.currencyAnalysis = this.analyzeCurrencyPair(symbol);

      return results;

    } catch (error) {
      logger.error(`Error getting fundamental data for ${symbol}:`, error.message);
      return null;
    }
  }

  /**
   * Analyze currency pair for fundamental factors
   */
  analyzeCurrencyPair(symbol) {
    // Extract currencies from pair
    const currencies = this.extractCurrencies(symbol);
    if (!currencies) return null;

    return {
      baseCurrency: currencies.base,
      quoteCurrency: currencies.quote,
      pairType: this.getPairType(currencies),
      majorCurrencies: ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD'],
      isMajorPair: this.isMajorPair(currencies)
    };
  }

  /**
   * Get bot's internal state for the pair
   */
  async getBotState(symbol) {
    try {
      const pairState = await getPairState(symbol);
      return pairState || null;
    } catch (error) {
      logger.error(`Error getting bot state for ${symbol}:`, error.message);
      return null;
    }
  }

  /**
   * Get market structure analysis
   */
  async getMarketStructure(symbol, exchange) {
    try {
      // Get recent candles for structure analysis
      let candles;
      if (exchange === 'binance') {
        candles = await binanceClient.getKlines(symbol, '1h', 100);
      } else if (exchange === 'bybit') {
        candles = await bybitClient.getKlines(symbol, '60', 100);
      } else if (exchange === 'deriv' || exchange === 'forex') {
        candles = await derivClient.getCandles(symbol, 3600, 100);
      }

      if (!candles) return null;

      return this.analyzeMarketStructure(candles);

    } catch (error) {
      logger.error(`Error getting market structure for ${symbol}:`, error.message);
      return null;
    }
  }

  /**
   * Analyze market structure from candles
   */
  analyzeMarketStructure(candles) {
    if (!candles || candles.length < 50) return null;

    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const closes = candles.map(c => c.close);

    // Find recent swing points
    const swingHighs = [];
    const swingLows = [];

    for (let i = 5; i < highs.length - 5; i++) {
      // Swing high: higher than surrounding candles
      if (highs[i] === Math.max(...highs.slice(i-5, i+6))) {
        swingHighs.push({ price: highs[i], index: i, timestamp: candles[i].timestamp });
      }
      // Swing low: lower than surrounding candles
      if (lows[i] === Math.min(...lows.slice(i-5, i+6))) {
        swingLows.push({ price: lows[i], index: i, timestamp: candles[i].timestamp });
      }
    }

    // Determine current trend
    const recentHighs = swingHighs.slice(-3);
    const recentLows = swingLows.slice(-3);

    let trend = 'sideways';
    if (recentHighs.length >= 2 && recentLows.length >= 2) {
      const recentHigh = Math.max(...recentHighs.map(h => h.price));
      const olderHigh = Math.min(...recentHighs.slice(0, -1).map(h => h.price));
      const recentLow = Math.min(...recentLows.map(l => l.price));
      const olderLow = Math.max(...recentLows.slice(0, -1).map(l => l.price));

      if (recentHigh > olderHigh && recentLow > olderLow) {
        trend = 'bullish';
      } else if (recentHigh < olderHigh && recentLow < olderLow) {
        trend = 'bearish';
      }
    }

    // Find order blocks (areas with high volume/large candles)
    const orderBlocks = [];
    for (let i = 10; i < candles.length; i++) {
      const candle = candles[i];
      const volume = candle.volume || 0;
      const avgVolume = candles.slice(i-10, i).reduce((sum, c) => sum + (c.volume || 0), 0) / 10;

      if (volume > avgVolume * 1.5 && Math.abs(candle.close - candle.open) > Math.abs(candle.high - candle.low) * 0.6) {
        orderBlocks.push({
          type: candle.close > candle.open ? 'bullish' : 'bearish',
          price: candle.close,
          volume: volume,
          timestamp: candle.timestamp
        });
      }
    }

    return {
      trend,
      swingHighs: swingHighs.slice(-5),
      swingLows: swingLows.slice(-5),
      orderBlocks: orderBlocks.slice(-3),
      currentPrice: closes[closes.length - 1],
      structureStrength: this.calculateStructureStrength(swingHighs, swingLows)
    };
  }

  /**
   * Calculate market structure strength
   */
  calculateStructureStrength(swingHighs, swingLows) {
    if (swingHighs.length < 3 || swingLows.length < 3) return 'weak';

    // Check if swing points are clearly defined and separated
    const recentHighs = swingHighs.slice(-3).map(h => h.price);
    const recentLows = swingLows.slice(-3).map(l => l.price);

    const highRange = Math.max(...recentHighs) - Math.min(...recentHighs);
    const lowRange = Math.max(...recentLows) - Math.min(...recentLows);
    const avgRange = (highRange + lowRange) / 2;

    const currentPrice = recentHighs[recentHighs.length - 1] || recentLows[recentLows.length - 1] || 0;
    const avgRangePercent = avgRange / currentPrice;

    if (avgRangePercent > 0.02) return 'strong';
    if (avgRangePercent > 0.01) return 'moderate';
    return 'weak';
  }

  /**
   * Helper: Map timeframe to Bybit format
   */
  mapTimeframe(tf) {
    const mapping = {
      '1m': '1',
      '5m': '5',
      '15m': '15',
      '1h': '60',
      '4h': '240',
      '1d': 'D'
    };
    return mapping[tf] || '60';
  }

  /**
   * Helper: Convert timeframe to seconds
   */
  timeframeToSeconds(tf) {
    const mapping = {
      '1m': 60,
      '5m': 300,
      '15m': 900,
      '1h': 3600,
      '4h': 14400,
      '1d': 86400
    };
    return mapping[tf] || 3600;
  }

  /**
   * Helper: Extract currencies from pair
   */
  extractCurrencies(symbol) {
    // Handle forex pairs like EURUSD, GBPJPY
    if (symbol.length === 6 && /^[A-Z]{6}$/.test(symbol)) {
      return {
        base: symbol.substring(0, 3),
        quote: symbol.substring(3, 6)
      };
    }

    // Handle crypto pairs like BTCUSDT
    const cryptoMatch = symbol.match(/^([A-Z]+)(USDT|BTC|ETH|BUSD)$/);
    if (cryptoMatch) {
      return {
        base: cryptoMatch[1],
        quote: cryptoMatch[2]
      };
    }

    return null;
  }

  /**
   * Helper: Get pair type
   */
  getPairType(currencies) {
    if (!currencies) return 'unknown';

    const majors = ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'CAD', 'AUD', 'NZD'];

    if (currencies.quote === 'USD') return 'major';
    if (majors.includes(currencies.base) && majors.includes(currencies.quote)) return 'cross';
    if (currencies.quote !== 'USD' && !majors.includes(currencies.quote)) return 'exotic';

    return 'other';
  }

  /**
   * Helper: Check if major pair
   */
  isMajorPair(currencies) {
    if (!currencies) return false;

    const majorPairs = [
      'EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD',
      'USDCHF', 'NZDUSD', 'EURGBP', 'EURJPY', 'GBPJPY'
    ];

    return majorPairs.includes(currencies.base + currencies.quote);
  }

  /**
   * Clean old cache entries
   */
  cleanCache() {
    const now = Date.now();
    for (const [key, value] of this.cache.entries()) {
      if (now - new Date(value.detectedAt).getTime() > this.cacheTTL) {
        this.cache.delete(key);
      }
    }
  }
}

export default new ZoneDataAggregator();
