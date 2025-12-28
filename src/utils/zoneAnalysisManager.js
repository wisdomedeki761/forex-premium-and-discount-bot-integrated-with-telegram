import { getFirestore, initializeFirestore } from '../db/firestore.js';
import logger from './logger.js';

/**
 * Zone Analysis Manager
 * Coordinates zone analysis workflow and stores results
 */
class ZoneAnalysisManager {
  constructor() {
    this.collection = 'zone_analyses';
    this.resultsCollection = 'zone_analysis_results';
    this.performanceCollection = 'zone_performance_tracking';
    this.firestoreInitialized = false;
  }

  /**
   * Ensure Firestore is initialized
   */
  async ensureFirestoreInitialized() {
    if (!this.firestoreInitialized) {
      try {
        await initializeFirestore();
        this.firestoreInitialized = true;
        logger.debug('Firestore initialized for zone analysis manager');
      } catch (error) {
        logger.error('Failed to initialize Firestore:', error.message);
        throw error;
      }
    }
    return getFirestore();
  }

  /**
   * Get Firestore database instance (with initialization check)
   */
  async getDb() {
    return await this.ensureFirestoreInitialized();
  }

  /**
   * Store analysis result
   */
  async storeAnalysisResult(analysisResult) {
    try {
      const db = await this.getDb();
      const timestamp = new Date().toISOString();

      // Store main analysis record
      const analysisDoc = {
        timestamp,
        zoneCount: analysisResult.zoneCount || 0,
        picksCount: analysisResult.picks?.length || 0,
        picks: analysisResult.picks || [],
        summary: analysisResult.summary || '',
        riskFactors: analysisResult.riskFactors || [],
        insights: analysisResult.insights || [],
        isFallback: analysisResult.isFallback || false,
        status: 'active' // Will be updated when picks are resolved
      };

      const docRef = await db.collection(this.collection).add(analysisDoc);
      const analysisId = docRef.id;

      logger.info(`Stored zone analysis ${analysisId} with ${analysisDoc.picksCount} picks`);

      // Store individual pick results for tracking
      if (analysisResult.picks && analysisResult.picks.length > 0) {
        const batch = db.batch();

        analysisResult.picks.forEach((pick, index) => {
          const pickDoc = {
            analysisId,
            timestamp,
            symbol: pick.symbol,
            zoneType: pick.zoneType,
            probability: pick.probability,
            expectedMove: pick.expectedMove,
            timeframe: pick.timeframe,
            entryPrice: pick.entryPrice,
            targetPrice: pick.targetPrice || null,
            aggressiveTarget: pick.aggressiveTarget || null,
            stopLoss: pick.stopLoss || null,
            pickOrder: index + 1, // 1 = primary, 2 = secondary
            status: 'pending', // pending -> triggered -> completed/expired
            outcome: null, // win/loss/breakeven
            actualMove: null,
            actualTimeframe: null,
            pnlPercent: null,
            triggeredAt: null,
            completedAt: null,
            notes: analysisResult.isFallback ? 'Fallback analysis' : null
          };

          const pickRef = db.collection(this.resultsCollection).doc();
          batch.set(pickRef, pickDoc);
        });

        await batch.commit();
        logger.info(`Stored ${analysisResult.picks.length} individual pick results`);
      }

      return analysisId;

    } catch (error) {
      logger.error('Error storing analysis result:', error.message);
      throw error;
    }
  }

