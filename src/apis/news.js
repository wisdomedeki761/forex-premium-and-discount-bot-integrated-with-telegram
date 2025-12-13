import axios from 'axios';
import config from '../config.js';
import logger from '../utils/logger.js';
import finnhubClient from './finnhub.js';
import newsApiClient from './newsApi.js';
import twelveDataClient from './twelveData.js';
import twelveDataClient from './twelveData.js';

/**
 * FCS API for Economic Calendar & News
 * Free tier: 500 requests/month
 */
export class NewsClient {
  constructor() {
    this.apiKey = config.fcs?.apiKey;
    this.baseUrl = 'https://fcsapi.com/api-v3';
  }

  /**
   * Extract currencies from forex pairs
   * Example: frxEURUSD -> ['EUR', 'USD']
   */
  extractCurrenciesFromPairs(forexPairs) {
    const currencies = new Set();
    
    forexPairs.forEach(pair => {
      // Remove 'frx' prefix if present
      const cleanPair = pair.replace(/^frx/i, '').toUpperCase();
      
      // Extract 3-letter currency codes
      // EURUSD -> EUR, USD
      // GBPJPY -> GBP, JPY
      const matches = cleanPair.match(/([A-Z]{3})([A-Z]{3})/);
      if (matches) {
        currencies.add(matches[1]); // First currency
        currencies.add(matches[2]); // Second currency
      }
    });
    
    return Array.from(currencies);
  }

  /**
   * Map currency codes to country codes
   */
  getCountryCodesForCurrencies(currencies) {
    const currencyToCountries = {
      'USD': ['US'],
      'EUR': ['EU', 'DE', 'FR', 'IT', 'ES', 'NL', 'BE', 'AT', 'IE', 'PT', 'FI', 'GR'],
      'GBP': ['UK', 'GB'],
      'JPY': ['JP'],
      'AUD': ['AU'],
      'CAD': ['CA'],
      'NZD': ['NZ'],
      'CHF': ['CH'],
      'CNY': ['CN']
    };

    const countryCodes = new Set();
    currencies.forEach(currency => {
      const countries = currencyToCountries[currency.toUpperCase()] || [];
      countries.forEach(country => countryCodes.add(country));
    });

    return Array.from(countryCodes);
  }

  /**
   * Get today's economic calendar events for major currencies
   * Hardcoded to monitor: USD, GBP, CAD, AUD, JPY
   */
  async getTodayNews(forexPairs = []) {
    if (!this.apiKey) {
      throw new Error('FCS API key not configured');
    }

    try {
      const today = new Date().toISOString().split('T')[0];
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowStr = tomorrow.toISOString().split('T')[0];

      // Get events for today and tomorrow (next 24 hours)
      const response = await axios.get(`${this.baseUrl}/forex/economy_cal`, {
        params: {
          access_key: this.apiKey,
          from: today,
          to: tomorrowStr
        }
      });

      if (!response.data || response.data.status === false) {
        throw new Error(response.data?.msg || 'Failed to fetch news');
      }

      const events = response.data.response || [];

      // Hardcoded major currencies: USD, GBP, CAD, AUD, JPY
      // Country codes for these currencies
      const majorCountryCodes = ['US', 'UK', 'GB', 'CA', 'AU', 'JP'];
      
      logger.debug(`Monitoring major currencies: USD, GBP, CAD, AUD, JPY`);
      logger.debug(`Monitoring countries: ${majorCountryCodes.join(', ')}`);

      // Filter for high and medium impact events from major countries
      const filtered = events.filter(event => {
        const impact = event.impact?.toLowerCase();
        const country = event.country?.toUpperCase();

        // High or medium impact only
        if (impact !== 'high' && impact !== 'medium') return false;

        // Check if country is in our major currencies list
        return majorCountryCodes.includes(country);
      });

      // Sort by time, then by impact (high first)
      filtered.sort((a, b) => {
        const timeCompare = a.time.localeCompare(b.time);
        if (timeCompare !== 0) return timeCompare;

        const impactOrder = { high: 0, medium: 1, low: 2 };
        return impactOrder[a.impact?.toLowerCase()] - impactOrder[b.impact?.toLowerCase()];
      });

      return filtered;
    } catch (error) {
      logger.error('Failed to fetch economic calendar:', error.message);
      throw error;
    }
  }

