import axios from 'axios';
import config from '../config.js';
import logger from '../utils/logger.js';

/**
 * OpenRouter Models API Client
 * Fetches and manages available models from OpenRouter
 */
class OpenRouterModelsClient {
  constructor() {
    this.apiKeys = config.openRouter.apiKeys || [];
    this.modelsEndpoint = 'https://openrouter.ai/api/v1/models';
    this.cache = new Map();
    this.cacheTTL = 24 * 60 * 60 * 1000; // 24 hours cache
  }

  /**
   * Fetch all available models from OpenRouter
   */
  async fetchAllModels() {
    if (this.apiKeys.length === 0) {
      throw new Error('No OpenRouter API keys configured');
    }

    // Check cache first
    const cacheKey = 'all_models';
    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey);
      if (Date.now() - cached.timestamp < this.cacheTTL) {
        logger.debug('Using cached models data');
        return cached.data;
      }
    }

    // Try each API key until one works
    for (const apiKey of this.apiKeys) {
      try {
        logger.info('Fetching models from OpenRouter...');

        const response = await axios.get(this.modelsEndpoint, {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 30000
        });

        if (response.data && response.data.data) {
          const models = response.data.data;

          // Cache the result
          this.cache.set(cacheKey, {
            data: models,
            timestamp: Date.now()
          });

          logger.success(`Fetched ${models.length} models from OpenRouter`);
          return models;
        } else {
          throw new Error('Invalid response structure from OpenRouter');
        }

      } catch (error) {
        logger.warn(`Failed to fetch models with API key: ${error.message}`);
        continue; // Try next API key
      }
    }

    throw new Error('All API keys failed to fetch models from OpenRouter');
  }

  /**
   * Filter models to get only free ones
   */
  filterFreeModels(allModels) {
    const freeModels = allModels.filter(model => {
      // Check if model ID contains ":free"
      const isFree = model.id && model.id.includes(':free');

      // Additional checks for validity
      const hasPricing = model.pricing && typeof model.pricing.prompt === 'string';
      const hasContext = typeof model.context_length === 'number' && model.context_length > 0;

      return isFree && hasPricing && hasContext;
    });

    logger.info(`Filtered ${freeModels.length} free models from ${allModels.length} total models`);

    // Log some examples
    if (freeModels.length > 0) {
      const examples = freeModels.slice(0, 3).map(m => m.id);
      logger.info(`Free model examples: ${examples.join(', ')}`);
    }

    return freeModels;
  }

  /**
   * Get formatted model data for storage
   */
  formatModelsForStorage(models) {
    return models.map(model => ({
      id: model.id,
      name: model.name || model.id,
      pricing: {
        prompt: parseFloat(model.pricing.prompt) || 0,
        completion: parseFloat(model.pricing.completion) || 0
      },
      contextLength: model.context_length || 4096,
      architecture: model.architecture || {},
      supportedParameters: model.supported_parameters || [],
      topProvider: model.top_provider || {},
      modality: model.architecture?.modality || 'text->text',
      isActive: true,
      lastUpdated: new Date().toISOString(),
      fetchedAt: new Date().toISOString()
    }));
  }

  /**
   * Get free models (fetch and filter)
   */
  async getFreeModels() {
    try {
      const allModels = await this.fetchAllModels();
      const freeModels = this.filterFreeModels(allModels);
      const formattedModels = this.formatModelsForStorage(freeModels);

      return {
        models: formattedModels,
        totalCount: allModels.length,
        freeCount: freeModels.length,
        lastFetched: new Date().toISOString()
      };

    } catch (error) {
      logger.error('Error getting free models:', error.message);
      throw error;
    }
  }

  /**
   * Test API key validity
   */
  async testApiKey(apiKey) {
    try {
      const response = await axios.get(this.modelsEndpoint, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000
      });

      return {
        valid: true,
        modelCount: response.data?.data?.length || 0
      };

    } catch (error) {
      return {
        valid: false,
        error: error.message
      };
    }
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.cache.clear();
    logger.debug('Models cache cleared');
  }

  /**
   * Check if API keys are configured
   */
  isConfigured() {
    return this.apiKeys.length > 0;
  }
}

export default new OpenRouterModelsClient();
