import axios from 'axios';
import config from '../config.js';
import logger from '../utils/logger.js';

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
   * Get today's economic calendar events filtered by monitored currencies
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

      // Extract currencies from forex pairs
      const monitoredCurrencies = this.extractCurrenciesFromPairs(forexPairs);
      const monitoredCountryCodes = this.getCountryCodesForCurrencies(monitoredCurrencies);

      logger.debug(`Monitoring currencies: ${monitoredCurrencies.join(', ')}`);
      logger.debug(`Monitoring countries: ${monitoredCountryCodes.join(', ')}`);

      // Filter for high and medium impact events from monitored countries
      const filtered = events.filter(event => {
        const impact = event.impact?.toLowerCase();
        const country = event.country?.toUpperCase();

        // High or medium impact only
        if (impact !== 'high' && impact !== 'medium') return false;

        // If no pairs specified, use default list
        if (monitoredCountryCodes.length === 0) {
          const defaultCountries = ['US', 'EU', 'UK', 'GB', 'JP', 'AU', 'CA', 'NZ', 'CH', 'CN',
            'DE', 'FR', 'IT', 'ES', 'NL', 'BE', 'AT', 'IE', 'PT', 'FI', 'GR'];
          return defaultCountries.includes(country);
        }

        // Check if country is in our monitored list
        return monitoredCountryCodes.includes(country);
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

      // Extract currencies from forex pairs
      const monitoredCurrencies = this.extractCurrenciesFromPairs(forexPairs);
      const monitoredCountryCodes = this.getCountryCodesForCurrencies(monitoredCurrencies);

      // Filter events happening in the next hour
      const upcomingEvents = events.filter(event => {
        const impact = event.impact?.toLowerCase();
        const country = event.country?.toUpperCase();

        // High or medium impact only
        if (impact !== 'high' && impact !== 'medium') return false;

        // Check country
        if (monitoredCountryCodes.length > 0 && !monitoredCountryCodes.includes(country)) {
          return false;
        } else if (monitoredCountryCodes.length === 0) {
          const defaultCountries = ['US', 'EU', 'UK', 'GB', 'JP', 'AU', 'CA', 'NZ', 'CH', 'CN',
            'DE', 'FR', 'IT', 'ES', 'NL', 'BE', 'AT', 'IE', 'PT', 'FI', 'GR'];
          if (!defaultCountries.includes(country)) return false;
        }

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
      
      if (forexPairs.length > 0) {
        const currencies = this.extractCurrenciesFromPairs(forexPairs);
        message += `<i>Monitoring currencies: ${currencies.join(', ')}</i>`;
      }
      
      return `<blockquote>${message}</blockquote>`;
    }

    // Filter events for today only
    const today = new Date().toISOString().split('T')[0];
    const todayEvents = events.filter(e => {
      const eventDate = e.date || e.event_date || today;
      return eventDate === today;
    });

    if (todayEvents.length === 0) {
      let message = '📰 <b>Economic Calendar - Today</b>\n\n';
      message += 'No high/medium impact events scheduled for today.\n\n';
      
      if (forexPairs.length > 0) {
        const currencies = this.extractCurrenciesFromPairs(forexPairs);
        message += `<i>Monitoring currencies: ${currencies.join(', ')}</i>`;
      }
      
      return `<blockquote>${message}</blockquote>`;
    }

    let message = '📰 <b>Economic Calendar - Today</b>\n\n';
    
    // Show monitored pairs/currencies
    if (forexPairs.length > 0) {
      const currencies = this.extractCurrenciesFromPairs(forexPairs);
      message += `<b>📊 Monitoring:</b> ${currencies.join(', ')}\n`;
      message += `<b>📅 Date:</b> ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}\n\n`;
    }

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
