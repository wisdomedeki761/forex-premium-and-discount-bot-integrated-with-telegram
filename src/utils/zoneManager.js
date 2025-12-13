import { getFirestore } from '../db/firestore.js';
import logger from './logger.js';

/**
 * Zone Manager
 * Manages premium/discount zones in Firestore
 */
class ZoneManager {
  constructor() {
    this.collection = 'zones';
    this.derivDisplayNames = {}; // Cache for Deriv display names
  }

  /**
   * Update Deriv display names cache from API
   */
  updateDerivDisplayNames(pairs) {
    if (pairs && pairs.all) {
      pairs.all.forEach(pair => {
        if (pair.symbol && pair.displayName) {
          this.derivDisplayNames[pair.symbol] = pair.displayName;
        }
      });
    }
  }

  /**
   * Get display name for a symbol
   */
  getDisplayName(symbol, exchange) {
    if (exchange === 'forex') {
      return symbol.replace('frx', '').replace(/(.{3})(.{3})/, '$1/$2');
    } else if (exchange === 'deriv') {
      return this.derivDisplayNames[symbol] || symbol;
    } else if (exchange === 'kraken') {
      return symbol.replace('USDT', '/USDT');
    }
    return symbol;
  }

  /**
   * Get Firestore database instance
   */
  getDb() {
    return getFirestore();
  }

  /**
   * Create a new zone
   */
  async createZone(symbol, exchange, zoneData) {
    try {
      const db = this.getDb();
      const docRef = db.collection(this.collection).doc(symbol);

      const zone = {
        symbol,
        exchange,
        type: zoneData.type, // 'discount' or 'premium'
        price: zoneData.price,
        ema20: zoneData.ema20,
        ema38: zoneData.ema38,
        ema62: zoneData.ema62,
        stochK: zoneData.stochK,
        status: 'active',
        createdAt: new Date().toISOString(),
        lastChecked: new Date().toISOString(),
        expiredAt: null,
        expireReason: null
      };

      await docRef.set(zone);

      logger.info(`Zone created for ${symbol}: ${zoneData.type}`);
      return zone;
    } catch (error) {
      logger.error(`Error creating zone for ${symbol}:`, error.message);
      throw error;
    }
  }

  /**
   * Get active zone for a symbol
   */
  async getActiveZone(symbol) {
    try {
      const db = this.getDb();
      const docRef = db.collection(this.collection).doc(symbol);
      const doc = await docRef.get();

      if (!doc.exists) {
        return null;
      }

      const zone = doc.data();

      // Only return if status is active
      if (zone.status === 'active') {
        return zone;
      }

      return null;
    } catch (error) {
      logger.error(`Error getting zone for ${symbol}:`, error.message);
      return null;
    }
  }

  /**
   * Update zone data
   */
  async updateZone(symbol, updates) {
    try {
      const db = this.getDb();
      const docRef = db.collection(this.collection).doc(symbol);

      await docRef.update({
        ...updates,
        lastChecked: new Date().toISOString()
      });

      logger.debug(`Zone updated for ${symbol}`);
      return true;
    } catch (error) {
      logger.error(`Error updating zone for ${symbol}:`, error.message);
      return false;
    }
  }

  /**
   * Expire a zone (move to history)
   */
  async expireZone(symbol, reason) {
    try {
      const db = this.getDb();
      const docRef = db.collection(this.collection).doc(symbol);
      const doc = await docRef.get();

      if (!doc.exists) {
        return false;
      }

      const zone = doc.data();

      // Move to history collection
      const historyRef = db.collection('zone_history').doc();
      await historyRef.set({
        ...zone,
        status: 'expired',
        expiredAt: new Date().toISOString(),
        expireReason: reason
      });

      // Delete from active zones
      await docRef.delete();

      logger.info(`Zone expired for ${symbol}: ${reason}`);
      return true;
    } catch (error) {
      logger.error(`Error expiring zone for ${symbol}:`, error.message);
      return false;
    }
  }

  /**
   * Check if a zone was recently expired (within last hour)
   * Prevents immediate reactivation after expiration
   */
  async wasRecentlyExpired(symbol, hoursAgo = 1) {
    try {
      const db = this.getDb();
      const cutoffTime = new Date();
      cutoffTime.setHours(cutoffTime.getHours() - hoursAgo);

      const snapshot = await db.collection('zone_history')
        .where('symbol', '==', symbol)
        .where('expiredAt', '>=', cutoffTime.toISOString())
        .orderBy('expiredAt', 'desc')
        .limit(1)
        .get();

      return !snapshot.empty;
    } catch (error) {
      logger.error(`Error checking recent expiration for ${symbol}:`, error.message);
      return false;
    }
  }

  /**
   * Get all active zones
   */
  async getAllActiveZones() {
    try {
      const db = this.getDb();
      const snapshot = await db.collection(this.collection)
        .where('status', '==', 'active')
        .get();

      if (snapshot.empty) {
        return [];
      }

      const zones = [];
      snapshot.forEach(doc => {
        zones.push({
          id: doc.id,
          ...doc.data()
        });
      });

      return zones;
    } catch (error) {
      logger.error('Error getting all active zones:', error.message);
      return [];
    }
  }

  /**
   * Get zone history for today
   */
  async getTodayHistory() {
    try {
      const db = this.getDb();
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayISO = today.toISOString();

      const snapshot = await db.collection('zone_history')
        .where('createdAt', '>=', todayISO)
        .orderBy('createdAt', 'desc')
        .get();

      if (snapshot.empty) {
        return [];
      }

      const history = [];
      snapshot.forEach(doc => {
        history.push({
          id: doc.id,
          ...doc.data()
        });
      });

      return history;
    } catch (error) {
      logger.error('Error getting zone history:', error.message);
      return [];
    }
  }

  /**
   * Get zones by exchange type
   */
  async getZonesByExchange(exchange) {
    try {
      const db = this.getDb();
      const snapshot = await db.collection(this.collection)
        .where('exchange', '==', exchange)
        .where('status', '==', 'active')
        .get();

      if (snapshot.empty) {
        return [];
      }

      const zones = [];
      snapshot.forEach(doc => {
        zones.push({
          id: doc.id,
          ...doc.data()
        });
      });

      return zones;
    } catch (error) {
      logger.error(`Error getting zones for ${exchange}:`, error.message);
      return [];
    }
  }

  /**
   * Delete all zones (cleanup utility)
   */
  async deleteAllZones() {
    try {
      const db = this.getDb();
      const snapshot = await db.collection(this.collection).get();

      const batch = db.batch();
      snapshot.docs.forEach(doc => {
        batch.delete(doc.ref);
      });

      await batch.commit();

      logger.info(`Deleted ${snapshot.size} zones`);
      return true;
    } catch (error) {
      logger.error('Error deleting all zones:', error.message);
      return false;
    }
  }
}

export default new ZoneManager();
