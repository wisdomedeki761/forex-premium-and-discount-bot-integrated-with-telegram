import logger from '../utils/logger.js';
import zoneDataAggregator from '../utils/zoneDataAggregator.js';
import zoneAnalysisAI from '../apis/zoneAnalysisAI.js';
import zoneAnalysisManager from '../utils/zoneAnalysisManager.js';
import telegramBot from '../apis/telegram.js';
import aiClient from '../apis/ai.js';

/**
 * Zone Analysis Trigger
 * Monitors zone detections and triggers AI analysis when thresholds are met
 */
class ZoneAnalysisTrigger {
  constructor() {
    this.hourlyZoneCount = 0;
    this.detectedZones = [];
    this.lastResetTime = new Date();
    this.isAnalyzing = false;
    this.minZonesThreshold = 3; // Minimum zones to trigger analysis (> 2)
    this.maxAnalysesPerHour = 2; // Prevent spam analysis
    this.analysesThisHour = 0;
  }

  /**
   * Start the zone analysis trigger
   */
  async start() {
    logger.success('Zone analysis trigger started');
    logger.info(`📊 AI Analysis will trigger when ${this.minZonesThreshold}+ zones detected in an hour`);

    // Check if AI is configured
    try {
      const isConfigured = await aiClient.isConfigured();
      if (isConfigured) {
        logger.info('✅ AI client is configured and ready');
      } else {
        logger.warn('⚠️ AI client is NOT configured - check OPENROUTER_API_KEYS');
      }
    } catch (error) {
      logger.warn('⚠️ Could not check AI configuration:', error.message);
    }
  }

  /**
   * Manually trigger analysis (for testing)
   * Call this to force analysis with current zones or test zones
   */
  async manualTrigger(testZones = null) {
    if (testZones && testZones.length > 0) {
      logger.info(`🧪 Manual trigger with ${testZones.length} test zones`);
      this.detectedZones = testZones;
      this.hourlyZoneCount = testZones.length;
    }

    if (this.detectedZones.length === 0) {
      logger.warn('❌ Cannot manually trigger: no zones available');
      return null;
    }

    logger.info(`🧪 Manually triggering AI analysis with ${this.detectedZones.length} zones`);
    await this.triggerAnalysis();
    return this.getStatus();
  }

  /**
   * Record a zone detection
   */
  recordZoneDetection(zoneData) {
    try {
      const now = new Date();
      const hoursSinceReset = (now - this.lastResetTime) / (1000 * 60 * 60);

      // Reset counters every hour
      if (hoursSinceReset >= 1) {
        logger.info(`⏰ Hourly reset triggered (${hoursSinceReset.toFixed(2)} hours since last reset)`);
        this.resetHourlyCounters();
      }

      // Add zone to current hour's detections
      this.detectedZones.push({
        ...zoneData,
        detectedAt: now.toISOString(),
        hoursSinceReset
      });

      this.hourlyZoneCount++;

      logger.info(`📍 Zone recorded: ${zoneData.symbol} (${zoneData.type}) - Count: ${this.hourlyZoneCount}/${this.minZonesThreshold}`);

      // Check if we should trigger analysis
      if (this.shouldTriggerAnalysis()) {
        logger.info(`🚀 AI Analysis trigger threshold reached!`);
        this.triggerAnalysis();
      }

    } catch (error) {
      logger.error('Error recording zone detection:', error.message);
    }
  }

  /**
   * Check if analysis should be triggered
   */
  shouldTriggerAnalysis() {
    // Must have minimum zones (> 2 means >= 3)
    if (this.hourlyZoneCount < this.minZonesThreshold) {
      logger.info(`📊 Zone count: ${this.hourlyZoneCount}/${this.minZonesThreshold} (need ${this.minZonesThreshold} to trigger AI analysis)`);
      return false;
    }

    // Check analysis rate limit
    if (this.analysesThisHour >= this.maxAnalysesPerHour) {
      logger.warn(`Analysis rate limit reached (${this.analysesThisHour}/${this.maxAnalysesPerHour})`);
      return false;
    }

    // Don't trigger if already analyzing
    if (this.isAnalyzing) {
      logger.info('⏳ AI analysis already in progress, waiting...');
      return false;
    }

    // Get unique symbols for logging
    const uniqueSymbols = [...new Set(this.detectedZones.map(z => z.symbol))];
    logger.info(`✅ Trigger conditions met: ${this.hourlyZoneCount} zones detected (${uniqueSymbols.length} unique symbols)`);

    return true;
  }

