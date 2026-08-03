/**
 * FOMOCLIX AI OS — Context Builder
 * Assembles live terminal states, wallet balances, open positions, target lists, logs, and RAG documentation.
 */

const fs = require('fs');
const path = require('path');
const { db } = require('./db');

// Cached documentation snippets for sub-millisecond RAG checks
let docParagraphs = [];

/**
 * Initializes and indexes the documentation from docs/ folder on startup.
 */
function indexDocumentation() {
  docParagraphs = [];
  try {
    const docsDir = path.join(__dirname, 'docs');
    if (!fs.existsSync(docsDir)) {
      console.warn('⚠️ docs/ directory not found. Documentation RAG is disabled.');
      return;
    }

    const files = fs.readdirSync(docsDir).filter(f => f.endsWith('.md'));
    files.forEach(file => {
      const filePath = path.join(docsDir, file);
      const content = fs.readFileSync(filePath, 'utf8');
      
      // Split by paragraph blocks
      const paragraphs = content.split(/\n\n+/);
      paragraphs.forEach(p => {
        const text = p.trim();
        if (text.length > 50) {
          docParagraphs.push({
            source: file,
            text
          });
        }
      });
    });
    console.log(`📄 Indexed ${docParagraphs.length} documentation paragraphs for RAG.`);
  } catch (err) {
    console.error('❌ Failed to index documentation for RAG:', err.message);
  }
}

// Initial index run
indexDocumentation();

/**
 * Performs a simple term-frequency matching RAG search on the documentation.
 */
function searchRagDocs(query, limit = 2) {
  if (!query || docParagraphs.length === 0) return [];
  
  const queryWords = query.toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 2); // Filter short words

  if (queryWords.length === 0) return [];

  const scored = docParagraphs.map(doc => {
    let score = 0;
    const docTextLower = doc.text.toLowerCase();
    queryWords.forEach(word => {
      if (docTextLower.includes(word)) {
        score += 1;
      }
    });
    return { ...doc, score };
  });

  return scored
    .filter(doc => doc.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(doc => `[Source: ${doc.source}]\n${doc.text}`);
}

/**
 * Main Context Builder. Compiles database lists, logs, and RAG.
 */
async function buildPlatformContext({ userId, activeChain = 'zora', currentTab = 'scanner', currentMessage = '', systemGetters = {} }) {
  let config = {};
  let positions = [];
  let creators = [];
  let activityLogs = [];
  let walletBalances = { eth: 0, usdc: 0 };
  let walletAddress = '';
  let ethPrice = 3500;
  let gasPrice = 0;

  try {
    // 1. Fetch live system states via dependency injection getters
    if (systemGetters.getBotConfig) config = systemGetters.getBotConfig() || {};
    if (systemGetters.getWalletAddress) walletAddress = systemGetters.getWalletAddress() || '';
    if (systemGetters.getBalances) walletBalances = await systemGetters.getBalances() || { eth: 0, usdc: 0 };
    if (systemGetters.getEthPrice) ethPrice = systemGetters.getEthPrice() || 0;
    if (systemGetters.getGasPrice) gasPrice = systemGetters.getGasPrice() || 0;

    // 2. Fetch database records from Firestore
    if (db) {
      // 2.1. Active Positions
      const positionsSnap = await db.collection('trades')
        .where('status', '==', 'open')
        .limit(10)
        .get();
      positions = positionsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      // 2.2. Tracked Creators
      const creatorsSnap = await db.collection('targetUsers')
        .limit(15)
        .get();
      creators = creatorsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      // 2.3. Recent Activity Logs
      const logsSnap = await db.collection('activityFeed')
        .orderBy('timestamp', 'desc')
        .limit(15)
        .get();
      activityLogs = logsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    }
  } catch (err) {
    console.error('❌ Context Builder database fetch error:', err.message);
  }

  // 3. Document RAG lookup
  const documentationContext = searchRagDocs(currentMessage, 2);

  // 4. Extract recent scanner feed context directly from the router feed state
  let scannerFeed = [];
  if (systemGetters.getScannerFeed) {
    scannerFeed = systemGetters.getScannerFeed(activeChain) || [];
  }

  // Phase 3: Resolve the active user's ephemeral trading wallet for AI tool context
  let resolvedEthersWallet = systemGetters.getEthersWallet ? systemGetters.getEthersWallet() : null;
  if (userId) {
    try {
      const { loadTradingWallet } = require('./routes/onboarding');
      const rpcUrl = process.env.ALCHEMY_RPC_URL || process.env.BASE_RPC_URL;
      const loaded = await loadTradingWallet(userId, rpcUrl);
      resolvedEthersWallet = loaded.wallet;
    } catch (_) {
      // Fall back to admin wallet if user wallet not yet created
    }
  }

  return {
    userId,
    activeChain,
    currentTab,
    walletAddress,
    walletBalances,
    gasPrice,
    ethPrice,
    config,
    positions,
    trackedCreators: creators,
    activityLogs,
    scannerFeed,
    documentationContext,
    timestamp: new Date().toISOString(),
    ethersWallet: resolvedEthersWallet,
    ethersProvider: systemGetters.getEthersProvider ? systemGetters.getEthersProvider() : null,
    executeBuy: systemGetters.executeBuy || null,
    executeSell: systemGetters.executeSell || null,
    updateConfig: systemGetters.updateConfig || null
  };
}

module.exports = {
  buildPlatformContext,
  searchRagDocs
};
