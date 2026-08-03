/**
 * FOMOCLIX Subscription Router
 * Handles: plan status, weekly subscription charging, profit-share collection,
 *          renewal, and admin treasury transfers.
 *
 * Business model:
 *   Pay As You Go — no upfront fee; 20% of NET PROFIT auto-collected on close.
 *   Weekly Plan   — $29/week deducted from trading wallet; account goes inactive if renewal fails.
 *
 * Fee collection is authorized by the user during onboarding (T&C acceptance).
 * Transactions are signed server-side using the user's trading wallet private key.
 * The frontend never initiates fee collection.
 */

'use strict';

const express = require('express');
const router = express.Router();
const { ethers } = require('ethers');
const { db, dbEvents } = require('../db');

// Treasury (admin) wallet — receives all fees
const TREASURY_WALLET = process.env.VAULT_ADDRESS || process.env.TREASURY_WALLET || '';

// Weekly plan cost in USD (resolved to ETH at current price)
const WEEKLY_PLAN_USD = 29;

// PAYG commission rate
const PAYG_COMMISSION_RATE = 0.20; // 20%

// RPC for signing transactions
const EVM_RPC_URL = process.env.ALCHEMY_RPC_URL || process.env.BASE_RPC_URL || 'https://mainnet.base.org';

function getUserId(req) {
  return req.user && (req.user.uid || req.user.walletAddress || '').toLowerCase();
}