  /**
   * Update pick status when it triggers
   */
  async updatePickTriggered(symbol, entryPrice, actualEntryPrice = null) {
    try {
      const db = await this.getDb();

      // Find the most recent pending pick for this symbol
      const snapshot = await db.collection(this.resultsCollection)
        .where('symbol', '==', symbol)
        .where('status', '==', 'pending')
        .orderBy('timestamp', 'desc')
        .limit(1)
        .get();

      if (snapshot.empty) {
        logger.debug(`No pending pick found for ${symbol}`);
        return false;
      }

      const pickDoc = snapshot.docs[0];
      const pickData = pickDoc.data();

      // Check if entry price is within reasonable range of predicted entry
      const entryDiff = Math.abs((actualEntryPrice || entryPrice) - pickData.entryPrice) / pickData.entryPrice;
      if (entryDiff > 0.001) { // 0.1% tolerance
        logger.debug(`Entry price difference too large for ${symbol}: ${entryDiff.toFixed(4)}`);
        return false;
      }

      await pickDoc.ref.update({
        status: 'triggered',
        triggeredAt: new Date().toISOString(),
        actualEntryPrice: actualEntryPrice || entryPrice,
        notes: pickData.notes ? `${pickData.notes} | Triggered at ${entryPrice}` : `Triggered at ${entryPrice}`
      });

      logger.info(`Updated pick status for ${symbol}: pending → triggered`);
      return true;

    } catch (error) {
      logger.error(`Error updating pick triggered for ${symbol}:`, error.message);
      return false;
    }
  }

  /**
   * Update pick outcome when it completes
   */
  async updatePickCompleted(symbol, outcome, pnlPercent = null, actualMove = null, actualTimeframe = null) {
    try {
      const db = await this.getDb();

      // Find the most recent triggered pick for this symbol
      const snapshot = await db.collection(this.resultsCollection)
        .where('symbol', '==', symbol)
        .where('status', '==', 'triggered')
        .orderBy('timestamp', 'desc')
        .limit(1)
        .get();

      if (snapshot.empty) {
        logger.debug(`No triggered pick found for ${symbol}`);
        return false;
      }

      const pickDoc = snapshot.docs[0];
      const updateData = {
        status: 'completed',
        completedAt: new Date().toISOString(),
        outcome,
        pnlPercent,
        actualMove,
        actualTimeframe
      };

      await pickDoc.ref.update(updateData);

      // Update performance tracking
      await this.updatePerformanceTracking(pickDoc.data(), outcome, pnlPercent);

      logger.info(`Updated pick outcome for ${symbol}: ${outcome}${pnlPercent ? ` (${pnlPercent}%)` : ''}`);
      return true;

    } catch (error) {
      logger.error(`Error updating pick completed for ${symbol}:`, error.message);
      return false;
    }
  }

