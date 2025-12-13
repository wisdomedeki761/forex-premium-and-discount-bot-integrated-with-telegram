import cron from 'node-cron';
import newsClient from '../apis/news.js';
import telegramClient from '../apis/telegram.js';
import { getManagedPairs, markEventNotified, isEventNotified, getNotifiedEventsToday, clearOldNotifications } from '../db/firestore.js';
import logger from '../utils/logger.js';

export class NewsScanner {
  constructor() {
    this.lastMorningBroadcastDate = null;
  }

  /**
   * Start the news scanner
   * - Morning summary at 06:00 UTC daily
   * - Check for upcoming events every 15 minutes
   */
  start() {
    // Run immediately on startup
    this.scanMorningSummary();
    this.checkUpcomingEvents();

    // Schedule morning summary at 06:00 UTC daily
    cron.schedule('0 6 * * *', () => {
      this.scanMorningSummary();
    }, {
      timezone: 'UTC'
    });

    // Check for upcoming events every 15 minutes
    cron.schedule('*/15 * * * *', () => {
      this.checkUpcomingEvents();
    });

    // Clean up old notifications daily at 02:00 UTC
    cron.schedule('0 2 * * *', () => {
      clearOldNotifications(7);
    }, {
      timezone: 'UTC'
    });

    logger.success('News scanner started');
    logger.info('  - Morning summary: 06:00 UTC daily');
    logger.info('  - Upcoming events check: Every 15 minutes');
  }

  /**
   * Send morning summary of today's high/medium impact events
   */
  async scanMorningSummary() {
    try {
      const today = new Date().toISOString().split('T')[0];

      // Avoid duplicate broadcasts on the same day
      if (this.lastMorningBroadcastDate === today) {
        logger.debug('Morning summary already sent today, skipping...');
        return;
      }

      logger.info('📰 Fetching today\'s economic calendar for morning summary...');

      // Get today's events for major currencies (hardcoded: USD, GBP, CAD, AUD, JPY)
      const events = await newsClient.getTodayNews();

      if (!events || events.length === 0) {
        logger.info('No high/medium impact events scheduled for today');
        // Still send a message to confirm the bot is working
        const message = '📰 <b>Economic Calendar - Today</b>\n\n' +
          'No high/medium impact events scheduled for today.\n\n' +
          '<i>Bot is monitoring and will notify you 1 hour before any events occur.</i>';
        
        await telegramClient.broadcast(message, { parse_mode: 'HTML' });
        this.lastMorningBroadcastDate = today;
        return;
      }

      logger.success(`✅ Found ${events.length} high/medium impact events for today`);

      // Format message for Telegram
      const message = newsClient.formatMorningSummary(events);

      // Broadcast to all subscribed channels
      await telegramClient.broadcast(message, { parse_mode: 'HTML' });

      // Mark as broadcasted
      this.lastMorningBroadcastDate = today;

      logger.success(`📰 Morning summary broadcasted (${events.length} events)`);
    } catch (error) {
      logger.error('❌ Failed to scan morning summary:', error.message);
    }
  }

  /**
   * Check for events happening in the next hour and send notifications
   */
  async checkUpcomingEvents() {
    try {
      logger.debug('🔔 Checking for upcoming events in the next hour...');

      // Get events happening in the next hour for major currencies
      const upcomingEvents = await newsClient.getUpcomingEventsInNextHour();

      if (!upcomingEvents || upcomingEvents.length === 0) {
        logger.debug('No events happening in the next hour');
        return;
      }

      logger.info(`Found ${upcomingEvents.length} events happening in the next hour`);

      // Send notification for each event (if not already notified)
      for (const event of upcomingEvents) {
        // Create unique event ID
        const eventId = `${event.date || new Date().toISOString().split('T')[0]}_${event.time}_${event.country}_${event.title || event.event}`.replace(/[^a-zA-Z0-9_]/g, '_');

        // Check if already notified
        if (await isEventNotified(eventId)) {
          logger.debug(`Event already notified: ${event.title || event.event}`);
          continue;
        }

        // Send 1-hour-before notification
        const message = newsClient.formatUpcomingEventNotification(event);
        await telegramClient.broadcast(message, { parse_mode: 'HTML' });

        // Mark as notified
        await markEventNotified(eventId, event.date || new Date().toISOString().split('T')[0]);

        logger.success(`📢 Sent 1-hour-before notification for: ${event.title || event.event}`);

        // Small delay between notifications
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

    } catch (error) {
      logger.error('❌ Failed to check upcoming events:', error.message);
    }
  }
}

export default new NewsScanner();
