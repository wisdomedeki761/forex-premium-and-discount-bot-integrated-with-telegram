import { initializeFirestore } from './db/firestore.js';
import krakenClient from './apis/kraken.js';
import derivClient from './apis/deriv.js';
import telegramClient from './apis/telegram.js';
import stateManager from './utils/stateManager.js';
import trendingScanner from './schedulers/trendingScanner.js';
import zoneScanner from './schedulers/zoneScanner.js';
import newsScanner from './schedulers/newsScanner.js';
// import conditionScanner from './schedulers/conditionScanner.js'; // Disabled - replaced by zone scanner
// import confirmationMonitor from './schedulers/confirmationMonitor.js'; // Disabled - not used in zone detection
// import activeMonitor from './schedulers/activeMonitor.js'; // Disabled - not used in zone detection
import logger from './utils/logger.js';
import config from './config.js';

async function main() {
  try {
    logger.info('🚀 Starting Trading Signal Bot...');
    logger.info(`Environment: ${config.bybit.testnet ? 'Testnet' : 'Production'}`);

    // Initialize Firebase Firestore
    logger.info('Connecting to Firebase Firestore...');
    await initializeFirestore();

    // Load subscriptions and pair states from Firestore
    logger.info('Loading subscriptions...');
    await telegramClient.loadSubscriptions();

    logger.info('Loading pair states...');
    await stateManager.loadStates();

    // Initialize Deriv WebSocket (optional - for forex pairs)
    if (config.deriv.appId) {
      try {
        logger.info('Connecting to Deriv...');
        await derivClient.connect();
        logger.success('✅ Deriv connected');
      } catch (error) {
        logger.warn('⚠️ Deriv connection failed (forex pairs disabled):', error.message);
        logger.info('Bot will continue with crypto pairs only');
      }
    } else {
      logger.info('No Deriv App ID configured - forex pairs disabled');
    }

    // Start all schedulers
    logger.info('Starting schedulers...');
    trendingScanner.start();      // Runs at 00:00 UTC daily
    zoneScanner.start();           // Runs every hour (1h timeframe)
    newsScanner.start();           // Runs at 06:00 UTC daily

    // Broadcast startup notification to all subscribed chats
    try {
      await telegramClient.broadcast(
        '🤖 <b>Premium/Discount Zone Bot Started!</b>\n\n' +
        '✅ All systems operational\n' +
        '📊 Monitoring 1-hour zones 24/7\n' +
        '🟢 DISCOUNT zones (BUY opportunities)\n' +
        '🔴 PREMIUM zones (SELL opportunities)\n\n' +
        'Use /help to see available commands.',
        { parse_mode: 'HTML' }
      );
    } catch (error) {
      logger.warn('Could not send startup notification:', error.message);
    }

    logger.success('✅ Premium/Discount Zone Bot is now running!');
    logger.info('');
    logger.info('📅 Active Schedulers:');
    logger.info('  ⏰ Trending scan: 00:00 UTC daily');
    logger.info('  ⏰ Zone detection: Every hour (1h timeframe)');
    logger.info('  ⏰ Economic news: 06:00 UTC daily');
    logger.info('');
    logger.info('💬 Telegram bot active');
    logger.info('🟢🔴 Ready to detect premium/discount zones!');

    // Graceful shutdown
    process.on('SIGINT', async () => {
      logger.info('');
      logger.info('Shutting down gracefully...');
      krakenClient.close();
      derivClient.close();
      logger.success('✅ Bot stopped');
      process.exit(0);
    });

  } catch (error) {
    logger.error('❌ Failed to start bot:', error.message);
    logger.error(error.stack);
    process.exit(1);
  }
}

main();
