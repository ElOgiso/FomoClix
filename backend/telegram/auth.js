/**
 * Isolated Telegram Authentication & Session Layer (CommonJS)
 * Maps Telegram chat IDs to user wallet addresses and backend configuration settings.
 * Single source of truth is the backend service layer and persistent Firestore collection 'telegramSessions'.
 */

const { db } = require('../db');

const userSessions = new Map();
let backendServicesRef = null;
let isInitialized = false;

// Async helper to save session to Firestore dedicated collection 'telegramSessions'
async function saveSessionToFirestore(session) {
  if (!session || !session.chatId) return;
  try {
    const key = String(session.chatId);
    const now = new Date().toISOString();
    const payload = {
      chatId: key,
      uid: session.uid || `telegram_${key}`,
      walletAddress: session.walletAddress || null,
      linkedAccount: session.linkedAccount || null,
      lastActive: session.lastActive || now,
      createdAt: session.createdAt || now,
      updatedAt: now
    };
    await db.collection('telegramSessions').doc(key).set(payload, { merge: true });
  } catch (err) {
    console.error('[TelegramAuth] Error saving session to Firestore:', err.message);
  }
}

// Load existing persistent sessions from Firestore collection 'telegramSessions'
async function loadSessionsFromFirestore() {
  try {
    const snap = await db.collection('telegramSessions').get();
    if (snap && snap.docs) {
      snap.docs.forEach(doc => {
        const data = doc.data();
        if (data && data.chatId) {
          const key = String(data.chatId);
          userSessions.set(key, {
            chatId: key,
            walletAddress: data.walletAddress || null,
            uid: data.uid || `telegram_${key}`,
            linkedAccount: data.linkedAccount || null,
            authenticated: Boolean(data.walletAddress || (data.uid && !data.uid.startsWith('telegram_'))),
            awaitingInput: null,
            selectedTokens: new Set(),
            lastActive: data.lastActive || new Date().toISOString(),
            createdAt: data.createdAt || new Date().toISOString(),
            updatedAt: data.updatedAt || new Date().toISOString()
          });
        }
      });
      console.log(`✅ Loaded ${userSessions.size} persistent Telegram session(s) from Firestore ('telegramSessions')`);
    }
  } catch (err) {
    console.warn('[TelegramAuth] Warning loading sessions from Firestore:', err.message);
  }
}

// Auto-trigger background hydration
loadSessionsFromFirestore().catch(() => {});

const TelegramAuth = {
  setBackendServices(services) {
    backendServicesRef = services;
  },

  getBackendServices() {
    return backendServicesRef;
  },

  async initPersistence() {
    if (!isInitialized) {
      isInitialized = true;
      await loadSessionsFromFirestore();
    }
  },

  // Retrieve session for a Telegram chat
  getSession(chatId) {
    const key = String(chatId);
    if (!userSessions.has(key)) {
      const now = new Date().toISOString();
      const newSession = {
        chatId: key,
        walletAddress: null,
        uid: `telegram_${key}`,
        linkedAccount: null,
        authenticated: false,
        awaitingInput: null,
        selectedTokens: new Set(),
        lastActive: now,
        createdAt: now,
        updatedAt: now
      };
      userSessions.set(key, newSession);
      saveSessionToFirestore(newSession);
    }
    const session = userSessions.get(key);
    if (!session.uid) {
      session.uid = `telegram_${key}`;
    }
    session.lastActive = new Date().toISOString();
    return session;
  },

  // Authenticate / bind wallet address or user UID
  authenticate(chatId, walletOrUid, extra = {}) {
    const session = this.getSession(chatId);
    const val = String(walletOrUid || '');
    if (val.startsWith('0x')) {
      session.walletAddress = val;
      session.uid = session.uid || `telegram_${chatId}`;
    } else if (val && val !== 'null' && val !== 'undefined') {
      session.uid = val;
    } else {
      session.uid = `telegram_${chatId}`;
    }
    if (extra && extra.linkedAccount) {
      session.linkedAccount = extra.linkedAccount;
    }
    session.authenticated = true;
    session.updatedAt = new Date().toISOString();
    session.lastActive = new Date().toISOString();
    userSessions.set(String(chatId), session);
    saveSessionToFirestore(session);
    return session;
  },

  // Find session by User ID or UID or target address (Required Method)
  findSessionByUser(userIdOrUid) {
    if (!userIdOrUid) return null;
    const target = String(userIdOrUid).toLowerCase().trim();
    for (const session of userSessions.values()) {
      if (
        String(session.chatId).toLowerCase() === target ||
        String(session.uid || '').toLowerCase() === target ||
        String(session.walletAddress || '').toLowerCase() === target ||
        String(session.linkedAccount || '').toLowerCase() === target
      ) {
        return session;
      }
    }
    return null;
  },

  // Find session by wallet address (Required Method)
  findSessionByWallet(walletAddress) {
    if (!walletAddress) return null;
    const target = String(walletAddress).toLowerCase().trim();
    for (const session of userSessions.values()) {
      if (session.walletAddress && String(session.walletAddress).toLowerCase() === target) {
        return session;
      }
    }
    return null;
  },

  // Get all active authenticated sessions (used for global notifications)
  getAllActiveSessions() {
    return Array.from(userSessions.values()).filter(s => s.chatId);
  }
};

module.exports = { TelegramAuth };


