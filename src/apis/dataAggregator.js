import logger from '../utils/logger.js';
import { getActiveSignals, getTrendingPairs, getPairState } from '../db/firestore.js';
import bybitClient from './bybit.js';
import derivClient from './deriv.js';
import analysisClient from './analysis.js';
import twelveDataClient from './twelveData.js';
import finnhubClient from './finnhub.js';
import newsClient from './news.js';
import newsApiClient from './newsApi.js';

/**
 * Data Aggregator - Collects comprehensive market data for AI analysis
 */
export class DataAggregator {
  constructor() {
    this.cache = new Map();
    this.cacheTTL = 5 * 60 * 1000; // 5 minutes
  }

  /**
   * Aggregate all available data for a symbol
   */
  async aggregateData(symbol, userQuestion) {
    try {
      logger.info(`Aggregating data for ${symbol}...`);

      // Normalize symbol
      const normalizedSymbol = this.normalizeSymbol(symbol);

      // Check cache
      const cacheKey = `${normalizedSymbol}_${Date.now() - (Date.now() % this.cacheTTL)}`;
      if (this.cache.has(cacheKey)) {
        logger.info('Using cached data');
        return this.cache.get(cacheKey);
      }

      // Collect data in parallel (with error handling for each)
      const [
        botData,
        technicalData,
        newsData,
        marketData
      ] = await Promise.allSettled([
        this.getBotData(normalizedSymbol),
        this.getTechnicalData(normalizedSymbol),
        this.getNewsData(normalizedSymbol),
        this.getMarketData(normalizedSymbol)
      ]);

      const aggregatedData = {
        symbol: normalizedSymbol,
        originalQuestion: userQuestion,
        timestamp: new Date().toISOString(),
        botData: botData.status === 'fulfilled' ? botData.value : null,
        technicalData: technicalData.status === 'fulfilled' ? technicalData.value : null,
        newsData: newsData.status === 'fulfilled' ? newsData.value : null,
        marketData: marketData.status === 'fulfilled' ? marketData.value : null
      };

      // Cache the result
      this.cache.set(cacheKey, aggregatedData);

      // Clean old cache entries
      this.cleanCache();

      return aggregatedData;
    } catch (error) {
      logger.error('Data aggregation error:', error.message);
      throw error;
    }
  }

  /**
   * Get bot's internal data
   */
  async getBotData(symbol) {
    try {
      const [pairState, activeSignals, trending] = await Promise.allSettled([
        getPairState(symbol),
        getActiveSignals(),
        getTrendingPairs(new Date().toISOString().split('T')[0])
      ]);

      return {
        pairState: pairState.status === 'fulfilled' ? pairState.value : null,
        activeSignals: activeSignals.status === 'fulfilled' ? activeSignals.value : [],
        trending: trending.status === 'fulfilled' ? trending.value : null
      };
    } catch (error) {
      logger.error('Bot data error:', error.message);
      return null;
    }
  }

  /**
   * Get technical analysis from multiple sources
   */
  async getTechnicalData(symbol) {
    const results = {};

    // Try Alpha Vantage
    if (analysisClient.apiKey) {
      try {
        results.alphaVantage = await analysisClient.getTechnicalAnalysis(symbol);
      } catch (error) {
        logger.warn('Alpha Vantage failed:', error.message);
      }
    }

    // Try Twelve Data
    if (twelveDataClient.isConfigured()) {
      try {
        const [quote, indicators] = await Promise.all([
          twelveDataClient.getQuote(symbol),
          twelveDataClient.getIndicators(symbol)
        ]);
        results.twelveData = { quote, indicators };
      } catch (error) {
        logger.warn('Twelve Data failed:', error.message);
      }
    }

    return Object.keys(results).length > 0 ? results : null;
  }

