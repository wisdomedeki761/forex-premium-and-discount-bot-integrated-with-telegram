import axios from 'axios';
import config from '../config.js';
import logger from '../utils/logger.js';

/**
 * Alpha Vantage API for Technical Analysis
 * Free tier: 500 requests/day, 5 requests/minute
 */
export class AnalysisClient {
  constructor() {
    this.apiKey = config.alphaVantage?.apiKey;
    this.baseUrl = 'https://www.alphavantage.co/query';
  }

  /**
   * Get technical analysis summary for a symbol
   */
  async getTechnicalAnalysis(symbol) {
    if (!this.apiKey) {
      throw new Error('Alpha Vantage API key not configured');
    }

    try {
      // Remove frx prefix for forex pairs
      const cleanSymbol = symbol.replace(/^frx/i, '');

      // Determine if it's forex or crypto
      const isCrypto = symbol.includes('USDT') || symbol.includes('BTC') || symbol.includes('ETH');
      const isForex = cleanSymbol.length === 6 && /^[A-Z]{6}$/.test(cleanSymbol);

      let function_type, from_currency, to_currency, market;

      if (isCrypto) {
        // Crypto: BTCUSDT -> BTC/USDT
        from_currency = cleanSymbol.replace('USDT', '').replace('USD', '');
        to_currency = 'USDT';
        function_type = 'DIGITAL_CURRENCY_DAILY';
        market = 'USD';
      } else if (isForex) {
        // Forex: EURUSD -> EUR/USD
        from_currency = cleanSymbol.substring(0, 3);
        to_currency = cleanSymbol.substring(3, 6);
        function_type = 'FX_DAILY';
      } else {
        throw new Error('Symbol format not supported');
      }

      // Get SMA, EMA, RSI data
      const [sma, ema, rsi, macd] = await Promise.all([
        this.getIndicator('SMA', cleanSymbol, 'daily', { time_period: 20 }),
        this.getIndicator('EMA', cleanSymbol, 'daily', { time_period: 20 }),
        this.getIndicator('RSI', cleanSymbol, 'daily', { time_period: 14 }),
        this.getIndicator('MACD', cleanSymbol, 'daily', {})
      ]);

      // Parse latest values
      const latestSMA = this.getLatestValue(sma);
      const latestEMA = this.getLatestValue(ema);
      const latestRSI = this.getLatestValue(rsi);
      const latestMACD = this.getLatestMACD(macd);

      // Determine trend
      const trend = this.calculateTrend(latestSMA, latestEMA, latestRSI, latestMACD);

      return {
        symbol: cleanSymbol,
        sma20: latestSMA,
        ema20: latestEMA,
        rsi14: latestRSI,
        macd: latestMACD,
        trend,
        timestamp: Date.now()
      };
    } catch (error) {
      logger.error(`Failed to get technical analysis for ${symbol}:`, error.message);
      throw error;
    }
  }

  /**
   * Get specific technical indicator
   */
  async getIndicator(indicator, symbol, interval = 'daily', params = {}) {
    try {
      const cleanSymbol = symbol.replace(/^frx/i, '');
      const isForex = cleanSymbol.length === 6 && /^[A-Z]{6}$/.test(cleanSymbol);

      const queryParams = {
        function: indicator,
        symbol: isForex ? `${cleanSymbol.substring(0, 3)}/${cleanSymbol.substring(3, 6)}` : cleanSymbol,
        interval,
        apikey: this.apiKey,
        ...params
      };

      const response = await axios.get(this.baseUrl, { params: queryParams });

      if (response.data['Error Message']) {
        throw new Error(response.data['Error Message']);
      }

      if (response.data['Note']) {
        throw new Error('API rate limit exceeded. Try again in 1 minute.');
      }

      return response.data;
    } catch (error) {
      logger.error(`Failed to get ${indicator} for ${symbol}:`, error.message);
      throw error;
    }
  }

  /**
   * Extract latest value from indicator response
   */
  getLatestValue(data) {
    const keys = Object.keys(data).filter(k => k.startsWith('Technical Analysis'));
    if (keys.length === 0) return null;

    const values = data[keys[0]];
    const dates = Object.keys(values);
    if (dates.length === 0) return null;

    const latestDate = dates[0];
    const latestData = values[latestDate];

    // Get first numeric value
    const valueKey = Object.keys(latestData)[0];
    return parseFloat(latestData[valueKey]);
  }

  /**
   * Extract latest MACD values
   */
  getLatestMACD(data) {
    const keys = Object.keys(data).filter(k => k.startsWith('Technical Analysis'));
    if (keys.length === 0) return null;

    const values = data[keys[0]];
    const dates = Object.keys(values);
    if (dates.length === 0) return null;

    const latestDate = dates[0];
    const latestData = values[latestDate];

    return {
      macd: parseFloat(latestData['MACD']),
      signal: parseFloat(latestData['MACD_Signal']),
      histogram: parseFloat(latestData['MACD_Hist'])
    };
  }

  /**
   * Calculate overall trend from indicators
   */
  calculateTrend(sma, ema, rsi, macd) {
    let bullish = 0;
    let bearish = 0;

    // RSI analysis
    if (rsi) {
      if (rsi > 70) bearish++;
      else if (rsi < 30) bullish++;
      else if (rsi > 50) bullish++;
      else bearish++;
    }

    // MACD analysis
    if (macd && macd.macd && macd.signal) {
      if (macd.macd > macd.signal) bullish++;
      else bearish++;
    }

    // SMA vs EMA
    if (sma && ema) {
      if (ema > sma) bullish++;
      else bearish++;
    }

    // Determine overall trend
    if (bullish > bearish) return 'BULLISH';
    if (bearish > bullish) return 'BEARISH';
    return 'NEUTRAL';
  }
}

export default new AnalysisClient();
