import { getFirestore } from './firestore.js';
import logger from '../utils/logger.js';

/**
 * OpenRouter Models Database Manager
 * Handles storage and retrieval of OpenRouter models
 */
class OpenRouterModelsDB {
  constructor() {
    this.collection = 'openrouter_models';
    this.metadataCollection = 'openrouter_metadata';
  }

  /**
   * Store free models in database
   */
  async storeFreeModels(modelsData) {
    try {
      const db = getFirestore();
      const batch = db.batch();
      const timestamp = new Date().toISOString();

      // Store individual models
      modelsData.models.forEach(model => {
        // Create a valid Firestore document ID by hashing or encoding the model ID
        const sanitizedId = this.createValidDocumentId(model.id);
        const docRef = db.collection(this.collection).doc(sanitizedId);
        batch.set(docRef, {
          ...model,
          originalId: model.id, // Keep original ID for API calls
          documentId: sanitizedId, // Store sanitized ID
          lastUpdated: timestamp
        });
      });

      // Store metadata
      const metadataRef = db.collection(this.metadataCollection).doc('latest');
      batch.set(metadataRef, {
        totalCount: modelsData.totalCount,
        freeCount: modelsData.freeCount,
        lastFetched: modelsData.lastFetched,
        lastUpdated: timestamp,
        modelsSnapshot: modelsData.models.map(m => ({
          id: m.id,
          name: m.name,
          pricing: m.pricing,
          contextLength: m.contextLength
        }))
      });

      await batch.commit();

      logger.success(`Stored ${modelsData.freeCount} free models in database`);

      return {
        stored: modelsData.freeCount,
        total: modelsData.totalCount
      };

    } catch (error) {
      logger.error('Error storing free models:', error.message);
      throw error;
    }
  }

  /**
   * Get active free models from database
   */
  async getActiveFreeModels() {
    try {
      const db = getFirestore();

      // Get all active models (no ordering to avoid index requirement)
      const snapshot = await db.collection(this.collection)
        .where('isActive', '==', true)
        .get();

      if (snapshot.empty) {
        logger.warn('No active free models found in database');
        return [];
      }

      const models = [];
      snapshot.forEach(doc => {
        const data = doc.data();
        models.push({
          id: data.originalId || doc.id, // Use original ID for API calls
          ...data
        });
      });

      // Sort by lastUpdated in memory (most recent first)
      models.sort((a, b) => new Date(b.lastUpdated) - new Date(a.lastUpdated));

      logger.info(`Retrieved ${models.length} active free models from database`);
      return models;

    } catch (error) {
      logger.error('Error getting active free models:', error.message);
      return [];
    }
  }

  /**
   * Get model by ID (sanitized for Firestore)
   */
  async getModelById(modelId) {
    try {
      const db = getFirestore();
      // Sanitize the ID for Firestore lookup using the same method
      const sanitizedId = this.createValidDocumentId(modelId);
      const docRef = db.collection(this.collection).doc(sanitizedId);
      const doc = await docRef.get();

      if (!doc.exists) {
        return null;
      }

      const data = doc.data();
      return {
        id: data.originalId || modelId, // Return original ID for API calls
        ...data
      };

    } catch (error) {
      logger.error(`Error getting model ${modelId}:`, error.message);
      return null;
    }
  }

  /**
   * Deactivate old models (when refreshing)
   */
  async deactivateOldModels(currentModelIds) {
    try {
      const db = getFirestore();

      // Get all currently active models
      const snapshot = await db.collection(this.collection)
        .where('isActive', '==', true)
        .get();

      if (snapshot.empty) {
        return 0;
      }

      const batch = db.batch();
      let deactivatedCount = 0;

      snapshot.forEach(doc => {
        // If model is not in current list, deactivate it
        if (!currentModelIds.includes(doc.id)) {
          batch.update(doc.ref, {
            isActive: false,
            deactivatedAt: new Date().toISOString()
          });
          deactivatedCount++;
        }
      });

      if (deactivatedCount > 0) {
        await batch.commit();
        logger.info(`Deactivated ${deactivatedCount} old models`);
      }

      return deactivatedCount;

    } catch (error) {
      logger.error('Error deactivating old models:', error.message);
      return 0;
    }
  }

