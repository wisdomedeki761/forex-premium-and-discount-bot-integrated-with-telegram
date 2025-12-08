import cron from 'node-cron';
import binanceClient from '../apis/binance.js';
import bybitClient from '../apis/bybit.js';
import derivClient from '../apis/deriv.js';
import { saveCandles, getManagedPairs } from '../db/firestore.js';
import zoneManager from '../utils/zoneManager.js';
import premiumDiscountCalculator from '../indicators/premiumDiscountCalculator.js';
import config from '../config.js';
import logger from '../utils/logger.js';
import trendingScanner from './trendingScanner.js';
import telegramBot from '../apis/telegram.js';

/**
 * Premium/Discount Zone Scanner
 * Runs every hour to detect zones on 1-hour timeframe
 */
class ZoneScanner {
  /**
   * Start the 1-hour zone scanner
   */
  start() {
    // Run immediately on startup
    setTimeout(() => this.scan(), 10000);

    // Schedule to run every hour at minute 0
    cron.schedule('0 * * * *', () => {
      this.scan();
    });

    logger.success('1-hour zone scanner started (runs every hour)');
  }

  /**
   * Scan all pairs for premium/discount zones
   */
  async scan() {
    try {
      logger.info('🔍 Running 1-hour zone scan...');

      // Get managed pairs from Firestore
      const managedPairs = await getManagedPairs();

      // Get trending crypto pairs (if no custom crypto pairs configured)
      let cryptoPairs = [];
      if (managedPairs.cryptoPairs && managedPairs.cryptoPairs.length > 0) {
        // Custom pairs - default to Binance
        cryptoPairs = managedPairs.cryptoPairs.map(s => ({ symbol: s, exchange: 'binance' }));
      } else {
        // Get trending pairs with exchange info
        const trendingPairs = trendingScanner.getActiveCryptoPairs();
        cryptoPairs = trendingPairs; // Already has { symbol, exchange } structure
      }

      // Get forex/deriv pairs from Firestore or fallback to config
      const forexPairs = (managedPairs.forexPairs && managedPairs.forexPairs.length > 0)
        ? managedPairs.forexPairs
        : config.trading.forexPairs || [];

      const derivPairs = (managedPairs.derivPairs && managedPairs.derivPairs.length > 0)
        ? managedPairs.derivPairs
        : config.trading.derivPairs || [];

      const allPairs = [
        ...cryptoPairs, // Already has exchange info
        ...forexPairs.map(s => ({ symbol: s, exchange: 'forex' })),
        ...derivPairs.map(s => ({ symbol: s, exchange: 'deriv' }))
      ];

      logger.info(`Scanning ${allPairs.length} pairs for 1h zones`);

      // Collect all newly detected zones during this scan
      const newZones = {
        forex: [],
        deriv: [],
        crypto: []
      };

      let zonesDetected = 0;

      for (const { symbol, exchange } of allPairs) {
        try {
          const result = await this.scanPair(symbol, exchange, newZones);
          if (result) zonesDetected++;
        } catch (error) {
          logger.error(`Error scanning ${symbol}:`, error.message);
        }
      }

      // Get all active zones (including existing ones) and send consolidated message
      await this.sendConsolidatedZoneMessage(newZones);

      logger.success(`1h zone scan completed: ${zonesDetected} zones detected`);
    } catch (error) {
      logger.error('Error in 1h zone scan:', error.message);
    }
  }