  /**
   * Get events happening in the next hour (for 1-hour-before notifications)
   * Hardcoded to monitor: USD, GBP, CAD, AUD, JPY
   */
  async getUpcomingEventsInNextHour(forexPairs = []) {
    if (!this.apiKey) {
      throw new Error('FCS API key not configured');
    }

    try {
      const now = new Date();
      const oneHourLater = new Date(now.getTime() + 60 * 60 * 1000);
      
      const today = now.toISOString().split('T')[0];
      const tomorrow = oneHourLater.toISOString().split('T')[0];

      const response = await axios.get(`${this.baseUrl}/forex/economy_cal`, {
        params: {
          access_key: this.apiKey,
          from: today,
          to: tomorrow
        }
      });

      if (!response.data || response.data.status === false) {
        throw new Error(response.data?.msg || 'Failed to fetch upcoming events');
      }

      const events = response.data.response || [];

      // Hardcoded major currencies: USD, GBP, CAD, AUD, JPY
      const majorCountryCodes = ['US', 'UK', 'GB', 'CA', 'AU', 'JP'];

      // Filter events happening in the next hour
      const upcomingEvents = events.filter(event => {
        const impact = event.impact?.toLowerCase();
        const country = event.country?.toUpperCase();

        // High or medium impact only
        if (impact !== 'high' && impact !== 'medium') return false;

        // Check if country is in our major currencies list
        if (!majorCountryCodes.includes(country)) return false;

        // Parse event time and check if it's in the next hour
        // FCS API returns date in format "2025-12-08" and time in format "08:30"
        const eventDate = event.date || event.event_date || today;
        const eventTime = this.parseEventTime(event.time, eventDate);
        if (!eventTime) return false;

        const timeDiff = eventTime.getTime() - now.getTime();
        // Event should happen between 50 minutes and 70 minutes from now (1 hour ± 10 min buffer)
        const isInNextHour = timeDiff >= 50 * 60 * 1000 && timeDiff <= 70 * 60 * 1000;
        
        if (isInNextHour) {
          // Add date to event for tracking
          event.date = eventDate;
        }
        
        return isInNextHour;
      });

      return upcomingEvents;
    } catch (error) {
      logger.error('Failed to fetch upcoming events:', error.message);
      throw error;
    }
  }

  /**
   * Parse event time string to Date object
   * Format: "08:30" or "14:00" (UTC time)
   */
  parseEventTime(timeStr, dateStr) {
    if (!timeStr || timeStr === 'TBA' || !dateStr) return null;

    try {
      // Ensure time has format HH:MM
      const timeMatch = timeStr.match(/(\d{1,2}):(\d{2})/);
      if (!timeMatch) return null;

      const hours = parseInt(timeMatch[1], 10);
      const minutes = parseInt(timeMatch[2], 10);

      // Create UTC date string: YYYY-MM-DDTHH:MM:00Z
      const utcDateStr = `${dateStr}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00Z`;
      const date = new Date(utcDateStr);
      
      // Validate date
      if (isNaN(date.getTime())) {
        logger.warn(`Invalid date created from: ${dateStr} ${timeStr}`);
        return null;
      }
      
      return date;
    } catch (error) {
      logger.warn(`Failed to parse event time: ${timeStr} on ${dateStr}`, error.message);
      return null;
    }
  }