  /**
   * Update performance tracking
   */
  async updatePerformanceTracking(pickData, outcome, pnlPercent) {
    try {
      const db = await this.getDb();
      const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

      // Get or create today's performance record
      const performanceRef = db.collection(this.performanceCollection).doc(today);
      const performanceDoc = await performanceRef.get();

      let performanceData = performanceDoc.exists ? performanceDoc.data() : {
        date: today,
        totalAnalyses: 0,
        totalPicks: 0,
        completedPicks: 0,
        winCount: 0,
        lossCount: 0,
        breakevenCount: 0,
        totalPnL: 0,
        avgWinPercent: 0,
        avgLossPercent: 0,
        winRate: 0,
        avgTimeframe: 0,
        byProbability: {
          HIGH: { count: 0, wins: 0, avgPnL: 0 },
          MEDIUM: { count: 0, wins: 0, avgPnL: 0 },
          LOW: { count: 0, wins: 0, avgPnL: 0 }
        },
        byZoneType: {
          discount: { count: 0, wins: 0, avgPnL: 0 },
          premium: { count: 0, wins: 0, avgPnL: 0 }
        }
      };

      // Update counters
      performanceData.completedPicks++;

      if (outcome === 'win') {
        performanceData.winCount++;
        performanceData.totalPnL += pnlPercent || 0;
      } else if (outcome === 'loss') {
        performanceData.lossCount++;
        performanceData.totalPnL += pnlPercent || 0;
      } else if (outcome === 'breakeven') {
        performanceData.breakevenCount++;
      }

      // Update probability stats
      const prob = pickData.probability;
      if (performanceData.byProbability[prob]) {
        performanceData.byProbability[prob].count++;
        if (outcome === 'win') {
          performanceData.byProbability[prob].wins++;
          performanceData.byProbability[prob].avgPnL =
            (performanceData.byProbability[prob].avgPnL * (performanceData.byProbability[prob].wins - 1) + (pnlPercent || 0)) /
            performanceData.byProbability[prob].wins;
        }
      }

      // Update zone type stats
      const zoneType = pickData.zoneType;
      if (performanceData.byZoneType[zoneType]) {
        performanceData.byZoneType[zoneType].count++;
        if (outcome === 'win') {
          performanceData.byZoneType[zoneType].wins++;
          performanceData.byZoneType[zoneType].avgPnL =
            (performanceData.byZoneType[zoneType].avgPnL * (performanceData.byZoneType[zoneType].wins - 1) + (pnlPercent || 0)) /
            performanceData.byZoneType[zoneType].wins;
        }
      }

      // Calculate derived metrics
      const totalTrades = performanceData.winCount + performanceData.lossCount + performanceData.breakevenCount;
      if (totalTrades > 0) {
        performanceData.winRate = (performanceData.winCount / totalTrades) * 100;

        if (performanceData.winCount > 0) {
          // Calculate average win (simplified - would need more complex logic for real avg)
          performanceData.avgWinPercent = performanceData.totalPnL / performanceData.winCount;
        }
      }

      await performanceRef.set(performanceData);

      logger.debug(`Updated performance tracking for ${today}`);

    } catch (error) {
      logger.error('Error updating performance tracking:', error.message);
    }
  }

  /**
   * Expire old pending picks
   */
  async expireOldPicks(maxAgeHours = 24) {
    try {
      const db = await this.getDb();
      const cutoffTime = new Date();
      cutoffTime.setHours(cutoffTime.getHours() - maxAgeHours);

      const snapshot = await db.collection(this.resultsCollection)
        .where('status', '==', 'pending')
        .where('timestamp', '<', cutoffTime.toISOString())
        .get();

      if (snapshot.empty) {
        return 0;
      }

      const batch = db.batch();
      snapshot.docs.forEach(doc => {
        batch.update(doc.ref, {
          status: 'expired',
          completedAt: new Date().toISOString(),
          outcome: 'expired',
          notes: doc.data().notes ? `${doc.data().notes} | Expired after ${maxAgeHours}h` : `Expired after ${maxAgeHours}h`
        });
      });

      await batch.commit();

      logger.info(`Expired ${snapshot.size} old pending picks`);
      return snapshot.size;

    } catch (error) {
      logger.error('Error expiring old picks:', error.message);
      return 0;
    }
  }

  /**
   * Get recent analysis results
   */
  async getRecentAnalyses(limit = 10) {
    try {
      const db = await this.getDb();

      const snapshot = await db.collection(this.collection)
        .orderBy('timestamp', 'desc')
        .limit(limit)
        .get();

      if (snapshot.empty) {
        return [];
      }

      const analyses = [];
      snapshot.forEach(doc => {
        analyses.push({
          id: doc.id,
          ...doc.data()
        });
      });

      return analyses;

    } catch (error) {
      logger.error('Error getting recent analyses:', error.message);
      return [];
    }
  }