  /**
   * Scan individual pair for premium/discount zones
   */
  async scanPair(symbol, exchange, newZones) {
    try {
      // Get 1-hour candles (need at least 100 for cascading EMAs)
      let candles;
      if (exchange === 'binance') {
        candles = await binanceClient.getKlines(symbol, '1h', 200);
      } else if (exchange === 'bybit') {
        candles = await bybitClient.getKlines(symbol, '60', 200);
      } else if (exchange === 'deriv' || exchange === 'forex') {
        candles = await derivClient.getCandles(symbol, 3600, 200); // 3600s = 1h
      }

      if (!candles || candles.length < 100) {
        logger.debug(`Not enough 1h candles for ${symbol}`);
        return false;
      }

      // Save candles
      await saveCandles(symbol, '1h', candles);

      // Calculate indicators
      const indicators = premiumDiscountCalculator.calculate(candles);
      if (!indicators) {
        logger.debug(`Cannot calculate indicators for ${symbol}`);
        return false;
      }

      // Get current zone status
      const currentZone = await zoneManager.getActiveZone(symbol);
      const currentPrice = candles[candles.length - 1].close;

      // Get zone status
      const zoneStatus = premiumDiscountCalculator.getZoneStatus(indicators);

      // If there's an active zone, check if it's still valid
      if (currentZone) {
        return await this.validateZone(symbol, exchange, indicators, currentZone, currentPrice);
      }

      // Check for new discount zone
      if (zoneStatus.type === 'discount') {
        logger.info(`🟢 DISCOUNT ZONE detected for ${symbol}: Price=${currentPrice.toFixed(5)}, Stoch=${indicators.stochK.toFixed(2)}`);

        await zoneManager.createZone(symbol, exchange, {
          type: 'discount',
          price: currentPrice,
          ema20: indicators.ema20,
          ema38: indicators.ema38,
          ema62: indicators.ema62,
          stochK: indicators.stochK,
          timestamp: new Date().toISOString()
        });

        // Collect zone data instead of sending immediately
        const displaySymbol = zoneManager.getDisplayName(symbol, exchange);
        if (exchange === 'forex') {
          newZones.forex.push({ symbol, displaySymbol, type: 'discount', price: currentPrice });
        } else if (exchange === 'deriv') {
          newZones.deriv.push({ symbol, displaySymbol, type: 'discount', price: currentPrice });
        } else {
          newZones.crypto.push({ symbol, displaySymbol, type: 'discount', price: currentPrice });
        }

        return true;
      }

      // Check for new premium zone
      if (zoneStatus.type === 'premium') {
        logger.info(`🔴 PREMIUM ZONE detected for ${symbol}: Price=${currentPrice.toFixed(5)}, Stoch=${indicators.stochK.toFixed(2)}`);

        await zoneManager.createZone(symbol, exchange, {
          type: 'premium',
          price: currentPrice,
          ema20: indicators.ema20,
          ema38: indicators.ema38,
          ema62: indicators.ema62,
          stochK: indicators.stochK,
          timestamp: new Date().toISOString()
        });

        // Collect zone data instead of sending immediately
        const displaySymbol = zoneManager.getDisplayName(symbol, exchange);
        if (exchange === 'forex') {
          newZones.forex.push({ symbol, displaySymbol, type: 'premium', price: currentPrice });
        } else if (exchange === 'deriv') {
          newZones.deriv.push({ symbol, displaySymbol, type: 'premium', price: currentPrice });
        } else {
          newZones.crypto.push({ symbol, displaySymbol, type: 'premium', price: currentPrice });
        }

        return true;
      }

      return false;
    } catch (error) {
      logger.error(`Error in scanPair for ${symbol}:`, error.message);
      return false;
    }
  }

  /**
   * Validate existing zone
   */
  async validateZone(symbol, exchange, indicators, zone, currentPrice) {
    const zoneType = zone.type;

    // Check if EMAs have crossed (zone invalidated)
    let emaValid = false;
    if (zoneType === 'discount') {
      emaValid = premiumDiscountCalculator.isDiscountZoneValid(indicators);
    } else if (zoneType === 'premium') {
      emaValid = premiumDiscountCalculator.isPremiumZoneValid(indicators);
    }

    if (!emaValid) {
      logger.warn(`⚠️ ${zoneType.toUpperCase()} zone for ${symbol} invalidated: EMA cross detected`);
      await zoneManager.expireZone(symbol, 'EMA cross');
      return false;
    }

    // Check if Stochastic has crossed back
    const previousStochK = zone.stochK;
    const currentStochK = indicators.stochK;

    const stochCrossed = premiumDiscountCalculator.hasStochCrossedBack(
      currentStochK,
      previousStochK,
      zoneType
    );

    if (stochCrossed) {
      logger.info(`📊 ${zoneType.toUpperCase()} zone for ${symbol} expired: Stochastic crossed back`);
      await zoneManager.expireZone(symbol, 'Stochastic cross');
      return false;
    }

    // Update zone with latest Stochastic value
    await zoneManager.updateZone(symbol, {
      stochK: currentStochK,
      lastChecked: new Date().toISOString()
    });

    return true;
  }

