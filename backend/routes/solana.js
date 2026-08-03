const express = require('express');
const router = express.Router();

// ============================================================
// SOLANA MARKET BACKEND — Pump.fun / PumpSwap / Jupiter
// Completely independent from Zora backend logic.
// ============================================================

// In-memory scanner state for Solana tokens
const solanaScannedTokens = [];
const solanaTrades = [];
let solanaConfig = {
  enabled: true,
  autoBuy: false,
  maxSlippageBps: 500,
  priorityFeeLamports: 100000,
  jitoTipLamports: 10000,
  maxBuySol: 0.5,
  minLiquiditySol: 5,
  minBondingCurvePercent: 60,
  autoSellOnGraduation: true,
  takeProfitPercent: 100,
  stopLossPercent: -50,
  rugCheckEnabled: true,
  mintAuthorityCheck: true,
  freezeAuthorityCheck: true,
  maxTopHolderPercent: 20,
};

// Simulated Pump.fun bonding curve token generator
function generatePumpFunToken() {
  const names = [
    'BONKCAT', 'SOLPEPEX', 'PUMPDOG', 'MOONBIRD', 'DEGENFISH',
    'SOLARAPE', 'WIFHAT', 'POPCAT', 'GIGACHAD', 'SOLANA_FROG',
    'JITO_MEME', 'RAYDIUM_OG', 'PHANTOM_PUNK', 'DRIFT_DEGEN',
    'ORCA_KING', 'MARINADE_DAO', 'TENSOR_NFT', 'MAGIC_EDEN',
    'HELIUS_BOT', 'JUPITER_MAX'
  ];
  const name = names[Math.floor(Math.random() * names.length)];
  const bondingPercent = Math.round(Math.random() * 100);
  const mcap = Math.round(Math.random() * 150000);
  const liquidity = (Math.random() * 80 + 2).toFixed(2);
  const holders = Math.floor(Math.random() * 500) + 5;
  const devHoldPercent = (Math.random() * 15).toFixed(1);
  const mintAddr = 'So1' + Array.from({length: 40}, () =>
    '0123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'[Math.floor(Math.random() * 58)]
  ).join('');

  return {
    id: `pump-${Date.now()}-${Math.random().toString(36).substr(2,6)}`,
    chain: 'solana',
    protocol: bondingPercent < 95 ? 'pump.fun' : 'pumpswap',
    name,
    symbol: name,
    mintAddress: mintAddr,
    bondingCurvePercent: bondingPercent,
    graduated: bondingPercent >= 95,
    marketCap: mcap,
    liquiditySol: parseFloat(liquidity),
    holders,
    devHoldPercent: parseFloat(devHoldPercent),
    volume24h: Math.round(Math.random() * 50000),
    priceChangePct: (Math.random() * 200 - 50).toFixed(1),
    rugScore: Math.floor(Math.random() * 100),
    mintAuthority: Math.random() > 0.8 ? 'ACTIVE' : 'REVOKED',
    freezeAuthority: Math.random() > 0.9 ? 'ACTIVE' : 'REVOKED',
    createdAt: Date.now() - Math.floor(Math.random() * 3600000),
    detectedAt: new Date().toISOString(),
  };
}

// Mock generator disabled for production readiness (100% real data from DexScreener).
/*
setInterval(async () => {
  if (!solanaConfig.enabled) return;
  const token = generatePumpFunToken();
  solanaScannedTokens.unshift(token);
  if (solanaScannedTokens.length > 200) solanaScannedTokens.length = 200;

  // Write token scan to Firestore activityFeed so it's broadcasted to frontend instantly
  try {
    const { db } = require('../db');
    if (db) {
      await db.collection('activityFeed').add({
        type: 'SCANNING_COIN',
        chain: 'solana',
        name: token.name,
        symbol: token.symbol,
        coin: token.mintAddress,
        creator: token.mintAddress,
        status: `Evaluating Solana Pump Curve (${token.bondingCurvePercent}% progress)...`,
        riskScore: token.rugScore,
        marketCap: token.marketCap,
        liveHolders: token.holders,
        timestamp: Date.now()
      });
    }
  } catch (err) {
    console.error('Solana Firestore scanner log error:', err.message);
  }
}, 8000);
*/

// ── Routes ──────────────────────────────────────────────────

// GET /solana/status
router.get('/status', (req, res) => {
  res.json({
    chain: 'solana',
    status: solanaConfig.enabled ? 'SCANNING' : 'IDLE',
    scannedTokens: solanaScannedTokens.length,
    activeTrades: solanaTrades.filter(t => t.status === 'open').length,
    config: {
      autoBuy: solanaConfig.autoBuy,
      maxBuySol: solanaConfig.maxBuySol,
      jitoEnabled: solanaConfig.jitoTipLamports > 0,
    }
  });
});

// GET /solana/scanner/feed
router.get('/scanner/feed', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const filter = req.query.filter; // 'graduating' | 'new' | 'all'
  let feed = [...solanaScannedTokens];

  if (filter === 'graduating') {
    feed = feed.filter(t => t.bondingCurvePercent >= 80 && !t.graduated);
  } else if (filter === 'new') {
    feed = feed.filter(t => t.bondingCurvePercent < 30);
  }

  res.json(feed.slice(0, limit));
});

// GET /solana/config
router.get('/config', (req, res) => {
  res.json(solanaConfig);
});

// POST /solana/config
router.post('/config', (req, res) => {
  const updates = req.body;
  Object.keys(updates).forEach(key => {
    if (key in solanaConfig) {
      solanaConfig[key] = updates[key];
    }
  });
  res.json({ success: true, config: solanaConfig });
});

// POST /solana/scanner/toggle
router.post('/scanner/toggle', (req, res) => {
  solanaConfig.enabled = !solanaConfig.enabled;
  res.json({ enabled: solanaConfig.enabled });
});

// GET /solana/trades
router.get('/trades', (req, res) => {
  res.json(solanaTrades);
});

// POST /solana/trade/buy
router.post('/trade/buy', (req, res) => {
  const { mintAddress, amountSol, symbol } = req.body;
  if (!mintAddress || !amountSol) {
    return res.status(400).json({ error: 'mintAddress and amountSol required' });
  }
  const trade = {
    id: `sol-trade-${Date.now()}`,
    chain: 'solana',
    mintAddress,
    symbol: symbol || 'UNKNOWN',
    amountSol: parseFloat(amountSol),
    entryPrice: (Math.random() * 0.001).toFixed(8),
    status: 'open',
    boughtAt: Date.now(),
    txHash: 'sim_' + Array.from({length: 64}, () => '0123456789abcdef'[Math.floor(Math.random()*16)]).join('')
  };
  solanaTrades.unshift(trade);
  res.json({ success: true, trade });
});

// POST /solana/trade/sell
router.post('/trade/sell', (req, res) => {
  const { tradeId } = req.body;
  const trade = solanaTrades.find(t => t.id === tradeId);
  if (!trade) return res.status(404).json({ error: 'Trade not found' });
  trade.status = 'sold';
  trade.soldAt = Date.now();
  trade.exitPrice = (parseFloat(trade.entryPrice) * (1 + Math.random())).toFixed(8);
  res.json({ success: true, trade });
});

router.solanaScannedTokens = solanaScannedTokens;
module.exports = router;
