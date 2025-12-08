import { getFirestore } from './firestore.js';
import logger from '../utils/logger.js';

const COLLECTION_SUBSCRIPTIONS = 'subscriptions';

/**
 * Add a subscription (group or channel)
 */
export async function addSubscription(chatId, chatTitle, chatType) {
  const db = getFirestore();

  await db.collection(COLLECTION_SUBSCRIPTIONS).doc(String(chatId)).set({
    chatId,
    chatTitle,
    chatType, // 'group', 'channel', or 'private'
    subscribedAt: Date.now(),
    active: true
  });

  logger.success(`Added subscription: ${chatTitle} (${chatId})`);
}

/**
 * Remove a subscription
 */
export async function removeSubscription(chatId) {
  const db = getFirestore();

  await db.collection(COLLECTION_SUBSCRIPTIONS).doc(String(chatId)).update({
    active: false,
    unsubscribedAt: Date.now()
  });

  logger.info(`Removed subscription: ${chatId}`);
}

/**
 * Get all active subscriptions
 */
export async function getActiveSubscriptions() {
  const db = getFirestore();

  const snapshot = await db.collection(COLLECTION_SUBSCRIPTIONS)
    .where('active', '==', true)
    .get();

  return snapshot.docs.map(doc => doc.data());
}

/**
 * Check if chat is subscribed
 */
export async function isSubscribed(chatId) {
  const db = getFirestore();

  const doc = await db.collection(COLLECTION_SUBSCRIPTIONS).doc(String(chatId)).get();

  if (!doc.exists) return false;

  const data = doc.data();
  return data.active === true;
}

export default {
  addSubscription,
  removeSubscription,
  getActiveSubscriptions,
  isSubscribed
};