  /**
   * Get metadata about last fetch
   */
  async getMetadata() {
    try {
      const db = getFirestore();
      const docRef = db.collection(this.metadataCollection).doc('latest');
      const doc = await docRef.get();

      if (!doc.exists) {
        return null;
      }

      return doc.data();

    } catch (error) {
      logger.error('Error getting models metadata:', error.message);
      return null;
    }
  }

  /**
   * Check if models need refresh (older than 7 days)
   */
  async needsRefresh() {
    try {
      const metadata = await this.getMetadata();

      if (!metadata || !metadata.lastFetched) {
        return true; // No data, needs refresh
      }

      const lastFetched = new Date(metadata.lastFetched);
      const now = new Date();
      const daysSinceFetch = (now - lastFetched) / (1000 * 60 * 60 * 24);

      const needsRefresh = daysSinceFetch >= 7; // Refresh weekly

      if (needsRefresh) {
        logger.info(`Models last fetched ${daysSinceFetch.toFixed(1)} days ago, needs refresh`);
      }

      return needsRefresh;

    } catch (error) {
      logger.error('Error checking if models need refresh:', error.message);
      return true; // Error, assume needs refresh
    }
  }

  /**
   * Get models count summary
   */
  async getModelsSummary() {
    try {
      const db = getFirestore();

      const [activeSnapshot, allSnapshot] = await Promise.all([
        db.collection(this.collection).where('isActive', '==', true).get(),
        db.collection(this.collection).get()
      ]);

      return {
        active: activeSnapshot.size,
        total: allSnapshot.size,
        inactive: allSnapshot.size - activeSnapshot.size
      };

    } catch (error) {
      logger.error('Error getting models summary:', error.message);
      return { active: 0, total: 0, inactive: 0 };
    }
  }

  /**
   * Clean up old inactive models (older than 90 days)
   */
  async cleanupOldModels(maxAgeDays = 90) {
    try {
      const db = getFirestore();
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - maxAgeDays);

      const snapshot = await db.collection(this.collection)
        .where('isActive', '==', false)
        .where('deactivatedAt', '<', cutoffDate.toISOString())
        .get();

      if (snapshot.empty) {
        return 0;
      }

      const batch = db.batch();
      snapshot.docs.forEach(doc => {
        batch.delete(doc.ref);
      });

      await batch.commit();

      logger.info(`Cleaned up ${snapshot.size} old inactive models`);
      return snapshot.size;

    } catch (error) {
      logger.error('Error cleaning up old models:', error.message);
      return 0;
    }
  }

  /**
   * Get random active models for AI rotation
   */
  async getRandomActiveModels(count = 5) {
    try {
      const activeModels = await this.getActiveFreeModels();

      if (activeModels.length === 0) {
        return [];
      }

      // Shuffle and return requested count
      const shuffled = activeModels.sort(() => 0.5 - Math.random());
      const selected = shuffled.slice(0, Math.min(count, activeModels.length));

      logger.debug(`Selected ${selected.length} random models for AI rotation`);
      return selected;

    } catch (error) {
      logger.error('Error getting random active models:', error.message);
      return [];
    }
  }

  /**
   * Create a valid Firestore document ID from model ID
   */
  createValidDocumentId(modelId) {
    // Replace invalid characters with safe alternatives
    let sanitized = modelId
      .replace(/\//g, '_slash_')    // Replace / with _slash_
      .replace(/:/g, '_colon_')    // Replace : with _colon_
      .replace(/\./g, '_dot_')     // Replace . with _dot_
      .replace(/-/g, '_dash_')     // Replace - with _dash_
      .replace(/[^a-zA-Z0-9_]/g, '_') // Replace any other invalid chars with _
      .replace(/^_+/, '')          // Remove leading underscores
      .replace(/_+$/, '');         // Remove trailing underscores

    // Ensure it's not empty and doesn't start with problematic patterns
    if (!sanitized || sanitized.length === 0) {
      sanitized = 'model_' + Math.random().toString(36).substr(2, 9);
    }

    // Limit length to 1500 characters (Firestore limit)
    if (sanitized.length > 1500) {
      sanitized = sanitized.substring(0, 1490) + '_truncated';
    }

    return sanitized;
  }
}

export default new OpenRouterModelsDB();