  /**
   * Format and send consolidated zone message
   */
  async sendConsolidatedZoneMessage(newZones) {
    try {
      // Get all active zones from database (including existing ones)
      const allActiveZones = await zoneManager.getAllActiveZones();

      // Group all active zones by exchange type
      const allZones = {
        forex: [],
        deriv: [],
        crypto: []
      };

      // Process all active zones
      for (const zone of allActiveZones) {
        const displaySymbol = zoneManager.getDisplayName(zone.symbol, zone.exchange);
        const zoneData = {
          symbol: zone.symbol,
          displaySymbol,
          type: zone.type,
          price: zone.price
        };

        if (zone.exchange === 'forex') {
          allZones.forex.push(zoneData);
        } else if (zone.exchange === 'deriv') {
          allZones.deriv.push(zoneData);
        } else {
          // crypto or kraken
          allZones.crypto.push(zoneData);
        }
      }

      // Only send message if there are any active zones
      const totalZones = allZones.forex.length + allZones.deriv.length + allZones.crypto.length;
      if (totalZones === 0) {
        logger.debug('No active zones to report');
        return;
      }

      const now = new Date();
      const timeString = now.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });

      let message = `<blockquote>\n`;
      message += `TIME ${timeString}\n\n`;
      message += `<b>AVAILABLE ZONES</b>\n\n`;

      // Helper function to format zones by type (Discount first, then Premium)
      const formatZonesByType = (zones, isDeriv = false) => {
        const discountZones = zones.filter(z => z.type === 'discount');
        const premiumZones = zones.filter(z => z.type === 'premium');
        let section = '';

        // Add Discount zones first
        discountZones.forEach(zone => {
          const zoneLabel = isDeriv ? 'DISCOUNT' : 'DISCOUNT ZONE';
          section += `🟢 ${zoneLabel}: ${zone.displaySymbol} @ ${zone.price.toFixed(5)}\n`;
        });

        // Add Premium zones second
        premiumZones.forEach(zone => {
          const zoneLabel = isDeriv ? 'PREMIUM ZONE' : 'PREMIUM ZONE';
          section += `🔴 ${zoneLabel}: ${zone.displaySymbol} @ ${zone.price.toFixed(5)}\n`;
        });

        return section;
      };

      // Format Forex zones
      if (allZones.forex.length > 0) {
        message += `===========\n`;
        message += `FOREX\n`;
        message += `===========\n`;
        message += formatZonesByType(allZones.forex, false);
        message += `\n`;
      }

      // Format Deriv/Synthetic zones
      if (allZones.deriv.length > 0) {
        message += `===========\n`;
        message += `DERIV/SYNTHETIC PAIRS\n`;
        message += `===========\n`;
        message += formatZonesByType(allZones.deriv, true);
        message += `\n`;
      }

      // Format Crypto zones
      if (allZones.crypto.length > 0) {
        message += `===========\n`;
        message += `CRYPTO PAIRS\n`;
        message += `===========\n`;
        message += formatZonesByType(allZones.crypto, false);
        message += `\n`;
      }

      message += `</blockquote>`;

      // Send consolidated message to all subscribers
      await telegramBot.broadcastToSubscribers(message, { parse_mode: 'HTML' });

      logger.success(`Consolidated zone message sent with ${totalZones} active zones`);
    } catch (error) {
      logger.error(`Error sending consolidated zone message:`, error.message);
    }
  }
}

export default new ZoneScanner();
