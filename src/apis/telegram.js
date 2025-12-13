import TelegramBot from 'node-telegram-bot-api';
import config from '../config.js';
import logger from '../utils/logger.js';
import { getActiveSignals, getTrendingPairs, getPairState, getManagedPairs, addManagedPair, removeManagedPair } from '../db/firestore.js';
import { addSubscription, removeSubscription, getActiveSubscriptions, isSubscribed } from '../db/subscriptions.js';
import analysisClient from './analysis.js';
import newsClient from './news.js';
import aiClient from './ai.js';
import dataAggregator from './dataAggregator.js';
import { canMakeRequest, logRequest, getRequestStats } from '../db/aiRequests.js';
import zoneManager from '../utils/zoneManager.js';
import derivClient from './deriv.js';
import bybitClient from './bybit.js';
import trendingScanner from '../schedulers/trendingScanner.js';
import entryMonitor from '../schedulers/entryMonitor.js';

export class TelegramClient {
  constructor() {
    this.bot = new TelegramBot(config.telegram.botToken, { polling: true });
    this.subscriptions = [];
    this.setupCommands();
    // Don't load subscriptions in constructor - Firestore not ready yet
    // Will load on first broadcast or when explicitly called
  }

  /**
   * Get friendly display name for symbols using zoneManager
   */
  getDerivDisplayName(symbol) {
    return zoneManager.getDisplayName(symbol, 'deriv');
  }

  /**
   * Load subscriptions from Firestore
   */
  async loadSubscriptions() {
    try {
      this.subscriptions = await getActiveSubscriptions();
      logger.info(`Loaded ${this.subscriptions.length} active subscriptions`);
    } catch (error) {
      logger.error('Failed to load subscriptions:', error.message);
    }
  }

  /**
   * Setup command handlers
   */
  setupCommands() {
    this.bot.onText(/\/start/, (msg) => this.handleStart(msg));
    this.bot.onText(/\/help/, (msg) => this.handleHelp(msg));
    this.bot.onText(/\/subscribe/, (msg) => this.handleSubscribe(msg));
    this.bot.onText(/\/unsubscribe/, (msg) => this.handleUnsubscribe(msg));
    this.bot.onText(/\/status/, (msg) => this.handleStatus(msg));
    this.bot.onText(/\/active_signals/, (msg) => this.handleActiveSignals(msg));
    this.bot.onText(/\/history/, (msg) => this.handleHistory(msg));
    this.bot.onText(/\/managepairs/, (msg) => this.handleManagePairs(msg));
    this.bot.onText(/\/trending/, (msg) => this.handleTrending(msg));
    this.bot.onText(/\/entry (.+)/, (msg, match) => this.handleEntry(msg, match[1]));

    // Dedicated forex pair commands (case-insensitive)
    this.bot.onText(/\/eurusd/i, (msg) => this.handlePairDirect(msg, 'frxEURUSD'));
    this.bot.onText(/\/audusd/i, (msg) => this.handlePairDirect(msg, 'frxAUDUSD'));
    this.bot.onText(/\/usdjpy/i, (msg) => this.handlePairDirect(msg, 'frxUSDJPY'));
    this.bot.onText(/\/gbpusd/i, (msg) => this.handlePairDirect(msg, 'frxGBPUSD'));
    this.bot.onText(/\/usdcad/i, (msg) => this.handlePairDirect(msg, 'frxUSDCAD'));
    this.bot.onText(/\/xauusd/i, (msg) => this.handlePairDirect(msg, 'frxXAUUSD'));

    // Dynamic crypto pair commands (e.g., /alchusdt, /btcusdt)
    this.bot.onText(/\/([a-zA-Z0-9]+usdt)/i, (msg, match) => this.handleCryptoPair(msg, match[1]));

    this.bot.onText(/\/analysis (.+)/, (msg, match) => this.handleAnalysis(msg, match[1]));
    this.bot.onText(/\/news/, (msg) => this.handleNews(msg));
    this.bot.onText(/\/ask (.+)/, (msg, match) => this.handleAsk(msg, match[1]));
    this.bot.onText(/\/mystats/, (msg) => this.handleMyStats(msg));
    this.bot.onText(/\/getchatid/, (msg) => this.handleGetChatId(msg));

    // Callback query handler for inline buttons
    this.bot.on('callback_query', (query) => this.handleCallbackQuery(query));

    logger.success('Telegram bot commands registered');
  }

  /**
   * Send message to all subscribed chats + broadcast channel (if configured)
   */
  async broadcast(message, options = {}) {
    await this.loadSubscriptions(); // Refresh subscriptions

    let sent = 0;
    let failed = 0;

    // Send to broadcast channel first (if configured)
    if (config.telegram.broadcastChannelId) {
      try {
        await this.bot.sendMessage(config.telegram.broadcastChannelId, message, options);
        sent++;
        logger.debug(`Sent to broadcast channel: ${config.telegram.broadcastChannelId}`);
      } catch (error) {
        logger.error(`Failed to send to broadcast channel:`, error.message);
        failed++;
      }
    }

    // Send to all subscribed chats
    for (const sub of this.subscriptions) {
      try {
        await this.bot.sendMessage(sub.chatId, message, options);
        sent++;
      } catch (error) {
        logger.error(`Failed to send to ${sub.chatTitle}:`, error.message);
        failed++;
      }
    }

    logger.info(`Broadcast: ${sent} sent, ${failed} failed`);
  }

  /**
   * Alias for broadcast - used by zone scanner
   */
  async broadcastToSubscribers(message, options = { parse_mode: 'HTML' }) {
    return this.broadcast(message, options);
  }

  /**
   * Send a signal notification to all subscribed chats
   */
  async sendSignal(signal) {
    const emoji = signal.signalType === 'BUY' ? '🟢' : '🔴';
    const message = `<blockquote>${emoji} <b>${signal.signalType}</b>: ${signal.symbol}
💰 Price: <code>$${signal.entryPrice.toFixed(2)}</code>
🕐 ${new Date().toUTCString()}</blockquote>`;

    await this.broadcast(message, { parse_mode: 'HTML' });
    logger.success(`Sent ${signal.signalType} signal for ${signal.symbol}`);
  }

  /**
   * Send a signal update to all subscribed chats
   */
  async sendUpdate(signal) {
    const pnlEmoji = signal.pnlPercent > 0 ? '📈' : '📉';
    const pnlSign = signal.pnlPercent > 0 ? '+' : '';

    const message = `<blockquote>📊 <b>Update</b>: ${signal.symbol}
💵 Entry: <code>$${signal.entryPrice.toFixed(2)}</code> → Current: <code>$${signal.currentPrice.toFixed(2)}</code>
${pnlEmoji} PnL: <b>${pnlSign}${signal.pnlPercent.toFixed(2)}%</b></blockquote>`;

    await this.broadcast(message, { parse_mode: 'HTML' });
    logger.info(`Sent update for ${signal.symbol}`);
  }

  /**
   * Send an exit notification to all subscribed chats
   */
  async sendExit(signal, exitReason) {
    const pnlEmoji = signal.pnlPercent > 0 ? '✅' : '❌';
    const pnlSign = signal.pnlPercent > 0 ? '+' : '';

    const message = `<blockquote>${pnlEmoji} <b>Exit</b>: ${signal.symbol}
📉 Reason: ${exitReason}
💵 Entry: <code>$${signal.entryPrice.toFixed(2)}</code> → Exit: <code>$${signal.currentPrice.toFixed(2)}</code>
💰 Final PnL: <b>${pnlSign}${signal.pnlPercent.toFixed(2)}%</b></blockquote>`;

    await this.broadcast(message, { parse_mode: 'HTML' });
    logger.success(`Sent exit notification for ${signal.symbol}`);
  }

