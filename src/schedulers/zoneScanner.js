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

      // Track validated zones (zones that were successfully checked this scan)
      const validatedZones = {
        forex: [],
        deriv: [],
        crypto: []
      };

      let zonesDetected = 0;

      for (const { symbol, exchange } of allPairs) {
        try {
          const result = await this.scanPair(symbol, exchange, newZones, validatedZones);
          if (result) zonesDetected++;
        } catch (error) {
          logger.error(`Error scanning ${symbol}:`, error.message);
        }
      }

      // Only send message with zones that were successfully validated this scan
      await this.sendConsolidatedZoneMessage(validatedZones);

      logger.success(`1h zone scan completed: ${zonesDetected} zones detected`);
    } catch (error) {
      logger.error('Error in 1h zone scan:', error.message);
    }
  }

  /**
   * Scan individual pair for premium/discount zones
   */
  async scanPair(symbol, exchange, newZones, validatedZones) {
    try {
      // FIRST: Check if there's an active zone and if it's expired (>24 hours)
      // Use UTC time directly - this ensures zones expire even if candlestick API fails
      const currentZone = await zoneManager.getActiveZone(symbol);
      if (currentZone) {
        const createdAt = new Date(currentZone.createdAt);
        const now = new Date(); // Current UTC time
        const hoursSinceCreation = (now - createdAt) / (1000 * 60 * 60);
        
        if (hoursSinceCreation >= 24) {
          logger.info(`⏰ ${currentZone.type.toUpperCase()} zone for ${symbol} expired: 24 hours elapsed (UTC time check)`);
          await zoneManager.expireZone(symbol, '24 hour expiration');
          return false; // Zone expired, no need to fetch candles
        }
      }

      // NOW proceed to get candlestick data (only if zone hasn't expired)
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
        
        // If there's an active zone but we can't validate it, expire it
        if (currentZone) {
          logger.warn(`⚠️ Cannot validate zone for ${symbol}: insufficient candlestick data. Expiring zone.`);
          await zoneManager.expireZone(symbol, 'Cannot validate: insufficient candlestick data');
        }
        
        return false;
      }

      // Save candles
      await saveCandles(symbol, '1h', candles);

      // Calculate indicators
      const indicators = premiumDiscountCalculator.calculate(candles);
      if (!indicators) {
        logger.debug(`Cannot calculate indicators for ${symbol}`);
        
        // If there's an active zone but we can't calculate indicators, expire it
        if (currentZone) {
          logger.warn(`⚠️ Cannot validate zone for ${symbol}: cannot calculate indicators. Expiring zone.`);
          await zoneManager.expireZone(symbol, 'Cannot validate: cannot calculate indicators');
        }
        
        return false;
      }

      const currentPrice = candles[candles.length - 1].close;

      // Get zone status
      const zoneStatus = premiumDiscountCalculator.getZoneStatus(indicators);

      // If there's an active zone, validate it (24-hour check already done above using UTC)
      if (currentZone) {
        const isValid = await this.validateZone(symbol, exchange, indicators, currentZone, currentPrice);
        
        // If zone is still valid, add it to validated zones list
        if (isValid) {
          const displaySymbol = zoneManager.getDisplayName(symbol, exchange);
          const zoneData = {
            symbol,
            displaySymbol,
            type: currentZone.type,
            price: currentZone.price
          };
          
          if (exchange === 'forex') {
            validatedZones.forex.push(zoneData);
          } else if (exchange === 'deriv') {
            validatedZones.deriv.push(zoneData);
          } else {
            validatedZones.crypto.push(zoneData);
          }
        }
        
        return isValid;
      }

      // Check if zone was recently expired (within last hour) - prevent immediate reactivation
      const recentlyExpired = await zoneManager.wasRecentlyExpired(symbol, 1);
      if (recentlyExpired) {
        logger.debug(`Skipping ${symbol}: Zone was recently expired, waiting before reactivation`);
        return false;
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

        // Collect zone data for new zones
        const displaySymbol = zoneManager.getDisplayName(symbol, exchange);
        const zoneData = { symbol, displaySymbol, type: 'discount', price: currentPrice };
        
        if (exchange === 'forex') {
          newZones.forex.push(zoneData);
          validatedZones.forex.push(zoneData);
        } else if (exchange === 'deriv') {
          newZones.deriv.push(zoneData);
          validatedZones.deriv.push(zoneData);
        } else {
          newZones.crypto.push(zoneData);
          validatedZones.crypto.push(zoneData);
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

        // Collect zone data for new zones
        const displaySymbol = zoneManager.getDisplayName(symbol, exchange);
        const zoneData = { symbol, displaySymbol, type: 'premium', price: currentPrice };
        
        if (exchange === 'forex') {
          newZones.forex.push(zoneData);
          validatedZones.forex.push(zoneData);
        } else if (exchange === 'deriv') {
          newZones.deriv.push(zoneData);
          validatedZones.deriv.push(zoneData);
        } else {
          newZones.crypto.push(zoneData);
          validatedZones.crypto.push(zoneData);
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

    // NOTE: 24-hour expiration check is now done in scanPair() BEFORE getting candles
    // using UTC time directly, so zones expire even when candlestick data is unavailable

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
   * Only displays zones that were successfully validated in the current scan
   */
  async sendConsolidatedZoneMessage(validatedZones) {
    try {
      // Use only validated zones (zones that were successfully checked this scan)
      const allZones = validatedZones;

      // Only send message if there are any validated zones
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
