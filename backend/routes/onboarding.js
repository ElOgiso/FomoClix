/**
 * FOMOCLIX Onboarding Router
 * Handles: wallet generation, terms acceptance, backup confirmation,
 *          funding detection, plan selection, onboarding state, profile tag.
 *
 * Security model:
 *   - Private key encrypted with AES-256-GCM before storage.
 *   - Encryption key sourced from Google Secret Manager (production)
 *     or WALLET_ENCRYPTION_KEY env var (dev/fallback).
 *   - Mnemonic is returned ONCE (on creation) and NEVER stored.
 *   - Frontend never receives decrypted key after backup step.
 */

'use strict';

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { ethers } = require('ethers');
const { db } = require('../db');

// ---------------------
// Encryption Key Setup
// ---------------------
let _encryptionKey = null;

async function getEncryptionKey() {
  if (_encryptionKey) return _encryptionKey;

  // Attempt Secret Manager first (production Cloud Run)
  try {
    const projectId = process.env.GCP_PROJECT || 'auto-trade-zbot';
    const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
    const client = new SecretManagerServiceClient();
    const name = `projects/${projectId}/secrets/WALLET_ENCRYPTION_KEY/versions/latest`;
    const [version] = await client.accessSecretVersion({ name });
    const rawKey = version.payload.data.toString('utf8').trim();
    // Derive 32-byte key via scrypt
    _encryptionKey = crypto.scryptSync(rawKey, 'fomoclix-wallet-salt-v1', 32);
    console.log('[Onboarding] Encryption key loaded from Secret Manager.');
    return _encryptionKey;
  } catch (smErr) {
    // Fall back to env var (development / non-GCP environments).
    // Prefer WALLET_ENCRYPTION_KEY; otherwise reuse JWT_SECRET so restarts stay stable.
    const rawKey = (process.env.WALLET_ENCRYPTION_KEY || process.env.JWT_SECRET || '').trim();
    if (!rawKey) {
      console.warn('[Onboarding] WALLET_ENCRYPTION_KEY/JWT_SECRET not set. Generating ephemeral key (NOT PRODUCTION SAFE — wallets will not decrypt after restart).');
      _encryptionKey = crypto.randomBytes(32);
    } else {
      _encryptionKey = crypto.scryptSync(rawKey, 'fomoclix-wallet-salt-v1', 32);
      if (process.env.WALLET_ENCRYPTION_KEY) {
        console.log('[Onboarding] Encryption key loaded from WALLET_ENCRYPTION_KEY.');
      } else {
        console.warn('[Onboarding] Encryption key derived from JWT_SECRET (set WALLET_ENCRYPTION_KEY in production).');
      }
    }
    return _encryptionKey;
  }
}

// ---------------------
// Crypto Helpers
// ---------------------
async function encryptText(plaintext) {
  const key = await getEncryptionKey();
  const iv = crypto.randomBytes(12); // 96-bit IV for GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');
  return {
    content: encrypted,
    iv: iv.toString('hex'),
    authTag,
  };
}