  /**
   * Handle /start command
   */
  async handleStart(msg) {
    const message = `<b>📊 Premium/Discount Zone Trading Bot</b>

Professional Smart Money Concepts zone detection and AI-powered market analysis.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

<b>📈 ZONE DETECTION COMMANDS</b>

/active_signals - View all active premium/discount zones
/entry [PAIR] - Start monitoring a pair for entry signal (e.g., /entry eurusd)
/history - Review today's expired zones
/trending - Browse trending cryptocurrency pairs
/managepairs - Manage monitored pairs (owner only)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

<b>🔔 SUBSCRIPTION MANAGEMENT</b>

/subscribe - Enable zone notifications
/unsubscribe - Disable notifications
/status - Check bot status and connection
/getchatid - Retrieve chat/channel ID for setup

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

<b>🤖 AI-POWERED MARKET ANALYSIS</b>

<b>Forex Pairs:</b>
/eurusd | /gbpusd | /usdjpy | /audusd | /usdcad | /xauusd

<b>Crypto Pairs:</b>
/alchusdt | /btcusdt | /ethusdt
Use /trending to see all available pairs, then type /SYMBOL

<b>AI Assistant:</b>
/ask [QUESTION] - Get AI market analysis
Example: /ask What is the current trend for EURUSD?
/mystats - View your AI usage statistics

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

<b>📰 ECONOMIC CALENDAR</b>

/news - View today's high-impact economic events
Auto-broadcast: Daily summary at 06:00 UTC | 1-hour alerts before major events

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

<b>💡 HOW TO USE</b>

<b>Step 1: Analysis & Confirmation</b>
• Review the zone signals using /active_signals
• Conduct your own technical analysis to confirm the setup
• Use AI analysis commands (/eurusd, /ask) for additional insights

<b>Step 2: Wait for Confirmation</b>
• DO NOT enter immediately when a zone appears
• Use /entry [PAIR] to start automated monitoring
• Bot will monitor 15-minute SuperTrend for trend change
• Wait for a clear break of structure (BOS)
• Confirm trend change aligns with the zone direction
• Look for price action confirmation (candlestick patterns, volume)

<b>Step 3: Entry Execution</b>
• Bot will send entry signal when 15m trend changes
• Signal includes: Signal ID, Entry Type, Current Price, Stop Loss
• Set stop loss as indicated in the signal
• Use proper risk management (1-2% risk per trade)
• Take partial profits at key resistance/support levels

<b>⚠️ IMPORTANT:</b>
Zones indicate potential reversal areas, not guaranteed entries. Always wait for price action confirmation before trading.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

<b>📚 UNDERSTANDING ZONES</b>

🟢 <b>DISCOUNT ZONE</b>
Price trading at discount relative to fair value. Potential BUY/LONG opportunity when structure confirms uptrend.

🔴 <b>PREMIUM ZONE</b>
Price trading at premium relative to fair value. Potential SELL/SHORT opportunity when structure confirms downtrend.

<b>Methodology:</b>
Zones are detected using Smart Money Concepts (SMC) on 1-hour timeframe, combining EMA alignment, Stochastic RSI, and market structure analysis.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

<b>⚙️ QUICK SETUP</b>

1. Add bot to your group/channel as administrator
2. Send /subscribe to enable notifications
3. Receive hourly zone updates automatically

<b>Need Help?</b>
Type /help anytime to view this message again.`;

    await this.bot.sendMessage(msg.chat.id, message, { parse_mode: 'HTML' });
  }

  /**
   * Handle /help command
   */
  async handleHelp(msg) {
    await this.handleStart(msg);
  }

  /**
   * Handle /subscribe command
   */
  async handleSubscribe(msg) {
    const chatId = msg.chat.id;
    const chatTitle = msg.chat.title || msg.chat.first_name || 'Private Chat';
    const chatType = msg.chat.type; // 'private', 'group', 'supergroup', or 'channel'

    try {
      // Check if already subscribed
      if (await isSubscribed(chatId)) {
        await this.bot.sendMessage(chatId, '✅ This chat is already subscribed!');
        return;
      }

      // Add subscription
      await addSubscription(chatId, chatTitle, chatType);

      // Reload subscriptions
      await this.loadSubscriptions();

      const message = `✅ <b>Subscribed!</b>

<b>Chat:</b> ${chatTitle}
<b>Type:</b> ${chatType}

You will now receive all trading signals in this chat.

Use /unsubscribe to stop receiving signals.`;

      await this.bot.sendMessage(chatId, message, { parse_mode: 'HTML' });
    } catch (error) {
      logger.error('Error in /subscribe:', error.message);
      await this.bot.sendMessage(chatId, '❌ Failed to subscribe. Please try again.');
    }
  }

  /**
   * Handle /unsubscribe command
   */
  async handleUnsubscribe(msg) {
    const chatId = msg.chat.id;

    try {
      if (!(await isSubscribed(chatId))) {
        await this.bot.sendMessage(chatId, 'ℹ️ This chat is not subscribed.');
        return;
      }

      await removeSubscription(chatId);
      await this.loadSubscriptions();

      await this.bot.sendMessage(chatId, '✅ Unsubscribed. You will no longer receive signals.');
    } catch (error) {
      logger.error('Error in /unsubscribe:', error.message);
      await this.bot.sendMessage(chatId, '❌ Failed to unsubscribe. Please try again.');
    }
  }

  /**
   * Handle /status command
   */
  async handleStatus(msg) {
    try {
      const zones = await zoneManager.getAllActiveZones();
      const subs = await getActiveSubscriptions();
      const managedPairs = await getManagedPairs();

      // Count total pairs being monitored
      const forexCount = (managedPairs.forexPairs?.length || 0);
      const derivCount = (managedPairs.derivPairs?.length || 0);
      const cryptoCount = (managedPairs.cryptoPairs?.length || 0);
      const totalPairs = forexCount + derivCount + cryptoCount;

      // Group zones by type
      const discountZones = zones.filter(z => z.type === 'discount');
      const premiumZones = zones.filter(z => z.type === 'premium');

      let message = `📊 <b>Bot Status</b>\n\n`;

      message += `🟢 Active Discount Zones: ${discountZones.length}\n`;
      message += `🔴 Active Premium Zones: ${premiumZones.length}\n`;
      message += `📢 Subscribed Chats: ${subs.length}\n\n`;

      message += `<b>Monitored Pairs:</b>\n`;
      message += `💱 Forex: ${forexCount} pairs\n`;
      message += `🎲 Deriv: ${derivCount} pairs\n`;
      message += `₿ Crypto: ${cryptoCount} pairs\n`;
      message += `📊 Total: ${totalPairs} pairs\n\n`;

      if (zones.length > 0) {
        message += `<b>Recent Zones:</b>\n`;
        zones.slice(0, 5).forEach(z => {
          const emoji = z.type === 'discount' ? '🟢' : '🔴';
          const displaySymbol = zoneManager.getDisplayName(z.symbol, z.exchange);
          const time = new Date(z.createdAt).toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit'
          });
          message += `${emoji} ${displaySymbol} @ ${z.price.toFixed(5)} (${time})\n`;
        });
      }

