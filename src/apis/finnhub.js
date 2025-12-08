import axios from 'axios';
import config from '../config.js';
import logger from '../utils/logger.js';

/**
 * Finnhub API Client
 * Free tier: 60 calls/minute
 */
export class FinnhubClient {
  constructor() {
    this.apiKey = config.finnhub?.apiKey;
    this.baseUrl = 'https://finnhub.io/api/v1';
  }

  /**
   * Get market news
   */
  async getMarketNews(category = 'forex') {
    if (!this.apiKey) {
      throw new Error('Finnhub API key not configured');
    }

    try {
      const response = await axios.get(`${this.baseUrl}/news`, {
        params: {
          category,
          token: this.apiKey
        }
      });

      if (response.data.error) {
        throw new Error(response.data.error);
      }

      // Return latest 5 news items
      return response.data.slice(0, 5).map(item => ({
        headline: item.headline,
        summary: item.summary,
        source: item.source,
        url: item.url,
        datetime: item.datetime,
        sentiment: this.analyzeSentiment(item.headline + ' ' + item.summary)
      }));
    } catch (error) {
      logger.error('Finnhub news error:', error.message);
      throw error;
    }
  }

  /**
   * Get company news (for crypto/stocks)
   */
  async getCompanyNews(symbol, fromDate, toDate) {
    if (!this.apiKey) {
      throw new Error('Finnhub API key not configured');
    }

    try {
      const response = await axios.get(`${this.baseUrl}/company-news`, {
        params: {
          symbol,
          from: fromDate,
          to: toDate,
          token: this.apiKey
        }
      });

      return response.data.slice(0, 5).map(item => ({
        headline: item.headline,
        summary: item.summary,
        source: item.source,
        url: item.url,
        datetime: item.datetime
      }));
    } catch (error) {
      logger.error(`Finnhub company news error for ${symbol}:`, error.message);
      throw error;
    }
  }

  /**
   * Get forex rates
   */
  async getForexRates(base = 'USD') {
    if (!this.apiKey) {
      throw new Error('Finnhub API key not configured');
    }

    try {
      const response = await axios.get(`${this.baseUrl}/forex/rates`, {
        params: {
          base,
          token: this.apiKey
        }
      });

      return response.data;
    } catch (error) {
      logger.error('Finnhub forex rates error:', error.message);
      throw error;
    }
  }

  /**
   * Simple sentiment analysis based on keywords
   */
  analyzeSentiment(text) {
    const lowerText = text.toLowerCase();

    const bullishWords = ['rally', 'surge', 'gain', 'rise', 'bullish', 'strong', 'growth', 'positive', 'upgrade', 'beat'];
    const bearishWords = ['fall', 'drop', 'plunge', 'bearish', 'weak', 'negative', 'downgrade', 'miss', 'decline', 'crash'];

    let bullishCount = 0;
    let bearishCount = 0;

    bullishWords.forEach(word => {
      if (lowerText.includes(word)) bullishCount++;
    });

    bearishWords.forEach(word => {
      if (lowerText.includes(word)) bearishCount++;
    });

    if (bullishCount > bearishCount) return 'positive';
    if (bearishCount > bullishCount) return 'negative';
    return 'neutral';
  }

  /**
   * Check if configured
   */
  isConfigured() {
    return !!this.apiKey;
  }
}

export default new FinnhubClient();