  /**
   * Trigger AI analysis for detected zones
   */
  async triggerAnalysis() {
    if (this.isAnalyzing) {
      logger.warn('Analysis already in progress, skipping trigger');
      return;
    }

    this.isAnalyzing = true;
    this.analysesThisHour++;

    try {
      logger.info(`🎯 TRIGGERING AI ZONE ANALYSIS: ${this.hourlyZoneCount} zones detected`);
      logger.info(`📋 Zones to analyze: ${this.detectedZones.map(z => `${z.symbol}(${z.type})`).join(', ')}`);

      // Send initial notification
      await this.sendAnalysisStartedNotification();

      // Collect comprehensive data for each zone
      const zonesWithData = await this.prepareZonesForAnalysis();

      if (!zonesWithData || zonesWithData.length === 0) {
        logger.warn('❌ No zones prepared for analysis - aborting');
        await this.sendAnalysisErrorNotification('Failed to prepare zone data for analysis');
        return;
      }

      logger.info(`🤖 Sending ${zonesWithData.length} zones to AI for analysis...`);

      // Send to AI for analysis
      const analysisResult = await zoneAnalysisAI.analyzeZones(zonesWithData);

      if (analysisResult) {
        logger.info(`🎯 AI analysis complete! Got ${analysisResult.picks?.length || 0} picks`);

        try {
          // Store analysis result
          await zoneAnalysisManager.storeAnalysisResult(analysisResult);
          logger.info('✅ Analysis result stored successfully');
        } catch (error) {
          logger.warn('⚠️ Failed to store analysis result:', error.message);
          // Continue with sending the result - the analysis is still valuable
        }

        // Always try to send the result to subscribers
        try {
          await this.sendAnalysisResult(analysisResult);
          logger.info('✅ Analysis result sent to subscribers');
        } catch (error) {
          logger.error('❌ Failed to send analysis result to subscribers:', error.message);
        }
      } else {
        logger.error('❌ AI analysis returned no result');
        await this.sendAnalysisErrorNotification('AI analysis returned no result');
      }

    } catch (error) {
      logger.error('❌ Error in zone analysis:', error.message);
      logger.error(error.stack);

      // Send error notification
      await this.sendAnalysisErrorNotification(error.message);
    } finally {
      this.isAnalyzing = false;
    }
  }

  /**
   * Prepare zones with comprehensive data for AI analysis
   */
  async prepareZonesForAnalysis() {
    const zonesWithData = [];

    logger.info(`📦 Preparing data for ${this.detectedZones.length} detected zones...`);

    for (const zone of this.detectedZones) {
      try {
        logger.info(`  ➤ Aggregating data for ${zone.symbol} (${zone.type})...`);

        // Get comprehensive zone data
        const zoneData = await zoneDataAggregator.aggregateZoneData(zone);

        if (zoneData) {
          zonesWithData.push(zoneData);
          logger.info(`  ✓ ${zone.symbol} data ready`);
        } else {
          logger.warn(`  ✗ Failed to aggregate data for ${zone.symbol}`);
        }

      } catch (error) {
        logger.error(`  ✗ Error preparing zone data for ${zone.symbol}:`, error.message);
      }
    }

    logger.info(`📊 Prepared ${zonesWithData.length}/${this.detectedZones.length} zones for AI analysis`);
    return zonesWithData; // Always returns an array (may be empty)
  }