  /**
   * Get historical economic calendar events
   */
  async getHistoricalNews(fromDate, toDate) {
    if (!this.apiKey) {
      throw new Error('FCS API key not configured');
    }

    try {
      const response = await axios.get(`${this.baseUrl}/forex/economy_cal`, {
        params: {
          access_key: this.apiKey,
          from: fromDate,
          to: toDate
        }
      });

      if (!response.data || response.data.status === false) {
        throw new Error(response.data?.msg || 'Failed to fetch historical news');
      }

      const events = response.data.response || [];

      // Map country codes to currencies we monitor
      const countryToCurrency = {
        'us': 'usd', 'eu': 'eur', 'uk': 'gbp', 'gb': 'gbp', 'jp': 'jpy',
        'au': 'aud', 'ca': 'cad', 'nz': 'nzd', 'ch': 'chf', 'cn': 'cny',
        'de': 'eur', 'fr': 'eur', 'it': 'eur', 'es': 'eur', 'nl': 'eur',
        'be': 'eur', 'at': 'eur', 'ie': 'eur', 'pt': 'eur', 'fi': 'eur', 'gr': 'eur'
      };

      // Filter for high and medium impact events from monitored countries
      const filtered = events.filter(event => {
        const impact = event.impact?.toLowerCase();
        const country = event.country?.toUpperCase();
        if (impact !== 'high' && impact !== 'medium') return false;
        return countryToCurrency.hasOwnProperty(country);
      });

      // Sort by time, then by impact (high first)
      filtered.sort((a, b) => {
        const timeCompare = a.time.localeCompare(b.time);
        if (timeCompare !== 0) return timeCompare;
        const impactOrder = { high: 0, medium: 1, low: 2 };
        return impactOrder[a.impact?.toLowerCase()] - impactOrder[b.impact?.toLowerCase()];
      });

      return filtered;
    } catch (error) {
      logger.error('Failed to fetch historical economic calendar:', error.message);
      throw error;
    }
  }

  /**
   * Format morning summary of today's events
   */
  formatMorningSummary(events) {
    if (!events || events.length === 0) {
      return '<blockquote>📰 <b>Economic Calendar - Today</b>\n\nNo high/medium impact events scheduled for today.</blockquote>';
    }

    // Filter events for today only
    const today = new Date().toISOString().split('T')[0];
    const todayEvents = events.filter(e => {
      const eventDate = e.date || today;
      return eventDate === today;
    });

    if (todayEvents.length === 0) {
      return '<blockquote>📰 <b>Economic Calendar - Today</b>\n\nNo high/medium impact events scheduled for today.</blockquote>';
    }

    let message = '📰 <b>Economic Calendar - Today</b>\n\n';
    message += `<b>📅 ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</b>\n\n`;

    const highImpact = todayEvents.filter(e => e.impact?.toLowerCase() === 'high');
    const mediumImpact = todayEvents.filter(e => e.impact?.toLowerCase() === 'medium');

    if (highImpact.length > 0) {
      message += '🔴 <b>HIGH IMPACT</b>\n';
      highImpact.forEach(event => {
        message += this.formatEventForSummary(event);
      });
      message += '\n';
    }

    if (mediumImpact.length > 0) {
      message += '🟡 <b>MEDIUM IMPACT</b>\n';
      mediumImpact.forEach(event => {
        message += this.formatEventForSummary(event);
      });
    }

    message += '\n<i>💡 You will receive a notification 1 hour before each event occurs.</i>';

    return `<blockquote>${message}</blockquote>`;
  }

  /**
   * Format event for morning summary (with time)
   */
  formatEventForSummary(event) {
    const time = event.time || 'TBA';
    const country = event.country || 'N/A';
    const title = event.title || event.event || 'N/A';
    const forecast = event.forecast || '-';
    const previous = event.previous || '-';

    return `⏰ <b>${time} UTC</b> | ${country.toUpperCase()}\n` +
           `   ${title}\n` +
           `   Forecast: <code>${forecast}</code> | Previous: <code>${previous}</code>\n\n`;
  }