      await this.bot.sendMessage(msg.chat.id, message, { parse_mode: 'HTML' });
    } catch (error) {
      await this.bot.sendMessage(msg.chat.id, 'Error fetching status');
      logger.error('Error in /status command:', error.message);
    }
  }

  /**
   * Handle /active_signals command - Show active premium/discount zones
   */
  async handleActiveSignals(msg) {
    try {
      const zones = await zoneManager.getAllActiveZones();

      if (zones.length === 0) {
        await this.bot.sendMessage(msg.chat.id, 'No active zones detected.');
        return;
      }

      // Group zones by exchange type
      const forexZones = zones.filter(z => z.exchange === 'forex');
      const cryptoZones = zones.filter(z => z.exchange === 'kraken');
      const derivZones = zones.filter(z => z.exchange === 'deriv');

      let message = '<b>📊 Active Premium/Discount Zones</b>\n\n';

      // Forex zones
      if (forexZones.length > 0) {
        message += '<b>💱 FOREX</b>\n';
        forexZones.forEach(zone => {
          const emoji = zone.type === 'discount' ? '🟢' : '🔴';
          const zoneName = zone.type === 'discount' ? 'DISCOUNT' : 'PREMIUM';
          const displaySymbol = zone.symbol.replace('frx', '').replace(/(.{3})(.{3})/, '$1/$2');
          const timestamp = new Date(zone.createdAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

          message += `${emoji} <b>${zoneName}</b>: ${displaySymbol} @ ${zone.price.toFixed(5)}\n`;
          message += `   <i>Detected: ${timestamp}</i>\n\n`;
        });
      }

      // Crypto zones
      if (cryptoZones.length > 0) {
        message += '<b>₿ CRYPTO</b>\n';
        cryptoZones.forEach(zone => {
          const emoji = zone.type === 'discount' ? '🟢' : '🔴';
          const zoneName = zone.type === 'discount' ? 'DISCOUNT' : 'PREMIUM';
          const displaySymbol = zone.symbol.replace('USDT', '/USDT');
          const timestamp = new Date(zone.createdAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

          message += `${emoji} <b>${zoneName}</b>: ${displaySymbol} @ $${zone.price.toFixed(2)}\n`;
          message += `   <i>Detected: ${timestamp}</i>\n\n`;
        });
      }

      // Deriv zones
      if (derivZones.length > 0) {
        message += '<b>🎲 DERIV</b>\n';
        derivZones.forEach(zone => {
          const emoji = zone.type === 'discount' ? '🟢' : '🔴';
          const zoneName = zone.type === 'discount' ? 'DISCOUNT' : 'PREMIUM';
          const displaySymbol = this.getDerivDisplayName(zone.symbol);
          const timestamp = new Date(zone.createdAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

          message += `${emoji} <b>${zoneName}</b>: ${displaySymbol} @ ${zone.price.toFixed(3)}\n`;
          message += `   <i>Detected: ${timestamp}</i>\n\n`;
        });
      }

      // Wrap in blockquote
      const finalMessage = `<blockquote>${message}</blockquote>`;
      await this.bot.sendMessage(msg.chat.id, finalMessage, { parse_mode: 'HTML' });
    } catch (error) {
      await this.bot.sendMessage(msg.chat.id, 'Error fetching active zones');
      logger.error('Error in /active_signals command:', error.message);
    }
  }

  /**
   * Handle /history command - Show expired zones from today
   */
  async handleHistory(msg) {
    try {
      const history = await zoneManager.getTodayHistory();

      if (history.length === 0) {
        await this.bot.sendMessage(msg.chat.id, 'No zone history for today.');
        return;
      }

      // Group by exchange type
      const forexHistory = history.filter(z => z.exchange === 'forex');
      const cryptoHistory = history.filter(z => z.exchange === 'kraken');
      const derivHistory = history.filter(z => z.exchange === 'deriv');

      let message = '<b>📜 Today\'s Zone History</b>\n\n';

      // Forex history
      if (forexHistory.length > 0) {
        message += '<b>💱 FOREX</b>\n';
        forexHistory.forEach(zone => {
          const emoji = zone.type === 'discount' ? '🟢' : '🔴';
          const zoneName = zone.type === 'discount' ? 'DISCOUNT' : 'PREMIUM';
          const displaySymbol = zone.symbol.replace('frx', '').replace(/(.{3})(.{3})/, '$1/$2');
          const duration = this.calculateDuration(zone.createdAt, zone.expiredAt);

          message += `${emoji} <b>${zoneName}</b>: ${displaySymbol} @ ${zone.price.toFixed(5)}\n`;
          message += `   <i>Duration: ${duration}</i>\n\n`;
        });
      }

      // Crypto history
      if (cryptoHistory.length > 0) {
        message += '<b>₿ CRYPTO</b>\n';
        cryptoHistory.forEach(zone => {
          const emoji = zone.type === 'discount' ? '🟢' : '🔴';
          const zoneName = zone.type === 'discount' ? 'DISCOUNT' : 'PREMIUM';
          const displaySymbol = zone.symbol.replace('USDT', '/USDT');
          const duration = this.calculateDuration(zone.createdAt, zone.expiredAt);

          message += `${emoji} <b>${zoneName}</b>: ${displaySymbol} @ $${zone.price.toFixed(2)}\n`;
          message += `   <i>Duration: ${duration}</i>\n\n`;
        });
      }

      // Deriv history
      if (derivHistory.length > 0) {
        message += '<b>🎲 DERIV</b>\n';
        derivHistory.forEach(zone => {
          const emoji = zone.type === 'discount' ? '🟢' : '🔴';
          const zoneName = zone.type === 'discount' ? 'DISCOUNT' : 'PREMIUM';
          const displaySymbol = this.getDerivDisplayName(zone.symbol);
          const duration = this.calculateDuration(zone.createdAt, zone.expiredAt);

          message += `${emoji} <b>${zoneName}</b>: ${displaySymbol} @ ${zone.price.toFixed(3)}\n`;
          message += `   <i>Duration: ${duration}</i>\n\n`;
        });
      }

      await this.bot.sendMessage(msg.chat.id, message, { parse_mode: 'HTML' });
    } catch (error) {
      await this.bot.sendMessage(msg.chat.id, 'Error fetching zone history');
      logger.error('Error in /history command:', error.message);
    }
  }

  /**
   * Handle /managepairs command - Interactive pair management
   */
  async handleManagePairs(msg) {
    try {
      // Check if user is owner
      const userId = msg.from.id;
      const ownerChatId = config.telegram.ownerChatId;

      if (!ownerChatId || String(userId) !== String(ownerChatId)) {
        await this.bot.sendMessage(msg.chat.id, '❌ This command is owner-only.');
        return;
      }

      await this.showPairManagementMenu(msg.chat.id);
    } catch (error) {
      await this.bot.sendMessage(msg.chat.id, 'Error in pair management');
      logger.error('Error in /managepairs command:', error.message);
    }
  }

  /**
   * Show pair management menu with current pairs
   */
  async showPairManagementMenu(chatId) {
    try {
      const managedPairs = await getManagedPairs();

      let message = '<b>⚙️ Pair Management</b>\n\n';
      message += '<i>Manage monitored pairs without server restart</i>\n\n';

      message += '<b>💱 FOREX/DERIV PAIRS</b>\n';
      if (managedPairs.forexPairs && managedPairs.forexPairs.length > 0) {
        managedPairs.forexPairs.forEach(pair => {
          const displaySymbol = pair.replace('frx', '').replace(/(.{3})(.{3})/, '$1/$2');
          message += `✅ ${displaySymbol}\n`;
        });
      }
      if (managedPairs.derivPairs && managedPairs.derivPairs.length > 0) {
        managedPairs.derivPairs.forEach(pair => {
          message += `✅ ${pair}\n`;
        });
      }
      if ((!managedPairs.forexPairs || managedPairs.forexPairs.length === 0) &&
          (!managedPairs.derivPairs || managedPairs.derivPairs.length === 0)) {
        message += '<i>No forex/deriv pairs configured</i>\n';
      }

      message += '\n<b>📈 CRYPTO PAIRS (Kraken)</b>\n';
      if (managedPairs.cryptoPairs && managedPairs.cryptoPairs.length > 0) {
        managedPairs.cryptoPairs.forEach(pair => {
          message += `✅ ${pair}\n`;
        });
      } else {
        message += '<i>Using trending crypto pairs</i>\n';
      }

      const keyboard = {
        inline_keyboard: [
          [
            { text: '➕ Add Forex/Deriv Pair', callback_data: 'pairs_add_forex' }
          ],
          [
            { text: '➖ Remove Forex/Deriv Pair', callback_data: 'pairs_remove_forex' }
          ],
          [
            { text: '🔄 Refresh', callback_data: 'pairs_refresh' }
          ]
        ]
      };

      await this.bot.sendMessage(chatId, message, {
        parse_mode: 'HTML',
        reply_markup: keyboard
      });
    } catch (error) {
      logger.error('Error showing pair management menu:', error.message);
    }
  }

  /**
   * Show Deriv pair categories
   */
  async showDerivPairCategories(chatId) {
    try {
      let message = '<b>📋 Select Pair Category</b>\n\n';
      message += '<i>Choose a category to view available pairs</i>';

      const keyboard = [
        [{ text: '💱 Forex Pairs', callback_data: 'pairs_cat_forex' }],
        [{ text: '📊 Volatility Indices (V75, V100, etc.)', callback_data: 'pairs_cat_volatility' }],
        [{ text: '💥 Crash/Boom Indices', callback_data: 'pairs_cat_crash_boom' }],
        [{ text: '📈 Step Indices', callback_data: 'pairs_cat_step_indices' }],
        [{ text: '🎯 Jump Indices', callback_data: 'pairs_cat_jump_indices' }],
        [{ text: '📉 Range Break Indices', callback_data: 'pairs_cat_range_break' }],
        [{ text: '🥇 Commodities', callback_data: 'pairs_cat_commodities' }],
        [{ text: '₿ Crypto Indices', callback_data: 'pairs_cat_crypto' }],
        [{ text: '🔙 Back to Menu', callback_data: 'pairs_menu' }]
      ];

      await this.bot.sendMessage(chatId, message, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: keyboard }
      });
    } catch (error) {
      logger.error('Error showing Deriv categories:', error.message);
    }
  }

  /**
   * Show available Deriv pairs for a specific category with pagination
   */
  async showDerivPairsByCategory(chatId, category, page = 0) {
    try {
      await this.bot.sendMessage(chatId, '🔍 Fetching pairs...');

      let pairsData = null;

      // Try to connect to Deriv if not connected
      try {
        if (!derivClient.connected) {
          await derivClient.connect();
        }
        pairsData = await derivClient.getAllPairs();

        // Update the zoneManager cache with display names from API
        if (pairsData) {
          zoneManager.updateDerivDisplayNames(pairsData);
        }
      } catch (error) {
        logger.warn('Could not fetch Deriv pairs from API, using fallback:', error.message);
      }

      // Get pairs for the selected category
      let categoryPairs = [];
      let categoryName = '';

      if (pairsData && pairsData.grouped && pairsData.grouped[category]) {
        categoryPairs = pairsData.grouped[category];
      }

      // Fallback for specific categories
      if (categoryPairs.length === 0) {
        if (category === 'forex') {
          categoryName = 'Forex Pairs';
          categoryPairs = [
            { symbol: 'frxEURUSD', displayName: 'EUR/USD' },
            { symbol: 'frxGBPUSD', displayName: 'GBP/USD' },
            { symbol: 'frxUSDJPY', displayName: 'USD/JPY' },
            { symbol: 'frxAUDUSD', displayName: 'AUD/USD' },
            { symbol: 'frxUSDCAD', displayName: 'USD/CAD' },
            { symbol: 'frxUSDCHF', displayName: 'USD/CHF' },
            { symbol: 'frxNZDUSD', displayName: 'NZD/USD' },
            { symbol: 'frxEURGBP', displayName: 'EUR/GBP' },
            { symbol: 'frxEURJPY', displayName: 'EUR/JPY' },
            { symbol: 'frxGBPJPY', displayName: 'GBP/JPY' },
            { symbol: 'frxXAUUSD', displayName: 'XAU/USD (Gold)' }
          ];
        } else if (category === 'volatility') {
          categoryName = 'Volatility Indices';
          categoryPairs = [
            { symbol: '1HZ10V', displayName: 'Volatility 10 (1s) Index' },
            { symbol: '1HZ25V', displayName: 'Volatility 25 (1s) Index' },
            { symbol: '1HZ50V', displayName: 'Volatility 50 (1s) Index' },
            { symbol: '1HZ75V', displayName: 'Volatility 75 (1s) Index' },
            { symbol: '1HZ100V', displayName: 'Volatility 100 (1s) Index' },
            { symbol: 'R_10', displayName: 'Volatility 10 Index' },
            { symbol: 'R_25', displayName: 'Volatility 25 Index' },
            { symbol: 'R_50', displayName: 'Volatility 50 Index' },
            { symbol: 'R_75', displayName: 'Volatility 75 Index' },
            { symbol: 'R_100', displayName: 'Volatility 100 Index' }
          ];
        } else if (category === 'crash_boom') {
          categoryName = 'Crash/Boom Indices';
          categoryPairs = [
            { symbol: 'CRASH300N', displayName: 'Crash 300 Index' },
            { symbol: 'CRASH500N', displayName: 'Crash 500 Index' },
            { symbol: 'CRASH1000N', displayName: 'Crash 1000 Index' },
            { symbol: 'BOOM300N', displayName: 'Boom 300 Index' },
            { symbol: 'BOOM500N', displayName: 'Boom 500 Index' },
            { symbol: 'BOOM1000N', displayName: 'Boom 1000 Index' }
          ];
        }
      }

      // Set category name based on category key
      const categoryNames = {
        forex: 'Forex Pairs',
        volatility: 'Volatility Indices',
        crash_boom: 'Crash/Boom Indices',
        step_indices: 'Step Indices',
        jump_indices: 'Jump Indices',
        range_break: 'Range Break Indices',
        commodities: 'Commodities',
        crypto: 'Crypto Indices'
      };
      categoryName = categoryNames[category] || category;

      if (categoryPairs.length === 0) {
        await this.bot.sendMessage(chatId, `❌ No ${categoryName} available.`);
        return;
      }

      const itemsPerPage = 10;
      const totalPages = Math.ceil(categoryPairs.length / itemsPerPage);
      const currentPage = Math.max(0, Math.min(page, totalPages - 1));
      const startIndex = currentPage * itemsPerPage;
      const endIndex = Math.min(startIndex + itemsPerPage, categoryPairs.length);
      const pagePairs = categoryPairs.slice(startIndex, endIndex);

      let message = `<b>📋 ${categoryName}</b>\n`;
      message += `Page ${currentPage + 1}/${totalPages} | Total: ${categoryPairs.length} pairs\n\n`;
      message += '<i>Click to add a pair to monitoring</i>\n';

      const keyboard = [];

      // Add pair buttons (2 per row)
      for (let i = 0; i < pagePairs.length; i += 2) {
        const row = [];
        row.push({
          text: pagePairs[i].displayName || pagePairs[i].symbol,
          callback_data: `pairs_add_${pagePairs[i].symbol}`
        });

        if (i + 1 < pagePairs.length) {
          row.push({
            text: pagePairs[i + 1].displayName || pagePairs[i + 1].symbol,
            callback_data: `pairs_add_${pagePairs[i + 1].symbol}`
          });
        }

        keyboard.push(row);
      }

      // Navigation buttons
      const navButtons = [];
      if (currentPage > 0) {
        navButtons.push({ text: '⬅️ Previous', callback_data: `pairs_cat_${category}_page_${currentPage - 1}` });
      }
      if (currentPage < totalPages - 1) {
        navButtons.push({ text: 'Next ➡️', callback_data: `pairs_cat_${category}_page_${currentPage + 1}` });
      }
      if (navButtons.length > 0) {
        keyboard.push(navButtons);
      }

      // Back button
      keyboard.push([{ text: '🔙 Back to Categories', callback_data: 'pairs_categories' }]);

      await this.bot.sendMessage(chatId, message, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: keyboard }
      });
    } catch (error) {
      logger.error('Error showing Deriv pairs by category:', error.message);
      await this.bot.sendMessage(chatId, '❌ Error fetching pairs: ' + error.message);
    }
  }

  /**
   * Show remove pairs menu
   */
  async showRemovePairsMenu(chatId) {
    try {
      const managedPairs = await getManagedPairs();

      const allPairs = [
        ...(managedPairs.forexPairs || []).map(p => ({ symbol: p, exchange: 'forex' })),
        ...(managedPairs.derivPairs || []).map(p => ({ symbol: p, exchange: 'deriv' })),
        ...(managedPairs.cryptoPairs || []).map(p => ({ symbol: p, exchange: 'kraken' }))
      ];

      if (allPairs.length === 0) {
        await this.bot.sendMessage(chatId, '❌ No pairs to remove.');
        return;
      }

      let message = '<b>➖ Remove Pairs</b>\n\n';
      message += '<i>Click to remove a pair from monitoring</i>\n';

      const keyboard = [];

      // Add remove buttons (2 per row)
      for (let i = 0; i < allPairs.length; i += 2) {
        const row = [];

        const displayName1 = allPairs[i].symbol.replace('frx', '').replace(/(.{3})(.{3})/, '$1/$2');
        row.push({
          text: `❌ ${displayName1}`,
          callback_data: `pairs_remove_${allPairs[i].exchange}_${allPairs[i].symbol}`
        });

        if (i + 1 < allPairs.length) {
          const displayName2 = allPairs[i + 1].symbol.replace('frx', '').replace(/(.{3})(.{3})/, '$1/$2');
          row.push({
            text: `❌ ${displayName2}`,
            callback_data: `pairs_remove_${allPairs[i + 1].exchange}_${allPairs[i + 1].symbol}`
          });
        }

        keyboard.push(row);
      }

      // Back button
      keyboard.push([{ text: '🔙 Back to Menu', callback_data: 'pairs_menu' }]);

      await this.bot.sendMessage(chatId, message, {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: keyboard }
      });
    } catch (error) {
      logger.error('Error showing remove pairs menu:', error.message);
    }
  }

  /**
   * Handle callback queries from inline buttons
   */
  async handleCallbackQuery(query) {
    try {
      const chatId = query.message.chat.id;
      const data = query.data;

      // Answer callback to remove loading state
      await this.bot.answerCallbackQuery(query.id);

      // Pair management callbacks
      if (data === 'pairs_menu') {
        await this.showPairManagementMenu(chatId);
      } else if (data === 'pairs_add_forex') {
        await this.showDerivPairCategories(chatId);
      } else if (data === 'pairs_categories') {
        await this.showDerivPairCategories(chatId);
      } else if (data === 'pairs_remove_forex') {
        await this.showRemovePairsMenu(chatId);
      } else if (data === 'pairs_refresh') {
        await this.showPairManagementMenu(chatId);
      } else if (data.startsWith('pairs_cat_')) {
        // Handle category selection: pairs_cat_forex, pairs_cat_volatility, etc.
        const match = data.match(/^pairs_cat_([a-z_]+)(?:_page_(\d+))?$/);
        if (match) {
          const category = match[1];
          const page = match[2] ? parseInt(match[2]) : 0;
          await this.showDerivPairsByCategory(chatId, category, page);
        }
      } else if (data.startsWith('pairs_add_')) {
        // Handle adding a pair
        const symbol = data.replace('pairs_add_', '');

        // Determine exchange type based on symbol
        let exchange = 'deriv';
        if (symbol.startsWith('frx')) {
          exchange = 'forex';
        }

        await addManagedPair(exchange, symbol);
        await this.bot.sendMessage(chatId, `✅ Added ${symbol.replace('frx', '')} to monitoring!`);
        await this.showPairManagementMenu(chatId);
      } else if (data.startsWith('pairs_remove_')) {
        const parts = data.replace('pairs_remove_', '').split('_');
        const exchange = parts[0];
        const symbol = parts.slice(1).join('_');
        await removeManagedPair(exchange, symbol);
        await this.bot.sendMessage(chatId, `✅ Removed ${symbol.replace('frx', '')} from monitoring!`);
        await this.showPairManagementMenu(chatId);
      }
    } catch (error) {
      logger.error('Error handling callback query:', error.message);
    }
  }

  /**
   * Calculate duration between two timestamps
   */
  calculateDuration(startTime, endTime) {
    const start = new Date(startTime);
    const end = new Date(endTime);
    const diffMs = end - start;

    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  }

  /**
   * Handle /trending command
   */
  async handleTrending(msg) {
    try {
      const today = new Date().toISOString().split('T')[0];
      const trending = await getTrendingPairs(today);

      if (!trending) {
        await this.bot.sendMessage(msg.chat.id, 'No trending data available for today.');
        return;
      }

      let message = '<b>📈 Trending Pairs</b>\n\n';

      message += '🟢 <b>Top Bullish:</b>\n';
      trending.cryptoBullish.slice(0, 5).forEach(pair => {
        message += `  • ${pair.symbol} <code>+${pair.changePercent.toFixed(2)}%</code>\n`;
      });

      message += '\n🔴 <b>Top Bearish:</b>\n';
      trending.cryptoBearish.slice(0, 5).forEach(pair => {
        message += `  • ${pair.symbol} <code>${pair.changePercent.toFixed(2)}%</code>\n`;
      });

      await this.bot.sendMessage(msg.chat.id, message, { parse_mode: 'HTML' });
    } catch (error) {
      await this.bot.sendMessage(msg.chat.id, 'Error fetching trending pairs');
      logger.error('Error in /trending command:', error.message);
    }
  }

  /**
   * Handle dedicated pair commands (/eurusd, /gbpusd, etc.) - Uses AI analysis
   */
  async handlePairDirect(msg, symbol) {
    try {
      const displaySymbol = symbol.replace('frx', '');
      const chatId = msg.chat.id;
      const userId = msg.from.id;

      // Send "analyzing" message
      await this.bot.sendMessage(chatId, `🤖 Analyzing ${displaySymbol}... Please wait...`);

      // Fetch multiple timeframes for comprehensive analysis
      let candles4H, candles1H, candles15M;
      try {
        // 4H candles (60 periods = 10 days)
        candles4H = await derivClient.getCandles(symbol, 14400, 60); // 14400s = 4H
        
        // 1H candles (168 periods = 7 days)
        candles1H = await derivClient.getCandles(symbol, 3600, 168); // 3600s = 1H
        
        // 15M candles (96 periods = 24 hours) - optional
        try {
          candles15M = await derivClient.getCandles(symbol, 900, 96); // 900s = 15M
        } catch (error) {
          logger.warn('15M candles not available, continuing without them');
          candles15M = null;
        }
      } catch (error) {
        logger.error('Error fetching candles:', error.message);
        await this.bot.sendMessage(chatId, '❌ Could not fetch market data. Please try again.');
        return;
      }

      if (!candles1H || candles1H.length < 20 || !candles4H || candles4H.length < 20) {
        await this.bot.sendMessage(chatId, '❌ Insufficient market data available.');
        return;
      }

      // Get active zone for context
      const zone = await zoneManager.getActiveZone(symbol);
      
      // Use advanced market analysis
      const advancedAnalysis = (await import('../utils/advancedMarketAnalysis.js')).default;

      // Prepare comprehensive market data using advanced analysis
      const marketData = await advancedAnalysis.prepareComprehensiveMarketData(
        symbol,
        displaySymbol,
        candles4H,
        candles1H,
        candles15M,
        zone,
        'forex'
      );

      // Generate AI analysis
      const question = `Provide a professional trading analysis for ${displaySymbol} with specific entry, stop loss, and take profit levels if a trade opportunity exists.`;
      const aiResponse = await aiClient.analyzeTrading(question, marketData);

      // AI outputs plain text - wrap in blockquote
      const finalMessage = `<blockquote>${aiResponse.content}</blockquote>`;

      await this.bot.sendMessage(chatId, finalMessage, { parse_mode: 'HTML' });

    } catch (error) {
      await this.bot.sendMessage(msg.chat.id, `❌ Error analyzing ${symbol.replace('frx', '')}: ${error.message}`);
      logger.error(`Error in /${symbol.replace('frx', '').toLowerCase()} command:`, error.message);
    }
  }

  /**
   * Handle dynamic crypto pair commands (/alchusdt, /btcusdt, etc.)
   */
  async handleCryptoPair(msg, symbolInput) {
    try {
      const symbol = symbolInput.toUpperCase();
      const chatId = msg.chat.id;

      // Check if pair is in active monitoring list
      const activeCryptoPairs = trendingScanner.getActiveCryptoPairs();
      const pairData = activeCryptoPairs.find(p =>
        (p.symbol && p.symbol.toUpperCase() === symbol) ||
        (typeof p === 'string' && p.toUpperCase() === symbol)
      );

      if (!pairData) {
        await this.bot.sendMessage(chatId,
          `❌ ${symbol} is not currently monitored.\n\n` +
          `Use /trending to see all monitored crypto pairs.`
        );
        return;
      }

      // Send "analyzing" message
      const displaySymbol = symbol.replace('USDT', '/USDT');
      await this.bot.sendMessage(chatId, `🤖 Analyzing ${displaySymbol}... Please wait...`);

      // Fetch multiple timeframes for comprehensive analysis
      let candles4H, candles1H, candles15M;
      try {
        // 4H candles (60 periods = 10 days)
        candles4H = await bybitClient.getKlines(symbol, '240', 60); // 240 = 4H
        
        // 1H candles (168 periods = 7 days)
        candles1H = await bybitClient.getKlines(symbol, '60', 168); // 60 = 1H
        
        // 15M candles (96 periods = 24 hours) - optional
        try {
          candles15M = await bybitClient.getKlines(symbol, '15', 96); // 15 = 15M
        } catch (error) {
          logger.warn('15M candles not available, continuing without them');
          candles15M = null;
        }
      } catch (error) {
        logger.error('Error fetching Bybit candles:', error.message);
        await this.bot.sendMessage(chatId, '❌ Could not fetch market data from Bybit. Please try again.');
        return;
      }

      if (!candles1H || candles1H.length < 20 || !candles4H || candles4H.length < 20) {
        await this.bot.sendMessage(chatId, '❌ Insufficient market data available.');
        return;
      }

      // Get active zone for context
      const zone = await zoneManager.getActiveZone(symbol);
      
      // Use advanced market analysis
      const advancedAnalysis = (await import('../utils/advancedMarketAnalysis.js')).default;

      // Prepare comprehensive market data using advanced analysis
      const marketData = await advancedAnalysis.prepareComprehensiveMarketData(
        symbol,
        displaySymbol,
        candles4H,
        candles1H,
        candles15M,
        zone,
        'crypto'
      );

      // Generate AI analysis
      const question = `Provide a professional crypto trading analysis for ${displaySymbol} on Bybit with specific entry, stop loss, and take profit levels if a trade opportunity exists.`;
      const aiResponse = await aiClient.analyzeTrading(question, marketData);

      // AI outputs plain text - wrap in blockquote
      const finalMessage = `<blockquote>${aiResponse.content}</blockquote>`;

      await this.bot.sendMessage(chatId, finalMessage, { parse_mode: 'HTML' });

    } catch (error) {
      await this.bot.sendMessage(msg.chat.id, `❌ Error analyzing ${symbolInput.toUpperCase()}: ${error.message}`);
      logger.error(`Error in /${symbolInput.toLowerCase()} command:`, error.message);
    }
  }

  /**
   * Handle /pair command (kept for backwards compatibility)
   */
  async handlePair(msg, symbol) {
    try {
      // Normalize symbol - try multiple variations
      const symbolUpper = symbol.toUpperCase();

      // Try direct match first
      let state = await getPairState(symbolUpper);

      // If not found, try with frx prefix for forex pairs
      if (!state && !symbolUpper.startsWith('FRX') && !symbolUpper.startsWith('1HZ') && !symbolUpper.startsWith('R_')) {
        state = await getPairState(`FRX${symbolUpper}`);
      }

      if (!state) {
        await this.bot.sendMessage(msg.chat.id, `No data found for ${symbol}`);
        return;
      }

      const stateStr = state.state === 'idle' ? 'Idle'
        : state.state === 'waiting' ? `Waiting for confirmation`
        : `Active (${state.signalType})`;

      const message = `<b>${state.symbol}</b> (${state.exchange})

State: ${stateStr}
15m EMA38: ${state.last15mEma38.toFixed(2)}
15m EMA62: ${state.last15mEma62.toFixed(2)}
15m Stoch RSI: ${state.last15mStochK.toFixed(2)}
1m EMA38: ${state.last1mEma38.toFixed(2)}
1m EMA62: ${state.last1mEma62.toFixed(2)}`;

      await this.bot.sendMessage(msg.chat.id, message, { parse_mode: 'HTML' });
    } catch (error) {
      await this.bot.sendMessage(msg.chat.id, `Error fetching data for ${symbol}`);
      logger.error('Error in /pair command:', error.message);
    }
  }

  /**
   * Handle /analysis command
   */
  async handleAnalysis(msg, symbol) {
    try {
      await this.bot.sendMessage(msg.chat.id, '🔍 Analyzing... Please wait...');

      // Normalize symbol
      const symbolUpper = symbol.toUpperCase();
      let searchSymbol = symbolUpper;

      // Add frx prefix if needed for forex
      if (!symbolUpper.startsWith('FRX') && !symbolUpper.includes('USDT') &&
          !symbolUpper.startsWith('1HZ') && !symbolUpper.startsWith('R_')) {
        searchSymbol = symbolUpper;
      }

      const analysis = await analysisClient.getTechnicalAnalysis(searchSymbol);

      const trendEmoji = analysis.trend === 'BULLISH' ? '📈' :
                         analysis.trend === 'BEARISH' ? '📉' : '➡️';

      const message = `📊 <b>Technical Analysis: ${analysis.symbol}</b>

${trendEmoji} <b>Trend: ${analysis.trend}</b>

<b>Moving Averages:</b>
  SMA(20): <code>${analysis.sma20?.toFixed(4) || 'N/A'}</code>
  EMA(20): <code>${analysis.ema20?.toFixed(4) || 'N/A'}</code>

<b>Momentum:</b>
  RSI(14): <code>${analysis.rsi14?.toFixed(2) || 'N/A'}</code>
  ${analysis.rsi14 ? (analysis.rsi14 > 70 ? '⚠️ Overbought' : analysis.rsi14 < 30 ? '⚠️ Oversold' : '✅ Neutral') : ''}

<b>MACD:</b>
  MACD: <code>${analysis.macd?.macd?.toFixed(4) || 'N/A'}</code>
  Signal: <code>${analysis.macd?.signal?.toFixed(4) || 'N/A'}</code>
  Histogram: <code>${analysis.macd?.histogram?.toFixed(4) || 'N/A'}</code>

<i>Data from Alpha Vantage</i>`;

      await this.bot.sendMessage(msg.chat.id, message, { parse_mode: 'HTML' });
    } catch (error) {
      logger.error('Error in /analysis command:', error.message);

      if (error.message.includes('not configured')) {
        await this.bot.sendMessage(msg.chat.id,
          '⚠️ Technical analysis requires Alpha Vantage API key.\n\n' +
          'Get free key: https://www.alphavantage.co/support/#api-key\n' +
          'Add to .env: ALPHA_VANTAGE_API_KEY=your_key');
      } else if (error.message.includes('rate limit')) {
        await this.bot.sendMessage(msg.chat.id,
          '⚠️ API rate limit exceeded. Please try again in 1 minute.');
      } else {
        await this.bot.sendMessage(msg.chat.id,
          `❌ Failed to analyze ${symbol}. ${error.message}`);
      }
    }
  }

  /**
   * Handle /news command - Show forex news for major pairs (USD, GBP, CAD, AUD, JPY)
   * Uses Finnhub API first, falls back to NewsAPI if needed
   */
  async handleNews(msg) {
    try {
      await this.bot.sendMessage(msg.chat.id, '📰 Fetching forex news for major pairs... Please wait...');

      // Try FCS API first (economic calendar)
      let events = [];
      let useForexNews = false;
      
      try {
        events = await newsClient.getTodayNews();
        // If we got events, use economic calendar format
        if (events && events.length > 0) {
          const message = newsClient.formatTodayNewsForTelegram(events, []);
          await this.bot.sendMessage(msg.chat.id, message, { parse_mode: 'HTML' });
          return;
        }
      } catch (fcsError) {
        // FCS API failed (limit exceeded or not configured), use alternative
        logger.debug('FCS API failed, using alternative news sources:', fcsError.message);
        useForexNews = true;
      }

      // Use alternative APIs (Finnhub/NewsAPI) for forex news
      if (useForexNews || events.length === 0) {
        const forexNews = await newsClient.getForexNewsFromAlternatives();
        
        if (forexNews.length === 0) {
          await this.bot.sendMessage(msg.chat.id,
            '📰 <b>Forex News - Major Pairs</b>\n\n' +
            'No recent news found for USD, GBP, CAD, AUD, JPY.\n\n' +
            '<i>Monitoring: USD, GBP, CAD, AUD, JPY</i>',
            { parse_mode: 'HTML' }
          );
          return;
        }

        const message = newsClient.formatForexNewsForTelegram(forexNews);
        await this.bot.sendMessage(msg.chat.id, message, { parse_mode: 'HTML' });
      }

    } catch (error) {
      logger.error('Error in /news command:', error.message);

      await this.bot.sendMessage(msg.chat.id,
        `❌ Failed to fetch news. ${error.message}\n\n` +
        `Tried: FCS API → Finnhub → NewsAPI`,
        { parse_mode: 'HTML' }
      );
    }
  }

  /**
   * Handle /ask command - AI-powered trading analysis
   */
  async handleAsk(msg, question) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    try {
      // Check if AI is configured
      if (!aiClient.isConfigured()) {
        await this.bot.sendMessage(chatId,
          '⚠️ AI analysis requires OpenRouter API keys.\n\n' +
          'Get free keys: https://openrouter.ai/\n' +
          'Add to .env: OPENROUTER_API_KEYS=your_key1,your_key2');
        return;
      }

      // Check rate limits
      const limitCheck = await canMakeRequest(chatId, userId);

      if (!limitCheck.allowed) {
        await this.bot.sendMessage(chatId,
          `⚠️ Daily AI request limit reached (3/day)\n\n` +
          `Resets in: ${limitCheck.resetTime}\n\n` +
          `💡 Tip: Use /mystats to see your usage`);
        return;
      }

      // Send processing message
      const processingMsg = await this.bot.sendMessage(chatId, '🤖 Analyzing...');

      try {
        // Detect if question mentions a monitored pair
        const detectedPair = await this.detectMonitoredPair(question);
        
        let marketData = '';
        let pairInfo = '';

        if (detectedPair) {
          // Fetch comprehensive market data for the detected pair
          logger.info(`Detected pair in question: ${detectedPair.displaySymbol} (${detectedPair.symbol})`);
          
          try {
            await this.bot.editMessageText(
              `🤖 Analyzing ${detectedPair.displaySymbol}... Fetching market data...`,
              { chat_id: chatId, message_id: processingMsg.message_id }
            );

            // Fetch multi-timeframe candles
            let candles4H, candles1H, candles15M;
            
            if (detectedPair.exchange === 'forex' || detectedPair.exchange === 'deriv') {
              // Use Deriv API for forex and deriv pairs
              candles4H = await derivClient.getCandles(detectedPair.symbol, 14400, 60); // 4H
              candles1H = await derivClient.getCandles(detectedPair.symbol, 3600, 168); // 1H
              try {
                candles15M = await derivClient.getCandles(detectedPair.symbol, 900, 96); // 15M
              } catch (error) {
                candles15M = null;
              }
            } else if (detectedPair.exchange === 'crypto') {
              // Use Bybit API for crypto pairs
              candles4H = await bybitClient.getKlines(detectedPair.symbol, '240', 60); // 4H
              candles1H = await bybitClient.getKlines(detectedPair.symbol, '60', 168); // 1H
              try {
                candles15M = await bybitClient.getKlines(detectedPair.symbol, '15', 96); // 15M
              } catch (error) {
                candles15M = null;
              }
            }

            if (candles1H && candles1H.length >= 20 && candles4H && candles4H.length >= 20) {
              // Get active zone if exists
              const zone = await zoneManager.getActiveZone(detectedPair.symbol);
              
              // Use advanced market analysis
              const advancedAnalysis = (await import('../utils/advancedMarketAnalysis.js')).default;
              marketData = await advancedAnalysis.prepareComprehensiveMarketData(
                detectedPair.symbol,
                detectedPair.displaySymbol,
                candles4H,
                candles1H,
                candles15M,
                zone,
                detectedPair.exchange
              );
              
              pairInfo = `\n\n📊 <b>Market Data for ${detectedPair.displaySymbol}</b>\n` +
                        `The comprehensive market analysis data for this pair has been included above.`;
            } else {
              logger.warn(`Insufficient data for ${detectedPair.displaySymbol}`);
            }
          } catch (error) {
            logger.error(`Error fetching market data for ${detectedPair.displaySymbol}:`, error.message);
            // Continue without market data
          }
        }

        // If no pair detected or market data fetch failed, try to get basic candles and use comprehensive format
        if (!marketData) {
          // Try to extract symbol and fetch at least basic comprehensive data
          const symbol = this.extractSymbol(question);
          logger.info(`No pair detected, attempting to fetch data for ${symbol}`);
          
          try {
            // Try to fetch at least 1H candles for comprehensive analysis
            let candles1H, candles4H;
            
            // Try Deriv first (for forex)
            try {
              candles4H = await derivClient.getCandles(`frx${symbol}`, 14400, 60);
              candles1H = await derivClient.getCandles(`frx${symbol}`, 3600, 168);
            } catch (error) {
              // Try without frx prefix
              try {
                candles4H = await derivClient.getCandles(symbol, 14400, 60);
                candles1H = await derivClient.getCandles(symbol, 3600, 168);
              } catch (error2) {
                // Try Bybit for crypto
                try {
                  candles4H = await bybitClient.getKlines(symbol, '240', 60);
                  candles1H = await bybitClient.getKlines(symbol, '60', 168);
                } catch (error3) {
                  logger.warn(`Could not fetch candles for ${symbol}`);
                }
              }
            }
            
            if (candles1H && candles1H.length >= 20 && candles4H && candles4H.length >= 20) {
              const zone = await zoneManager.getActiveZone(symbol);
              const advancedAnalysis = (await import('../utils/advancedMarketAnalysis.js')).default;
              const displaySymbol = symbol.replace('USDT', '/USDT').replace(/(.{3})(.{3})/, '$1/$2');
              
              marketData = await advancedAnalysis.prepareComprehensiveMarketData(
                symbol,
                displaySymbol,
                candles4H,
                candles1H,
                null, // No 15M
                zone,
                symbol.includes('USDT') ? 'crypto' : 'forex'
              );
              
              pairInfo = `\n\n📊 <b>Market Data for ${displaySymbol}</b>\n` +
                        `Comprehensive market analysis data included.`;
            }
          } catch (error) {
            logger.error(`Error fetching fallback data:`, error.message);
          }
        }

        // Generate AI response with comprehensive market data
        // If we still don't have market data, just send the question (no old format)
        const promptWithData = marketData 
          ? `${question}\n\n${marketData}${pairInfo}`
          : `${question}\n\n⚠️ Note: Could not fetch market data. Please ensure the pair is monitored or try using the pair's symbol directly (e.g., /eurusd or /btcusdt).`;

        const aiResponse = await aiClient.analyzeTrading(question, promptWithData);

        // Log the request
        await logRequest(chatId, userId, question, aiResponse.model, aiResponse.content.length);

        // Send AI response
        const remainingText = limitCheck.remaining === 'unlimited'
          ? '∞'
          : `${limitCheck.remaining}/3`;

        // AI outputs plain text - wrap in blockquote
        const finalMessage = `<blockquote>${aiResponse.content}\n\n` +
          `📊 Remaining requests today: ${remainingText}</blockquote>`;

        await this.bot.sendMessage(chatId, finalMessage, { parse_mode: 'HTML' });

        // Delete processing message
        await this.bot.deleteMessage(chatId, processingMsg.message_id);

      } catch (error) {
        // Delete processing message
        try {
          await this.bot.deleteMessage(chatId, processingMsg.message_id);
        } catch (e) {
          // Ignore deletion error
        }

        throw error;
      }

    } catch (error) {
      logger.error('Error in /ask command:', error.message);

      let errorMessage = '❌ Failed to generate AI analysis.\n\n';

      if (error.message.includes('not configured')) {
        errorMessage += 'OpenRouter API keys not configured.\n';
        errorMessage += 'Get free keys: https://openrouter.ai/';
      } else if (error.message.includes('All AI attempts failed')) {
        errorMessage += 'All AI models are currently unavailable.\n';
        errorMessage += 'This could be due to:\n';
        errorMessage += '- Rate limits on all API keys\n';
        errorMessage += '- All models are down\n';
        errorMessage += '- Network connectivity issues\n\n';
        errorMessage += 'Try again in a few minutes.';
      } else {
        errorMessage += `Error: ${error.message}`;
      }

      await this.bot.sendMessage(chatId, errorMessage);
    }
  }

  /**
   * Handle /mystats command - Show user's AI usage stats
   */
  async handleMyStats(msg) {
    const chatId = msg.chat.id;

    try {
      const stats = await getRequestStats(chatId);

      if (!stats) {
        await this.bot.sendMessage(chatId, 'Unable to fetch stats. Try again later.');
        return;
      }

      const isOwnerUser = config.telegram.ownerChatId &&
                          String(chatId) === String(config.telegram.ownerChatId);

      let message = '📊 <b>Your AI Usage Statistics</b>\n\n';

      if (isOwnerUser) {
        message += '👑 <b>Owner Account</b> - Unlimited requests\n\n';
      } else {
        message += `📈 <b>Today\'s Usage:</b> ${stats.count}/3\n`;
        message += `🔄 <b>Remaining:</b> ${stats.remaining}\n\n`;
      }

      if (stats.requests && stats.requests.length > 0) {
        message += '<b>Recent Requests:</b>\n';
        stats.requests.slice(-5).reverse().forEach((req, index) => {
          const time = new Date(req.timestamp).toLocaleTimeString();
          const questionPreview = req.question.substring(0, 40) + '...';
          message += `${index + 1}. ${time} - "${questionPreview}"\n`;
        });
      } else {
        message += 'No requests made today.\n';
      }

      if (!isOwnerUser) {
        const resetTime = new Date();
        resetTime.setUTCDate(resetTime.getUTCDate() + 1);
        resetTime.setUTCHours(0, 0, 0, 0);
        const hoursUntilReset = Math.floor((resetTime - new Date()) / (1000 * 60 * 60));

        message += `\n⏰ Resets in ${hoursUntilReset} hours (00:00 UTC)`;
      }

      await this.bot.sendMessage(chatId, message, { parse_mode: 'HTML' });

    } catch (error) {
      logger.error('Error in /mystats command:', error.message);
      await this.bot.sendMessage(chatId, 'Error fetching stats. Please try again.');
    }
  }

  /**
   * Detect and extract monitored pair from user question
   * Returns { symbol, exchange, displaySymbol } or null if no pair detected
   * Uses fuzzy matching to handle variations in pair names
   */
  async detectMonitoredPair(question) {
    try {
      // Normalize question for matching (remove special chars, normalize spaces)
      const normalize = (str) => str.toLowerCase()
        .replace(/[()]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
      
      const normalizedQuestion = normalize(question);
      const upperQuestion = question.toUpperCase();
      const lowerQuestion = question.toLowerCase();

      // Get all managed pairs
      const managedPairs = await getManagedPairs();

      // Helper function to check if question matches pair
      const matchesPair = (displayName, symbol, questionNorm, questionUpper, questionLower) => {
        const displayNorm = normalize(displayName);
        const symbolNorm = normalize(symbol.replace(/^frx/i, ''));
        const symbolUpper = symbol.toUpperCase().replace(/^FRX/, '');
        
        // Exact matches
        if (questionUpper.includes(symbolUpper) || 
            questionUpper.includes(displayName.toUpperCase()) ||
            questionLower.includes(displayName.toLowerCase())) {
          return true;
        }
        
        // Normalized partial matches (for cases like "Volatility 50" matching "Volatility 50 (1s) Index")
        if (questionNorm.includes(displayNorm) || displayNorm.includes(questionNorm)) {
          return true;
        }
        
        // Check if key words match (e.g., "volatility 50" matches "Volatility 50 (1s) Index")
        const displayWords = displayNorm.split(/\s+/).filter(w => w.length > 2);
        const questionWords = questionNorm.split(/\s+/).filter(w => w.length > 2);
        const matchingWords = questionWords.filter(qw => 
          displayWords.some(dw => dw.includes(qw) || qw.includes(dw))
        );
        
        // If at least 2 key words match, consider it a match
        if (matchingWords.length >= 2) {
          return true;
        }
        
        return false;
      };

      // Check forex pairs
      if (managedPairs.forexPairs && managedPairs.forexPairs.length > 0) {
        for (const symbol of managedPairs.forexPairs) {
          const displayName = zoneManager.getDisplayName(symbol, 'forex');
          
          if (matchesPair(displayName, symbol, normalizedQuestion, upperQuestion, lowerQuestion)) {
            return {
              symbol: symbol.startsWith('frx') ? symbol : `frx${symbol}`,
              exchange: 'forex',
              displaySymbol: displayName
            };
          }
        }
      }

      // Check deriv pairs
      if (managedPairs.derivPairs && managedPairs.derivPairs.length > 0) {
        for (const symbol of managedPairs.derivPairs) {
          const displayName = zoneManager.getDisplayName(symbol, 'deriv');
          
          if (matchesPair(displayName, symbol, normalizedQuestion, upperQuestion, lowerQuestion)) {
            return {
              symbol,
              exchange: 'deriv',
              displaySymbol: displayName
            };
          }
        }
      }

      // Check crypto pairs
      if (managedPairs.cryptoPairs && managedPairs.cryptoPairs.length > 0) {
        for (const symbol of managedPairs.cryptoPairs) {
          const displayName = zoneManager.getDisplayName(symbol, 'kraken');
          
          if (matchesPair(displayName, symbol, normalizedQuestion, upperQuestion, lowerQuestion)) {
            return {
              symbol,
              exchange: 'crypto',
              displaySymbol: displayName
            };
          }
        }
      }

      // Also check active zones (they might have display names not in managed pairs)
      const activeZones = await zoneManager.getAllActiveZones();
      for (const zone of activeZones) {
        const displayName = zoneManager.getDisplayName(zone.symbol, zone.exchange);
        
        if (matchesPair(displayName, zone.symbol, normalizedQuestion, upperQuestion, lowerQuestion)) {
          return {
            symbol: zone.symbol,
            exchange: zone.exchange,
            displaySymbol: displayName
          };
        }
      }

      return null;
    } catch (error) {
      logger.error('Error detecting monitored pair:', error.message);
      return null;
    }
  }

  /**
   * Extract symbol from user question (legacy method, kept for backward compatibility)
   */
  extractSymbol(question) {
    const upperQuestion = question.toUpperCase();

    // Crypto pairs (return as-is)
    const cryptoPairs = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'ADAUSDT', 'XRPUSDT'];
    for (const pair of cryptoPairs) {
      if (upperQuestion.includes(pair)) {
        return pair;
      }
    }

    // Forex pairs (need frx prefix for our system)
    const forexPairs = ['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD', 'XAUUSD'];
    for (const pair of forexPairs) {
      if (upperQuestion.includes(pair)) {
        return pair; // Return without frx prefix - APIs will handle it
      }
    }

    // Default to EURUSD if no pair found
    return 'EURUSD';
  }

  /**
   * Handle /getchatid command - helps users get their channel/group ID
   */
  async handleGetChatId(msg) {
    const chatId = msg.chat.id;
    const chatType = msg.chat.type;
    const chatTitle = msg.chat.title || msg.chat.first_name || 'Unknown';

    const message = `📋 <b>Chat Information</b>

<b>Chat ID:</b> <code>${chatId}</code>
<b>Chat Type:</b> ${chatType}
<b>Chat Name:</b> ${chatTitle}

<b>How to use this as broadcast channel:</b>
1. Copy the Chat ID above
2. Add it to your .env file:
   <code>BROADCAST_CHANNEL_ID=${chatId}</code>
3. Restart the bot
4. All signals will be sent here automatically!

<i>Note: Make sure the bot is added as an admin with "Post Messages" permission.</i>`;

    await this.bot.sendMessage(msg.chat.id, message, { parse_mode: 'HTML' });
    logger.info(`Sent chat ID to ${chatTitle}: ${chatId}`);
  }

  /**
   * Handle /entry command - Start monitoring a pair for entry signal
   * Usage: /entry eurusd or /entry eur/usd
   */
  async handleEntry(msg, symbolInput) {
    const chatId = msg.chat.id;
    
    try {
      // Normalize symbol input (remove spaces, handle / separator)
      let symbol = symbolInput.trim().toUpperCase().replace(/[\/\s]/g, '');
      
      // Try to find the symbol in active zones
      const allZones = await zoneManager.getAllActiveZones();
      let foundZone = null;
      let exchange = null;
      
      // Try exact match first
      for (const zone of allZones) {
        const zoneSymbol = zone.symbol.replace('frx', '').replace(/(.{3})(.{3})/, '$1$2');
        const zoneSymbolWithSlash = zone.symbol.replace('frx', '').replace(/(.{3})(.{3})/, '$1/$2');
        
        if (zone.symbol.toUpperCase() === symbol ||
            zoneSymbol.toUpperCase() === symbol ||
            zoneSymbolWithSlash.toUpperCase().replace(/\//g, '') === symbol) {
          foundZone = zone;
          exchange = zone.exchange;
          symbol = zone.symbol; // Use the exact symbol from zone
          break;
        }
      }
      
      // Try with frx prefix for forex
      if (!foundZone && !symbol.startsWith('FRX') && !symbol.startsWith('1HZ') && !symbol.startsWith('R_')) {
        if (symbol.length === 6 && /^[A-Z]{6}$/.test(symbol)) {
          const frxSymbol = 'FRX' + symbol;
          for (const zone of allZones) {
            if (zone.symbol.toUpperCase() === frxSymbol) {
              foundZone = zone;
              exchange = zone.exchange;
              symbol = zone.symbol;
              break;
            }
          }
        }
      }
      
      if (!foundZone) {
        await this.bot.sendMessage(chatId,
          `❌ No active zone found for ${symbolInput}.\n\n` +
          `Use /active_signals to see all available zones.`
        );
        return;
      }
      
      // Add to entry monitoring
      const result = await entryMonitor.addPair(
        symbol,
        exchange,
        foundZone.type, // 'discount' or 'premium'
        chatId
      );
      
      await this.bot.sendMessage(chatId, result.message, { parse_mode: 'HTML' });
      
    } catch (error) {
      logger.error('Error in /entry command:', error.message);
      await this.bot.sendMessage(chatId,
        `❌ Error: ${error.message}\n\n` +
        `Usage: /entry eurusd or /entry eur/usd\n` +
        `Make sure the pair has an active zone (use /active_signals to check).`
      );
    }
  }

  /**
   * Convert markdown to HTML for Telegram
   * Converts #### headers, **bold**, etc. to HTML equivalents
   */
  convertMarkdownToHtml(text) {
    if (!text) return '';

    let html = text;

    // First, un-escape any already-escaped HTML entities to normalize
    html = html
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');

    // Store existing valid HTML tags temporarily with unique placeholders
    const supportedTags = ['b', 'i', 'code', 'pre', 'a', 'blockquote', 'strong', 'em'];
    const tagPlaceholders = new Map();
    let placeholderIndex = 0;
    
    // Create a pattern to match all supported tags (opening and closing)
    const tagPattern = new RegExp(`<(/?)(${supportedTags.join('|')})(\\s[^>]*)?>`, 'gi');
    
    html = html.replace(tagPattern, (match, closingSlash, tagName, attrs) => {
      const placeholder = `__TAG_PLACEHOLDER_${placeholderIndex}__`;
      tagPlaceholders.set(placeholder, match);
      placeholderIndex++;
      return placeholder;
    });

    // Convert headers (####, ###, ##, #) to bold
    html = html.replace(/^####\s+(.+)$/gm, '<b>$1</b>');
    html = html.replace(/^###\s+(.+)$/gm, '<b>$1</b>');
    html = html.replace(/^##\s+(.+)$/gm, '<b>$1</b>');
    html = html.replace(/^#\s+(.+)$/gm, '<b>$1</b>');

    // Convert **bold** to <b>bold</b>
    html = html.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');

    // Convert *italic* to <i>italic</i> (but not if it's part of **bold**)
    html = html.replace(/(?<!\*)\*([^*]+?)\*(?!\*)/g, '<i>$1</i>');

    // Convert --- to line break
    html = html.replace(/^---$/gm, '\n');

    // Convert code blocks ```code``` to <code>code</code>
    html = html.replace(/```([^`]+)```/g, '<code>$1</code>');
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Clean up multiple newlines
    html = html.replace(/\n{3,}/g, '\n\n');

    // Now escape all HTML entities
    html = html
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // Restore supported tags (they're already properly formatted)
    tagPlaceholders.forEach((value, key) => {
      html = html.replace(key, value);
    });

    return html;
  }

  /**
   * Escape HTML to prevent Telegram parsing errors
   * Keeps only supported tags: <b>, <i>, <code>, <pre>, <a>, <blockquote>
   */
  escapeHtml(text) {
    if (!text) return '';

    // Escape all HTML first
    let escaped = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // Then un-escape supported tags
    const supportedTags = ['b', 'i', 'code', 'pre', 'a', 'blockquote', 'strong', 'em'];
    supportedTags.forEach(tag => {
      const openRegex = new RegExp(`&lt;${tag}(&gt;| [^&]*?&gt;)`, 'g');
      const closeRegex = new RegExp(`&lt;/${tag}&gt;`, 'g');
      escaped = escaped.replace(openRegex, `<${tag}$1`);
      escaped = escaped.replace(closeRegex, `</${tag}>`);
    });

    return escaped;
  }
}

export default new TelegramClient();