  /**
   * Get news from multiple sources
   */
  async getNewsData(symbol) {
    const results = {};

    // Try FCS API (economic calendar)
    if (newsClient.apiKey) {
      try {
        results.economicCalendar = await newsClient.getTodayNews();
      } catch (error) {
        logger.warn('FCS API failed:', error.message);
      }
    }

    // Try Finnhub (market news)
    if (finnhubClient.isConfigured()) {
      try {
        results.marketNews = await finnhubClient.getMarketNews('forex');
      } catch (error) {
        logger.warn('Finnhub failed:', error.message);
      }
    }

    // Try NewsAPI (general news)
    if (newsApiClient.isConfigured()) {
      try {
        results.pairNews = await newsApiClient.getPairNews(symbol);
      } catch (error) {
        logger.warn('NewsAPI failed:', error.message);
      }
    }

    return Object.keys(results).length > 0 ? results : null;
  }

  /**
   * Get market data (price, volume, etc.)
   */
  async getMarketData(symbol) {
    try {
      // Determine if it's crypto or forex
      const isCrypto = symbol.includes('USDT') || symbol.includes('BTC');
      const isForex = symbol.startsWith('frx') || (symbol.length === 6 && /^[A-Z]{6}$/.test(symbol));

      if (isCrypto) {
        // Get from Bybit
        return {
          source: 'bybit',
          data: await this.getBybitData(symbol)
        };
      } else if (isForex) {
        // Get from Deriv
        return {
          source: 'deriv',
          data: await this.getDerivData(symbol)
        };
      }

      return null;
    } catch (error) {
      logger.error('Market data error:', error.message);
      return null;
    }
  }

  /**
   * Get Bybit market data
   */
  async getBybitData(symbol) {
    try {
      // Get recent candles (15-minute timeframe)
      const candles = await bybitClient.getKlines(symbol, '15', 400);
      const latest = candles[candles.length - 1];

      return {
        price: latest?.close,
        high24h: Math.max(...candles.slice(-96).map(c => c.high)), // Last 96 candles = 24h
        low24h: Math.min(...candles.slice(-96).map(c => c.low)),
        volume24h: candles.slice(-96).reduce((sum, c) => sum + c.volume, 0),
        candles: candles // All 400 candles for AI analysis
      };
    } catch (error) {
      logger.error('Bybit data error:', error.message);
      return null;
    }
  }

  /**
   * Get Deriv market data
   */
  async getDerivData(symbol) {
    try {
      const candles = await derivClient.getCandles(symbol, 900, 400); // 15min candles, 400 count
      const latest = candles[candles.length - 1];

      return {
        price: latest?.close,
        high: Math.max(...candles.slice(-96).map(c => c.high)), // Last 24h
        low: Math.min(...candles.slice(-96).map(c => c.low)),
        candles: candles // All 400 candles for AI analysis
      };
    } catch (error) {
      logger.error('Deriv data error:', error.message);
      return null;
    }
  }