  /**
   * Format 1-hour-before event notification
   */
  formatUpcomingEventNotification(event) {
    const time = event.time || 'TBA';
    const country = event.country || 'N/A';
    const title = event.title || event.event || 'N/A';
    const impact = event.impact?.toLowerCase() === 'high' ? '🔴 HIGH' : '🟡 MEDIUM';
    const forecast = event.forecast || '-';
    const previous = event.previous || '-';

    const message = `🔔 <b>Economic Event in 1 Hour!</b>\n\n` +
           `${impact} <b>IMPACT</b>\n` +
           `⏰ <b>Time:</b> ${time} UTC\n` +
           `🌍 <b>Country:</b> ${country.toUpperCase()}\n` +
           `📋 <b>Event:</b> ${title}\n` +
           `📊 Forecast: <code>${forecast}</code> | Previous: <code>${previous}</code>\n\n` +
           `<i>Event occurs in approximately 1 hour.</i>`;

    return `<blockquote>${message}</blockquote>`;
  }

  /**
   * Format today's news for Telegram command (/news)
   * Shows events with emoji indicators: 🔴 for high, 🟡 for medium
   */
  formatTodayNewsForTelegram(events, forexPairs = []) {
    if (!events || events.length === 0) {
      let message = '📰 <b>Economic Calendar - Today</b>\n\n';
      message += 'No high/medium impact events scheduled for today.\n\n';
      message += `<i>Monitoring: USD, GBP, CAD, AUD, JPY</i>`;
      
      return `<blockquote>${message}</blockquote>`;
    }

    // Filter events for today only (including past events)
    const today = new Date().toISOString().split('T')[0];
    const todayEvents = events.filter(e => {
      const eventDate = e.date || e.event_date || today;
      return eventDate === today;
    });

    if (todayEvents.length === 0) {
      let message = '📰 <b>Economic Calendar - Today</b>\n\n';
      message += 'No high/medium impact events scheduled for today.\n\n';
      message += `<i>Monitoring: USD, GBP, CAD, AUD, JPY</i>`;
      
      return `<blockquote>${message}</blockquote>`;
    }

    let message = '📰 <b>Economic Calendar - Today</b>\n\n';
    
    // Show monitored currencies
    message += `<b>📊 Monitoring:</b> USD, GBP, CAD, AUD, JPY\n`;
    message += `<b>📅 Date:</b> ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}\n\n`;

    // Group by impact
    const highImpact = todayEvents.filter(e => e.impact?.toLowerCase() === 'high');
    const mediumImpact = todayEvents.filter(e => e.impact?.toLowerCase() === 'medium');

    // Show high impact events with 🔴 emoji
    if (highImpact.length > 0) {
      message += '🔴 <b>HIGH IMPACT</b>\n';
      highImpact.forEach(event => {
        message += this.formatEventWithEmoji(event, 'high');
      });
      message += '\n';
    }

    // Show medium impact events with 🟡 emoji
    if (mediumImpact.length > 0) {
      message += '🟡 <b>MEDIUM IMPACT</b>\n';
      mediumImpact.forEach(event => {
        message += this.formatEventWithEmoji(event, 'medium');
      });
    }

    return `<blockquote>${message}</blockquote>`;
  }

  /**
   * Format event with emoji indicator
   */
  formatEventWithEmoji(event, impact) {
    const emoji = impact === 'high' ? '🔴' : '🟡';
    const time = event.time || 'TBA';
    const country = event.country || 'N/A';
    const title = event.title || event.event || 'N/A';
    const forecast = event.forecast || '-';
    const previous = event.previous || '-';

    return `${emoji} <b>${time} UTC</b> | ${country.toUpperCase()}\n` +
           `   ${title}\n` +
           `   Forecast: <code>${forecast}</code> | Previous: <code>${previous}</code>\n\n`;
  }