  /**
   * Get performance statistics
   */
  async getPerformanceStats(days = 30) {
    try {
      const db = await this.getDb();
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);

      const snapshot = await db.collection(this.performanceCollection)
        .where('date', '>=', cutoffDate.toISOString().split('T')[0])
        .orderBy('date', 'desc')
        .get();

      if (snapshot.empty) {
        return null;
      }

      // Aggregate stats across the period
      const aggregatedStats = {
        period: `${days} days`,
        totalAnalyses: 0,
        totalPicks: 0,
        completedPicks: 0,
        winCount: 0,
        lossCount: 0,
        breakevenCount: 0,
        totalPnL: 0,
        winRate: 0,
        avgWinPercent: 0,
        avgLossPercent: 0,
        byProbability: {
          HIGH: { count: 0, wins: 0, avgPnL: 0, winRate: 0 },
          MEDIUM: { count: 0, wins: 0, avgPnL: 0, winRate: 0 },
          LOW: { count: 0, wins: 0, avgPnL: 0, winRate: 0 }
        },
        byZoneType: {
          discount: { count: 0, wins: 0, avgPnL: 0, winRate: 0 },
          premium: { count: 0, wins: 0, avgPnL: 0, winRate: 0 }
        }
      };

      snapshot.forEach(doc => {
        const data = doc.data();
        aggregatedStats.totalAnalyses += data.totalAnalyses || 0;
        aggregatedStats.totalPicks += data.totalPicks || 0;
        aggregatedStats.completedPicks += data.completedPicks || 0;
        aggregatedStats.winCount += data.winCount || 0;
        aggregatedStats.lossCount += data.lossCount || 0;
        aggregatedStats.breakevenCount += data.breakevenCount || 0;
        aggregatedStats.totalPnL += data.totalPnL || 0;

        // Aggregate by probability
        Object.keys(aggregatedStats.byProbability).forEach(prob => {
          if (data.byProbability && data.byProbability[prob]) {
            aggregatedStats.byProbability[prob].count += data.byProbability[prob].count || 0;
            aggregatedStats.byProbability[prob].wins += data.byProbability[prob].wins || 0;
            // Note: avgPnL aggregation would need more complex logic
          }
        });

        // Aggregate by zone type
        Object.keys(aggregatedStats.byZoneType).forEach(type => {
          if (data.byZoneType && data.byZoneType[type]) {
            aggregatedStats.byZoneType[type].count += data.byZoneType[type].count || 0;
            aggregatedStats.byZoneType[type].wins += data.byZoneType[type].wins || 0;
          }
        });
      });

      // Calculate final metrics
      const totalTrades = aggregatedStats.winCount + aggregatedStats.lossCount + aggregatedStats.breakevenCount;
      if (totalTrades > 0) {
        aggregatedStats.winRate = (aggregatedStats.winCount / totalTrades) * 100;

        if (aggregatedStats.winCount > 0) {
          aggregatedStats.avgWinPercent = aggregatedStats.totalPnL / aggregatedStats.winCount;
        }
      }

      // Calculate win rates by category
      Object.keys(aggregatedStats.byProbability).forEach(prob => {
        const probData = aggregatedStats.byProbability[prob];
        if (probData.count > 0) {
          probData.winRate = (probData.wins / probData.count) * 100;
        }
      });

      Object.keys(aggregatedStats.byZoneType).forEach(type => {
        const typeData = aggregatedStats.byZoneType[type];
        if (typeData.count > 0) {
          typeData.winRate = (typeData.wins / typeData.count) * 100;
        }
      });

      return aggregatedStats;

    } catch (error) {
      logger.error('Error getting performance stats:', error.message);
      return null;
    }
  }

  /**
   * Clean up old analysis records
   */
  async cleanupOldRecords(maxAgeDays = 90) {
    try {
      const db = await this.getDb();
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - maxAgeDays);

      const collections = [this.collection, this.resultsCollection];

      for (const collection of collections) {
        const snapshot = await db.collection(collection)
          .where('timestamp', '<', cutoffDate.toISOString())
          .get();

        if (!snapshot.empty) {
          const batch = db.batch();
          snapshot.docs.forEach(doc => {
            batch.delete(doc.ref);
          });
          await batch.commit();
          logger.info(`Cleaned up ${snapshot.size} old records from ${collection}`);
        }
      }

    } catch (error) {
      logger.error('Error cleaning up old records:', error.message);
    }
  }
}

export default new ZoneAnalysisManager();
