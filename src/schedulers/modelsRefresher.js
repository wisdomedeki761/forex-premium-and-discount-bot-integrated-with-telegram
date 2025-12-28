import cron from 'node-cron';
import openRouterModelsClient from '../apis/openRouterModels.js';
import openRouterModelsDB from '../db/openRouterModels.js';
import logger from '../utils/logger.js';

/**
 * Models Refresher Scheduler
 * Updates OpenRouter free models weekly
 */
class ModelsRefresher {
  constructor() {
    this.isRefreshing = false;
  }

  /**
   * Start the weekly models refresh scheduler
   */
  start() {
    // Run immediately on startup if needed
    setTimeout(() => this.checkAndRefresh(), 30000); // 30 seconds after startup

    // Schedule to run every Sunday at 02:00 UTC (weekly)
    cron.schedule('0 2 * * 0', () => {
      this.refreshModels();
    });

    logger.success('Models refresher started (runs weekly on Sundays at 02:00 UTC)');
  }

  /**
   * Check if refresh is needed and refresh if so
   */
  async checkAndRefresh() {
    try {
      logger.info('🔍 Checking if models need refresh...');

      const needsRefresh = await openRouterModelsDB.needsRefresh();

      if (needsRefresh) {
        logger.info('📡 Models need refresh, starting refresh process...');
        await this.refreshModels();
      } else {
        logger.info('✅ Models are up to date');
      }

    } catch (error) {
      logger.error('Error checking models refresh:', error.message);
    }
  }

  /**
   * Refresh models from OpenRouter API
   */
  async refreshModels() {
    if (this.isRefreshing) {
      logger.warn('Models refresh already in progress, skipping');
      return;
    }

    this.isRefreshing = true;

    try {
      logger.info('🚀 Starting weekly models refresh...');

      // Step 1: Fetch free models from OpenRouter
      logger.info('📥 Fetching free models from OpenRouter...');
      const modelsData = await openRouterModelsClient.getFreeModels();

      if (!modelsData || modelsData.models.length === 0) {
        throw new Error('No free models received from OpenRouter');
      }

      logger.info(`📊 Received ${modelsData.freeCount} free models out of ${modelsData.totalCount} total`);

      // Step 2: Deactivate old models
      logger.info('🗑️ Deactivating old models...');
      const currentModelIds = modelsData.models.map(m => m.id);
      const deactivatedCount = await openRouterModelsDB.deactivateOldModels(currentModelIds);

      // Step 3: Store new models
      logger.info('💾 Storing updated models...');
      const storeResult = await openRouterModelsDB.storeFreeModels(modelsData);

      // Step 4: Clean up old inactive models
      logger.info('🧹 Cleaning up old inactive models...');
      const cleanedCount = await openRouterModelsDB.cleanupOldModels(90);

      // Step 5: Get final summary
      const summary = await openRouterModelsDB.getModelsSummary();

      logger.success(`✅ Models refresh completed successfully!`);
      logger.info(`📈 Summary: ${summary.active} active, ${summary.inactive} inactive (${summary.total} total)`);
      logger.info(`📊 Changes: +${storeResult.stored} new, -${deactivatedCount} deactivated, -${cleanedCount} cleaned`);

      // Log some new models for visibility
      if (modelsData.models.length > 0) {
        const newModels = modelsData.models.slice(0, 5).map(m => m.id);
        logger.info(`🆕 New free models: ${newModels.join(', ')}`);
      }

    } catch (error) {
      logger.error('❌ Models refresh failed:', error.message);

      // Try to get fallback info
      try {
        const summary = await openRouterModelsDB.getModelsSummary();
        logger.info(`📊 Current status: ${summary.active} active models available`);
      } catch (fallbackError) {
        logger.error('Could not get fallback status:', fallbackError.message);
      }

    } finally {
      this.isRefreshing = false;
    }
  }

  /**
   * Force refresh models (for manual triggering)
   */
  async forceRefresh() {
    logger.info('🔧 Force refreshing models...');
    await this.refreshModels();
  }

  /**
   * Get current models status
   */
  async getStatus() {
    try {
      const metadata = await openRouterModelsDB.getMetadata();
      const summary = await openRouterModelsDB.getModelsSummary();
      const needsRefresh = await openRouterModelsDB.needsRefresh();

      return {
        isRefreshing: this.isRefreshing,
        summary,
        lastFetched: metadata?.lastFetched || null,
        totalModels: metadata?.totalCount || 0,
        freeModels: metadata?.freeCount || 0,
        needsRefresh,
        nextRefresh: metadata?.lastFetched ?
          new Date(new Date(metadata.lastFetched).getTime() + (7 * 24 * 60 * 60 * 1000)).toISOString() :
          null
      };

    } catch (error) {
      logger.error('Error getting models status:', error.message);
      return {
        isRefreshing: this.isRefreshing,
        error: error.message
      };
    }
  }

  /**
   * Test the models refresh process
   */
  async testRefresh() {
    logger.info('🧪 Testing models refresh process...');

    try {
      // Check if API client is configured
      if (!openRouterModelsClient.isConfigured()) {
        throw new Error('OpenRouter API client not configured');
      }

      // Test API key
      const testResult = await openRouterModelsClient.testApiKey(openRouterModelsClient.apiKeys[0]);
      if (!testResult.valid) {
        throw new Error(`API key test failed: ${testResult.error}`);
      }

      logger.info('✅ API key is valid');

      // Do a quick fetch test
      const modelsData = await openRouterModelsClient.getFreeModels();
      logger.info(`✅ Successfully fetched ${modelsData.freeCount} free models`);

      return {
        success: true,
        freeModelsCount: modelsData.freeCount,
        totalModelsCount: modelsData.totalCount
      };

    } catch (error) {
      logger.error('❌ Models refresh test failed:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

export default new ModelsRefresher();