  /**
   * Send analysis started notification
   */
  async sendAnalysisStartedNotification() {
    try {
      const message = `🤖 <b>AI Zone Analysis Started</b>\n\n` +
                     `📊 Detected ${this.hourlyZoneCount} zones this hour\n` +
                     `🧠 Analyzing for highest probability setups...\n\n` +
                     `<i>This may take 30-60 seconds</i>`;

      await telegramBot.broadcastToSubscribers(message, { parse_mode: 'HTML' });
    } catch (error) {
      logger.error('Error sending analysis started notification:', error.message);
    }
  }

  /**
   * Send analysis result to subscribers
   */
  async sendAnalysisResult(analysisResult) {
    try {
      const message = this.formatAnalysisResult(analysisResult);
      await telegramBot.broadcastToSubscribers(message, { parse_mode: 'HTML' });
    } catch (error) {
      logger.error('Error sending analysis result:', error.message);
    }
  }

  /**
   * Send analysis error notification
   */
  async sendAnalysisErrorNotification(errorMessage) {
    try {
      const message = `⚠️ <b>AI Zone Analysis Error</b>\n\n` +
                     `❌ Analysis failed: ${errorMessage}\n` +
                     `📊 ${this.hourlyZoneCount} zones were detected but could not be analyzed\n\n` +
                     `<i>The bot will continue monitoring for new zones</i>`;

      await telegramBot.broadcastToSubscribers(message, { parse_mode: 'HTML' });
    } catch (error) {
      logger.error('Error sending analysis error notification:', error.message);
    }
  }

  /**
   * Format analysis result for Telegram
   */
  formatAnalysisResult(analysisResult) {
    let message = `🎯 <b>AI ZONE ANALYSIS RESULTS</b>\n\n`;
    message += `📊 Market Scan: ${this.hourlyZoneCount} zones detected\n`;
    message += `🤖 AI Analysis Complete\n\n`;

    // Add top picks
    if (analysisResult.picks && analysisResult.picks.length > 0) {
      analysisResult.picks.forEach((pick, index) => {
        const medal = index === 0 ? '🥇' : '🥈';
        const priority = index === 0 ? 'PRIMARY' : 'SECONDARY';

        message += `${medal} <b>${priority} PICK:</b> ${pick.symbol} (${pick.zoneType} Zone)\n`;
        message += `🎯 Probability: <b>${pick.probability}</b>\n`;
        message += `📈 Expected Move: ${pick.expectedMove}\n`;
        message += `⏱️ Timeframe: ${pick.timeframe}\n`;
        message += `💰 Entry: $${pick.entryPrice}\n`;
        if (pick.targetPrice) message += `🎯 Target: $${pick.targetPrice}\n`;
        if (pick.stopLoss) message += `🛑 Stop Loss: $${pick.stopLoss}\n`;
        message += `\n`;
      });
    }

    // Add analysis summary if available
    if (analysisResult.summary) {
      message += `📋 <b>ANALYSIS SUMMARY:</b>\n`;
      message += `${analysisResult.summary}\n\n`;
    }

    // Add risk factors if available
    if (analysisResult.riskFactors && analysisResult.riskFactors.length > 0) {
      message += `⚠️ <b>RISK FACTORS:</b>\n`;
      analysisResult.riskFactors.forEach(factor => {
        message += `• ${factor}\n`;
      });
      message += `\n`;
    }

    message += `---\n`;
    message += `⚠️ <i>This is AI analysis for educational purposes. Trade at your own risk.</i>`;

    return message;
  }

  /**
   * Reset hourly counters
   */
  resetHourlyCounters() {
    this.hourlyZoneCount = 0;
    this.detectedZones = [];
    this.analysesThisHour = 0;
    this.lastResetTime = new Date();

    logger.debug('Hourly zone counters reset');
  }

  /**
   * Get current status for monitoring
   */
  getStatus() {
    return {
      hourlyZoneCount: this.hourlyZoneCount,
      detectedZones: this.detectedZones.length,
      isAnalyzing: this.isAnalyzing,
      analysesThisHour: this.analysesThisHour,
      lastResetTime: this.lastResetTime.toISOString(),
      minZonesThreshold: this.minZonesThreshold
    };
  }
}

export default new ZoneAnalysisTrigger();