  /**
   * Get forex news from ALL available APIs with comprehensive fallback chain
   * Hardcoded to major pairs: USD, GBP, CAD, AUD, JPY
   * Fallback order: FCS → Finnhub → NewsAPI
   * Note: Alpha Vantage and Twelve Data don't have news endpoints (only technical data)
   */
  async getForexNewsFromAlternatives() {
    const majorPairs = ['USD', 'GBP', 'CAD', 'AUD', 'JPY'];
    const majorPairQuery = majorPairs.join(' OR ');
    
    // Helper function to filter news for major pairs
    const filterForMajorPairs = (items, getTextFn) => {
      return items.filter(item => {
        const text = getTextFn(item).toUpperCase();
        return majorPairs.some(pair => text.includes(pair));
      });
    };

    // 1. Try FCS API (economic calendar) - Best for scheduled events
    try {
      if (this.apiKey) {
        const today = new Date().toISOString().split('T')[0];
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowStr = tomorrow.toISOString().split('T')[0];

        const response = await axios.get(`${this.baseUrl}/forex/economy_cal`, {
          params: {
            access_key: this.apiKey,
            from: today,
            to: tomorrowStr
          },
          timeout: 10000
        });

        if (response.data && response.data.status !== false && response.data.response) {
          const events = response.data.response || [];
          const majorCountryCodes = ['US', 'UK', 'GB', 'CA', 'AU', 'JP'];
          
          const filtered = events.filter(event => {
            const impact = event.impact?.toLowerCase();
            const country = event.country?.toUpperCase();
            if (impact !== 'high' && impact !== 'medium') return false;
            return majorCountryCodes.includes(country);
          });

          if (filtered.length > 0) {
            logger.info(`✅ FCS API: Found ${filtered.length} economic events`);
            return filtered.map((event, index) => ({
              id: index + 1,
              title: event.title || event.event || 'Economic Event',
              summary: `Forecast: ${event.forecast || '-'} | Previous: ${event.previous || '-'}`,
              source: event.country || 'N/A',
              url: null,
              datetime: this.parseEventTime(event.time, event.date || today) || new Date(),
              sentiment: 'neutral',
              impact: event.impact?.toLowerCase() || 'medium',
              type: 'economic_calendar'
            }));
          }
        }
      }
    } catch (error) {
      logger.debug(`FCS API failed (${error.message}), trying Finnhub...`);
    }

    // 2. Try Finnhub (forex market news) - 60 calls/minute
    try {
      if (finnhubClient.isConfigured()) {
        const finnhubNews = await finnhubClient.getMarketNews('forex');
        
        const filteredNews = filterForMajorPairs(finnhubNews, item => 
          item.headline + ' ' + item.summary
        );
        
        if (filteredNews.length > 0) {
          logger.info(`✅ Finnhub: Found ${filteredNews.length} news items`);
          return filteredNews.map((item, index) => ({
            id: index + 1,
            title: item.headline,
            summary: item.summary,
            source: item.source,
            url: item.url,
            datetime: new Date(item.datetime * 1000),
            sentiment: item.sentiment,
            impact: item.sentiment === 'positive' ? 'high' : item.sentiment === 'negative' ? 'high' : 'medium',
            type: 'forex_news'
          }));
        }
      }
    } catch (error) {
      logger.debug(`Finnhub failed (${error.message}), trying NewsAPI...`);
    }
    
    // 3. Try NewsAPI (general financial news) - 100 requests/day
    try {
      if (newsApiClient.isConfigured()) {
        const newsApiArticles = await newsApiClient.getFinancialNews(
          `${majorPairQuery} forex OR currency OR exchange rate OR central bank OR interest rate`,
          25
        );
        
        const filteredNews = filterForMajorPairs(newsApiArticles, article => 
          article.title + ' ' + (article.description || '')
        );
        
        if (filteredNews.length > 0) {
          logger.info(`✅ NewsAPI: Found ${filteredNews.length} news items`);
          return filteredNews.map((article, index) => ({
            id: index + 1,
            title: article.title,
            summary: article.description,
            source: article.source,
            url: article.url,
            datetime: new Date(article.publishedAt),
            sentiment: 'neutral',
            impact: 'medium',
            type: 'forex_news'
          }));
        }
      }
    } catch (error) {
      logger.debug(`NewsAPI failed (${error.message})`);
    }

    // Note: Alpha Vantage and Twelve Data don't have news endpoints
    // Alpha Vantage: Only technical analysis (SMA, EMA, RSI, MACD) - no news
    // Twelve Data: Only quotes and technical indicators - no news
    
    logger.warn('All news APIs exhausted: FCS → Finnhub → NewsAPI');
    return [];
  }