// ---------------------
// GET /subscription/status
// Returns active plan, expiry, and subscription state
// ---------------------
router.get('/status', async (req, res) => {
  try {
    const uid = getUserId(req);
    if (!uid) return res.status(401).json({ error: 'Unauthorized' });
    if (!db) return res.status(503).json({ error: 'Database not ready' });

    const snap = await db.collection('users').doc(uid).get();
    const userData = snap.exists ? snap.data() : {};

    const ADMIN_WALLETS = (process.env.ADMIN_WALLETS || '')
      .toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
    const isAdmin = ADMIN_WALLETS.includes(uid);

    if (isAdmin) {
      return res.json({
        plan: 'admin',
        subscriptionActive: true,
        profileTag: 'Gold User',
        role: 'admin',
        weeklyRenewalDue: null,
        daysUntilRenewal: null,
      });
    }

    const plan = userData.plan || null;
    const subscriptionActive = !!(userData.subscriptionActive);
    const weeklyRenewalDue = userData.weeklyRenewalDue || null;
    let daysUntilRenewal = null;
    if (weeklyRenewalDue) {
      daysUntilRenewal = Math.max(0, Math.ceil((weeklyRenewalDue - Date.now()) / (1000 * 60 * 60 * 24)));
    }

    return res.json({
      plan,
      subscriptionActive,
      profileTag: userData.profileTag || null,
      role: 'user',
      weeklyRenewalDue,
      daysUntilRenewal,
    });
  } catch (err) {
    console.error('[Subscription] /status error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------
// POST /subscription/activate-weekly
// Deducts $29 equivalent in ETH from user's trading wallet → treasury.
// Activates subscription for 7 days.
// ---------------------
router.post('/activate-weekly', async (req, res) => {
  try {
    const uid = getUserId(req);
    if (!uid) return res.status(401).json({ error: 'Unauthorized' });
    if (!db) return res.status(503).json({ error: 'Database not ready' });
    if (!TREASURY_WALLET) return res.status(500).json({ error: 'Treasury wallet not configured.' });

    const snap = await db.collection('users').doc(uid).get();
    const userData = snap.exists ? snap.data() : {};

    if (!userData.tradingWallet || !userData.tradingWallet.address) {
      return res.status(400).json({ error: 'Trading wallet not found.' });
    }
    if (!userData.tradingWallet.backupConfirmed) {
      return res.status(403).json({ error: 'Wallet backup must be confirmed first.' });
    }

    // Get current ETH price to convert $29 → ETH
    let ethPriceUsd = 3000; // fallback
    try {
      const priceRes = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd');
      const priceData = await priceRes.json();
      ethPriceUsd = priceData?.ethereum?.usd || 3000;
    } catch (_) { /* use fallback */ }

    const weeklyFeeEth = WEEKLY_PLAN_USD / ethPriceUsd;
    const weeklyFeeWei = ethers.parseEther(weeklyFeeEth.toFixed(8));

    // Load trading wallet for signing
    const { loadTradingWallet } = require('./onboarding');
    const { wallet } = await loadTradingWallet(uid, EVM_RPC_URL);

    // Check balance
    const provider = wallet.provider;
    const balance = await provider.getBalance(wallet.address);
    const gasEstimate = ethers.parseEther('0.0005'); // buffer for gas
    if (balance < weeklyFeeWei + gasEstimate) {
      return res.status(402).json({
        error: 'Insufficient balance for weekly subscription.',
        required: parseFloat(ethers.formatEther(weeklyFeeWei)).toFixed(6),
        available: parseFloat(ethers.formatEther(balance)).toFixed(6),
      });
    }

    // Send fee to treasury
    const tx = await wallet.sendTransaction({
      to: ethers.getAddress(TREASURY_WALLET),
      value: weeklyFeeWei,
    });
    const receipt = await tx.wait(1);

    const now = Date.now();
    const renewalDue = now + (7 * 24 * 60 * 60 * 1000); // 7 days

    // Update Firestore
    await db.collection('users').doc(uid).set({
      plan: 'weekly',
      subscriptionActive: true,
      profileTag: 'Subscribed',
      planActivatedAt: now,
      weeklyRenewalDue: renewalDue,
      onboardingComplete: true,
      onboardingCompletedAt: now,
      lastSubscriptionTx: tx.hash,
      lastSubscriptionFeeEth: parseFloat(ethers.formatEther(weeklyFeeWei)),
    }, { merge: true });

    // Broadcast to WebSocket clients
    dbEvents.emit('change', {
      type: 'subscription_activated',
      uid,
      plan: 'weekly',
      txHash: tx.hash,
      renewalDue,
    });

    console.log(`[Subscription] Weekly plan activated for ${uid}. Tx: ${tx.hash}`);
    res.json({
      success: true,
      txHash: tx.hash,
      feeEth: parseFloat(ethers.formatEther(weeklyFeeWei)).toFixed(6),
      renewalDue,
      blockNumber: receipt.blockNumber,
    });
  } catch (err) {
    console.error('[Subscription] /activate-weekly error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------
// POST /subscription/record-profit-share
// Called internally by trade-close logic when a profitable PAYG trade closes.
// Body: { tradeId, netProfitEth, tokenAddress, txHash }
// NOT exposed to frontend — backend-to-backend only.
// ---------------------
router.post('/record-profit-share', async (req, res) => {
  try {
    const uid = getUserId(req);
    if (!uid) return res.status(401).json({ error: 'Unauthorized' });
    const { netProfitEth, tradeId, tokenAddress } = req.body;
    if (!netProfitEth || netProfitEth <= 0) {
      return res.status(400).json({ error: 'netProfitEth must be positive.' });
    }
    if (!TREASURY_WALLET) return res.status(500).json({ error: 'Treasury wallet not configured.' });
    if (!db) return res.status(503).json({ error: 'Database not ready' });

    const snap = await db.collection('users').doc(uid).get();
    const userData = snap.exists ? snap.data() : {};
    if (userData.plan !== 'payg') {
      // Only collect profit share for PAYG users
      return res.json({ success: true, collected: false, reason: 'Not a PAYG user' });
    }
    if (!userData.tradingWallet || !userData.tradingWallet.address) {
      return res.status(400).json({ error: 'Trading wallet not found.' });
    }

    const commissionEth = netProfitEth * PAYG_COMMISSION_RATE;
    const commissionWei = ethers.parseEther(commissionEth.toFixed(8));

    // Load trading wallet
    const { loadTradingWallet } = require('./onboarding');
    const { wallet } = await loadTradingWallet(uid, EVM_RPC_URL);

    const balance = await wallet.provider.getBalance(wallet.address);
    if (balance < commissionWei) {
      console.warn(`[Subscription] Insufficient balance for profit share for ${uid}. Skipping.`);
      return res.json({ success: true, collected: false, reason: 'Insufficient balance for commission.' });
    }

    const tx = await wallet.sendTransaction({
      to: ethers.getAddress(TREASURY_WALLET),
      value: commissionWei,
    });
    await tx.wait(1);

    // Record the collection
    await db.collection('users').doc(uid).set({
      lastProfitShareTx: tx.hash,
      lastProfitShareEth: commissionEth,
      lastProfitShareAt: Date.now(),
      totalProfitShareCollected: (userData.totalProfitShareCollected || 0) + commissionEth,
    }, { merge: true });

    // Broadcast
    dbEvents.emit('change', {
      type: 'profit_collected',
      uid,
      tradeId,
      tokenAddress,
      commissionEth,
      txHash: tx.hash,
    });

    console.log(`[Subscription] Profit share collected for ${uid}: ${commissionEth.toFixed(6)} ETH. Tx: ${tx.hash}`);
    res.json({ success: true, collected: true, commissionEth, txHash: tx.hash });
  } catch (err) {
    console.error('[Subscription] /record-profit-share error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------
// POST /subscription/renew
// Called by scheduled job or triggered manually when renewal is due.
// Attempts to charge another week from trading wallet.
// ---------------------
router.post('/renew', async (req, res) => {
  try {
    const uid = getUserId(req);
    if (!uid) return res.status(401).json({ error: 'Unauthorized' });
    if (!db) return res.status(503).json({ error: 'Database not ready' });

    const snap = await db.collection('users').doc(uid).get();
    const userData = snap.exists ? snap.data() : {};

    if (userData.plan !== 'weekly') {
      return res.status(400).json({ error: 'Only weekly plan users can renew.' });
    }

    // Re-use activate-weekly logic
    req.body = {}; // clear body, activate-weekly will re-fetch everything
    // Delegate to activate-weekly handler
    const activateHandler = router.stack.find(l => l.route && l.route.path === '/activate-weekly');
    if (!activateHandler) {
      return res.status(500).json({ error: 'Renewal handler not found.' });
    }

    // Inline the core renewal logic
    let ethPriceUsd = 3000;
    try {
      const priceRes = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd');
      const priceData = await priceRes.json();
      ethPriceUsd = priceData?.ethereum?.usd || 3000;
    } catch (_) {}

    const weeklyFeeEth = WEEKLY_PLAN_USD / ethPriceUsd;
    const weeklyFeeWei = ethers.parseEther(weeklyFeeEth.toFixed(8));

    const { loadTradingWallet } = require('./onboarding');
    const { wallet } = await loadTradingWallet(uid, EVM_RPC_URL);

    const balance = await wallet.provider.getBalance(wallet.address);
    const gasBuffer = ethers.parseEther('0.0005');

    if (balance < weeklyFeeWei + gasBuffer) {
      // Renewal failed — deactivate
      await db.collection('users').doc(uid).set({
        subscriptionActive: false,
        profileTag: 'Pay As You Go',
        plan: 'payg', // Downgrade to PAYG
        subscriptionExpiredAt: Date.now(),
      }, { merge: true });

      dbEvents.emit('change', { type: 'plan_expired', uid });
      return res.json({
        success: false,
        renewed: false,
        reason: 'Insufficient balance. Account downgraded to Pay As You Go.',
      });
    }

    const tx = await wallet.sendTransaction({
      to: ethers.getAddress(TREASURY_WALLET),
      value: weeklyFeeWei,
    });
    await tx.wait(1);

    const now = Date.now();
    const renewalDue = now + (7 * 24 * 60 * 60 * 1000);

    await db.collection('users').doc(uid).set({
      subscriptionActive: true,
      weeklyRenewalDue: renewalDue,
      lastSubscriptionTx: tx.hash,
      lastSubscriptionFeeEth: weeklyFeeEth,
    }, { merge: true });

    dbEvents.emit('change', { type: 'subscription_activated', uid, plan: 'weekly', txHash: tx.hash, renewalDue });

    console.log(`[Subscription] Renewed weekly for ${uid}. Tx: ${tx.hash}`);
    res.json({ success: true, renewed: true, txHash: tx.hash, renewalDue });
  } catch (err) {
    console.error('[Subscription] /renew error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.PAYG_COMMISSION_RATE = PAYG_COMMISSION_RATE;
module.exports.WEEKLY_PLAN_USD = WEEKLY_PLAN_USD;
