import axios from 'axios';
import config from '../config.js';
import logger from '../utils/logger.js';

/**
 * NewsAPI Client
 * Free tier: 100 requests/day (development only)
 */
export class NewsApiClient {
  constructor() {
    this.apiKey = config.newsApi?.apiKey;
    this.baseUrl = 'https://newsapi.org/v2';
  }

  /**
   * Get financial news
   */
  async getFinancialNews(query = 'forex OR crypto OR trading', pageSize = 5) {
    if (!this.apiKey) {
      throw new Error('NewsAPI key not configured');
    }

    try {
      const response = await axios.get(`${this.baseUrl}/everything`, {
        params: {
          q: query,
          language: 'en',
          sortBy: 'publishedAt',
          pageSize,
          apiKey: this.apiKey
        }
      });

      if (response.data.status !== 'ok') {
        throw new Error(response.data.message || 'API error');
      }

      return response.data.articles.map(article => ({
        title: article.title,
        description: article.description,
        source: article.source.name,
        url: article.url,
        publishedAt: article.publishedAt,
        author: article.author
      }));
    } catch (error) {
      logger.error('NewsAPI error:', error.message);
      throw error;
    }
  }

  /**
   * Get news for specific currency pair
   */
  async getPairNews(pair, pageSize = 3) {
    // Convert EURUSD to "EUR USD forex"
    const cleanPair = pair.replace(/^frx/i, '');
    const query = `${cleanPair} forex trading`;

    return this.getFinancialNews(query, pageSize);
  }

  /**
   * Get top business headlines
   */
  async getTopHeadlines(country = 'us', category = 'business', pageSize = 5) {
    if (!this.apiKey) {
      throw new Error('NewsAPI key not configured');
    }

    try {
      const response = await axios.get(`${this.baseUrl}/top-headlines`, {
        params: {
          country,
          category,
          pageSize,
          apiKey: this.apiKey
        }
      });

      if (response.data.status !== 'ok') {
        throw new Error(response.data.message || 'API error');
      }

      return response.data.articles.map(article => ({
        title: article.title,
        description: article.description,
        source: article.source.name,
        url: article.url,
        publishedAt: article.publishedAt
      }));
    } catch (error) {
      logger.error('NewsAPI headlines error:', error.message);
      throw error;
    }
  }

  /**
   * Check if configured
   */
  isConfigured() {
    return !!this.apiKey;
  }
}

export default new NewsApiClient();
