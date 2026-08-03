/**
 * FOMOCLIX AI OS — Memory Manager
 * Manages long-term user memory, preferences, strategy histories, and closed trade learning loops in Firestore.
 */

const { db } = require('./db');

/**
 * Fetch user preference memory profile from Firestore
 */
async function getUserPreferences(userId) {
  if (!db) return {};
  try {
    const docRef = db.collection('users').doc(userId).collection('ai_memory').doc('preferences');
    const doc = await docRef.get();
    if (doc.exists) {
      return doc.data();
    }
  } catch (err) {
    console.error('Error fetching user preferences:', err.message);
  }
  
  // Default fallback preference schema
  return {
    favoriteChains: ['zora'],
    riskTolerance: 'medium', // low | medium | high
    defaultBudgetEth: 0.001,
    antiRektStrictness: 'moderate',
    notes: 'Prefers small-budget sniping positions.'
  };
}

/**
 * Update user preference memory profile
 */
async function updateUserPreferences(userId, updates) {
  if (!db) return { success: false };
  try {
    const docRef = db.collection('users').doc(userId).collection('ai_memory').doc('preferences');
    await docRef.set({
      ...updates,
      updatedAt: new Date().toISOString()
    }, { merge: true });
    return { success: true };
  } catch (err) {
    console.error('Error saving user preferences:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Log trade reviews when a position finishes / gets sold to train the learning model.
 */
async function logClosedTradeReview(userId, { tokenAddress, name, symbol, entryEth, exitEth, pnlEth, pnlPercent, outcome, mistakes = [], successFactors = [] }) {
  if (!db) return { success: false };
  try {
    const colRef = db.collection('users').doc(userId).collection('learning_history');
    await colRef.add({
      tokenAddress,
      name,
      symbol,
      entryEth,
      exitEth,
      pnlEth,
      pnlPercent,
      outcome, // 'PROFIT' | 'LOSS'
      mistakes,
      successFactors,
      timestamp: new Date().toISOString()
    });
    return { success: true };
  } catch (err) {
    console.error('Error logging trade review:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * Reads insights from historical trade reviews to give the AI context on past actions.
 */
async function getUserLearningSummary(userId) {
  if (!db) return 'No learning loops active (Firestore offline).';
  try {
    const colRef = db.collection('users').doc(userId).collection('learning_history');
    const snap = await colRef.orderBy('timestamp', 'desc').limit(20).get();
    
    if (snap.empty) {
      return 'No historical trade outcomes recorded yet.';
    }

    let profitTrades = 0;
    let lossTrades = 0;
    let totalPnL = 0;
    const commonMistakes = {};
    const commonSuccess = {};

    snap.docs.forEach(doc => {
      const data = doc.data();
      totalPnL += data.pnlEth || 0;
      if (data.outcome === 'PROFIT') profitTrades++;
      else lossTrades++;

      if (data.mistakes) {
        data.mistakes.forEach(m => {
          commonMistakes[m] = (commonMistakes[m] || 0) + 1;
        });
      }
      if (data.successFactors) {
        data.successFactors.forEach(s => {
          commonSuccess[s] = (commonSuccess[s] || 0) + 1;
        });
      }
    });

    const topMistake = Object.entries(commonMistakes).sort((a,b) => b[1]-a[1])[0]?.[0] || 'none';
    const topSuccess = Object.entries(commonSuccess).sort((a,b) => b[1]-a[1])[0]?.[0] || 'none';

    return `Past 20 trades: ${profitTrades} Wins, ${lossTrades} Losses. Net PnL: ${totalPnL.toFixed(4)} ETH. Top recurring mistake: "${topMistake}". Top success factor: "${topSuccess}".`;
  } catch (err) {
    console.error('Error compiling learning summary:', err.message);
    return 'Failed to compile learning history due to service errors.';
  }
}

/**
 * Returns a standardized memory context block.
 */
async function getMemorySnapshot(userId) {
  const prefs = await getUserPreferences(userId);
  const learning = await getUserLearningSummary(userId);
  
  return {
    tradingPreferences: prefs,
    learningSummary: learning
  };
}

module.exports = {
  getUserPreferences,
  updateUserPreferences,
  logClosedTradeReview,
  getUserLearningSummary,
  getMemorySnapshot
};