  /**
   * Format data for AI prompt
   */
  formatForAI(aggregatedData) {
    let prompt = '';

    // Market Data Section
    prompt += '📊 CURRENT MARKET DATA:\n';
    if (aggregatedData.marketData) {
      const market = aggregatedData.marketData;
      prompt += `Source: ${market.source}\n`;
      prompt += `Current Price: $${market.data?.price?.toFixed(4) || 'N/A'}\n`;
      if (market.data?.high24h) {
        prompt += `24h High: $${market.data.high24h.toFixed(4)}\n`;
        prompt += `24h Low: $${market.data.low24h.toFixed(4)}\n`;
      }
      if (market.data?.volume24h) {
        prompt += `24h Volume: ${market.data.volume24h.toFixed(0)}\n`;
      }
    } else {
      prompt += 'Market data unavailable\n';
    }
    prompt += '\n';

    // Candlestick Data Section (Recent 400 candles for pattern recognition)
    if (aggregatedData.marketData?.data?.candles && aggregatedData.marketData.data.candles.length > 0) {
      const candles = aggregatedData.marketData.data.candles;
      prompt += '📈 CANDLESTICK DATA (15-minute timeframe):\n';
      prompt += `Total candles: ${candles.length} (last ${(candles.length * 15 / 60).toFixed(1)} hours)\n`;

      // Add summary stats
      const closes = candles.map(c => c.close);
      const volumes = candles.map(c => c.volume);
      const avgPrice = closes.reduce((a, b) => a + b, 0) / closes.length;
      const avgVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;

      prompt += `Average price: $${avgPrice.toFixed(4)}\n`;
      prompt += `Average volume: ${avgVolume.toFixed(0)}\n`;

      // Add last 20 candles in detail for immediate context
      prompt += '\nLast 20 candles (most recent):\n';
      prompt += 'Time | Open | High | Low | Close | Volume\n';
      candles.slice(-20).forEach((c, idx) => {
        const time = new Date(c.timestamp).toISOString().substr(11, 5);
        prompt += `${time} | ${c.open.toFixed(4)} | ${c.high.toFixed(4)} | ${c.low.toFixed(4)} | ${c.close.toFixed(4)} | ${c.volume.toFixed(0)}\n`;
      });

      // Add price action summary (every 10th candle for longer-term view)
      prompt += `\nPrice action summary (every 10th candle, total ${Math.floor(candles.length / 10)}):\n`;
      for (let i = 0; i < candles.length; i += 10) {
        const c = candles[i];
        const time = new Date(c.timestamp).toISOString().substr(11, 5);
        const changePercent = i > 0 ? ((c.close - candles[i-10]?.close) / candles[i-10]?.close * 100) : 0;
        prompt += `${time}: $${c.close.toFixed(4)} (${changePercent >= 0 ? '+' : ''}${changePercent.toFixed(2)}%)\n`;
      }
      prompt += '\n';
    }

    // Technical Analysis Section
    prompt += '📈 TECHNICAL INDICATORS:\n';
    if (aggregatedData.technicalData) {
      const tech = aggregatedData.technicalData;

      if (tech.alphaVantage) {
        prompt += `Trend: ${tech.alphaVantage.trend || 'N/A'}\n`;
        if (tech.alphaVantage.sma20 != null && typeof tech.alphaVantage.sma20 === 'number') {
          prompt += `SMA(20): ${tech.alphaVantage.sma20.toFixed(4)}\n`;
        }
        if (tech.alphaVantage.ema20 != null && typeof tech.alphaVantage.ema20 === 'number') {
          prompt += `EMA(20): ${tech.alphaVantage.ema20.toFixed(4)}\n`;
        }
        if (tech.alphaVantage.rsi14 != null && typeof tech.alphaVantage.rsi14 === 'number') {
          prompt += `RSI(14): ${tech.alphaVantage.rsi14.toFixed(2)}\n`;
        }
        if (tech.alphaVantage.macd?.macd != null && tech.alphaVantage.macd?.signal != null) {
          prompt += `MACD: ${tech.alphaVantage.macd.macd.toFixed(4)} / Signal: ${tech.alphaVantage.macd.signal.toFixed(4)}\n`;
        }
      }

      if (tech.twelveData?.indicators) {
        const ind = tech.twelveData.indicators;
        if (ind.rsi != null) {
          const rsiValue = typeof ind.rsi === 'string' ? parseFloat(ind.rsi) : ind.rsi;
          if (!isNaN(rsiValue)) prompt += `RSI (12Data): ${rsiValue.toFixed(2)}\n`;
        }
        if (ind.ema20 != null) {
          const emaValue = typeof ind.ema20 === 'string' ? parseFloat(ind.ema20) : ind.ema20;
          if (!isNaN(emaValue)) prompt += `EMA(20) (12Data): ${emaValue.toFixed(4)}\n`;
        }
      }
    } else {
      prompt += 'Technical indicators unavailable\n';
    }
    prompt += '\n';

    // News Section
    prompt += '📰 NEWS & EVENTS:\n';
    if (aggregatedData.newsData) {
      const news = aggregatedData.newsData;

      if (news.economicCalendar && news.economicCalendar.length > 0) {
        prompt += 'Economic Calendar (Today):\n';
        news.economicCalendar.slice(0, 3).forEach(event => {
          prompt += `- ${event.time || 'TBA'} | ${event.country} | ${event.title || event.event}\n`;
        });
      }

      if (news.marketNews && news.marketNews.length > 0) {
        prompt += '\nRecent Market News:\n';
        news.marketNews.slice(0, 3).forEach(item => {
          prompt += `- ${item.headline} (${item.sentiment})\n`;
        });
      }

      if (news.pairNews && news.pairNews.length > 0) {
        prompt += '\nPair-Specific News:\n';
        news.pairNews.slice(0, 2).forEach(item => {
          prompt += `- ${item.title}\n`;
        });
      }
    } else {
      prompt += 'No recent news available\n';
    }
    prompt += '\n';

    // Bot's Active Signals
    prompt += '🤖 BOT\'S ACTIVE SIGNALS:\n';
    if (aggregatedData.botData?.activeSignals && aggregatedData.botData.activeSignals.length > 0) {
      aggregatedData.botData.activeSignals.slice(0, 5).forEach(signal => {
        prompt += `- ${signal.symbol}: ${signal.signalType} at $${signal.entryPrice?.toFixed(4)} (PnL: ${signal.pnlPercent?.toFixed(2)}%)\n`;
      });
    } else {
      prompt += 'No active signals\n';
    }
    prompt += '\n';

    // Bot's Pair State
    prompt += '🎯 PAIR STATE:\n';
    if (aggregatedData.botData?.pairState) {
      const state = aggregatedData.botData.pairState;
      prompt += `State: ${state.state}\n`;
      prompt += `15m EMA38: ${state.last15mEma38?.toFixed(4)}\n`;
      prompt += `15m EMA62: ${state.last15mEma62?.toFixed(4)}\n`;
      prompt += `15m Stoch RSI: ${state.last15mStochK?.toFixed(2)}\n`;
      prompt += `1m EMA38: ${state.last1mEma38?.toFixed(4)}\n`;
      prompt += `1m EMA62: ${state.last1mEma62?.toFixed(4)}\n`;
    } else {
      prompt += 'Pair not currently monitored by bot\n';
    }
    prompt += '\n';

    // Trending Pairs
    prompt += '📈 TODAY\'S TRENDING PAIRS:\n';
    if (aggregatedData.botData?.trending) {
      const trending = aggregatedData.botData.trending;
      if (trending.cryptoBullish && trending.cryptoBullish.length > 0) {
        prompt += 'Top Bullish: ';
        prompt += trending.cryptoBullish.slice(0, 3).map(p => `${p.symbol} (+${p.changePercent.toFixed(2)}%)`).join(', ');
        prompt += '\n';
      }
      if (trending.cryptoBearish && trending.cryptoBearish.length > 0) {
        prompt += 'Top Bearish: ';
        prompt += trending.cryptoBearish.slice(0, 3).map(p => `${p.symbol} (${p.changePercent.toFixed(2)}%)`).join(', ');
        prompt += '\n';
      }
    } else {
      prompt += 'Trending data not available\n';
    }

    return prompt;
  }

  /**
   * Normalize symbol (extract pair name)
   */
  normalizeSymbol(symbol) {
    // Extract pair from question if not explicit
    const upperSymbol = symbol.toUpperCase();

    // Common pairs
    const pairs = ['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD', 'XAUUSD',
                   'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT'];

    for (const pair of pairs) {
      if (upperSymbol.includes(pair)) {
        return pair;
      }
    }

    return upperSymbol;
  }

  /**
   * Clean old cache entries
   */
  cleanCache() {
    const now = Date.now();
    for (const [key, value] of this.cache.entries()) {
      if (now - value.timestamp > this.cacheTTL) {
        this.cache.delete(key);
      }
    }
  }
}

export default new DataAggregator();