  /**
   * Format forex news for Telegram command (/news)
   * Shows news for major pairs: USD, GBP, CAD, AUD, JPY
   */
  formatForexNewsForTelegram(newsItems) {
    if (!newsItems || newsItems.length === 0) {
      return '<blockquote>📰 <b>Forex News - Major Pairs</b>\n\n' +
             'No recent news found for USD, GBP, CAD, AUD, JPY.\n\n' +
             '<i>Monitoring: USD, GBP, CAD, AUD, JPY</i></blockquote>';
    }

    let message = '📰 <b>Forex News - Major Pairs</b>\n\n';
    message += '<b>📊 Monitoring:</b> USD, GBP, CAD, AUD, JPY\n';
    message += `<b>📅 Date:</b> ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}\n\n`;

    // Group by sentiment
    const positiveNews = newsItems.filter(n => n.sentiment === 'positive');
    const negativeNews = newsItems.filter(n => n.sentiment === 'negative');
    const neutralNews = newsItems.filter(n => n.sentiment === 'neutral' || !n.sentiment);

    // Show positive news
    if (positiveNews.length > 0) {
      message += '🟢 <b>POSITIVE SENTIMENT</b>\n';
      positiveNews.slice(0, 5).forEach((item, index) => {
        const time = item.datetime ? new Date(item.datetime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : 'N/A';
        message += `${index + 1}. <b>${time}</b> | ${item.source || 'N/A'}\n`;
        message += `   ${item.title}\n`;
        if (item.summary) {
          const summary = item.summary.replace(/<[^>]*>/g, '').substring(0, 80);
          message += `   <i>${summary}...</i>\n`;
        }
        message += '\n';
      });
      message += '\n';
    }

    // Show negative news
    if (negativeNews.length > 0) {
      message += '🔴 <b>NEGATIVE SENTIMENT</b>\n';
      negativeNews.slice(0, 5).forEach((item, index) => {
        const time = item.datetime ? new Date(item.datetime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : 'N/A';
        message += `${index + 1}. <b>${time}</b> | ${item.source || 'N/A'}\n`;
        message += `   ${item.title}\n`;
        if (item.summary) {
          const summary = item.summary.replace(/<[^>]*>/g, '').substring(0, 80);
          message += `   <i>${summary}...</i>\n`;
        }
        message += '\n';
      });
      message += '\n';
    }

    // Show neutral news
    if (neutralNews.length > 0 && (positiveNews.length === 0 && negativeNews.length === 0)) {
      message += '🟡 <b>RECENT NEWS</b>\n';
      neutralNews.slice(0, 10).forEach((item, index) => {
        const time = item.datetime ? new Date(item.datetime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : 'N/A';
        message += `${index + 1}. <b>${time}</b> | ${item.source || 'N/A'}\n`;
        message += `   ${item.title}\n`;
        if (item.summary) {
          const summary = item.summary.replace(/<[^>]*>/g, '').substring(0, 80);
          message += `   <i>${summary}...</i>\n`;
        }
        message += '\n';
      });
    }

    return `<blockquote>${message}</blockquote>`;
  }

  /**
   * Format news events for Telegram (legacy method - kept for compatibility)
   */
  formatNewsForTelegram(events) {
    return this.formatMorningSummary(events);
  }

  /**
   * Format single event
   */
  formatEvent(event) {
    const time = event.time || 'TBA';
    const country = event.country || 'N/A';
    const title = event.title || event.event || 'N/A';
    const forecast = event.forecast || '-';
    const previous = event.previous || '-';

    return `⏰ <b>${time}</b> | ${country.toUpperCase()}\n` +
           `   ${title}\n` +
           `   Forecast: <code>${forecast}</code> | Previous: <code>${previous}</code>\n\n`;
  }
}

export default new NewsClient();