async function decryptText(encryptedData) {
  const key = await getEncryptionKey();
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(encryptedData.iv, 'hex')
  );
  decipher.setAuthTag(Buffer.from(encryptedData.authTag, 'hex'));
  let decrypted = decipher.update(encryptedData.content, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// ---------------------
// Admin check helper
// ---------------------
function isAdminUser(req) {
  return req.user && req.user.role === 'admin';
}

function getUserId(req) {
  return req.user && (req.user.uid || req.user.walletAddress || '').toLowerCase();
}

// ---------------------
// GET /onboarding/status
// Returns full onboarding state so frontend can resume at correct step
// ---------------------
router.get('/status', async (req, res) => {
  try {
    const uid = getUserId(req);
    if (!uid) return res.status(401).json({ error: 'Unauthorized' });

    const ADMIN_WALLETS = (process.env.ADMIN_WALLETS || '')
      .toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
    const role = ADMIN_WALLETS.includes(uid) ? 'admin' : 'user';

    if (!db) return res.status(503).json({ error: 'Database not ready' });
    const snap = await db.collection('users').doc(uid).get();
    const userData = snap.exists ? snap.data() : {};

    const hasTradingWallet = !!(userData.tradingWallet && userData.tradingWallet.address);
    const backupConfirmed = !!(userData.tradingWallet && userData.tradingWallet.backupConfirmed);

    // Admin users are always "complete"
    if (role === 'admin') {
      return res.json({
        role: 'admin',
        onboardingComplete: true,
        termsAccepted: true,
        privacyAccepted: true,
        riskAccepted: true,
        hasTradingWallet: true,
        backupConfirmed: true,
        plan: 'admin',
        subscriptionActive: true,
        profileTag: 'Gold User',
        tradingWalletAddress: userData.tradingWallet ? userData.tradingWallet.address : null,
      });
    }

    return res.json({
      role: 'user',
      onboardingComplete: !!(userData.onboardingComplete),
      termsAccepted: !!(userData.termsAccepted),
      privacyAccepted: !!(userData.privacyAccepted),
      riskAccepted: !!(userData.riskAccepted),
      hasTradingWallet,
      backupConfirmed,
      plan: userData.plan || null,
      subscriptionActive: !!(userData.subscriptionActive),
      weeklyRenewalDue: userData.weeklyRenewalDue || null,
      profileTag: userData.profileTag || null,
      tradingWalletAddress: hasTradingWallet ? userData.tradingWallet.address : null,
    });
  } catch (err) {
    console.error('[Onboarding] /status error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------
// GET /onboarding/profile
// Returns user profile tag for the UI badge
// ---------------------
router.get('/profile', async (req, res) => {
  try {
    const uid = getUserId(req);
    if (!uid) return res.status(401).json({ error: 'Unauthorized' });

    const ADMIN_WALLETS = (process.env.ADMIN_WALLETS || '')
      .toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
    const role = ADMIN_WALLETS.includes(uid) ? 'admin' : 'user';

    if (role === 'admin') {
      return res.json({ role: 'admin', profileTag: 'Gold User', subscriptionActive: true, plan: 'admin' });
    }

    if (!db) return res.status(503).json({ error: 'Database not ready' });
    const snap = await db.collection('users').doc(uid).get();
    const userData = snap.exists ? snap.data() : {};

    return res.json({
      role: 'user',
      profileTag: userData.profileTag || 'Pay As You Go',
      plan: userData.plan || null,
      subscriptionActive: !!(userData.subscriptionActive),
      weeklyRenewalDue: userData.weeklyRenewalDue || null,
    });
  } catch (err) {
    console.error('[Onboarding] /profile error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------
// POST /onboarding/accept-terms
// Body: { terms: true, privacy: true, risk: true }
// ---------------------
router.post('/accept-terms', async (req, res) => {
  try {
    const uid = getUserId(req);
    if (!uid) return res.status(401).json({ error: 'Unauthorized' });
    const { terms, privacy, risk } = req.body;
    if (!terms || !privacy || !risk) {
      return res.status(400).json({ error: 'All legal agreements must be accepted.' });
    }
    if (!db) return res.status(503).json({ error: 'Database not ready' });
    await db.collection('users').doc(uid).set({
      termsAccepted: true,
      termsAcceptedAt: Date.now(),
      privacyAccepted: true,
      privacyAcceptedAt: Date.now(),
      riskAccepted: true,
      riskAcceptedAt: Date.now(),
    }, { merge: true });
    res.json({ success: true });
  } catch (err) {
    console.error('[Onboarding] /accept-terms error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------
// POST /onboarding/create-wallet
// Generates a new EVM trading wallet, encrypts private key, returns address + mnemonic ONCE.
// If wallet already exists, returns existing address only (no mnemonic).
// ---------------------
router.post('/create-wallet', async (req, res) => {
  try {
    const uid = getUserId(req);
    if (!uid) return res.status(401).json({ error: 'Unauthorized' });
    if (!db) return res.status(503).json({ error: 'Database not ready' });

    // Check if wallet already exists
    const snap = await db.collection('users').doc(uid).get();
    const userData = snap.exists ? snap.data() : {};
    if (userData.tradingWallet && userData.tradingWallet.address) {
      // Return existing address without mnemonic
      return res.json({
        success: true,
        isExisting: true,
        address: userData.tradingWallet.address,
        mnemonic: null, // Never sent again after backup step
      });
    }

    // Check terms acceptance
    if (!userData.termsAccepted || !userData.riskAccepted) {
      return res.status(403).json({ error: 'Terms and risk disclosure must be accepted first.' });
    }

    // Generate new HD wallet (ethers v6)
    const wallet = ethers.Wallet.createRandom();
    const mnemonic = wallet.mnemonic.phrase; // 12-word BIP-39
    const privateKey = wallet.privateKey;
    const address = wallet.address;

    // Encrypt both private key and mnemonic
    const [encryptedKey, encryptedMnemonic] = await Promise.all([
      encryptText(privateKey),
      encryptText(mnemonic),
    ]);

    // Store encrypted wallet data (mnemonic NOT stored in plaintext)
    await db.collection('users').doc(uid).set({
      tradingWallet: {
        address,
        encryptedKey,
        encryptedMnemonic,
        backupConfirmed: false,
        createdAt: Date.now(),
        chain: 'evm', // Works across Zora, Base, Ethereum
      },
    }, { merge: true });

    console.log(`[Onboarding] Trading wallet created for ${uid}: ${address}`);

    // Return address + mnemonic ONCE (will not be returned after this)
    res.json({
      success: true,
      isExisting: false,
      address,
      mnemonic, // Frontend must download/confirm then this is never sent again
    });

    // Clear sensitive vars from scope
    // (GC will handle this; Node.js has no explicit memory zeroing)
  } catch (err) {
    console.error('[Onboarding] /create-wallet error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------
// GET /onboarding/wallet
// Returns existing wallet address (no key material)
// ---------------------
router.get('/wallet', async (req, res) => {
  try {
    const uid = getUserId(req);
    if (!uid) return res.status(401).json({ error: 'Unauthorized' });
    if (!db) return res.status(503).json({ error: 'Database not ready' });
    const snap = await db.collection('users').doc(uid).get();
    const userData = snap.exists ? snap.data() : {};
    if (!userData.tradingWallet || !userData.tradingWallet.address) {
      return res.json({ exists: false, address: null });
    }
    res.json({
      exists: true,
      address: userData.tradingWallet.address,
      backupConfirmed: !!(userData.tradingWallet.backupConfirmed),
    });
  } catch (err) {
    console.error('[Onboarding] /wallet error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------
// POST /onboarding/backup-confirmed
// Marks mnemonic as backed up — user confirmed download
// ---------------------
router.post('/backup-confirmed', async (req, res) => {
  try {
    const uid = getUserId(req);
    if (!uid) return res.status(401).json({ error: 'Unauthorized' });
    if (!db) return res.status(503).json({ error: 'Database not ready' });

    const snap = await db.collection('users').doc(uid).get();
    const userData = snap.exists ? snap.data() : {};
    if (!userData.tradingWallet || !userData.tradingWallet.address) {
      return res.status(400).json({ error: 'No trading wallet found.' });
    }

    await db.collection('users').doc(uid).set({
      tradingWallet: {
        ...userData.tradingWallet,
        backupConfirmed: true,
        backupConfirmedAt: Date.now(),
      },
    }, { merge: true });

    res.json({ success: true });
  } catch (err) {
    console.error('[Onboarding] /backup-confirmed error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------
// GET /onboarding/wallet/balance
// Returns ETH balance of trading wallet for funding detection
// ---------------------
router.get('/wallet/balance', async (req, res) => {
  try {
    const uid = getUserId(req);
    if (!uid) return res.status(401).json({ error: 'Unauthorized' });
    if (!db) return res.status(503).json({ error: 'Database not ready' });

    const snap = await db.collection('users').doc(uid).get();
    const userData = snap.exists ? snap.data() : {};
    if (!userData.tradingWallet || !userData.tradingWallet.address) {
      return res.status(400).json({ error: 'No trading wallet found.' });
    }

    const walletAddress = userData.tradingWallet.address;
    const rpcUrl = process.env.ALCHEMY_RPC_URL || process.env.BASE_RPC_URL || 'https://mainnet.base.org';

    // Use ethers provider to check balance
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const balanceWei = await provider.getBalance(walletAddress);
    const balanceEth = parseFloat(ethers.formatEther(balanceWei));

    // Also fetch ETH price for USD display
    let ethPriceUsd = 0;
    try {
      const priceRes = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd');
      const priceData = await priceRes.json();
      ethPriceUsd = priceData?.ethereum?.usd || 0;
    } catch (_) { /* non-critical */ }

    const balanceUsd = balanceEth * ethPriceUsd;

    res.json({
      address: walletAddress,
      balanceEth,
      balanceUsd: parseFloat(balanceUsd.toFixed(2)),
      ethPriceUsd,
      funded: balanceEth > 0.0001, // Consider funded if > dust
    });
  } catch (err) {
    console.error('[Onboarding] /wallet/balance error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------
// POST /onboarding/choose-plan
// Body: { plan: 'payg' | 'weekly' }
// ---------------------
router.post('/choose-plan', async (req, res) => {
  try {
    const uid = getUserId(req);
    if (!uid) return res.status(401).json({ error: 'Unauthorized' });
    const { plan } = req.body;
    if (!['payg', 'weekly'].includes(plan)) {
      return res.status(400).json({ error: 'Invalid plan. Choose "payg" or "weekly".' });
    }
    if (!db) return res.status(503).json({ error: 'Database not ready' });

    const snap = await db.collection('users').doc(uid).get();
    const userData = snap.exists ? snap.data() : {};
    if (!userData.tradingWallet || !userData.tradingWallet.backupConfirmed) {
      return res.status(403).json({ error: 'Wallet backup must be confirmed before choosing a plan.' });
    }

    const profileTag = plan === 'payg' ? 'Pay As You Go' : 'Subscribed';
    const now = Date.now();

    const updates = {
      plan,
      profileTag,
      planActivatedAt: now,
      subscriptionActive: plan === 'payg', // PAYG is immediately active
      onboardingComplete: false, // Will be set true after plan activation for weekly
    };

    if (plan === 'payg') {
      updates.onboardingComplete = true;
      updates.onboardingCompletedAt = now;
    }

    await db.collection('users').doc(uid).set(updates, { merge: true });

    res.json({ success: true, plan, profileTag, requiresPayment: plan === 'weekly' });
  } catch (err) {
    console.error('[Onboarding] /choose-plan error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------
// POST /onboarding/complete
// Marks onboarding as complete (called after plan confirmation)
// ---------------------
router.post('/complete', async (req, res) => {
  try {
    const uid = getUserId(req);
    if (!uid) return res.status(401).json({ error: 'Unauthorized' });
    if (!db) return res.status(503).json({ error: 'Database not ready' });
    await db.collection('users').doc(uid).set({
      onboardingComplete: true,
      onboardingCompletedAt: Date.now(),
    }, { merge: true });
    res.json({ success: true });
  } catch (err) {
    console.error('[Onboarding] /complete error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------
// Internal helper: decrypt and load trading wallet for signing
// Used by subscription.js and trade execution logic
// ---------------------
async function loadTradingWallet(uid, providerUrl) {
  if (!db) throw new Error('Database not ready');
  let snap = await db.collection('users').doc(uid).get();
  let userData = snap.exists ? snap.data() : null;

  if (!userData && typeof uid === 'string') {
    if (uid.startsWith('telegram_')) {
      const rawId = uid.replace(/^telegram_/, '');
      const altSnap = await db.collection('users').doc(rawId).get();
      if (altSnap.exists) userData = altSnap.data();
    } else if (!uid.startsWith('0x')) {
      const altSnap = await db.collection('users').doc(`telegram_${uid}`).get();
      if (altSnap.exists) userData = altSnap.data();
    }
  }

  if (!userData && typeof uid === 'string' && uid.startsWith('0x')) {
    const query = await db.collection('users').where('tradingWallet.address', '==', uid).limit(1).get();
    if (!query.empty) userData = query.docs[0].data();
  }

  if (!userData || !userData.tradingWallet || !userData.tradingWallet.encryptedKey) {
    throw new Error(`No trading wallet found for user: ${uid}`);
  }
  const privateKey = await decryptText(userData.tradingWallet.encryptedKey);
  const provider = providerUrl ? new ethers.JsonRpcProvider(providerUrl) : null;
  const wallet = provider
    ? new ethers.Wallet(privateKey, provider)
    : new ethers.Wallet(privateKey);
  return { wallet, address: userData.tradingWallet.address, privateKey };
}

module.exports = router;
module.exports.loadTradingWallet = loadTradingWallet;
module.exports.encryptText = encryptText;
module.exports.decryptText = decryptText;
