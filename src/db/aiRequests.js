import { getFirestore } from './firestore.js';
import logger from '../utils/logger.js';
import config from '../config.js';

const COLLECTION_AI_REQUESTS = 'ai_requests';
const MAX_DAILY_REQUESTS = 3;

/**
 * Check if user can make an AI request
 */
export async function canMakeRequest(chatId, userId) {
  // Owner has unlimited requests (check by userId, not chatId for groups)
  const ownerChatId = config.telegram.ownerChatId;
  if (ownerChatId && String(userId) === String(ownerChatId)) {
    return { allowed: true, remaining: 'unlimited', reason: 'owner' };
  }

  const db = getFirestore();
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const docId = `${chatId}_${today}`;

  try {
    const doc = await db.collection(COLLECTION_AI_REQUESTS).doc(docId).get();

    if (!doc.exists) {
      // First request of the day
      return { allowed: true, remaining: MAX_DAILY_REQUESTS - 1, reason: 'new_day' };
    }

    const data = doc.data();
    const count = data.count || 0;

    if (count >= MAX_DAILY_REQUESTS) {
      return {
        allowed: false,
        remaining: 0,
        reason: 'limit_exceeded',
        resetTime: getResetTime()
      };
    }

    return {
      allowed: true,
      remaining: MAX_DAILY_REQUESTS - count - 1,
      reason: 'within_limit'
    };

  } catch (error) {
    logger.error('Error checking AI request limit:', error.message);
    // Allow request if error (fail open)
    return { allowed: true, remaining: 'unknown', reason: 'error' };
  }
}

/**
 * Log an AI request
 */
export async function logRequest(chatId, userId, question, model, responseLength) {
  const db = getFirestore();
  const today = new Date().toISOString().split('T')[0];
  const docId = `${chatId}_${today}`;

  try {
    const docRef = db.collection(COLLECTION_AI_REQUESTS).doc(docId);
    const doc = await docRef.get();

    const requestLog = {
      timestamp: Date.now(),
      question: question.substring(0, 200), // Truncate long questions
      model,
      responseLength
    };

    if (!doc.exists) {
      // Create new document
      await docRef.set({
        chatId,
        userId,
        date: today,
        count: 1,
        requests: [requestLog],
        firstRequestAt: Date.now(),
        lastRequestAt: Date.now()
      });
    } else {
      // Update existing document
      const data = doc.data();
      const requests = data.requests || [];
      requests.push(requestLog);

      await docRef.update({
        count: (data.count || 0) + 1,
        requests,
        lastRequestAt: Date.now()
      });
    }

    logger.info(`Logged AI request for chat ${chatId}`);
  } catch (error) {
    logger.error('Error logging AI request:', error.message);
  }
}

/**
 * Get user's request stats for today
 */
export async function getRequestStats(chatId) {
  const db = getFirestore();
  const today = new Date().toISOString().split('T')[0];
  const docId = `${chatId}_${today}`;

  try {
    const doc = await db.collection(COLLECTION_AI_REQUESTS).doc(docId).get();

    if (!doc.exists) {
      return {
        count: 0,
        remaining: MAX_DAILY_REQUESTS,
        requests: []
      };
    }

    const data = doc.data();
    return {
      count: data.count || 0,
      remaining: Math.max(0, MAX_DAILY_REQUESTS - (data.count || 0)),
      requests: data.requests || [],
      firstRequestAt: data.firstRequestAt,
      lastRequestAt: data.lastRequestAt
    };

  } catch (error) {
    logger.error('Error getting request stats:', error.message);
    return null;
  }
}

/**
 * Get reset time (next UTC midnight)
 */
function getResetTime() {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  tomorrow.setUTCHours(0, 0, 0, 0);

  const hoursUntilReset = Math.floor((tomorrow - now) / (1000 * 60 * 60));
  const minutesUntilReset = Math.floor(((tomorrow - now) % (1000 * 60 * 60)) / (1000 * 60));

  return `${hoursUntilReset}h ${minutesUntilReset}m`;
}

/**
 * Check if user is owner (by userId)
 */
export function isOwner(userId) {
  const ownerChatId = config.telegram.ownerChatId;
  return ownerChatId && String(userId) === String(ownerChatId);
}

export default {
  canMakeRequest,
  logRequest,
  getRequestStats,
  isOwner
};
