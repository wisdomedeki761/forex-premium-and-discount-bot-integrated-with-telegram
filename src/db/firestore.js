import admin from 'firebase-admin';
import { readFileSync } from 'fs';
import config from '../config.js';
import logger from '../utils/logger.js';

let db = null;

export async function initializeFirestore() {
  try {
    let credential;

    // Try loading from file first
    if (config.firebase.keyPath) {
      try {
        const serviceAccount = JSON.parse(readFileSync(config.firebase.keyPath, 'utf8'));
        credential = admin.credential.cert(serviceAccount);
        logger.info('Loaded Firebase credentials from file');
      } catch (err) {
        logger.warn('Could not load Firebase key from file, trying env vars');
      }
    }

    // Fall back to env vars
    if (!credential) {
      credential = admin.credential.cert({
        projectId: config.firebase.projectId,
        privateKey: config.firebase.privateKey,
        clientEmail: config.firebase.clientEmail
      });
    }

    admin.initializeApp({
      credential,
      databaseURL: `https://${config.firebase.projectId}.firebaseio.com`
    });

    db = admin.firestore();
    logger.success('Connected to Firestore');
    return db;
  } catch (error) {
    logger.error('Failed to initialize Firestore:', error.message);
    throw error;
  }
}

export function getFirestore() {
  if (!db) {
    throw new Error('Firestore not initialized. Call initializeFirestore() first.');
  }
  return db;
}

// Collection names
export const COLLECTIONS = {
  CANDLES: 'candles',
  PAIR_STATES: 'pair_states',
  SIGNALS: 'signals',
  TRENDING_PAIRS: 'trending_pairs',
  MANAGED_PAIRS: 'managed_pairs',
  ENTRY_SIGNALS: 'entry_signals'
};

// Candle operations
export async function saveCandles(symbol, timeframe, candles) {
  const docId = `${symbol}_${timeframe}`;
  const docRef = db.collection(COLLECTIONS.CANDLES).doc(docId);

  await docRef.set({
    symbol,
    timeframe,
    candles: candles.slice(-1000), // Keep last 1000
    lastFetchTime: Date.now(),
    updatedAt: Date.now()
  });
}

export async function getCandles(symbol, timeframe) {
  const docId = `${symbol}_${timeframe}`;
  const doc = await db.collection(COLLECTIONS.CANDLES).doc(docId).get();

  if (!doc.exists) return null;
  return doc.data();
}

export async function addCandle(symbol, timeframe, candle) {
  const docId = `${symbol}_${timeframe}`;
  const docRef = db.collection(COLLECTIONS.CANDLES).doc(docId);

  const doc = await docRef.get();
  let candles = [];

  if (doc.exists) {
    candles = doc.data().candles || [];
  }

  candles.push(candle);

  // Keep only last 1000 candles
  if (candles.length > 1000) {
    candles = candles.slice(-1000);
  }

  await docRef.set({
    symbol,
    timeframe,
    candles,
    lastFetchTime: Date.now(),
    updatedAt: Date.now()
  });
}

// Pair state operations
export async function savePairState(state) {
  await db.collection(COLLECTIONS.PAIR_STATES).doc(state.symbol).set({
    ...state,
    updatedAt: Date.now()
  });
}

export async function getPairState(symbol) {
  const doc = await db.collection(COLLECTIONS.PAIR_STATES).doc(symbol).get();
  if (!doc.exists) return null;
  return doc.data();
}

export async function getAllPairStates() {
  const snapshot = await db.collection(COLLECTIONS.PAIR_STATES).get();
  return snapshot.docs.map(doc => doc.data());
}

// Signal operations
export async function saveSignal(signal) {
  const docId = `signal_${signal.id}_${signal.sentAt}`;
  await db.collection(COLLECTIONS.SIGNALS).doc(docId).set(signal);
}

export async function getActiveSignals() {
  const snapshot = await db.collection(COLLECTIONS.SIGNALS)
    .where('status', '==', 'active')
    .get();

  return snapshot.docs.map(doc => doc.data());
}

// Trending pairs operations
export async function saveTrendingPairs(date, trendingData) {
  await db.collection(COLLECTIONS.TRENDING_PAIRS).doc(date).set({
    ...trendingData,
    lastScanTime: Date.now()
  });
}

export async function getTrendingPairs(date) {
  const doc = await db.collection(COLLECTIONS.TRENDING_PAIRS).doc(date).get();
  if (!doc.exists) return null;
  return doc.data();
}

// Managed pairs operations
export async function getManagedPairs() {
  const doc = await db.collection(COLLECTIONS.MANAGED_PAIRS).doc('config').get();
  if (!doc.exists) {
    // Return default configuration
    return {
      forexPairs: [],
      derivPairs: [],
      cryptoPairs: []
    };
  }
  return doc.data();
}

