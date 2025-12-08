import { getPairState, savePairState, getAllPairStates } from '../db/firestore.js';
import logger from './logger.js';

class StateManager {
  constructor() {
    this.cache = new Map(); // In-memory cache
  }

  /**
   * Load all states from Firestore
   */
  async loadStates() {
    try {
      const states = await getAllPairStates();
      for (const state of states) {
        this.cache.set(state.symbol, state);
      }
      logger.info(`Loaded ${this.cache.size} pair states from Firestore`);
    } catch (error) {
      logger.error('Failed to load states:', error.message);
    }
  }

  /**
   * Get state for a symbol
   */
  async getState(symbol) {
    // Check cache first
    if (this.cache.has(symbol)) {
      return this.cache.get(symbol);
    }

    // Load from Firestore
    const state = await getPairState(symbol);
    if (state) {
      this.cache.set(symbol, state);
    }
    return state;
  }

  /**
   * Set state for a symbol
   */
  async setState(symbol, state) {
    // Update cache
    this.cache.set(symbol, state);

    // Save to Firestore
    await savePairState(state);
  }

  /**
   * Create or update state
   */
  async updateState(symbol, exchange, updates) {
    let state = await this.getState(symbol);

    if (!state) {
      state = {
        symbol,
        exchange,
        state: 'idle',
        signalType: null,
        last15mEma38: 0,
        last15mEma62: 0,
        last15mStochK: 0,
        last1mEma38: 0,
        last1mEma62: 0,
        entryPrice: 0,
        signalId: null,
        enteredAt: null,
        sentAt: null,
        lastUpdateSent: null
      };
    }

    // Apply updates
    Object.assign(state, updates);
    state.updatedAt = Date.now();

    await this.setState(symbol, state);
    return state;
  }

  /**
   * Set waiting state
   */
  async setWaiting(symbol, exchange, signalType, ema38, ema62) {
    return await this.updateState(symbol, exchange, {
      state: 'waiting',
      signalType,
      last15mEma38: ema38,
      last15mEma62: ema62,
      enteredAt: Date.now()
    });
  }

  /**
   * Set active monitoring state
   */
  async setActive(symbol, signalId, entryPrice, signalType) {
    const state = await this.getState(symbol);
    return await this.updateState(symbol, state.exchange, {
      state: 'active',
      signalId,
      entryPrice,
      signalType,
      sentAt: Date.now(),
      lastUpdateSent: Date.now()
    });
  }

  /**
   * Reset to idle
   */
  async resetState(symbol) {
    const state = await this.getState(symbol);
    if (!state) return;

    return await this.updateState(symbol, state.exchange, {
      state: 'idle',
      signalType: null,
      entryPrice: 0,
      signalId: null,
      enteredAt: null,
      sentAt: null,
      lastUpdateSent: null
    });
  }

  /**
   * Get all pairs in waiting state
   */
  getWaitingPairs() {
    return Array.from(this.cache.values()).filter(s => s.state === 'waiting');
  }

  /**
   * Get all pairs in active state
   */
  getActivePairs() {
    return Array.from(this.cache.values()).filter(s => s.state === 'active');
  }

  /**
   * Get all cached states
   */
  getAllStates() {
    return Array.from(this.cache.values());
  }
}

export default new StateManager();