export async function saveManagedPairs(pairsConfig) {
  await db.collection(COLLECTIONS.MANAGED_PAIRS).doc('config').set({
    ...pairsConfig,
    updatedAt: Date.now()
  });
}

export async function addManagedPair(exchange, symbol) {
  const config = await getManagedPairs();

  if (exchange === 'forex') {
    if (!config.forexPairs.includes(symbol)) {
      config.forexPairs.push(symbol);
    }
  } else if (exchange === 'deriv') {
    if (!config.derivPairs.includes(symbol)) {
      config.derivPairs.push(symbol);
    }
  } else if (exchange === 'kraken') {
    if (!config.cryptoPairs.includes(symbol)) {
      config.cryptoPairs.push(symbol);
    }
  }

  await saveManagedPairs(config);
}

export async function removeManagedPair(exchange, symbol) {
  const config = await getManagedPairs();

  if (exchange === 'forex') {
    config.forexPairs = config.forexPairs.filter(p => p !== symbol);
  } else if (exchange === 'deriv') {
    config.derivPairs = config.derivPairs.filter(p => p !== symbol);
  } else if (exchange === 'kraken') {
    config.cryptoPairs = config.cryptoPairs.filter(p => p !== symbol);
  }

  await saveManagedPairs(config);
}

// News notifications tracking
export async function markEventNotified(eventId, eventTime) {
  await db.collection('news_notifications').doc(eventId).set({
    eventId,
    notifiedAt: new Date().toISOString(),
    eventTime,
    notified: true
  });
}

export async function isEventNotified(eventId) {
  const doc = await db.collection('news_notifications').doc(eventId).get();
  return doc.exists && doc.data().notified === true;
}

export async function getNotifiedEventsToday() {
  const today = new Date().toISOString().split('T')[0];
  const snapshot = await db.collection('news_notifications')
    .where('eventTime', '>=', today)
    .get();
  
  const notifiedIds = new Set();
  snapshot.forEach(doc => {
    notifiedIds.add(doc.data().eventId);
  });
  
  return notifiedIds;
}

export async function clearOldNotifications(daysToKeep = 7) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
  
  const snapshot = await db.collection('news_notifications')
    .where('eventTime', '<', cutoffDate.toISOString().split('T')[0])
    .get();
  
  const batch = db.batch();
  snapshot.docs.forEach(doc => {
    batch.delete(doc.ref);
  });
  
  await batch.commit();
  logger.info(`Cleared ${snapshot.size} old news notifications`);
}

// Entry signal operations
export async function saveEntrySignal(signal) {
  const docId = `entry_${signal.id}_${Date.now()}`;
  await db.collection(COLLECTIONS.ENTRY_SIGNALS).doc(docId).set({
    ...signal,
    updatedAt: Date.now()
  });
}

export async function getEntrySignal(signalId) {
  const snapshot = await db.collection(COLLECTIONS.ENTRY_SIGNALS)
    .where('id', '==', signalId)
    .limit(1)
    .get();
  
  if (snapshot.empty) {
    return null;
  }
  
  return snapshot.docs[0].data();
}

export async function getAllEntrySignals(limit = 100) {
  const snapshot = await db.collection(COLLECTIONS.ENTRY_SIGNALS)
    .orderBy('createdAt', 'desc')
    .limit(limit)
    .get();
  
  return snapshot.docs.map(doc => doc.data());
}

export async function getNextSignalId() {
  try {
    // Get the highest signal ID
    const snapshot = await db.collection(COLLECTIONS.ENTRY_SIGNALS)
      .orderBy('id', 'desc')
      .limit(1)
      .get();
    
    if (snapshot.empty) {
      return 1; // First signal
    }
    
    const lastSignal = snapshot.docs[0].data();
    return (lastSignal.id || 0) + 1;
  } catch (error) {
    logger.error('Error getting next signal ID:', error.message);
    // Fallback: use timestamp-based ID
    return Math.floor(Date.now() / 1000) % 1000000;
  }
}

export async function updateEntrySignal(signalId, updates) {
  const snapshot = await db.collection(COLLECTIONS.ENTRY_SIGNALS)
    .where('id', '==', signalId)
    .limit(1)
    .get();
  
  if (snapshot.empty) {
    return false;
  }
  
  await snapshot.docs[0].ref.update({
    ...updates,
    updatedAt: Date.now()
  });
  
  return true;
}

export default {
  initializeFirestore,
  getFirestore,
  saveCandles,
  getCandles,
  addCandle,
  savePairState,
  getPairState,
  getAllPairStates,
  saveSignal,
  getActiveSignals,
  saveTrendingPairs,
  getTrendingPairs,
  getManagedPairs,
  saveManagedPairs,
  addManagedPair,
  removeManagedPair,
  markEventNotified,
  isEventNotified,
  getNotifiedEventsToday,
  clearOldNotifications,
  saveEntrySignal,
  getEntrySignal,
  getAllEntrySignals,
  getNextSignalId,
  updateEntrySignal
};
