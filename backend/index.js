require('dotenv').config();
/* eslint no-console: 0 */

if (!BigInt.prototype.toJSON) {
  BigInt.prototype.toJSON = function () {
    return this.toString();
  };
}

// Recursively convert BigInt -> string for Firestore writes
function serializeForFirestore(value) {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(serializeForFirestore);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = serializeForFirestore(v);
    }
    return out;
  }
  return value;
}

const express = require('express');
const crypto = require('crypto');
const cors = require('cors');
const { ethers, Wallet, WebSocketProvider, Contract, JsonRpcProvider, formatEther: ethersFormatEther, parseEther: ethersParseEther } = require('ethers');
const { createPublicClient, createWalletClient, http, parseEther: viemParseEther, formatEther: viemFormatEther } = require('viem');
const { privateKeyToAccount } = require('viem/accounts');
const { base } = require('viem/chains');
const zoraCoinsSdk = require('@zoralabs/coins-sdk');
const { tradeCoin, getCoinHolders, getCoinSwaps, getCoin, getCoins, getProfileCoins, getProfileBalances, getProfile, getExploreCoins } = zoraCoinsSdk;
const { NeynarAPIClient, Configuration } = require('@neynar/nodejs-sdk');
const { db, dbQuery, dbEvents, signJwt, verifyJwt, userContextStore, defaultUserId, migrateUserLegacyData } = require('./db');

// Onboarding & Subscription routes
const onboardingRouter = require('./routes/onboarding');
const subscriptionRouter = require('./routes/subscription');

let fetchFn;
if (typeof globalThis.fetch === 'function') fetchFn = globalThis.fetch.bind(globalThis);
else fetchFn = require('node-fetch').default;

// ---------------------
// Env/config
// ---------------------
const GCP_PROJECT = (process.env.GCP_PROJECT || '').trim();
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const ZORA_FACTORY_ADDRESS = '0x777777751622c0d3258f214F9DF38E35BF45baF3';
const ZORA_NFT_CONTRACT = '0x76215415c090d2f4d74a40badf17aca289cc6992';
const ZORA_NFT_ABI = ['event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)'
];
const TARGET_USERS_COLLECTION = 'targetUsers'; // Fixed: Defining missing constant
const ZORA_FACTORY_ABI = [
  // Content/Media Coins (V4)
  'event CoinCreatedV4(address indexed caller, address indexed payoutRecipient, address indexed platformReferrer, address currency, string uri, string name, string symbol, address coin, tuple(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hook) poolKey, bytes32 poolKeyHash, string version)',
  
  // Creator/Profile Coins (Matches V4 structure)
  'event CreatorCoinCreated(address indexed caller, address indexed payoutRecipient, address indexed platformReferrer, address currency, string uri, string name, string symbol, address coin, tuple(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hook) poolKey, bytes32 poolKeyHash, string version)',


'event TrendCoinDeployed(string indexed symbol, address indexed coin, address caller)'
];
// Production frontend (Firebase) + legacy hosts + local Vite
const CORS_ALLOWED_ORIGIN = process.env.CORS_ALLOWED_ORIGIN || [
  'https://zora-trader-run-v1.web.app',
  'https://zora-trader-run-v1.firebaseapp.com',
  'https://zora-trader-v1.web.app',
  'https://auto-trade-zbot.web.app',
  'http://localhost:3000',
  'http://localhost:5173'
].join(',');
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const USDC_ADDRESS = process.env.USDC_ADDRESS || '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 1000;
const ADMIN_WALLETS = (process.env.ADMIN_WALLETS || '0xFA887A39E22555e1a3f815A9aC730366ec0e05E4').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'mauriceogiso@gmail.com').toLowerCase().trim();
const ADMIN_UID = (process.env.ADMIN_UID || 'm9VxOtnIrwYvd19BttRAHEx2E1i1').trim();
const ZORA_COIN_FACTORY_ADDRESS = '0x777777751622c0d3258f214F9DF38E35BF45baF3';

const NEYNAR_RATE_LIMIT_MAX = 15;
const ZORA_SDK_RATE_LIMIT_MAX = 5;
// ---------------------
// Global state
// ---------------------
let PRIVATE_KEY, ALCHEMY_RPC_URL;
// Prefer env; keep legacy inline key only as last-resort fallback for existing deployments
const ZORA_READ_API_KEY = (process.env.ZORA_READ_API_KEY || process.env.ZORA_API_KEY || 'zora_api_2c5394c46458bcc46def53a7ec735e6962442e13f4dcb77d339c44407605798d').trim();
let ethersProvider, ethersWallet;
let viemPublicClient, viemWalletClient, viemAccount;
let ethPriceUsd = 3000.0;
let alchemyWsProvider;
let zoraFactoryContract;
let wsStatus = 'disconnected';
let contractListenersAttached = false;
let nftContract;
let nftListenersAttached = false;
let NEYNAR_WEBHOOK_SECRET = process.env.NEYNAR_WEBHOOK_SECRET;
let NEYNAR_API_KEY = process.env.NEYNAR_API_KEY;
let neynarClient;
let lastNeynarCall = 0;
let lastZoraCall = 0;
let trackedCreatorSet = new Set();
let heartbeatInterval;
let prepareSpendCallData;
let BOT_SPENDER_ADDRESS; // Define the variable name here


function isTargetMatch(symbol, name) {
  if (!botConfig.symbolTargetingEnabled) return false;
  
  const sym = (symbol || '').trim().toUpperCase();
  const coinName = (name || '').trim().toUpperCase();

  // --- NEW EXCLUSION LOGIC ---
  const exclusions = botConfig.exclusionPhrases.split(',').map(e => e.trim().toUpperCase()).filter(Boolean);
  const isExcluded = exclusions.some(phrase => 
    coinName.includes(phrase) || sym.includes(phrase)
  );

  if (isExcluded) {
    console.log(`🚫 EXCLUSION HIT: "${name}" (${symbol}) matches an exclusion phrase. Skipping.`);
    return false; // Exit early, do not buy
  }
  // ---------------------------

  const keywords = (botConfig.targetKeywords || "").split(',').map(k => k.trim().toUpperCase()).filter(Boolean);

  // This ensures "Free Words" works whether you toggle symbolTargeting or freeWordsEnabled
  const hasKeyword = (botConfig.symbolTargetingEnabled || botConfig.freeWordsEnabled) && keywords.some(k => 
    coinName === k || sym === k
  ); 

  // 2. Pattern Match
  const isFourLetters = sym.length === 4;
  const isAllCaps = sym === sym.toUpperCase() && /[A-Z]/.test(sym);

  if (hasKeyword) return true;
  if (botConfig.requireFourLetterSymbol && isFourLetters) return true;
  if (botConfig.requireAllCapsSymbol && isAllCaps) return true;

  return false;
}

// --- NEW GLOBAL HELPER: Format USD Currency ---
function formatUSD(ethAmount) {
  const usdValue = parseFloat(ethAmount) * ethPriceUsd;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(usdValue);
}

// --- NEW: Real-time sell loop state ---
let activePositions = new Map(); // K: coinAddress, V: tradeData
let isSellingSet = new Set(); // Prevents selling the same coin twice
let creatorSellRules = new Map(); // K: creatorAddress, V: { sellAfterUsers, minimumHoldMinutes }
// --- END NEW ---

// Default config, will be overwritten by Firestore in real-time
let botConfig = {
  botState: 'paused',
  vaultAddress: process.env.VAULT_ADDRESS || '',
  telegramEnabled: true,
  tradeCurrency: (process.env.TRADE_CURRENCY || 'ETH').toUpperCase(),
  tradeSlippage: parseFloat(process.env.TRADE_SLIPPAGE || '0.0025'),
  minimumHoldMinutes: parseInt(process.env.MINIMUM_HOLD_MINUTES || '5', 10),
  tradeAmountEth: parseFloat(process.env.TRADE_AMOUNT_ETH || '0.0002'),
  contentTradeAmountEth: parseFloat(process.env.CONTENT_TRADE_ETH || '0.0002'), 
  creatorTradeAmountEth: parseFloat(process.env.CREATOR_TRADE_ETH || '0.01'), 
  tradeAmountUsdc: BigInt(process.env.TRADE_AMOUNT_USDC || 1e6),
  autoWithdraw: process.env.AUTO_WITHDRAW === 'true',
  minProfitBeforeWithdraw: BigInt(process.env.MIN_PROFIT_BEFORE_WITHDRAW || '0'),
  sellAfterUsers: parseInt(process.env.SELL_AFTER_USERS || '1', 10),
  maxPriorityFeeGwei: parseFloat(process.env.MAX_PRIORITY_FEE_GWEI || '0.05'),
  autoSellGlobal: true,
  globalEmergencySell: false,
  takeProfitUsd: 100.0,
  // --- SYMBOL TARGETING FEATURE CONFIG ---
  symbolTargetingEnabled: false,
  targetKeywords: "RESERVE,GOLD,BASE",
  exclusionPhrases: "USXR ON ZORA, BEN CRUZ",
  requireFourLetterSymbol: false,
  requireAllCapsSymbol: false,
  symbolTargetTimerMinutes: 2, // Default 2 mins
  symbolTargetTakeProfitUsd: 60.0, // Sell all above $60
  symbolTargetStopLossPercent: 20, // 20% loss
  symbolTargetPartialProfitUsd: 100.0, // Partial profit trigger
  // -----------------------------------------
  freeTraderMode: false,
  // --- DECAY & MOMENTUM SNIPE CONFIG ---
  taxArbitrageEnabled: false,      // Toggle the 10s decay logic
  taxFrontrunTargetMs: 8500,       // Target 8.5 seconds (15% tax)
  taxTimerEnabled: false,          // Use a fixed timer instead of frontrun
  taxTimerSeconds: 9.5,            // Fixed delay if taxTimerEnabled is true
  microInertiaEnabled: false,      // Buy early if others are buying
  microInertiaMinBuys: 2,          // Number of early buys to trigger entry
  preBuyMomentumEnabled: false,    // Check volume before buying
  preBuyMinEthVolume: 0.05,        // Required volume to trigger buy
  // --- TRENDING & MEDIA CONFIG ---
  trendingSnipingEnabled: false,   // Toggle to buy coins appearing on Trend list
  minTrendVolume24h: 0.5,          // Only buy trending coins with > 0.5 ETH vol
  minTrendUniqueHolders: 50,       // Required holder count to consider "Trending"
  buyNewProfilesOnly: false,       // Feature: Only buy if creator is fresh (0-1 previous coins)
  // -------------------------------
  // -------------------------------------
  maxRandomCoinsPerDay: 5,
  maxCreatorCoinsPerDay: 5,
  creatorFollowerThreshold: 10000,
  bypassCreatorFollowerCheck: true,
  randomTradeAmountEth: 0.0005
};

// ---------------------
// Bot state
// ---------------------
const TRACKED_CREATORS_COLLECTION = 'targetUsers';
const ACTIVITY_FEED_COLLECTION = 'activityFeed';
const PROCESSED_CASTS_COLLECTION = 'processedCasts';

// ---------------------
// Helpers
// ---------------------
async function getSecrets() {
  PRIVATE_KEY = process.env.PRIVATE_KEY || process.env.ZORA_TRADER_PK;
  ALCHEMY_RPC_URL = process.env.ALCHEMY_RPC_URL;
  NEYNAR_API_KEY = process.env.NEYNAR_API_KEY;
  NEYNAR_WEBHOOK_SECRET = process.env.NEYNAR_WEBHOOK_SECRET;

  if (!PRIVATE_KEY || !ALCHEMY_RPC_URL || !NEYNAR_API_KEY) {
     throw new Error('One or more critical secrets (ZORA_TRADER_PK/PRIVATE_KEY, ALCHEMY_RPC_URL, NEYNAR_API_KEY) could not be loaded from environment variables.');
  }
  console.log('✅ Secrets loaded from environment variables');
}

async function notify(level, message) {
  const text = `[${level}] ${message}`;
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return console.log(text);
  try {
    if (botConfig.telegramEnabled) {
        await fetchFn(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text }),
        });
    }
  } catch (err) { console.error('Telegram notify failed:', err); }
}

async function getEthPrice() {
  try {
    const res = await fetchFn('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd');
    if (res.ok) {
      const data = await res.json();
      if (data?.ethereum?.usd) {
        ethPriceUsd = parseFloat(data.ethereum.usd);
        console.log(`Updated ETH Price (CoinGecko): $${ethPriceUsd}`);
        return ethPriceUsd;
      }
    }
  } catch (err) {
    console.error('Error fetching CoinGecko ETH price:', err.message);
  }

  try {
    const res = await fetchFn('https://api.coinbase.com/v2/prices/ETH-USD/spot');
    if (res.ok) {
      const data = await res.json();
      if (data?.data?.amount) {
        ethPriceUsd = parseFloat(data.data.amount);
        console.log(`Updated ETH Price (Coinbase): $${ethPriceUsd}`);
        return ethPriceUsd;
      }
    }
  } catch (cbErr) {
    console.error('Error fetching Coinbase ETH price:', cbErr.message);
  }
  return ethPriceUsd || 0;
}

async function setupServices() {
  console.log('🔌 SQLite/D1 Database service ready.');


  if (!ALCHEMY_RPC_URL || !PRIVATE_KEY || !NEYNAR_API_KEY) throw new Error('Missing secrets');

  ethersProvider = new ethers.JsonRpcProvider(ALCHEMY_RPC_URL);
  ethersWallet = new Wallet(PRIVATE_KEY, ethersProvider);
  BOT_SPENDER_ADDRESS = ethersWallet.address; 

  viemPublicClient = createPublicClient({ chain: base, transport: http(ALCHEMY_RPC_URL) });
  viemAccount = privateKeyToAccount(PRIVATE_KEY);
  viemWalletClient = createWalletClient({ account: viemAccount, chain: base, transport: http(ALCHEMY_RPC_URL) });

  console.log('✅ HTTP Services ready. Wallet:', ethersWallet.address);

  const config = new Configuration({
    apiKey: NEYNAR_API_KEY,
  });
  neynarClient = new NeynarAPIClient(config);
  console.log('✅ Neynar client initialized');

  console.log('Setting up WebSocket provider...');
  const wsUrl = ALCHEMY_RPC_URL.replace('https', 'wss').replace('http', 'ws');

  alchemyWsProvider = new ethers.WebSocketProvider(wsUrl);

  let wsInitRetries = 0;
  const maxRetries = 10;
  const initInterval = setInterval(() => {
    wsInitRetries++;
    const ws = alchemyWsProvider ? (alchemyWsProvider.websocket || alchemyWsProvider._websocket) : null;
    if (ws && wsInitRetries >= 1) {
      clearInterval(initInterval);
      console.log('✅ WS ready—attaching listeners');
      setupWebSocketListeners();
      setupContractListeners();
      setupNFTListeners();
      return;
    }
    if (wsInitRetries >= maxRetries) {
      clearInterval(initInterval);
      console.error('❌ WS init failed after 10s—manual retry in 5s');
      setTimeout(() => {
        const wsUrl = ALCHEMY_RPC_URL.replace('https', 'wss').replace('http', 'ws');
        alchemyWsProvider = new ethers.WebSocketProvider(wsUrl);
        setupWebSocketListeners();
        setupContractListeners();
        setupNFTListeners();
      }, 5000);
    }
  }, 1000);

  await getEthPrice();
  setInterval(getEthPrice, 5 * 60 * 1000);
}

/**
 * Sets up WebSocket event listeners and handles robust auto-reconnect logic
 * WITH a working heartbeat to fix stale connections.
 */
function setupWebSocketListeners() {
  const ws = alchemyWsProvider ? (alchemyWsProvider.websocket || alchemyWsProvider._websocket) : null;
  if (!ws) {
    console.error("WebSocketProvider not initialized correctly or underlying websocket is missing.");
    return;
  }

  // Clear any old intervals to prevent duplicates
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  let pingTimeout = null;
  
  const KEEP_ALIVE_INTERVAL = 15000; // Send ping every 15 seconds
  const KEEP_ALIVE_TIMEOUT = 10000;  // Expect pong back within 10 seconds

  ws.on('open', () => {
    wsStatus = 'connected';
    console.log('✅ Alchemy WebSocket connected');
    notify('INFO', 'Alchemy WebSocket connected.');

    // Start the ping/pong keep-alive loop
    heartbeatInterval = setInterval(() => {
      // console.log('WS Heartbeat: Sending ping...');
      
      // 1. Set a timeout. If a pong isn't received in time, this will fire.
      pingTimeout = setTimeout(() => {
        console.warn('WS Heartbeat: No pong received. Connection is stale. Terminating...');
        const currentWs = alchemyWsProvider ? (alchemyWsProvider.websocket || alchemyWsProvider._websocket) : null;
        if (currentWs) {
          currentWs.terminate(); // Force-close
        }
      }, KEEP_ALIVE_TIMEOUT);
      
      // 2. Send the actual ping
      const currentWs = alchemyWsProvider ? (alchemyWsProvider.websocket || alchemyWsProvider._websocket) : null;
      if (currentWs) {
        currentWs.ping();
      }
      
    }, KEEP_ALIVE_INTERVAL);
  });

  // This is the "pong" listener. It clears the timeout, proving the connection is alive.
  ws.on('pong', () => {
    // console.log('WS Heartbeat: Received pong.');
    if (pingTimeout) clearTimeout(pingTimeout);
  });

  ws.on('close', (code) => {
    wsStatus = 'disconnected';
    console.log(`🛑 Alchemy WebSocket disconnected (code: ${code}). Reconnecting...`);
    notify('WARN', 'Alchemy WebSocket disconnected—reconnecting.');
    
    // 3. CRITICAL: Clear all timers and intervals on close
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    if (pingTimeout) clearTimeout(pingTimeout);
    
    // This is your correct teardown logic
    if (zoraFactoryContract) {
        zoraFactoryContract.removeAllListeners();
        console.log('Removed old zoraFactoryContract listeners.');
    }
    if (nftContract) {
        nftContract.removeAllListeners();
        console.log('Removed old nftContract listeners.');
    }
    
    contractListenersAttached = false;
    nftListenersAttached = false;

    // 4. Start the reconnection process
    const wsUrl = ALCHEMY_RPC_URL.replace('https', 'wss').replace('http', 'ws');
    
    // Give it a 1s buffer before trying to reconnect
    setTimeout(() => {
      alchemyWsProvider = new ethers.WebSocketProvider(wsUrl);
      setupWebSocketListeners(); // Re-attach all handlers
      setupNFTListeners();       // Re-build NFT listener
      setupContractListeners();  // Re-build Contract listener
    }, 1000);
  });

  ws.on('error', (err) => {
    wsStatus = 'error';
    console.error('WebSocket Error:', err.message);

    // 5. On error, also terminate. This will trigger the 'close' event above.
    const currentWs = alchemyWsProvider ? (alchemyWsProvider.websocket || alchemyWsProvider._websocket) : null;
    if (currentWs) {
      currentWs.terminate();
    }
  });
}

// Retry wrapper for getCoin
async function retryGetCoin(address, chainId) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await rateLimitedZoraCall(() => getCoin({ address, chain: chainId, apiKey: ZORA_READ_API_KEY }));
    } catch (err) {
      console.warn(`getCoin retry ${attempt}/3 failed for ${address}: ${err.message}`);
      if (attempt < 3) await new Promise(r => setTimeout(r, 1000));
      else throw err;
    }
  }
}

/**
 * Attaches listeners for CoinCreatedV4 events.
 */
function setupContractListeners() {
  if (contractListenersAttached) {
    console.log('setupContractListeners: Already attached, skipping.');
    return;
  }

  try {
     zoraFactoryContract = new ethers.Contract(ZORA_FACTORY_ADDRESS, ZORA_FACTORY_ABI, alchemyWsProvider);
  } catch (err) {
     console.error('Failed to re-init zoraFactoryContract:', err.message);
     return;
  }
  
  contractListenersAttached = true;
  console.log(`🎧 Listening for CoinCreatedV4 events (Content Coins) from ${ZORA_FACTORY_ADDRESS}...`);

// --- NEW: LISTENER FOR TREND COINS ---
  zoraFactoryContract.on('TrendCoinDeployed', async (symbol, coin, caller, event) => {
    console.log(`🔥 NEW TREND COIN DEPLOYED: ${symbol} at ${coin}`);

    if (botConfig.botState !== 'running' || !botConfig.trendingSnipingEnabled) return;

    try {
      // Trend Coins use a deterministic address based on ticker
      // We log this to the activity feed for the UI
      if (db) {
        await db.collection(ACTIVITY_FEED_COLLECTION).add({
          type: 'TREND_COIN_DETECTED',
          coin: coin,
          symbol: symbol,
          creator: caller,
          txHash: event.log.transactionHash,
          timestamp: Date.now(),
          chain: 'zora'
        });
      }

      // Immediately trigger the Sniper Tax/Momentum logic for the new Trend Coin
      const trendContext = { source: 'trend_listener', isTrending: true };
      await handleAutoBuy(coin, caller, symbol, symbol, trendContext);

    } catch (err) {
      console.error(`Error processing TrendCoinDeployed: ${err.message}`);
    }
  });

  zoraFactoryContract.on('CoinCreatedV4', async (caller, payoutRecipient, platformReferrer, currency, uri, name, symbol, coin, poolKey, poolKeyHash, version, event) => {
    const logData = {
      creator: caller,
      coin: coin,
      name: name,
      symbol: symbol,
      txHash: event.log.transactionHash,
      version: version,
      hook: poolKey ? poolKey.hook : null,
      poolKeyHash: poolKeyHash,
      isV4: true,
      coinType: 'Content'
    };

    console.log('🎉 Detected new V4 coin:', JSON.stringify(logData, null, 2));

    // ALWAYS publish to activity feed immediately so Telegram Channel & Live Scanner broadcast all V4 discoveries!
    try {
      if (db) {
        await db.collection(ACTIVITY_FEED_COLLECTION).add({
          ...logData,
          type: 'CONTENT_COIN_V4',
          timestamp: Date.now(),
          chain: 'zora'
        });
      }
    } catch (feedErr) {
      console.error(`Error saving V4 coin to activity feed: ${feedErr.message}`);
    }

    const isTracked = trackedCreatorSet.has(caller.toLowerCase());
    const isRuleMatch = isTargetMatch(symbol, name);

    // LOGIC: Skip auto-buy if creator isn't tracked AND there is no symbol/name match
    if (!isTracked && !isRuleMatch) {
      console.log(`WS Sniper: Creator ${caller} not tracked and no targeting match—skipping auto-buy.`);
      return;
    }
    
    if (isRuleMatch && !isTracked) {
      console.log(`🎯 TARGETING HIT: Detected "${name}" (${symbol}) from untracked creator ${caller}.`);
    }

    console.log('DEBUG: V4 Event: Creator', caller.toLowerCase(), 'State', botConfig.botState, 'Tracked? YES (in-memory)');

    let isV4Coin = version && version.includes('ContentCoin');
    let coinTypeDebug = "Unknown (from event)";

    if (!isV4Coin) {
      try {
        const coinData = await rateLimitedZoraCall(() => getCoin({ address: coin, chain: base.id, apiKey: ZORA_READ_API_KEY }));
        const sdkVersion = coinData.data?.zora20Token?.version || '';
        const sdkCoinType = coinData.data?.zora20Token?.coinType || '';
        
        console.log(`WS Sniper: SDK fetch for ${coin} (${name}): version="${sdkVersion}", coinType="${sdkCoinType}"`);
        
        if (sdkCoinType === 'Content' || sdkCoinType === 'Media' || sdkVersion.includes('ContentCoin')) {
          isV4Coin = true;
          coinTypeDebug = sdkCoinType || "Content (from version string)";
        }
      } catch (fetchErr) {
        console.warn(`WS Sniper: SDK fetch failed for ${coin}: ${fetchErr.message}—skipping.`);
      }
    }

    if (!isV4Coin) {
      try {
        const coinTypeAbi = ['function coinType() external view returns (uint8)'];
        const coinContract = new ethers.Contract(coin, coinTypeAbi, ethersProvider);
        const coinTypeUint = await coinContract.coinType();
        const coinTypeStr = coinTypeUint.toString();
        
        console.log(`WS Sniper: Contract coinType() for ${coin}: ${coinTypeStr}`);
        
        if (coinTypeStr === '1' || coinTypeStr === '2') {
          isV4Coin = true;
          coinTypeDebug = coinTypeStr === '1' ? 'Media (Type 1)' : 'Content (Type 2)';
        }
      } catch (contractErr) {
        console.warn(`WS Sniper: coinType() query failed for ${coin}: ${contractErr.message}—assuming non-target.`);
      }
    }

    if (!isV4Coin) {
      console.log(`WS Sniper: Detected V4 coin ${name} (${coin}) is not Media or Content Coin (version="${version}"); skipping auto-buy.`);
      return;
    }

    console.log(`🎉 V4 Coin (${coinTypeDebug}): ${name} (${version}) TX ${logData.txHash} by ${caller}`);

    try {
      if (botConfig.botState !== 'running') {
        console.log(`Bot is ${botConfig.botState}, skipping auto-buy for ${name}.`);
        return;
      }

      console.log(`Tracked creator ${caller} dropped new Content Coin V4. Initiating auto-buy...`);
      await notify('CONTENT_POST_V4', `New Content Coin V4 by ${caller}: ${name} (${symbol}) at ${coin}. Attempting auto-buy.`);
        
      const context = { source: 'contract_listener' };
      await handleAutoBuy(coin, caller, name, symbol, context);

    } catch (err) {
      console.error(`Error processing CoinCreatedV4 event: ${err.message}`);
      await notify('ERROR', `V4 Event processing failed: ${err.message}`);
    }
  });

  // --- ADDED: LISTENER FOR CREATOR COINS (PROFILES) ---
  // --- CORRECTED: LISTENER FOR CREATOR COINS (PROFILES) ---
  zoraFactoryContract.on('CreatorCoinCreated', async (caller, payoutRecipient, platformReferrer, currency, uri, name, symbol, coin, poolKey, poolKeyHash, version, event) => {
    
    const creatorLower = caller.toLowerCase();

    console.log(`💎 Creator Profile Coin Detected: ${name} (${symbol}) by ${caller}`);

    // Record in activity feed immediately for discovery stream & Telegram channel
    try {
      if (db) {
        await db.collection(ACTIVITY_FEED_COLLECTION).add({
          creator: creatorLower, 
          coin: coin, 
          name: name, 
          symbol: symbol, 
          txHash: event ? event.log?.transactionHash : '',
          type: 'CREATOR_COIN_PROFILE', 
          timestamp: Date.now(),
          chain: 'zora'
        });
      }
    } catch (feedErr) {
      console.error(`Error saving Creator Coin to activity feed: ${feedErr.message}`);
    }

    // Check if we auto-buy this creator
    const isTracked = trackedCreatorSet.has(creatorLower);
    
    // If NOT tracked AND Free Trader Mode is OFF, then skip auto-buy.
    if (!isTracked && !botConfig.freeTraderMode) {
        console.log(`💎 WS Creator Sniper: Profile coin by ${caller} detected—skipping untracked auto-buy.`);
        return;
    }

    if (!isTracked && botConfig.freeTraderMode) {
        console.log(`🎲 FREE TRADER: Random coin by ${caller} detected. Proceeding...`);
    }

    try {
      // 2. Check bot state
      if (botConfig.botState !== 'running') {
        console.log(`Bot is ${botConfig.botState}, skipping Creator Coin buy for ${name}.`);
        return;
      }

      await notify('CREATOR_LAUNCH', `🚀 NEW PROFILE COIN by ${caller}: ${name} (${symbol}). Buying to HOLD.`);
      
      const context = { source: 'creator_listener' };
      
      // 3. Trigger Buy: 'true' flag ensures it uses creatorTradeAmountEth and avoids the sell loop
      await handleAutoBuy(coin, creatorLower, name, symbol, context, true);

    } catch (err) {
      console.error(`Error processing CreatorCoinCreated event: ${err.message}`);
    }
  });
}

/**
 * Attaches listeners for NFT Transfer events.
 */
function setupNFTListeners() {
  if (nftListenersAttached) {
    console.log('setupNFTListeners: Already attached, skipping.');
    return;
  }
  
  try {
    nftContract = new ethers.Contract(ZORA_NFT_CONTRACT, ZORA_NFT_ABI, alchemyWsProvider);
  } catch (err) {
     console.error('Failed to re-init nftContract:', err.message);
     return;
  }
  
  nftListenersAttached = true;
  console.log(`🎧 Listening for NFT Transfers to tracked wallets on Zora ERC721Drop ${ZORA_NFT_CONTRACT}...`);

  nftContract.on('Transfer', async (from, to, tokenId, event) => {
    if (!trackedCreatorSet.has(to.toLowerCase())) return;

    console.log(`🎉 NFT Transfer to tracked wallet ${to}: Token ID ${tokenId}, TX ${event.log.transactionHash}`);

   try {
      const profileCoins = await rateLimitedZoraCall(() => getProfileCoins({ identifier: to, chainIds: [base.id], apiKey: ZORA_READ_API_KEY }));
      let coins = profileCoins.data?.profile?.createdCoins?.edges || [];
      coins = coins.sort((a, b) => new Date(b.node.createdAt) - new Date(a.node.createdAt));
      const recentCoin = coins[0]?.node;
      if (!recentCoin) return;

      const coinAddress = recentCoin.address;
      const coinData = await rateLimitedZoraCall(() => getCoin({ address: coinAddress, chain: base.id, apiKey: ZORA_READ_API_KEY }));
      
      const version = coinData.data?.zora20Token?.version || '';
      const sdkCoinType = coinData.data?.zora20Token?.coinType || '';
      const isContentOrMedia = sdkCoinType === 'Content' || sdkCoinType === 'Media' || version.includes('ContentCoin');

      if (!isContentOrMedia) {
        console.log(`WS NFT: Not Content/Media Coin for ${coinAddress}. Skipping.`);
        return;
      }

      const swaps = await rateLimitedZoraCall(() => getCoinSwaps({ address: coinAddress, chain: base.id, first: 1, apiKey: ZORA_READ_API_KEY }));
      if (!swaps.data?.zora20Token?.swaps?.edges?.[0]) {
        console.log(`WS NFT: No liquidity for ${coinAddress}. Skipping.`);
        return;
      }

      const creatorAddress = to;
      const name = recentCoin.name || 'Unknown';
      const symbol = recentCoin.symbol || 'UNK';
      
      const context = { source: 'nft_transfer' };
      await handleAutoBuy(coinAddress, creatorAddress, name, symbol, context);

    } catch (err) {
      console.error(`WS NFT: Error processing transfer for ${to}: ${err.message}`);
    }
  });
}

async function monitorKeywordTargets() {
  // Helper for persistent retries so we don't "give up" on a sell
  const persistentSell = async (address, amount, symbol) => {
    let sold = false;
    let attempts = 0;
    const maxWait = 30000;

    while (!sold && attempts < 8) {
      try {
        attempts++;
        console.log(`[Attempt ${attempts}] 🔄 Persistent Sell initiating for ${symbol}...`);
        await marketSell(address, amount);
        sold = true; 
        console.log(`✅ SUCCESS: ${symbol} sold after ${attempts} attempts.`);
      } catch (err) {
        const delay = Math.min(BACKOFF_BASE_MS * Math.pow(2, attempts), maxWait);
        console.error(`❌ Sell Failed for ${symbol} (Attempt ${attempts}): ${err.message}. Retrying...`);
        
        if (err.message.includes("insufficient funds") || err.message.includes("amount exceeds balance")) {
            console.log("⚠️ Potential ghost success. Check manually.");
            sold = true; 
        } else {
            await new Promise(r => setTimeout(r, delay));
        }
      }
    }
    if (!sold) console.error(`❌ Gave up selling ${symbol} after 8 attempts`);
  };

  for (const [address, pos] of activePositions.entries()) {
    if (!pos.isKeywordTarget) continue;

    try {
      const coinData = await retryGetCoin(address, base.id);
      const currentPriceEth = parseFloat(coinData.data?.zora20Token?.priceInEth || 0);
      const currentUsdValue = (parseFloat(pos.receivedBuyTokenAmount) / 1e18) * currentPriceEth * ethPriceUsd;
      
      const holdersRes = await getCoinHolders({ chainId: base.id, address, count: 550, apiKey: ZORA_READ_API_KEY });
      const currentHolders = (holdersRes.data?.zora20Token?.tokenBalances?.edges || []).length;

      // TRIGGER A: Take Profit
      if (currentUsdValue >= botConfig.symbolTargetTakeProfitUsd) {
        console.log(`🎯 TP HIT: ${pos.symbol} at $${currentUsdValue.toFixed(2)}.`);
        activePositions.delete(address); // Remove from monitor first to prevent loop overlap
        await persistentSell(address, pos.receivedBuyTokenAmount, pos.symbol);
        continue;
      }

      // TRIGGER B: Partial Profit (Handles its own state via partialSellCount)
      if (currentUsdValue >= botConfig.symbolTargetPartialProfitUsd && pos.partialSellCount === 0) {
        console.log(`💰 PARTIAL TP: ${pos.symbol} > $${botConfig.symbolTargetPartialProfitUsd}. Selling 50%.`);
        const half = BigInt(pos.receivedBuyTokenAmount) / 2n;
        pos.partialSellCount = 1;
        pos.receivedBuyTokenAmount = (BigInt(pos.receivedBuyTokenAmount) - half).toString();
        await persistentSell(address, half.toString(), pos.symbol);
      }

      // TRIGGER C: FIXED TIMER
      const minutesSinceBuy = (Date.now() - (pos.boughtAt || Date.now())) / 60000;
      if (minutesSinceBuy >= botConfig.symbolTargetTimerMinutes) {
        console.log(`⏰ TARGET TIMER HIT: ${pos.symbol} held ${minutesSinceBuy.toFixed(1)} min → SELLING`);
        activePositions.delete(address);
        await persistentSell(address, pos.receivedBuyTokenAmount, pos.symbol);
        
        // Bonus: Update Firestore Status
        if (db) {
          const tradeDoc = await db.collection('trades')
            .where('tokenAddress', '==', address)
            .where('status', '==', 'bought')
            .get();
          tradeDoc.docs.forEach(doc => 
            doc.ref.update({ status: 'sold', soldAt: Date.now(), sellReason: 'Keyword_Target_Timer' })
          );
        }
        continue;
      }

      // TRIGGER D: Stop Loss
      const priceAtBuy = parseFloat(pos.priceAtBuy || 0);
      const lossPercent = ((priceAtBuy - currentPriceEth) / priceAtBuy) * 100;
      if (lossPercent >= botConfig.symbolTargetStopLossPercent) {
          console.log(`🛑 STOP LOSS HIT: ${pos.symbol} down ${lossPercent.toFixed(2)}%. Selling.`);
          activePositions.delete(address);
          await persistentSell(address, pos.receivedBuyTokenAmount, pos.symbol);
          continue;
      }

    } catch (err) {
      console.error(`Error monitoring ${pos.symbol}:`, err.message);
    }
  }
}

async function checkGlobalSellRules() {
  if (botConfig.botState !== 'running' || activePositions.size === 0) return;
  // This satisfies the polling requirement and prevents the crash
  console.log(`System: Checking global rules for ${activePositions.size} positions.`);
}

/**
 * Logic to wait for Tax Decay and check for Momentum/Inertia before buying.
 */
async function waitForSniperWindow(coinAddress, name, context = {}) {
  const startTime = Date.now();
  let momentumMet = false;
  
  // 1. If we just want a fixed timer delay
  if (botConfig.taxTimerEnabled && !botConfig.microInertiaEnabled) {
    const delay = botConfig.taxTimerSeconds * 1000;
    console.log(`⏳ Tax Timer: Waiting ${botConfig.taxTimerSeconds}s...`);
    await new Promise(r => setTimeout(r, delay));
    return true;
  }

  // 2. Tax Arbitrage / Micro-Inertia / Momentum Polling Loop
  while (true) {
    const elapsed = Date.now() - startTime;
    
    // Check if we hit our target frontrun window (e.g., 8.5s)
    if (botConfig.taxArbitrageEnabled && elapsed >= botConfig.taxFrontrunTargetMs) {
      console.log(`🎯 Tax Window Hit: ${elapsed}ms elapsed. Executing.`);
      return true;
    }

   // Check for Micro-Inertia (Early Buys) or Pre-buy Momentum
    if (botConfig.microInertiaEnabled || botConfig.preBuyMomentumEnabled) {
      try {
        const coinData = await rateLimitedZoraCall(() => getCoin({ address: coinAddress, chain: base.id, apiKey: ZORA_READ_API_KEY }));
        
        // FIX: Extracting stats safely from the response
        const stats = coinData.data?.zora20Token; 
        const currentMCap = parseFloat(stats?.marketCap || '0'); 

        if (db) {
          const holdersRes = await rateLimitedZoraCall(() => getCoinHolders({ address: coinAddress, chainId: base.id, apiKey: ZORA_READ_API_KEY }));
          const hCount = (holdersRes.data?.zora20Token?.tokenBalances?.edges || []).length;

          await db.collection(ACTIVITY_FEED_COLLECTION).add({
            type: 'MOMENTUM_UPDATE',
            name: name, 
            coin: coinAddress,
            mCap: currentMCap, 
            holders: hCount,
            // ADD THESE TWO LINES SO THE UI CAN READ THEM IN THE TITLE:
            mcAtTime: currentMCap.toFixed(2),
            holdersAtTime: hCount,
            elapsedMs: Date.now() - startTime,
            timestamp: Date.now()
          });
        }
       

        // --- ADD MOMENTUM STATUS LOG ---
        if (db) {
          const currentMC = parseFloat(stats?.marketCap || '0');
          const holdersRes = await rateLimitedZoraCall(() => getCoinHolders({ address: coinAddress, chainId: base.id, apiKey: ZORA_READ_API_KEY }));
          const hCount = (holdersRes.data?.zora20Token?.tokenBalances?.edges || []).length;

          await db.collection(ACTIVITY_FEED_COLLECTION).add({
            type: 'MOMENTUM_UPDATE',
            coin: coinAddress,
            mCap: currentMC,
            holders: hCount,
            // ADD THESE TWO LINES SO THE UI CAN READ THEM IN THE TITLE:
            mcAtTime: currentMCap.toFixed(2),
            holdersAtTime: hCount,
            elapsedMs: Date.now() - startTime,
            timestamp: Date.now()
          });
        }
        // --- END ADDED LOG ---

         // --- START YOUR NEW TRIGGER LOGIC ---
        try {
            const currentMC = parseFloat(stats?.marketCap || '0');
            
            // Trigger buy if MC hits your target (e.g., $5,000)
            if (botConfig.triggerMC && currentMC >= botConfig.triggerMC) { 
                console.log(`🎯 MC Trigger Hit: $${currentMC}. Executing early buy.`);
                if (context) context.detectedMomentum = currentMC; 
                return true; 
            }

            // Trigger buy if Holder Count hits your target (e.g., 10 holders)
            const holdersRes = await rateLimitedZoraCall(() => getCoinHolders({ address: coinAddress, chainId: base.id, apiKey: ZORA_READ_API_KEY }));
            const holderCount = (holdersRes.data?.zora20Token?.tokenBalances?.edges || []).length;
            
            if (botConfig.triggerHolders && holderCount >= botConfig.triggerHolders) {
                console.log(`👥 Holder Trigger Hit: ${holderCount} holders. Executing.`);
                if (context) context.detectedInertia = holderCount;
                return true;
            }
        } catch (innerErr) { console.warn("MC/Holder check lag:", innerErr.message); }
        // --- END YOUR NEW TRIGGER LOGIC ---
        
       if (botConfig.preBuyMomentumEnabled) {
          const currentMCap = parseFloat(stats?.marketCap || '0');
          const targetMCap = parseFloat(botConfig.preBuyMinEthVolume || '0'); // Using your field as the MC target
          
          if (currentMCap >= targetMCap) {
             console.log(`📈 MC Momentum Hit: $${currentMCap.toFixed(2)} / Target: $${targetMCap}. Buying.`);
             if (context) context.detectedMomentum = currentMCap; 
             return true;
          }
        }

        if (botConfig.microInertiaEnabled) {
          const swaps = await rateLimitedZoraCall(() => getCoinSwaps({ address: coinAddress, chain: base.id, first: 10, apiKey: ZORA_READ_API_KEY }));
          const earlyBuys = (swaps.data?.zora20Token?.swaps?.edges || []).length;
          if (earlyBuys >= botConfig.microInertiaMinBuys) {
            console.log(`🚀 Micro-Inertia: ${earlyBuys} early buys detected. Frontrunning tax drop.`);
            if (context) context.detectedInertia = earlyBuys; // Capture for UI
            return true;
          }
        }
      } catch (e) { console.warn("Inertia check failed, retrying..."); }
    }

    
   if (elapsed > 11000) {
      // MANDATORY MOMENTUM: If Free Trader is ON, we REQUIRE a hit. 
      // We no longer return 'true' just because time ran out.
      console.log(`❌ Mandatory Requirement Fail: ${coinAddress} reached 11s with no MC/Holder trigger. Aborting.`);
      return false; 
    }
    await new Promise(r => setTimeout(r, 500));
  }
}


/**
 * Checks and increments a daily counter for Creator Coin buys.
 * Returns true if we are UNDER the limit.
 */
async function checkAndIncrementDailyCreatorLimit() {
  if (!db) return true;
  const today = new Date().toISOString().split('T')[0]; // Format: YYYY-MM-DD
  const dailyRef = db.collection('stats').doc(`daily_${today}`);

  try {
    return await db.runTransaction(async (transaction) => {
      const doc = await transaction.get(dailyRef);
      const currentCount = doc.exists ? (doc.data().creatorCoinsBought || 0) : 0;

      if (currentCount >= botConfig.maxCreatorCoinsPerDay) {
        console.log(`🚫 Daily Limit Reached: Already bought ${currentCount} Creator Coins today.`);
        return false;
      }

      // If we are under the limit, increment (but don't commit yet—buy logic happens next)
      // Actually, we increment here to "reserve" the spot.
      transaction.set(dailyRef, { creatorCoinsBought: currentCount + 1 }, { merge: true });
      return true;
    });
  } catch (err) {
    console.error("Daily limit check error:", err.message);
    return false; // Fail safe
  }
}

/**
 * Handles the auto-buy logic with an atomic database lock to prevent race conditions.
 * Allows retries on failure.
 */
async function handleAutoBuy(coinAddress, creatorAddress, name, symbol, context = {}, isCreatorCoin = false) {
  const lowerCoinAddress = coinAddress.toLowerCase();
  const lowerCreatorAddress = creatorAddress.toLowerCase();

// --- ADD THIS BLOCK HERE ---
  if (db) {
    await db.collection(ACTIVITY_FEED_COLLECTION).add({
      type: 'SCANNING_COIN',
      name: name,
      symbol: symbol,
      coin: lowerCoinAddress,
      creator: lowerCreatorAddress,
      status: 'Evaluating Requirements...',
      timestamp: Date.now()
    }).catch(e => console.error("Scanner log failed:", e.message));
  }
  // --- END ADDED BLOCK ---
  
 // 1. DUAL-GATE CHECK WITH PAUSE RESPECT:
  const creatorDoc = await db.collection(TARGET_USERS_COLLECTION).doc(lowerCreatorAddress).get();
  const creatorExists = creatorDoc.exists;
  const isPaused = creatorExists && creatorDoc.data().status === 'paused';

  // If the user exists in your list and is paused, skip entirely (even if keywords match)
  if (isPaused) {
    console.log(`🚫 SKIP: Creator ${lowerCreatorAddress} is in target list but is currently PAUSED.`);
    return;
  }

 const isTrackedInDB = trackedCreatorSet.has(lowerCreatorAddress);
  const isRuleMatch = isTargetMatch(symbol, name);

  // LOGIC GATE: 
  // 1. If it's a tracked creator -> PROCEED
  // 2. If it's a keyword hit (regardless of creator) -> PROCEED
  // 3. If Free Trader Mode is ON (Momentum Snipe) -> PROCEED
  // --- UI SYMBOL/NAME TARGETING FILTER (Only for Keyword Hits) ---
  if (isRuleMatch && botConfig.symbolTargetingEnabled) {
    const upperSymbol = (symbol || "").toUpperCase();
    const upperName = (name || "").toUpperCase();
    const keywords = botConfig.targetKeywords.split(',').map(k => k.trim().toUpperCase()).filter(Boolean);

    const matchesKeyword = keywords.some(k => upperSymbol.includes(k) || upperName.includes(k));
    const lengthValid = botConfig.requireFourLetterSymbol ? symbol.length === 4 : true;
    const capsValid = botConfig.requireAllCapsSymbol ? symbol === upperSymbol : true;

    // FIX: Only reject if it's NOT Free Trader Mode and NOT a Tracked User
    if (!botConfig.freeTraderMode && !isTrackedInDB) {
        if (!matchesKeyword || !lengthValid || !capsValid) {
          console.log(`🚫 UI Filter: ${symbol} rejected. No keyword match.`);
          return; 
        }
    } else if (botConfig.freeTraderMode && !matchesKeyword) {
        console.log(`📈 MOMENTUM MODE: No keyword match for ${symbol}, but Free Trader is ON. Proceeding to momentum check.`);
    }
    
    // FIX: Added missing quotes in the console log below
    console.log(`🎯 TARGETING HIT: Detected "${name}" (${symbol}) from untracked creator ${creatorAddress}.`);
  }

  if (isRuleMatch && !isTrackedInDB) {
    console.log(`🎯 GLOBAL KEYWORD HIT: "${name}" detected. Bypassing creator check.`);
  }

  const rules = creatorSellRules.get(lowerCreatorAddress) || {};


  // --- ANTI-REKT SKIP LOGIC ---
  if (rules.antiRektEnabled && !isCreatorCoin) {
    if (rules.skipNext) {
      console.log(`🛡️ ANTI-REKT: Skipping buy for ${lowerCreatorAddress} to break loss streak.`);
      await notify('INFO', `Anti-Rekt: Skipping ${name} to recover from losses.`);
      await db.collection(TRACKED_CREATORS_COLLECTION).doc(lowerCreatorAddress).update({ skipNext: false });
      return; 
    }

    try {
      const pastTrades = await db.collection('trades')
        .where('creatorAddress', '==', lowerCreatorAddress)
        .orderBy('boughtAt', 'desc').limit(rules.antiRektStreak).get();

      if (pastTrades.size >= rules.antiRektStreak) {
        const streakLosses = pastTrades.docs.filter(d => (d.data().status === 'sold' || d.data().status === 'error') && parseFloat(d.data().liveProfitPercent || 0) <= rules.antiRektLossLimit);
        if (streakLosses.length === rules.antiRektStreak) {
          console.log(`🚨 ANTI-REKT: Loss streak hit for ${lowerCreatorAddress}. Flagging next skip.`);
          await db.collection(TRACKED_CREATORS_COLLECTION).doc(lowerCreatorAddress).update({ skipNext: true });
          return; 
        }
      }
    } catch (e) { console.error("Anti-Rekt Check Error:", e.message); }
  }

  // 1. ATOMIC LOCK: Use 'processedCoins' to ensure only one trigger wins.
  if (db) {
    const dedupRef = db.collection('processedCoins').doc(lowerCoinAddress);
    try {
      await db.runTransaction(async (transaction) => {
        const doc = await transaction.get(dedupRef);
        if (doc.exists) {
          const tenMinutesAgo = Date.now() - (10 * 60 * 1000);
          if (doc.data().timestamp > tenMinutesAgo) {
            throw new Error('ALREADY_PROCESSED');
          }
        }
        transaction.set(dedupRef, { timestamp: Date.now(), name, creator: creatorAddress });
      });
    } catch (err) {
      if (err.message === 'ALREADY_PROCESSED') return; 
      console.error(`handleAutoBuy: Dedup error for ${lowerCoinAddress}: ${err.message}`);
    }
  }

  // 2. DETERMINE TRACKING STATUS
  const isTracked = trackedCreatorSet.has(lowerCreatorAddress);

  // 3. DAILY LIMIT CHECK (Bypass for Tracked Users OR Keyword Matches)
  const isKeywordHit = context.source === 'contract_listener' && isTargetMatch(symbol, name);

  if (!isTracked && !isKeywordHit) {
    // Only apply limits if NOT a tracked creator AND NOT a keyword match
    const canBuy = await checkAndIncrementDailyCreatorLimit();
    if (!canBuy) {
      await notify('INFO', `Skipped ${name}: Daily random limit reached.`);
      return;
    }
  } else {
    console.log(`🎯 TARGET PRIORITY: Bypassing limits for ${isKeywordHit ? 'Keyword Match' : 'Tracked User'}: ${lowerCreatorAddress}`);
  }

  // 3. DETERMINE BUY AMOUNT & SOCIAL AUDIT
  const creatorRules = creatorSellRules.get(lowerCreatorAddress) || {};

  
  // Logic: 1. Manual Override > 2. Content Amount (for Keyword Targets) > 3. Creator Amount > 4. Global Content Amount
  const rawAmt = rules.buyAmountEthOverride || 
                 (isRuleMatch ? botConfig.randomTradeAmountEth : 
                 (isCreatorCoin ? botConfig.creatorTradeAmountEth : botConfig.contentTradeAmountEth));

  // 3. SOCIAL AUDIT (Bypass for Tracked Targets)
  if (isCreatorCoin && isTracked) {
    console.log(`✅ TARGET MATCH: Bypassing social audit for ${name} (Tracked User).`);
  } else if (isCreatorCoin && !isTracked) {
    try {
      let profile = null;
      let attempts = 0;
      const MAX_ATTEMPTS = 5;

      // --- NEW: RETRY LOOP TO BEAT INDEXER LAG ---
      while (!profile && attempts < MAX_ATTEMPTS) {
        if (attempts > 0) {
          console.log(`⏳ [Attempt ${attempts}] Waiting for Zora indexer to link socials for ${name}...`);
          await new Promise(r => setTimeout(r, 1500)); // Wait 1.5s between retries
        }

        // 1. Try getting profile via the Coin record
        const coinRes = await rateLimitedZoraCall(() => getCoin({ 
          address: coinAddress, 
          chain: base.id, 
          apiKey: ZORA_READ_API_KEY 
        }));
        profile = coinRes?.data?.zora20Token?.creatorProfile;

        // 2. FALLBACK: If coin record is empty, query the wallet address directly
        if (!profile) {
          const directProfile = await rateLimitedZoraCall(() => getProfile({ 
            identifier: lowerCreatorAddress, 
            apiKey: ZORA_READ_API_KEY 
          }));
          profile = directProfile?.data?.profile;
        }
        
        attempts++;
      }

      if (!profile) {
        console.log(`❌ Skip: No profile data found for ${name} after ${MAX_ATTEMPTS} retries.`);
        if (!botConfig.bypassCreatorFollowerCheck) return;
      }

      const social = profile?.socialAccounts || {};
      
      // RELIABLE DETECTION: Any non-empty username on any platform
      const hasLinkedSocial = Object.values(social).some(p => p?.username && p.username.trim() !== "");

      const followers = {
        x: social.twitter?.followerCount || 0,
        farcaster: social.farcaster?.followerCount || 0,
        instagram: social.instagram?.followerCount || 0,
        tiktok: social.tiktok?.followerCount || 0
      };
      const maxFollowers = Math.max(...Object.values(followers));

      console.log(`🔍 Social Audit [${name}]: Linked: ${hasLinkedSocial}, Max Followers: ${maxFollowers} (Found on attempt ${attempts})`);

      // --- LOG SOCIAL DATA TO FIRESTORE ---
      if (db) {
        await db.collection(ACTIVITY_FEED_COLLECTION).add({
          type: 'SOCIAL_AUDIT',
          coin: lowerCoinAddress,
          creator: lowerCreatorAddress,
          name,
          symbol,
          hasLinkedSocial,
          maxFollowers,
          platforms: Object.entries(social)
            .filter(([_, data]) => data?.username)
            .map(([p]) => p),
          timestamp: Date.now(),
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) 
        }).catch(e => console.warn("Social Log Error:", e.message));
      }

     // 3. DECISION GATE (Corrected Logic)
      
      // STEP A: Mandatory Verification Check
      if (!hasLinkedSocial) {
          console.log(`❌ Skip: ${name} is UNVERIFIED (No linked socials found). Code prevents buying unverified wallets.`);
          return; // This now kills the process for any unverified coin
      }

      // STEP B: Conditional Follower Check
      if (!botConfig.bypassCreatorFollowerCheck) {
          // If we are NOT bypassing, check the threshold
          if (maxFollowers < botConfig.creatorFollowerThreshold) {
             console.log(`❌ Rule Failed: ${name} is verified but only has ${maxFollowers} followers. Threshold is ${botConfig.creatorFollowerThreshold}. Skipping.`);
             return;
          }
          console.log(`✅ Verified & High Reach: Proceeding with buy for ${name}.`);
      } else {
          // If bypass is ON, we only care that they are verified (which we checked in Step A)
          console.log(`⚡ Follower Bypass Active: Buying verified creator ${name} regardless of follower count (${maxFollowers}).`);
      }
    } catch (err) {
      console.error("❌ Social Audit Error:", err.message);
      if (!botConfig.bypassCreatorFollowerCheck) return;
    }
  } else {
    console.log(`ℹ️ Content Coin detected: Skipping social audit.`);
  }

  // --- PRE-BUY LOGGING ---
  try {
    const preBuyStats = await rateLimitedZoraCall(() => getCoin({ address: coinAddress, chain: base.id, apiKey: ZORA_READ_API_KEY }));
    const mCap = preBuyStats.data?.zora20Token?.marketCap || "0";
    const vol = preBuyStats.data?.zora20Token?.volume24h || "0";
    
    // --- ADD THIS LOG ---
    if (db) {
       await db.collection(ACTIVITY_FEED_COLLECTION).add({
         type: 'COIN_STATS_CHECK',
         coin: lowerCoinAddress,
         mCapUsd: parseFloat(mCap),
         vol24hEth: ethers.formatEther(vol),
         status: 'Checking MCap/Volume thresholds...',
         timestamp: Date.now()
       });
    }
    // --- END ADDED LOG ---

    console.log(`🔍 SCANNING: ${name} (${symbol}) | MCap: $${parseFloat(mCap).toFixed(2)} | 24h Vol: ${ethers.formatEther(vol)} ETH`);
    
    // Check Free Words Max MCap limit if enabled
    if (botConfig.freeWordsEnabled && parseFloat(mCap) > botConfig.freeWordsMaxMcapUsd) {
        console.log(`⏭️ Skipping: MCap $${mCap} exceeds Free Word limit of $${botConfig.freeWordsMaxMcapUsd}`);
        return;
    }
  } catch (e) { console.warn("Could not fetch pre-buy stats, proceeding with default checks."); }
 

  // --- NEW: SNIPER TAX & MOMENTUM DELAY ---
 if (botConfig.taxArbitrageEnabled || botConfig.taxTimerEnabled || botConfig.preBuyMomentumEnabled) {
    console.log(`⏲️ Entering Tax/Momentum wait period for ${name}...`);
    const momentumMet = await waitForSniperWindow(coinAddress, context);
    
    if (!momentumMet) {
        console.log(`🚫 Buy Aborted: ${name} did not meet momentum/inertia requirements.`);
        return; // Exits the buy process entirely
    }
  }


  // 4. CHECK BALANCE & EXECUTE BUY
  try {
    const activeUserId = userContextStore.getStore();
    let userWallet = ethersWallet;
    if (activeUserId) {
      try {
        const { loadTradingWallet } = require('./routes/onboarding');
        const loaded = await loadTradingWallet(activeUserId, process.env.ALCHEMY_RPC_URL || process.env.BASE_RPC_URL);
        userWallet = loaded.wallet;
      } catch (walletErr) {
        console.warn(`[Ephemeral] Could not load user wallet for auto-buy: ${walletErr.message}`);
      }
    }

    const balances = await withRetry(() => getAllBalances(userWallet.address));
    const amt = botConfig.tradeCurrency === 'ETH' ? ethersParseEther(rawAmt.toString()) : botConfig.tradeAmountUsdc;
    const balance = botConfig.tradeCurrency === 'ETH' ? balances.eth : balances.usdc;

    if (balance < amt) {
      await notify('BUY_WARN', `Insufficient balance to auto-buy ${name}. Need ${rawAmt}, have ${ethersFormatEther(balance)}`);
      if (db) {
        await db.collection(ACTIVITY_FEED_COLLECTION).add({
          type: 'BUY_FAIL', reason: 'Insufficient balance', coin: coinAddress, creator: creatorAddress, name, symbol, timestamp: Date.now()
        });
      }
      return; 
    }

    // --- INFINITE BUY RETRY LOOP ---
    let buyRes;
    let buySuccessful = false;
    let buyAttempt = 1;

    while (!buySuccessful) {
      try {
        console.log(`Auto-Buy Attempt #${buyAttempt} for ${name}...`);
        buyRes = await marketBuy(coinAddress, amt);
        buySuccessful = true;
      } catch (buyErr) {
        console.warn(`⚠️ Buy attempt ${buyAttempt} failed: ${buyErr.message}. Retrying in 1s...`);
        buyAttempt++;
        await new Promise(r => setTimeout(r, 1000));
        if (botConfig.botState !== 'running') return;
      }
    }

    // 5. AUTO-APPROVE (Second Transaction)
    try {
      console.log(`Approving token ${name} for selling...`);
      const abi = ['function approve(address spender, uint256 amount) returns (bool)'];
      const tokenContract = new ethers.Contract(coinAddress, abi, userWallet);
      const approveTx = await tokenContract.approve(ZORA_FACTORY_ADDRESS, ethers.MaxUint256);
      await approveTx.wait();
      console.log(`✅ Approved ${name}.`);
    } catch (approveErr) {
      console.error(`Auto-approve failed: ${approveErr.message}`);
    }

   // 6. LOG TRADE & MONITORING
    const blockTimestamp = Date.now();
    let initialHolderCount = 0;
    try {
      const holdersResponse = await rateLimitedZoraCall(() => getCoinHolders({ chainId: base.id, address: coinAddress, count: 550, apiKey: ZORA_READ_API_KEY }));
      const holders = holdersResponse.data?.zora20Token?.tokenBalances?.edges || [];
      initialHolderCount = holders.filter(h => h.node.ownerAddress.toLowerCase() !== userWallet.address.toLowerCase()).length;
    } catch (e) { console.warn("Holder count fetch failed, defaulting to 0."); }

    const tradeData = {
      tokenAddress: coinAddress, name, symbol, status: 'bought', partialSellCount: 0,
      boughtAt: blockTimestamp, spentOnSellToken: buyRes.spent.toString(),
      receivedBuyTokenAmount: buyRes.received.toString(), txHash: buyRes.txHash,
      tradeCurrency: botConfig.tradeCurrency, creatorAddress, context, initialHolderCount,
      lastHolderCount: initialHolderCount,
      lastActivityTime: Date.now(),
      isKeywordTarget: isRuleMatch,
      ownerAddress: userWallet.address.toLowerCase(),
      userId: activeUserId || defaultUserId,
      
      // --- NEW UI LIVE DATA FIELDS ---
      executionDelayMs: Date.now() - blockTimestamp, // How long we waited for tax/momentum
      buyMomentumEth: context.detectedMomentum || 0,
      buyInertiaCount: context.detectedInertia || 0,
      estimatedTaxPaid: botConfig.taxArbitrageEnabled ? "15-20%" : "0%",
      // --- NEW MEDIA & TREND DATA FOR UI ---
      imageUrl: context.imageUrl || null,
      tokenIcon: context.tokenIcon || null,
      isTrending: context.isTrending || false,
      creatorHandle: context.creatorHandle || 'Unknown',
      volume24h: context.volume24h || '0',
      marketCapUsd: context.marketCapUsd || '0',
      liveMarketCap: context.marketCapUsd || '0', // Added for UI compatibility
      // -------------------------------------
      // -------------------------------
      
      sellFails: 0
    };

    if (db) {
      // FIX: Capture the docRef to get the auto-generated ID
      const docRef = await db.collection('trades').add(tradeData);
      
      // Update local memory with the docId so the price loop can find it
      if (!isCreatorCoin) {
        activePositions.set(lowerCoinAddress, { ...tradeData, docId: docRef.id });
      }

      await db.collection(ACTIVITY_FEED_COLLECTION).add({
        type: 'BUY_SUCCESS', coin: coinAddress, creator: creatorAddress, name, symbol, 
        amount: buyRes.received.toString(), txHash: buyRes.txHash, timestamp: Date.now(), context
      });
    } 

     // --- NEW: DETAILED UI LOG FOR SNIPER STATS ---
      await db.collection(ACTIVITY_FEED_COLLECTION).add({
        type: 'SNIPER_METRICS',
        coin: coinAddress,
        name: name,
        timing: {
          delayMs: tradeData.executionDelayMs,
          taxStrategy: botConfig.taxArbitrageEnabled ? 'Decay_Arbitrage' : 'Instant',
        },
        pressure: {
          momentum: tradeData.buyMomentumEth,
          inertia: tradeData.buyInertiaCount,
          holdersAtBuy: initialHolderCount
        },
        timestamp: Date.now()
      });


    await notify('BUY', `🟢 Auto-bought ${name} (${symbol})\nSpent: ${formatUSD(rawAmt)}\nTX: ${buyRes.txHash}`);

  } catch (err) {
    console.error(`Auto-buy fatal failure for ${name}: ${err.message}`);
    await notify('ERROR', `Auto-buy failed for ${name}: ${err.message}`);
    if (db) {
      await db.collection(ACTIVITY_FEED_COLLECTION).add({
        type: 'BUY_FAIL', reason: err.message, coin: coinAddress, creator: creatorAddress, name, symbol, timestamp: Date.now()
      });
    }
  }
}

// Modified trackCoinAnalytics to validate and extract plain data
async function trackCoinAnalytics(tokenAddress) {
  if (!db) return;
  try {
    const [holdersRes, swapsRes] = await Promise.all([
      withRetry(async () => await rateLimitedZoraCall(() => getCoinHolders({ chainId: base.id, address: tokenAddress, count: 550, apiKey: ZORA_READ_API_KEY }))),
      withRetry(async () => await rateLimitedZoraCall(() => getCoinSwaps({ address: tokenAddress, chain: base.id, apiKey: ZORA_READ_API_KEY })))
    ]);

    // Extract plain data to avoid invalid objects
    const holders = holdersRes?.data?.zora20Token?.tokenBalances?.edges || [];
    const swaps = swapsRes?.data?.zora20Token?.swaps?.edges || [];

    // Ensure they are serializable (Firestore rejects non-plain objects)
    const plainHolders = JSON.parse(JSON.stringify(holders));
    const plainSwaps = JSON.parse(JSON.stringify(swaps));

    await db.collection('analytics').doc(tokenAddress).set({ 
      tokenAddress, 
      holders: plainHolders, 
      swaps: plainSwaps, 
      lastUpdated: Date.now() 
    }, { merge: true });
  } catch (err) {
    console.error(`trackCoinAnalytics error for ${tokenAddress}: ${err.message}`);
    throw err; // Let caller handle
  }
}

async function getAllBalances(targetAddress = null) {
  if (!ethersProvider) throw new Error('Ethers not initialized');
  const addressToCheck = targetAddress || (ethersWallet ? ethersWallet.address : null);
  if (!addressToCheck) throw new Error('No address to check balance.');

  let ethBalanceWei = 0n;
  let usdcBalance = 0n;

  if (botConfig.tradeCurrency === 'ETH') {
    ethBalanceWei = await ethersProvider.getBalance(addressToCheck);
  } else if (botConfig.tradeCurrency === 'USDC') {
    try {
      const abi = ['function balanceOf(address) view returns (uint256)'];
      const contract = new ethers.Contract(USDC_ADDRESS, abi, ethersProvider);
      usdcBalance = await contract.balanceOf(addressToCheck);
    } catch (err) {
      console.error("Could not fetch USDC balance:", err.message);
      throw err;
    }
  }
  
  return { eth: ethBalanceWei, usdc: usdcBalance };
}

function parseReceivedAmount(receiptObj, receiverAddress, tokenAddress) {
  if (!receiptObj || !receiverAddress) return 0n;
  const targetAddr = typeof receiverAddress === 'string' ? receiverAddress : (receiverAddress.address || '');
  if (!targetAddr) return 0n;
  const logs = receiptObj.logs || receiptObj.receipt?.logs || [];
  const transferTopic = ethers.id('Transfer(address,address,uint256)');
  const padTopic = (addr) => '0x' + String(addr).toLowerCase().replace(/^0x/, '').padStart(64, '0');
  const recvTopic = padTopic(targetAddr);

  for (const log of logs) {
    try {
      if (!log.topics || log.topics.length < 3) continue;
      if (log.topics[0] !== transferTopic) continue;
      if (tokenAddress && log.address && log.address.toLowerCase() !== tokenAddress.toLowerCase()) continue;
      if (log.topics[2].toLowerCase() !== recvTopic) continue;
      return BigInt(log.data || '0x0');
    } catch {}
  }
  return 0n;
}

async function withRetry(fn, ...args) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try { return await fn(...args); }
    catch (err) {
      console.warn(`Attempt ${attempt} failed: ${err?.message||err}`);
      if (attempt < MAX_RETRIES) await new Promise(r => setTimeout(r, BACKOFF_BASE_MS * 2 ** (attempt - 1)));
      else throw err;
    }
  }
}

async function setupBotConfigListener() {
  if (!db) {
    console.warn('Firestore not available, using default config.');
    return;
  }
  
  const configRef = db.collection('config').doc('botSettings');

  configRef.onSnapshot(docSnapshot => {
    if (docSnapshot.exists) {
      console.log('⚙️ Bot config updated from Firestore');
      const newConfig = docSnapshot.data();
      
      botConfig.botState = newConfig.botState || 'paused';
      botConfig.vaultAddress = newConfig.vaultAddress || process.env.VAULT_ADDRESS;
      botConfig.telegramEnabled = newConfig.telegramEnabled ?? true;
      botConfig.tradeCurrency = newConfig.tradeCurrency || 'ETH';
      botConfig.tradeSlippage = parseFloat(newConfig.tradeSlippage || '0.0025');
      botConfig.minimumHoldMinutes = parseInt(newConfig.minimumHoldMinutes || '5', 10);
      botConfig.tradeAmountEth = parseFloat(newConfig.tradeAmountEth || '0.0002');
      botConfig.tradeAmountUsdc = BigInt(String(newConfig.tradeAmountUsdc ?? 1e6));
      botConfig.autoWithdraw = newConfig.autoWithdraw ?? false;
      botConfig.minProfitBeforeWithdraw = BigInt(String(newConfig.minProfitBeforeWithdraw ?? '0'));
      botConfig.sellAfterUsers = parseInt(newConfig.sellAfterUsers || '1', 10);
      botConfig.creatorTradeAmountEth = parseFloat(newConfig.creatorTradeAmountEth || '0.001');
      botConfig.maxCreatorCoinsPerDay = parseInt(newConfig.maxCreatorCoinsPerDay || '5', 10);
      botConfig.bypassCreatorFollowerCheck = newConfig.bypassCreatorFollowerCheck ?? true;
      // --- ADD THESE TO THE SNAPSHOT LISTENER ---
      botConfig.freeWordsEnabled = newConfig.freeWordsEnabled ?? false;
      botConfig.freeWordsMaxMcapUsd = parseFloat(newConfig.freeWordsMaxMcapUsd || '50000');
      botConfig.trendingSnipingEnabled = newConfig.trendingSnipingEnabled ?? false;
      botConfig.buyNewProfilesOnly = newConfig.buyNewProfilesOnly ?? false;
      botConfig.minTrendVolume24h = parseFloat(newConfig.minTrendVolume24h || '0.5');
      botConfig.minTrendUniqueHolders = parseInt(newConfig.minTrendUniqueHolders || '50', 10);
      botConfig.taxArbitrageEnabled = newConfig.taxArbitrageEnabled ?? false;
      botConfig.taxFrontrunTargetMs = parseInt(newConfig.taxFrontrunTargetMs || '8500', 10);
      
      // Strategy Overrides
      botConfig.symbolTargetTimerMinutes = parseInt(newConfig.symbolTargetTimerMinutes || '2', 10);
      botConfig.symbolTargetStopLossPercent = parseFloat(newConfig.symbolTargetStopLossPercent || '20');
      
      
      // --- ADD THIS NEW LINE ---

      botConfig.creatorFollowerThreshold = parseInt(newConfig.creatorFollowerThreshold || '10000', 10);
      botConfig.maxPriorityFeeGwei = parseFloat(newConfig.maxPriorityFeeGwei || '0.05');

      botConfig.takeProfitUsd = parseFloat(newConfig.takeProfitUsd || '100.0');
      
      botConfig.freeTraderMode = newConfig.freeTraderMode ?? false;
      botConfig.maxRandomCoinsPerDay = parseInt(newConfig.maxRandomCoinsPerDay || '5', 10);
      botConfig.randomTradeAmountEth = parseFloat(newConfig.randomTradeAmountEth || '0.0005');
      botConfig.symbolTargetingEnabled = newConfig.symbolTargetingEnabled ?? false;
      botConfig.targetKeywords = newConfig.targetKeywords || '';
      botConfig.exclusionPhrases = newConfig.exclusionPhrases || ''; // ADD THIS LINE
      botConfig.requireFourLetterSymbol = newConfig.requireFourLetterSymbol ?? false;
      botConfig.requireAllCapsSymbol = newConfig.requireAllCapsSymbol ?? false;
      botConfig.taxArbitrageEnabled = newConfig.taxArbitrageEnabled ?? false;
      botConfig.taxFrontrunTargetMs = parseInt(newConfig.taxFrontrunTargetMs || '8500', 10);
      botConfig.taxTimerEnabled = newConfig.taxTimerEnabled ?? false;
      botConfig.taxTimerSeconds = parseFloat(newConfig.taxTimerSeconds || '9.5');
      botConfig.microInertiaEnabled = newConfig.microInertiaEnabled ?? false;
      botConfig.microInertiaMinBuys = parseInt(newConfig.microInertiaMinBuys || '2', 10);
      botConfig.preBuyMomentumEnabled = newConfig.preBuyMomentumEnabled ?? false;
      botConfig.preBuyMinEthVolume = parseFloat(newConfig.preBuyMinEthVolume || '0.05');
      botConfig.trendingSnipingEnabled = newConfig.trendingSnipingEnabled ?? false;
      botConfig.buyNewProfilesOnly = newConfig.buyNewProfilesOnly ?? false;
      botConfig.minTrendVolume24h = parseFloat(newConfig.minTrendVolume24h || '0.5');
      botConfig.minTrendUniqueHolders = parseInt(newConfig.minTrendUniqueHolders || '50', 10);
     botConfig.globalTakeProfitUsd = parseFloat(newConfig.globalTakeProfitUsd || '100');
botConfig.globalStopLossPercent = parseFloat(newConfig.globalStopLossPercent || '20');

      console.log(` > Bot state is now: ${botConfig.botState.toUpperCase()}`);
      console.log(` > Max Priority Fee is now: ${botConfig.maxPriorityFeeGwei} Gwei`);
    } else {
      console.log('⚠️ No botSettings document found. Creating one with defaults.');
      configRef.set(serializeForFirestore(botConfig)).catch(err => console.error("Failed to create default config:", err));
    }
  }, err => {
    console.error('Config listener error:', err);
  });
}


/**
 * Loads and syncs tracked creators AND their custom sell rules to in-memory maps.
 */
async function setupTrackedCreatorsListener() {
  if (!db) {
    console.warn('Firestore not available, tracked creators list will be empty.');
    return;
  }
  
  db.collection(TRACKED_CREATORS_COLLECTION).onSnapshot(snapshot => {
    console.log('🔄 Syncing Tracked Creators & Rules from Firestore...');
    const newSet = new Set();
    const newRulesMap = new Map();

    snapshot.docs.forEach(doc => {
      const data = doc.data();
      const creatorAddress = doc.id.toLowerCase();

      // 1. Toggle: Only track if status is 'active'
      if (data.status !== 'active') {
        console.log(`ℹ️ Creator ${creatorAddress} is ${data.status || 'inactive'}—skipping buy tracking.`);
        return; 
      }
      
      newSet.add(creatorAddress);

      // 2. Map all custom overrides and UI Toggles
      const rules = {
        autoSellEnabled: data.autoSellEnabled !== false, // UI Button toggle
        stopLossEnabled: data.stopLossEnabled !== false, // UI Button toggle
        sellAllAtOnce: data.sellAllAtOnce === true, 
        forceSellEnabled: data.forceSellEnabled === true,
        antiRektEnabled: data.antiRektEnabled === true,
        antiRektLossLimit: data.antiRektLossLimit !== undefined ? parseFloat(data.antiRektLossLimit) : -80,
        antiRektStreak: data.antiRektStreak !== undefined ? parseInt(data.antiRektStreak, 10) : 2,
        skipNext: data.skipNext === true,
        // Existing Overrides
       
        buyAmountEthOverride: data.buyAmountEthOverride ? parseFloat(data.buyAmountEthOverride) : null,
        sellAfterUsers: data.sellAfterUsersOverride ? parseInt(data.sellAfterUsersOverride, 10) : null,
        minimumHoldMinutes: data.minimumHoldMinutesOverride ? parseInt(data.minimumHoldMinutesOverride, 10) : null,
        takeProfitUsdOverride: data.takeProfitUsdOverride ? parseFloat(data.takeProfitUsdOverride) : null,
        stopLossPercentOverride: data.stopLossPercentOverride ? parseFloat(data.stopLossPercentOverride) : null,
        maxSlippageOverride: data.maxSlippageOverride ? parseFloat(data.maxSlippageOverride) : null,
        maxPriorityFeeOverride: data.maxPriorityFeeOverride ? parseFloat(data.maxPriorityFeeOverride) : null
      };

      newRulesMap.set(creatorAddress, rules);
    });

    trackedCreatorSet = newSet;
    creatorSellRules = newRulesMap;
    console.log(`✅ Monitoring ${trackedCreatorSet.size} active creators.`);
  }, err => {
    console.error('Tracked creators listener error:', err);
  });
}

// ---------------------
// --- NEYNAR HELPERS ---
// ---------------------

async function rateLimitedNeynarCall(fn, ...args) {
    const now = Date.now();
    if (now - lastNeynarCall < 1000 / NEYNAR_RATE_LIMIT_MAX) {
      await new Promise(r => setTimeout(r, 1000 / NEYNAR_RATE_LIMIT_MAX - (now - lastNeynarCall)));
    }
    lastNeynarCall = Date.now();
    return await fn(...args);
}

async function rateLimitedZoraCall(fn, ...args) {
    const now = Date.now();
    if (now - lastZoraCall < 1000 / ZORA_SDK_RATE_LIMIT_MAX) {
      await new Promise(r => setTimeout(r, 1000 / ZORA_SDK_RATE_LIMIT_MAX - (now - lastZoraCall)));
    }
    lastZoraCall = Date.now();
    return await fn(...args);
}

async function pruneOldProcessedCasts(ttlMs) {
  if (!db) return;
  try {
    const cutoff = Date.now() - ttlMs;
    const batch = db.batch();
    const snapshot = await db.collection(PROCESSED_CASTS_COLLECTION)
      .where('timestamp', '<', cutoff)
      .limit(500)
      .get();
    snapshot.docs.forEach(doc => {
      batch.delete(doc.ref);
    });
    await batch.commit();
    console.log(`Pruned ${snapshot.size} old cast hashes`);
  } catch (err) {
    console.error(`Prune casts error: ${err.message}`);
  }
}

async function isProcessedCastHash(castHash) {
  if (!db) return false;
  try {
    const now = Date.now();
    const ttlMs = 24 * 60 * 60 * 1000;
    const doc = await db.collection(PROCESSED_CASTS_COLLECTION).doc(castHash).get();
    
    if (doc.exists && now - doc.data().timestamp < ttlMs) {
      return true;
    }
    if (Math.random() < 0.05) {
      await pruneOldProcessedCasts(ttlMs);
    }
    return false;
  } catch (err) {
    console.error(`Processed cast hash check error: ${err.message}`);
    return false;
  }
}

async function markCastProcessed(castHash) {
  if (!db) return;
  await db.collection(PROCESSED_CASTS_COLLECTION).doc(castHash).set({
    timestamp: Date.now(),
  });
}

/**
 * Checks if a given FID is being tracked.
 */
async function isTrackedFid(fid) {
    if (!db) return false;
    try {
        let snapshot = await db.collection(TRACKED_CREATORS_COLLECTION).where('fid', '==', String(fid)).get();
        if (!snapshot.empty) return true;
        
        snapshot = await db.collection(TRACKED_CREATORS_COLLECTION).where('fid', '==', Number(fid)).get();
        return !snapshot.empty;
    } catch (err) {
        console.error(`isTrackedFid check failed for FID ${fid}:`, err.message);
        return false;
    }
}

async function getCreatorAddressFromFid(fid) {
  try {
    const user = await rateLimitedNeynarCall(() => neynarClient.fetchUserByFID(fid));
    return user.custodyAddress || user.verifiedAddresses?.eth_addresses[0] || null;
  } catch (err) {
    console.error(`FID ${fid} addr error: ${err.message}`);
    return null;
  }
}

/**
 * Checks a cast for mint intent and finds the matching new, liquid coin.
 */
async function detectAndGetNewCoinFromCast(fid, castHash, creatorAddress) {
  try {
    const fullCast = await rateLimitedNeynarCall(() => neynarClient.fetchCastByHash(castHash));
    const cast = fullCast.result;
    const text = (cast.text || '').toLowerCase();
    const castTimeMs = new Date(cast.createdAt).getTime();
    const hasZoraEmbed = cast.embeds?.some(embed => embed.url?.includes('zora.co')) || false;
    const hasMintIntent = text.includes('mint') || text.includes('coin') || text.includes('post to token') || hasZoraEmbed;

    if (!hasMintIntent) {
      console.log(`Cast ${castHash}: No mint intent.`);
      return null;
    }

    console.log(`Cast ${castHash}: Potential mint intent found.`);

    const profileCoins = await rateLimitedZoraCall(() => getProfileCoins({ identifier: creatorAddress, chainIds: [base.id], apiKey: ZORA_READ_API_KEY }));
    
    let coins = profileCoins.data?.profile?.createdCoins?.edges || [];
    coins = coins.sort((a, b) => new Date(b.node.createdAt) - new Date(a.node.createdAt));
    const recentCoin = coins[0]?.node;

    if (!recentCoin) {
      console.log(`Cast ${castHash}: No coins found in profile for ${creatorAddress}.`);
      return null;
    }

    const coinAddress = recentCoin.address;
    const coinData = await rateLimitedZoraCall(() => getCoin({ address: coinAddress, chain: base.id, apiKey: ZORA_READ_API_KEY }));
    
    const version = coinData.data?.zora20Token?.version || '';
    const sdkCoinType = coinData.data?.zora20Token?.coinType || '';
    const isContentOrMedia = sdkCoinType === 'Content' || sdkCoinType === 'Media' || version.includes('ContentCoin');

    if (!isContentOrMedia) {
        console.log(`Cast ${castHash}: Most recent coin ${coinAddress} is not Content/Media Coin.`);
        return null;
    }

    const swaps = await rateLimitedZoraCall(() => getCoinSwaps({ address: coinAddress, chain: base.id, first: 1, apiKey: ZORA_READ_API_KEY }));
    const recentSwap = swaps.data?.zora20Token?.swaps?.edges?.[0];
    const swapTs = Number(recentSwap?.node?.timestamp) * 1000;

    if (recentSwap && swapTs > (castTimeMs - 3 * 60 * 1000)) { 
      console.log(`Cast ${castHash}: Confirmed new, liquid Content/Media Coin: ${coinAddress}`);
      // --- MODIFIED: Return text and author for UI ---
      return { coinAddress, name: recentCoin.name, symbol: recentCoin.symbol, version, text: cast.text, author: cast.author };
    }

    console.log(`Cast ${castHash}: No new *liquid* Content/Media Coin found (Address: ${coinAddress}, Last Swap: ${new Date(swapTs)}, Cast Time: ${new Date(castTimeMs)})`);
    return null;
  } catch (err) {
    console.error(`detectAndGetNewCoinFromCast error for ${castHash}: ${err.message}`);
    return null;
  }
}

// ---------------------
// Auth Middleware
// ---------------------
async function verifyFirebaseToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(403).send('Unauthorized: No token provided.');
  }

  const idToken = authHeader.split('Bearer ')[1];
  try {
    const decodedToken = verifyJwt(idToken);
    if (!decodedToken) {
      return res.status(403).send('Unauthorized: Invalid token.');
    }
    const uid = decodedToken.uid;
    const email = (decodedToken.email || '').toLowerCase();
    const isWalletAdmin = ADMIN_WALLETS.length > 0 && ADMIN_WALLETS.includes(uid.toLowerCase());
    const isEmailUIDAdmin = ADMIN_UID && uid === ADMIN_UID;
    const isEmailAdmin = ADMIN_EMAIL && email === ADMIN_EMAIL;
    const isAdmin = isWalletAdmin || isEmailUIDAdmin || isEmailAdmin;
    const role = decodedToken.role || (isAdmin ? 'admin' : 'user');

    // Bot-control routes restricted to admins only
    const adminOnlyPaths = ['/bot/'];
    const isAdminOnlyPath = adminOnlyPaths.some(p => req.path.startsWith(p));
    if (isAdminOnlyPath && !isAdmin) {
      console.warn(`Auth_DENIED: Non-admin ${uid} tried to access admin route ${req.path}.`);
      return res.status(403).json({ error: 'Access Denied: Admin privileges required.' });
    }

    req.user = { ...decodedToken, role };
    const targetUserId = uid.toLowerCase();

    console.log(`Auth_ALLOWED: User ${targetUserId} (role: ${role}) accessed ${req.path}.`);
    await migrateUserLegacyData(targetUserId).catch(err => {
      console.error(`[Migration Error] Failed to migrate user ${targetUserId}:`, err.message);
    });
    userContextStore.run(targetUserId, () => next());
  } catch (error) {
    console.error('Error verifying token:', error);
    res.status(403).send('Unauthorized: Invalid token.');
  }
}

// ---------------------
// Market buy/sell
// ---------------------
async function marketBuy(tokenAddress, amountIn, userAddress = null) {
  return await withRetry(async () => {
    // --- Phase 3: Ephemeral Wallet Resolution ---
    const activeUserId = userContextStore.getStore();
    let signerWallet = ethersWallet;
    let signerAccount = viemAccount;
    let signerWalletClient = viemWalletClient;
    if (activeUserId) {
      try {
        const { loadTradingWallet } = require('./routes/onboarding');
        let loaded = null;
        try {
          loaded = await loadTradingWallet(activeUserId, process.env.ALCHEMY_RPC_URL || process.env.BASE_RPC_URL);
        } catch (_) {
          const altId = activeUserId.startsWith('telegram_')
            ? activeUserId.replace(/^telegram_/, '')
            : `telegram_${activeUserId}`;
          try {
            loaded = await loadTradingWallet(altId, process.env.ALCHEMY_RPC_URL || process.env.BASE_RPC_URL);
          } catch (_) {}
        }
        if (loaded && loaded.wallet) {
          signerWallet = loaded.wallet;
          const { privateKeyToAccount } = require('viem/accounts');
          const { createWalletClient, http } = require('viem');
          const rawPk = signerWallet.privateKey || loaded.privateKey || '';
          const formattedPk = rawPk.startsWith('0x') ? rawPk : `0x${rawPk}`;
          signerAccount = privateKeyToAccount(formattedPk);
          signerWalletClient = createWalletClient({ account: signerAccount, chain: base, transport: http(process.env.ALCHEMY_RPC_URL || 'https://mainnet.base.org') });
          console.log(`[Ephemeral] marketBuy using user wallet: ${signerWallet.address}`);
        }
      } catch (walletErr) {
        console.warn(`[Ephemeral] Could not load user wallet for ${activeUserId}, falling back to admin wallet: ${walletErr.message}`);
      }
    }
    // --- End Ephemeral Wallet Resolution ---

    if (!signerWallet || !signerWallet.address || !signerAccount || !signerAccount.address) {
      throw new Error('NO_WALLET_AVAILABLE: Neither user wallet nor system wallet is available for marketBuy.');
    }
    let before = 0n;
    try { before = await new ethers.Contract(tokenAddress, ['function balanceOf(address) view returns (uint256)'], ethersProvider).balanceOf(signerWallet.address); } catch {}
    
// --- NEW: Spend Permission Logic ---
    if (userAddress) {
      const userDoc = await db.collection('users').doc(userAddress.toLowerCase()).get();
      const userData = userDoc.data();

      if (userData?.spendPermission) {
        console.log(`Using Spend Permission for user: ${userAddress}`);
        
        if (!prepareSpendCallData) {
          const mod = await import("@base-org/account/spend-permission");
          prepareSpendCallData = mod.prepareSpendCallData;
        }
        
        // 1. Prepare the permission call
        const spendCalls = await prepareSpendCallData({
          permission: userData.spendPermission,
          signature: userData.spendSignature,
          amount: amountIn,
        });

        // 2. Execute the "Spend" call to move ETH from User Smart Account -> Bot Spender
        // This ensures the bot has the funds to execute the Zora trade
        for (const call of spendCalls) {
          const tx = await signerWallet.sendTransaction({
            to: call.to,
            data: call.data,
            value: call.value || 0n
          });
          await tx.wait();
        }
      }
    }
    // --- End Spend Permission Logic ---

    // --- THIS IS THE KEY CHANGE ---
    const tradeParams = { 
      sell: botConfig.tradeCurrency==='USDC'?{type:'erc20',address:USDC_ADDRESS}:{type:'eth'}, 
      buy:{type:'erc20',address:tokenAddress}, 
      amountIn:BigInt(amountIn), 
      slippage:botConfig.tradeSlippage, // From config
      sender:signerAccount.address,
      
      // --- UPDATED TO USE THE CONFIG VARIABLE ---
      maxPriorityFeePerGas: viemParseEther(botConfig.maxPriorityFeeGwei.toString(), 'gwei') 
    };
    // --- END CHANGE ---

    let volume24h = 0n;
    try {
      const coinData = await rateLimitedZoraCall(() => getCoin({ address: tokenAddress, chain: base.id, apiKey: ZORA_READ_API_KEY }));
      volume24h = coinData.data?.zora20Token?.volume24h || 0n;
      if (volume24h < viemParseEther('0.01')) {
        tradeParams.slippage = 0.05;
        console.log(`Adjusted slippage to 5% for low-volume coin ${tokenAddress} (24h vol: ${viemFormatEther(volume24h)} ETH)`);
      }
   // Adjust slippage if buying inside the 10s tax window
      if (botConfig.taxArbitrageEnabled) {
        tradeParams.slippage = 0.20; // Allow 20% to cover the ~15% tax at 8.5s
        console.log(`Adjusted slippage to 20% to account for Sniper Tax window.`);
      }
    } catch (volErr) {
      console.warn(`Volume check failed for ${tokenAddress}: ${volErr.message}—using default slippage/volume=0.`);
    }
    const tradeOptions = { 
      tradeParameters: tradeParams, 
      walletClient: signerWalletClient, 
      account: signerAccount, 
      publicClient: viemPublicClient, 
      validateTransaction: volume24h > 0n,
      chain: base 
    };
    const tradeRes = await tradeCoin(tradeOptions);
    let txHash;
    let receipt;
    if (typeof tradeRes === 'object' && tradeRes.transactionHash) {
      receipt = tradeRes;
      txHash = receipt.transactionHash;
    } else if (typeof tradeRes === 'string' && tradeRes.startsWith('0x')) {
      txHash = tradeRes;
      receipt = await viemPublicClient.waitForTransactionReceipt({ hash: txHash });
    } else {
      throw new Error(`Unexpected return from tradeCoin: ${JSON.stringify(tradeRes)}`);
    }
    
    // --- Robust balance check (from previous fix) ---
    let received = parseReceivedAmount(receipt, signerWallet.address, tokenAddress);
    if (received === 0n) {
      console.warn(`parseReceivedAmount failed for ${tokenAddress}. Retrying with balance check (1.5s delay)...`);
      try { 
        await new Promise(r => setTimeout(r, 1500)); 
        const after = await new ethers.Contract(tokenAddress, ['function balanceOf(address) view returns (uint256)'], ethersProvider).balanceOf(signerWallet.address); 
        received = after - before; 
      } catch(e) {
         console.error(`Balance check fallback 1 failed: ${e.message}`);
      }
    }
    if (received === 0n) {
       console.warn(`Balance check fallback 1 failed for ${tokenAddress}. Retrying one last time (3s delay)...`);
       try {
         await new Promise(r => setTimeout(r, 3000)); 
         const after = await new ethers.Contract(tokenAddress, ['function balanceOf(address) view returns (uint256)'], ethersProvider).balanceOf(signerWallet.address); 
         received = after - before;
       } catch (e) {
         console.error(`Balance check fallback 2 failed: ${e.message}`);
       }
    }
    if (received === 0n) {
      throw new Error(`Failed to confirm token balance for ${tokenAddress} after buy.`);
    }
    // --- End robust balance check ---

    return { tokenAddress, spent:BigInt(amountIn), received, txHash, raw: receipt };
  });
}

// After marketBuy, add this (full definition from context)
async function marketSell(tokenAddress, amountIn, options = {}) {
  return await withRetry(async () => {
    // --- Phase 3: Ephemeral Wallet Resolution ---
    const activeUserId = userContextStore.getStore();
    let signerWallet = ethersWallet;
    let signerAccount = viemAccount;
    let signerWalletClient = viemWalletClient;
    let loadedPrivateKey = null;
    if (activeUserId) {
      try {
        const { loadTradingWallet } = require('./routes/onboarding');
        let loaded = null;
        try {
          loaded = await loadTradingWallet(activeUserId, process.env.ALCHEMY_RPC_URL || process.env.BASE_RPC_URL);
        } catch (_) {
          const altId = activeUserId.startsWith('telegram_')
            ? activeUserId.replace(/^telegram_/, '')
            : `telegram_${activeUserId}`;
          try {
            loaded = await loadTradingWallet(altId, process.env.ALCHEMY_RPC_URL || process.env.BASE_RPC_URL);
          } catch (_) {}
        }
        if (loaded && loaded.wallet) {
          signerWallet = loaded.wallet;
          loadedPrivateKey = loaded.privateKey || signerWallet.privateKey || '';
          const { privateKeyToAccount } = require('viem/accounts');
          const { createWalletClient, http } = require('viem');
          const rawPk = loadedPrivateKey;
          const formattedPk = rawPk.startsWith('0x') ? rawPk : `0x${rawPk}`;
          signerAccount = privateKeyToAccount(formattedPk);
          signerWalletClient = createWalletClient({ account: signerAccount, chain: base, transport: http(process.env.ALCHEMY_RPC_URL || 'https://mainnet.base.org') });
          console.log(`[Ephemeral] marketSell using user wallet: ${signerWallet.address}`);
        }
      } catch (walletErr) {
        console.warn(`[Ephemeral] Could not load user wallet for ${activeUserId}, falling back to admin wallet: ${walletErr.message}`);
      }
    }
    // --- End Ephemeral Wallet Resolution ---

    if (!signerWallet || !signerWallet.address || !signerAccount || !signerAccount.address || !signerWalletClient || !signerWalletClient.account) {
      throw new Error(`NO_WALLET_AVAILABLE: Neither user wallet nor system wallet is properly configured for marketSell (user: ${activeUserId || 'system'}).`);
    }

    let ethBefore = 0n;
    let usdcBefore = 0n;
    const expected = botConfig.tradeCurrency === 'USDC' ? USDC_ADDRESS : null;

    try {
      ethBefore = await ethersProvider.getBalance(signerWallet.address).catch(() => 0n);
      if (expected) {
        usdcBefore = await new ethers.Contract(expected, ['function balanceOf(address) view returns (uint256)'], ethersProvider).balanceOf(signerWallet.address).catch(() => 0n);
      }
    } catch {}

    // Pre-flight check: Gas ETH balance check
    if (ethBefore < ethers.parseEther('0.00003')) {
      const ethStr = parseFloat(ethers.formatEther(ethBefore)).toFixed(6);
      throw new Error(`INSUFFICIENT_GAS_BALANCE: Wallet (${signerWallet.address.slice(0, 6)}...${signerWallet.address.slice(-4)}) has only ${ethStr} ETH. Insufficient funds to pay on-chain gas fees for Base L2 execution. Please deposit ETH to continue.`);
    }

    const tradeParams = { 
      sell: { type: 'erc20', address: tokenAddress }, 
      buy: expected ? { type: 'erc20', address: expected } : { type: 'eth' }, 
      amountIn: BigInt(amountIn), 
      slippage: options.slippage || botConfig.tradeSlippage, 
      sender: signerAccount.address,
      maxPriorityFeePerGas: options.maxPriorityFeePerGas
    };
      
    // --- Execution Router Step 1: Identify Token Type ---
    const { findBestDexSellQuote, executeDexSell, WETH_BASE } = require('./sellRouter');

    let coinData = null;
    let isZoraToken = false;
    let volume24h = 0n;

    try {
      coinData = await rateLimitedZoraCall(() => getCoin({ address: tokenAddress, chain: base.id, apiKey: ZORA_READ_API_KEY }));
      if (coinData && coinData.data && coinData.data.zora20Token !== null) {
        isZoraToken = true;
        volume24h = coinData.data.zora20Token.volume24h || 0n;
        if (volume24h < viemParseEther('0.01')) {
          tradeParams.slippage = 0.05;
          console.log(`Adjusted slippage to 5% for low-volume coin ${tokenAddress} (24h vol: ${viemFormatEther(volume24h)} ETH)`);
        }
      }
    } catch (_) {}

    if (isZoraToken) {
      const tradeOptions = { 
        tradeParameters: tradeParams, 
        walletClient: signerWalletClient, 
        account: signerAccount, 
        publicClient: viemPublicClient, 
        validateTransaction: volume24h > 0n,
        chain: base 
      };

      console.log('[Telegram Sell Pre-Execution Audit (Zora)]', {
        activeUserId,
        signerWalletAddress: signerWallet?.address,
        signerAccountAddress: signerAccount?.address,
        walletClientAccountAddress: signerWalletClient?.account?.address,
        chainId: base?.id,
        coinContractAddress: tokenAddress,
        amountIn: amountIn.toString(),
        slippage: tradeParams.slippage,
        priorityFee: tradeParams.maxPriorityFeePerGas?.toString(),
        rpcUrl: process.env.ALCHEMY_RPC_URL || process.env.BASE_RPC_URL || 'https://mainnet.base.org',
        hasPrivateKey: Boolean(loadedPrivateKey || signerWallet?.privateKey)
      });

      let tradeRes = null;
      try {
        tradeRes = await tradeCoin(tradeOptions);
      } catch (quoteErr) {
        const errMsg = quoteErr?.message || String(quoteErr);
        if (errMsg.toLowerCase().includes('exceeds the balance') || errMsg.toLowerCase().includes('insufficient funds') || errMsg.toLowerCase().includes('gas fee') || errMsg.toLowerCase().includes('cost (gas')) {
          throw new Error(`INSUFFICIENT_GAS_BALANCE: ${errMsg}`);
        }
        console.warn(`Zora tradeCoin failed for ${tokenAddress}: ${errMsg} — falling back to DEX Router.`);
        isZoraToken = false;
      }

      if (tradeRes) {
        let txHash;
        let receipt;
        if (typeof tradeRes === 'object' && tradeRes.transactionHash) {
          receipt = tradeRes;
          txHash = receipt.transactionHash;
        } else if (typeof tradeRes === 'string' && tradeRes.startsWith('0x')) {
          txHash = tradeRes;
          receipt = await viemPublicClient.waitForTransactionReceipt({ hash: txHash });
        } else {
          throw new Error(`Unexpected return from tradeCoin: ${JSON.stringify(tradeRes)}`);
        }

        let received = parseReceivedAmount(receipt, signerWallet.address, expected);

        if (received === 0n) {
          try {
            if (expected) {
              const usdcAfter = await new ethers.Contract(expected, ['function balanceOf(address) view returns (uint256)'], ethersProvider).balanceOf(signerWallet.address);
              received = usdcAfter - usdcBefore;
            } else {
              const ethAfter = await ethersProvider.getBalance(signerWallet.address);
              const gasCost = (receipt.gasUsed || 0n) * (receipt.effectiveGasPrice || 0n);
              received = (ethAfter + gasCost) - ethBefore;
            }
          } catch (err) {
            console.error(`Sell fallback failed: ${err.message}`);
          }
        }

        return { tokenAddress, received, txHash: receipt.transactionHash, raw: receipt };
      }
    }

    // --- Execution Router Step 2: Route Non-Zora Token / DEX Fallback ---
    console.log(`[SellRouter] Inspecting DEX liquidity for non-Zora token: ${tokenAddress}`);
    const targetOut = expected || WETH_BASE;
    const bestQuote = await findBestDexSellQuote(ethersProvider, tokenAddress, amountIn, targetOut);

    if (!bestQuote || !bestQuote.engine || !bestQuote.amountOut || bestQuote.amountOut === 0n) {
      console.error(`🚨 TOKEN_HAS_NO_SELLABLE_LIQUIDITY for ${tokenAddress}: No active liquidity pool found on Uniswap V3 or Aerodrome.`);
      throw new Error(`TOKEN_HAS_NO_SELLABLE_LIQUIDITY: Token ${tokenAddress} has no active sellable liquidity pool on Zora, Uniswap V3, or Aerodrome.`);
    }

    console.log(`[SellRouter] Executing swap via ${bestQuote.engine} for token ${tokenAddress} (Estimated Out: ${bestQuote.amountOut.toString()})`);
    const dexResult = await executeDexSell({
      provider: ethersProvider,
      signerWallet,
      tokenAddress,
      amountIn,
      bestQuote,
      slippage: tradeParams.slippage,
      targetAddress: targetOut
    });

    return { tokenAddress, received: dexResult.received, txHash: dexResult.txHash, raw: dexResult };
  });
}

// ---------------------
// Vault
// ---------------------
async function sendToVault(amount) {
  try {
    if (!botConfig.vaultAddress) return;
    const activeUserId = userContextStore.getStore();
    let signerWallet = ethersWallet;
    if (activeUserId) {
      try {
        const { loadTradingWallet } = require('./routes/onboarding');
        const loaded = await loadTradingWallet(activeUserId, process.env.ALCHEMY_RPC_URL || process.env.BASE_RPC_URL);
        signerWallet = loaded.wallet;
      } catch (walletErr) {
        console.warn(`[Vault] Could not load user wallet for vault: ${walletErr.message}`);
      }
    }
    if (botConfig.tradeCurrency==='USDC') {
      const abi=['function transfer(address,uint256) returns (bool)'];
      const contract=new ethers.Contract(USDC_ADDRESS, abi, signerWallet);
      const tx=await contract.transfer(botConfig.vaultAddress, amount);
      await tx.wait();
    } else {
      const tx = await signerWallet.sendTransaction({ to: botConfig.vaultAddress, value: amount });
      await tx.wait();
    }
    await notify('VAULT', `Vault deposit ${botConfig.tradeCurrency==='USDC'?amount.toString():ethers.formatEther(amount)} ${botConfig.tradeCurrency}`);
  } catch (err) { await notify('ERROR','Vault transfer failed: '+(err?.message||err)); }
}

// ---------------------
// Sell after X users
// ---------------------
async function shouldSell(tokenAddress, sellThreshold, initialHolderCount, ownerAddress = null) {
  if (!db) return false;
 
  // If initialHolderCount is null/undefined, default to 0
  const boughtAtCount = initialHolderCount || 0;

  try {
    const holdersResponse = await withRetry(async () => {
      return await rateLimitedZoraCall(() => getCoinHolders({
        chainId: base.id,
        address: tokenAddress,
        count: 550,
        apiKey: ZORA_READ_API_KEY
      }));
    });

    const holders = holdersResponse.data?.zora20Token?.tokenBalances?.edges || [];
    if (!holders || holders.length === 0) return { should: false, count: 0 };

    const ourWallet = (ownerAddress || (ethersWallet ? ethersWallet.address : '')).toLowerCase();
    
    // Get the *current* number of other holders
    const currentOtherHoldersCount = holders.filter(h => h.node.ownerAddress.toLowerCase() !== ourWallet).length;
    
    // Calculate the number of *new* holders since we bought
    const newHoldersCount = currentOtherHoldersCount - boughtAtCount;
    
    console.log(`shouldSell check for ${tokenAddress}: ${newHoldersCount} new holders (Current: ${currentOtherHoldersCount}, Initial: ${boughtAtCount}). Threshold: ${sellThreshold}`);
    
    // Sell if the number of new holders meets the threshold
    return { should: newHoldersCount >= sellThreshold, count: newHoldersCount };
    
  } catch (err) {
    console.error(`Error in shouldSell for ${tokenAddress}: ${err.message}`);
    await notify('ERROR', `shouldSell check failed: ${err.message}`);
    return { should: false, count: 0 };
  }
}

// <<< --- REPLACE YOUR OLD 'handleSellLogic' (lines 1084-1215) WITH THIS ENTIRE BLOCK --- >>>

async function handleSellLogic(coinAddress, tradeData, docId = null, reasonOverride = null) {
  const lowerCoinAddress = coinAddress.toLowerCase();
  const creatorAddress = tradeData.creatorAddress ? tradeData.creatorAddress.toLowerCase() : null;
  const customRules = creatorAddress ? (creatorSellRules.get(creatorAddress) || {}) : {};

  // Resolve user wallet for re-approvals
  const tradeUserId = tradeData.userId || defaultUserId;
  let userWallet = ethersWallet;
  if (tradeUserId) {
    try {
      const { loadTradingWallet } = require('./routes/onboarding');
      const loaded = await loadTradingWallet(tradeUserId, process.env.ALCHEMY_RPC_URL || process.env.BASE_RPC_URL);
      userWallet = loaded.wallet;
    } catch (walletErr) {
      console.warn(`[Ephemeral] Could not load user wallet for handleSellLogic: ${walletErr.message}`);
    }
  }

  // Resolve Overrides for this specific sell
  const sellSlippage = customRules.maxSlippageOverride || botConfig.tradeSlippage;
  const sellPriorityFee = customRules.maxPriorityFeeOverride || botConfig.maxPriorityFeeGwei;
  const feeInWei = BigInt(Math.floor(sellPriorityFee * 1e9));

  const tradeOptions = {
    slippage: sellSlippage,
    maxPriorityFeePerGas: feeInWei
  };
  
  const onSellSuccess = async (resSell, sellType, currentTotal, soldAmount) => {
    // 1. Handle Partial Sells (Tiered Take Profit)
    if (sellType === "Tier1_Spike_50%" || sellType === "Tier1_50_Percent") {
      const remainingBalance = currentTotal - soldAmount;
      const updatedData = { 
        ...tradeData, 
        partialSellCount: 1, 
        receivedBuyTokenAmount: remainingBalance.toString() 
      };
      
      // Update local memory
      activePositions.set(lowerCoinAddress, updatedData);
      isSellingSet.delete(lowerCoinAddress); // Release lock for Tier 2
      
      // Update Database
      const targetDoc = docId || tradeData.docId;
      if (db && targetDoc) {
        await db.collection('trades').doc(targetDoc).update({
          partialSellCount: 1,
          receivedBuyTokenAmount: remainingBalance.toString(),
          lastUpdate: Date.now()
        });
      }
      
      await notify('SELL_PARTIAL', `🟠 Tier 1 Sold (50%) for ${lowerCoinAddress}. Waiting for remainder.`);
      return 'PARTIAL_SOLD';
    }

    // 2. FINAL EXIT: Clear memory IMMEDIATELY to stop the loop
    activePositions.delete(lowerCoinAddress);
    isSellingSet.delete(lowerCoinAddress);

    // 3. Calculate Profit and Auto-Vault
    const profit = (resSell.received || 0n) - BigInt(tradeData.spentOnSellToken || '0');
    if (profit > 0n && botConfig.autoWithdraw && profit >= botConfig.minProfitBeforeWithdraw) {
      await sendToVault(profit / 2n);
    }

    // 4. Update Database Status to 'sold'
    try {
      const batch = db.batch();
      const targetDocId = docId || tradeData.docId;
      
      if (targetDocId) {
        batch.update(db.collection('trades').doc(targetDocId), {
  status: 'sold',
  soldAt: Date.now(),
  received: resSell.received.toString(),
  profit: profit.toString(),
  sellTx: resSell.txHash || null,
  sellReason: sellType,
  tokenAddress: lowerCoinAddress
});
      } else {
        // Fallback: find by address if docId is missing
        const snap = await db.collection('trades')
          .where('tokenAddress', '==', lowerCoinAddress)
          .where('status', '==', 'bought').get();
        snap.docs.forEach(d => batch.update(d.ref, {
  status: 'sold',
  soldAt: Date.now(),
  profit: profit.toString(),
  sellReason: sellType,
  tokenAddress: lowerCoinAddress
}));
      }
      
      await batch.commit();

      if (db) {
        await db.collection(ACTIVITY_FEED_COLLECTION).add({
          type: 'SELL_SUCCESS',
          coin: lowerCoinAddress,
          received: resSell.received.toString(),
          profit: profit.toString(),
          txHash: resSell.txHash,
          timestamp: Date.now(),
          sellReason: sellType
        });
      }
    } catch (dbErr) {
      console.error(`DB Update Error during sell of ${lowerCoinAddress}:`, dbErr.message);
    }

    const profitUsd = formatUSD(ethersFormatEther(profit));
    await notify('SELL', `🔴 Final Sell: ${lowerCoinAddress}\nProfit: ${profitUsd}\nReason: ${sellType}`);
    
    console.log(`✅ ${lowerCoinAddress} fully removed from memory and marked sold in DB.`);
    return 'SOLD';
  };
  // --- End Helper ---

   // --- 0. Live Analytics & Stop Loss Gate ---
  let isProfitTargetHit = false;
  let currentProfitUsd = 0;
  let profitPercent = 0;

  try {
    const coinStats = await rateLimitedZoraCall(() => getCoin({ address: lowerCoinAddress, chain: base.id, apiKey: ZORA_READ_API_KEY }));
    const stats = coinStats.data?.zora20Token;

    if (stats) {
      const mCapUsd = parseFloat(stats.marketCap || "0");
      const totalSupply = parseFloat(stats.totalSupply || "0");
      const myBalance = parseFloat(ethers.formatEther(tradeData.receivedBuyTokenAmount || "0"));
      const ownershipFraction = myBalance / totalSupply;
      const currentValueUsd = ownershipFraction * mCapUsd;

      let costUsd = tradeData.tradeCurrency === 'USDC'
        ? parseFloat(ethers.formatUnits(tradeData.spentOnSellToken, 6))
        : parseFloat(ethers.formatEther(tradeData.spentOnSellToken)) * ethPriceUsd;

      currentProfitUsd = currentValueUsd - costUsd;
      profitPercent = (currentProfitUsd / costUsd) * 100;
      
      const holdersRes = await rateLimitedZoraCall(() => getCoinHolders({ 
    chainId: base.id, 
    address: lowerCoinAddress, 
    count: 550, 
    apiKey: ZORA_READ_API_KEY 
  }));
  const currentCount = (holdersRes.data?.zora20Token?.tokenBalances?.edges || []).length;

      // LOG LIVE DATA TO DB FOR FRONTEND
      const targetDoc = docId || tradeData.docId;
      if (db && targetDoc) {
        await db.collection('trades').doc(targetDoc).update({
          liveMarketCap: mCapUsd,
          liveValueUsd: currentValueUsd,
          liveProfitUsd: currentProfitUsd,
          currentOtherHoldersCount: currentCount,
          liveProfitPercent: profitPercent,
          lastPriceCheck: Date.now()
        }).catch(() => {});
      }

      // RESOLVE TAKE PROFIT TARGET
      const targetProfitUsd = customRules.takeProfitUsdOverride || botConfig.takeProfitUsd;
      if (currentProfitUsd >= targetProfitUsd) isProfitTargetHit = true;

      // STOP LOSS CHECK
      const stopLossTarget = customRules.stopLossPercentOverride || -50;
      const isStopLossOn = customRules.stopLossEnabled !== false; // Check individual toggle

      // Only trigger if Stop Loss is enabled OR if it's a manual "FORCE_SELL" override
      if (reasonOverride === "STOP_LOSS" || (isStopLossOn && profitPercent <= stopLossTarget)) {
        console.log(`🚨 STOP LOSS/FORCE: ${lowerCoinAddress} at ${profitPercent.toFixed(2)}%`);
        const amount = BigInt(tradeData.receivedBuyTokenAmount || '0');
        if (amount > 0n && !isSellingSet.has(lowerCoinAddress)) {
          isSellingSet.add(lowerCoinAddress);
          const resSell = await marketSell(lowerCoinAddress, amount, tradeOptions);
          return await onSellSuccess(resSell, "Stop_Loss_Exit", amount, amount);
        }
      }
    }
  } catch (err) {
    console.warn(`Live analytics/SL check failed: ${err.message}`);
  }

  // --- 1. Rule Resolution ---
// --- 1. Rule Resolution (UPDATED) ---
const holdMinutes = customRules.minimumHoldMinutes || botConfig.minimumHoldMinutes;
const sellUsers = customRules.sellAfterUsers || botConfig.sellAfterUsers;
// NEW: Resolve the Take Profit target (Custom vs Global)
const targetProfitUsd = customRules.takeProfitUsdOverride || botConfig.takeProfitUsd;

const initialHolderCount = tradeData.initialHolderCount || 0;
const forceSellEnabled = customRules.forceSellEnabled || false;

  // A. Auto-Sell Toggles (Global and Per-Creator)
  const isAutoSellOff = botConfig.autoSellGlobal === false || customRules.autoSellEnabled === false || tradeData.autoSellDisabled === true;
  
  // B. Price Spike / Profit Check (Cleaned & Flattened)
   isProfitTargetHit = false;
   currentProfitUsd = 0;

  try {
    const coinStats = await rateLimitedZoraCall(() => getCoin({ address: lowerCoinAddress, chain: base.id, apiKey: ZORA_READ_API_KEY }));
    
    const mCapUsd = parseFloat(coinStats.data?.zora20Token?.marketCap || "0");
    const totalSupply = parseFloat(coinStats.data?.zora20Token?.totalSupply || "0");
    const myBalance = parseFloat(ethers.formatEther(tradeData.receivedBuyTokenAmount || "0"));

    if (totalSupply > 0 && mCapUsd > 0 && myBalance > 0) {
      const ownershipFraction = myBalance / totalSupply;
      const currentValueUsd = ownershipFraction * mCapUsd;
      
      let costUsd = 0;
      if (tradeData.tradeCurrency === 'USDC') {
        costUsd = parseFloat(ethers.formatUnits(tradeData.spentOnSellToken, 6));
      } else {
        costUsd = parseFloat(ethers.formatEther(tradeData.spentOnSellToken)) * ethPriceUsd;
      }

      currentProfitUsd = currentValueUsd - costUsd;

      if (currentProfitUsd >= targetProfitUsd) {
        const tokenName = coinStats.data?.zora20Token?.name || lowerCoinAddress;
        console.log(`🚀 REAL SPIKE: ${tokenName} | Profit: $${currentProfitUsd.toFixed(2)} | Target: $${targetProfitUsd}`);
        isProfitTargetHit = true;
      } else {
        console.log(`[CHECK] ${coinStats.data?.zora20Token?.symbol}: Value $${currentValueUsd.toFixed(2)} | Profit $${currentProfitUsd.toFixed(2)}`);
      }
    }
  } catch (err) { 
    console.warn(`Profit check failed for ${lowerCoinAddress}: ${err.message}`); 
  }

  // C. Standard Rule Logic
  const minTime = Date.now() - holdMinutes * 60 * 1000;
  const isTimeUp = (tradeData.boughtAt || 0) <= minTime;
  let isHolderCountMet = false;

  if (!isTimeUp && !isProfitTargetHit) {
    const sellRes = await shouldSell(lowerCoinAddress, sellUsers, initialHolderCount, tradeData.ownerAddress);
    isHolderCountMet = sellRes.should;
  }

  // --- [THE DECISION GATE] ---
  // If auto-sell is manually OFF, always return HOLDING unless it's a Profit Spike
  if (isAutoSellOff && !isProfitTargetHit) {
    return 'HOLDING';
  }

 // --- 3. [FIXED] Tiered Decision Gate ---
  if (!isProfitTargetHit && !isTimeUp && !isHolderCountMet) return 'HOLDING';
  if (isSellingSet.has(lowerCoinAddress)) return 'PENDING';

  // LOGIC: If first spike, sell 50%. If already sold once OR limit met, sell 100%.
  // --- FIX: Tiered Spike vs Sell All Logic ---
  const hasSoldFirstTier = (tradeData.partialSellCount || 0) >= 1;
  const totalBalance = BigInt(tradeData.receivedBuyTokenAmount || '0');
  let amount;
  let sellType;

  if (reasonOverride === "GLOBAL_FORCE_SELL") {
      amount = totalBalance;
      sellType = "GLOBAL_MASTER_SWITCH_EXIT";
  } else if (customRules.sellAllAtOnce === true) {
      // If "Sell All" is ON for this creator, we sell 100% on the very FIRST trigger (Price, Time, or Holders)
      amount = totalBalance;
      sellType = "CREATOR_CUSTOM_SELL_ALL";
  } else if (!hasSoldFirstTier && isProfitTargetHit) {
      // Standard Tiered Logic: Sell half on first spike
      amount = totalBalance / 2n;
      sellType = "Tier1_Spike_50%";
  } else {
      // Sell remainder on Tier 2 or standard exit
      amount = totalBalance;
      sellType = hasSoldFirstTier ? "Tier2_Final_Exit" : "Standard_Full_Exit";
  }

  if (amount <= 0n) return 'HOLDING';
  isSellingSet.add(lowerCoinAddress);
  
  let sellAmount;
  let currentSellTier;

  if (!hasSoldFirstTier && isProfitTargetHit) {
    // TIER 1: First spike detected, sell 50%
    sellAmount = totalBalance / 2n;
    currentSellTier = "Tier1_50_Percent";
    console.log(`🎯 Tier 1 Spike: Selling 50% of ${lowerCoinAddress}`);
  } else {
    // TIER 2 or Time/Holder Trigger: Sell remaining 100%
    sellAmount = totalBalance;
    currentSellTier = hasSoldFirstTier ? "Tier2_Remainder" : "Full_Exit";
    console.log(`🚀 Final Exit: Selling remainder of ${lowerCoinAddress}`);
  }

  if (sellAmount <= 0n) return 'HOLDING';

  isSellingSet.add(lowerCoinAddress);

// 3. Execute the Sell
  try {
    // FIX 1: Define tradeOptions so the bot doesn't crash
    const feeInWei = BigInt(Math.floor(botConfig.maxPriorityFeeGwei * 1e9));
    const tradeOptions = {
      slippage: botConfig.tradeSlippage,
      maxPriorityFeePerGas: feeInWei
    };

    const resSell = await marketSell(lowerCoinAddress, sellAmount, tradeOptions);
    
    // If successful, reset failures (if any)
    tradeData.sellFails = 0; 
    
   return await onSellSuccess(resSell, currentSellTier, totalBalance, amount);

  } catch (err) {
    const errMessage = (err.message || '').toLowerCase();
    
    // FIX 2: The "2-Strike" Rule for Dead Coins
    tradeData.sellFails = (tradeData.sellFails || 0) + 1;
    console.log(`⚠️ Sell attempt #${tradeData.sellFails} failed for ${lowerCoinAddress}: ${err.message}`);

    // On the 2nd failure, check if the coin is actually dead
    if (tradeData.sellFails >= 2) {
      try {
        const stats = await rateLimitedZoraCall(() => getCoin({ address: lowerCoinAddress, chain: base.id, apiKey: ZORA_READ_API_KEY }));
        const mCap = BigInt(Math.floor(Number(stats.data?.zora20Token?.marketCap || 0)));
        const vol = BigInt(Math.floor(Number(stats.data?.zora20Token?.volume24h || 0)));

        // If Market Cap or Volume is 0, or SDK says "Quote failed", it's a dead coin
        if (mCap === 0n || vol === 0n || errMessage.includes("quote failed")) {
          console.error(`💀 DEAD COIN: ${lowerCoinAddress}. Marking as error and stopping.`);
          
          if (db) {
            const targetDoc = docId || tradeData.docId;
            if (targetDoc) {
              await db.collection('trades').doc(targetDoc).update({ 
                status: 'error', 
                sellTx: 'DEAD_COIN_OR_QUOTE_FAILED' 
              });
            }
          }
          
          activePositions.delete(lowerCoinAddress); // Stop monitoring
          isSellingSet.delete(lowerCoinAddress);
          return 'ERROR_PERMANENT';
        }
      } catch (checkErr) {
        console.warn("Could not verify coin status, will retry one more time later.");
      }
    }

    // Clear the "isSelling" lock so the next loop can try again
    isSellingSet.delete(lowerCoinAddress);
    return 'ERROR_RETRY_LATER';
  }

  // --- 4. [CLEAN] Dead Coin / Liquidity Safety Check ---
  try {
    const coinStats = await rateLimitedZoraCall(() => getCoin({ address: lowerCoinAddress, chain: base.id, apiKey: ZORA_READ_API_KEY }));
    const vol24h = BigInt(coinStats.data?.zora20Token?.volume24h || 0n);
    const mCap = BigInt(coinStats.data?.zora20Token?.marketCap || 0n);

    // If both volume and market cap are zero, the liquidity pool is gone
    if (vol24h === 0n && mCap === 0n) {
      console.error(`🚨 DEAD COIN DETECTED: ${lowerCoinAddress}. Volume/MCap is 0. Stopping.`);
      await notify('WARN', `Stopped trying to sell dead coin ${lowerCoinAddress} (0 volume).`);
      activePositions.delete(lowerCoinAddress);
      isSellingSet.delete(lowerCoinAddress);
      if (db && docId) await db.collection('trades').doc(docId).update({ status: 'error', sellTx: 'DEAD_COIN_0_LIQUIDITY' });
      return 'ERROR_PERMANENT'; 
    }
  } catch (e) { 
    console.warn("Liquidity check skipped due to API lag—proceeding with sell attempt."); 
  }

    // --- [END UPGRADE] ---
 
  // --- 3. Amount Check ---
  
  if (amount <= 0n) {
    console.warn(`handleSellLogic: Skipping sell for ${lowerCoinAddress}, zero amount.`);
    if (db) {
        try {
          if (docId) {
            const docRef = db.collection('trades').doc(docId);
            await docRef.update({ status: 'error', sellTx: 'PERMANENT_FAIL: Zero amount' });
          } else {
            const tradeSnap = await db.collection('trades').where('tokenAddress', '==', lowerCoinAddress).where('status', '==', 'bought').get();
            const batch = db.batch();
            tradeSnap.docs.forEach(doc => {
              batch.update(doc.ref, { status: 'error', sellTx: 'PERMANENT_FAIL: Zero amount' });
            });
            await batch.commit();
          }
        } catch (dbErr) { 
          console.error(`handleSellLogic: DB update failed for zero amount trade ${lowerCoinAddress}: ${dbErr.message}`); }
    }
    activePositions.delete(lowerCoinAddress); // Remove from active memory
    isSellingSet.delete(lowerCoinAddress); 
    return 'ERROR_PERMANENT';
  }

  // --- 4. Gated Sell Logic ---
  if (forceSellEnabled) {
    console.log(`✅ handleSellLogic: Starting AGGRESSIVE (Relentless) sell for ${lowerCoinAddress} (forceSellEnabled=true)...`);
    
    let retries = 0; 

    while (true) { // Main sell loop
      try {
        // Get *current* config settings on every attempt
        const staticSlippage = botConfig.tradeSlippage;
        const staticPriorityFeeGwei = botConfig.maxPriorityFeeGwei;
        const feeInWei = BigInt(Math.floor(staticPriorityFeeGwei * 1e9));

        // Create a custom tradeOptions for marketSell
        const tradeOptions = {
          slippage: staticSlippage,
          maxPriorityFeePerGas: feeInWei
        };

      const sellType = isProfitTargetHit ? "Tier1_Spike_50%" : (hasSoldFirstTier ? "Tier2_Final_Exit" : "Standard_Full_Exit");
      
      // Execute with Resolved Overrides (Slippage/Gas)
      const resSell = await marketSell(lowerCoinAddress, amount, tradeOptions);
        
        return await onSellSuccess(resSell, sellType, totalBalance, amount);

      } catch (err) {
        const errMessage = (err.message || '').toLowerCase();
        
        if (errMessage.includes('allowance') || errMessage.includes('insufficient funds for transfer')) {
          // APPROVAL ERROR
          console.warn(`Sell failed (Attempt ${retries}): Missing approval. Entering approval retry loop...`);
          
          let approvalSuccess = false;
          while (!approvalSuccess) {
            try {
              const abi = ['function approve(address spender, uint256 amount) returns (bool)'];
              const tokenContract = new ethers.Contract(lowerCoinAddress, abi, userWallet);
              
              const feeData = await ethersProvider.getFeeData();
             const approvePriorityFee = (feeData.maxPriorityFeePerGas || 0n) + ethersParseEther('0.05', 'gwei');

              const approveTx = await tokenContract.approve(
                ZORA_FACTORY_ADDRESS, 
                ethers.MaxUint256,
                { maxPriorityFeePerGas: approvePriorityFee }
             );
              await approveTx.wait();
              
            console.log(`✅ Re-approval successful for ${lowerCoinAddress}. Retrying sell...`);
              approvalSuccess = true;
          } catch (approveErr) {
             console.error(`Re-approval attempt FAILED for ${lowerCoinAddress}: ${approveErr.message}. Retrying approval in 1s...`);
              await new Promise(r => setTimeout(r, 1000));
            }
          }
          retries++; // Increment retry count after approval is sorted

        } else {
          // SLIPPAGE/GAS ERROR
          console.warn(`Aggressive sell retry ${retries} for ${lowerCoinAddress} failed: ${err.message}. Retrying with SAME params...`);
          retries++;
        }
      }
      await new Promise(r => setTimeout(r, 100)); // 100ms retry for main sell loop
    }
    // --- END AGGRESSIVE BLOCK ---

  } else {
    // --- OPTION B: STANDARD (RETRY-LIMITED) SELL LOGIC ---
    console.log(`✅ handleSellLogic: Starting STANDARD sell for ${lowerCoinAddress}...`);
    try {
      const sellType = isProfitTargetHit ? "Spike_TakeProfit" : (isTimeUp ? "Time_Expiry" : "Holder_Threshold");
      
      
      const feeInWei = BigInt(Math.floor(botConfig.maxPriorityFeeGwei * 1e9));
      const tradeOptions = {
        slippage: botConfig.tradeSlippage,
        maxPriorityFeePerGas: feeInWei
      };

      const resSell = await marketSell(lowerCoinAddress, amount, tradeOptions);

      return await onSellSuccess(resSell, sellType, totalBalance, amount);

    } catch (err) {
      // --- [START] ROBUST CATCH BLOCK (for standard sell) ---
      const errMessage = (err.message || '').toLowerCase();
      
      // 1. Handle Approval Error (Non-counting failure)
      if (errMessage.includes('allowance') || errMessage.includes('insufficient funds for transfer')) {
        console.warn(`Standard sell failed: Missing approval. Sending approve tx...`);
        try {
          const abi = ['function approve(address spender, uint256 amount) returns (bool)'];
          const tokenContract = new ethers.Contract(lowerCoinAddress, abi, userWallet);
          const feeData = await ethersProvider.getFeeData();
          const approvePriorityFee = (feeData.maxPriorityFeePerGas || 0n) + ethersParseEther('0.05', 'gwei');

        const approveTx = await tokenContract.approve(
            ZORA_FACTORY_ADDRESS, 
            ethers.MaxUint256,
            { maxPriorityFeePerGas: approvePriorityFee }
          );
          await approveTx.wait();
          console.log(`✅ Re-approval successful for ${lowerCoinAddress}. Sell will retry on next cycle.`);
        } catch (approveErr) {
          console.error(`Re-approval FAILED for ${lowerCoinAddress}: ${approveErr.message}`);
        }
      } else {
        // 2. Handle Real Sell Error (Quote, Gas, Slippage)
        console.error(`handleSellLogic: STANDARD sell FAILED for ${lowerCoinAddress}: ${err.message}`);
        await notify('ERROR', `Standard sell failed for ${lowerCoinAddress}: ${err.message}.`);

        // --- FAILURE COUNT LOGIC ---
        const currentTradeData = activePositions.get(lowerCoinAddress);
        if (currentTradeData) {
          // Initialize or increment the failure counter
          currentTradeData.sellFails = (currentTradeData.sellFails || 0) + 1;
         console.log(`Sell failure count for ${lowerCoinAddress}: ${currentTradeData.sellFails}`);
          
          // Check if we've exceeded the 30-retry limit
         if (currentTradeData.sellFails > 30) {
            // 1. IMMEDIATE MEMORY PURGE (Prevents ghost calls if DB fails)
            activePositions.delete(lowerCoinAddress);
            isSellingSet.delete(lowerCoinAddress);
            
            console.error(`💀 PERMANENT FAIL: ${lowerCoinAddress} failed 30 times. Purged from memory.`);
            await notify('ERROR', `PERMANENT SELL FAIL for ${lowerCoinAddress}. Removed from active tracking.`);

            // 2. BACKGROUND DB UPDATE (Don't await this for memory safety)
            if (db) {
              (async () => {
                try {
                  const batch = db.batch();
                  if (docId) {
                    batch.update(db.collection('trades').doc(docId), { 
                      status: 'error', 
                      sellTx: `PERMANENT_FAIL: ${err.message}` 
                    });
                  } else {
                    const snap = await db.collection('trades')
                      .where('tokenAddress', '==', lowerCoinAddress)
                      .where('status', '==', 'bought').get();
                    snap.docs.forEach(d => batch.update(d.ref, { 
                      status: 'error', 
                      sellTx: `PERMANENT_FAIL: ${err.message}` 
                    }));
                  }
                  await batch.commit();
                  console.log(`✅ DB updated for permanent fail: ${lowerCoinAddress}`);
                } catch (dbErr) {
                  console.error(`❌ Failed to mark error in DB for ${lowerCoinAddress}:`, dbErr.message);
                }
              })();
            }
            return 'ERROR_PERMANENT';
          }
        }
        // --- END FAILURE COUNT LOGIC ---
      }
      // --- [END] ROBUST CATCH BLOCK ---

      isSellingSet.delete(lowerCoinAddress);
      return 'ERROR_RETRY_LATER';
    }
    // --- END STANDARD BLOCK ---
  }
}
// ---------------------
// Express & routes
// ---------------------
const app=express();
app.use(express.json({limit:'1mb'}));
const corsOptions = {
  origin: function (origin, callback) {
    // Dynamically allow all incoming origins so CORS is never blocked, maintaining credentials support
    callback(null, true);
  },
  credentials: true,
  methods: 'GET,POST,OPTIONS,PUT,DELETE',
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'x-request-id']
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// ── Multi-Market Route Modules (independent from Zora) ──
const solanaRoutes = require('./routes/solana');
const baseRoutes = require('./routes/base');
app.use('/solana', solanaRoutes);
app.use('/base', baseRoutes);

// ── Isolated Telegram Control Module ──
const { initTelegramModule, setBackendServices } = require('./telegram');
const { getConnectPageHtml } = require('./telegram/connectPage');
initTelegramModule(app);

app.get('/telegram-connect', (req, res) => {
  const chatId = req.query.chatId || '';
  res.setHeader('Content-Type', 'text/html');
  res.send(getConnectPageHtml(chatId));
});

// Add this to your Express routes
app.post('/webhook/cloud-logs', async (req, res) => {
  try {
    // Pub/Sub messages are base64 encoded
    const pubsubMessage = req.body.message;
    if (!pubsubMessage || !pubsubMessage.data) {
      return res.status(400).send('No data found');
    }

    const logEntry = JSON.parse(Buffer.from(pubsubMessage.data, 'base64').toString());
    const messageText = logEntry.textPayload || "Log entry detected";

    // Detect if it's a sniper activity to keep the feed relevant
    if (messageText.includes('WS Creator Sniper') || messageText.includes('Detected new V4')) {
      if (db) {
        await db.collection(ACTIVITY_FEED_COLLECTION).add({
          type: 'CLOUD_LOG',
          text: messageText,
          timestamp: Date.now(),
          originalTimestamp: logEntry.timestamp,
          severity: logEntry.severity || 'DEFAULT'
        });
        console.log('✅ Cloud log synced to activity feed');
      }
    }

    res.status(204).send();
  } catch (err) {
    console.error('Error processing cloud log webhook:', err.message);
    res.status(500).send(err.message);
  }
});

app.post('/auth/save-permission', verifyFirebaseToken, async (req, res) => {
  try {
    const { permission, signature, userAddress } = req.body;

    if (!permission || !signature || !userAddress) {
      return res.status(400).json({ error: 'Missing permission data' });
    }

    // Store the signed permission for this user
    await db.collection('users').doc(userAddress.toLowerCase()).set({
      spendPermission: permission,
      spendSignature: signature,
      updatedAt: Date.now()
    }, { merge: true });

    res.json({ status: 'OK', message: 'Spend Permission saved.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------
// Auth Routes
// ---------------------
// -------------------------
// GET /auth/challenge
// Returns a nonce for wallet signature (replay-attack prevention)
// -------------------------
app.get('/auth/challenge', async (req, res) => {
  try {
    const { address } = req.query;
    if (!address) return res.status(400).json({ error: 'address query param required' });
    const nonce = crypto.randomBytes(16).toString('hex');
    const issuedAt = new Date().toISOString();
    const message = `Welcome to FOMOCLIX.\n\nSign this message to authenticate your wallet.\nThis request will not trigger a blockchain transaction.\n\nWallet: ${address}\nNonce: ${nonce}\nIssued At: ${issuedAt}`;
    // Store nonce briefly in memory (5 min TTL)
    if (!app._nonces) app._nonces = new Map();
    app._nonces.set(nonce, { address: address.toLowerCase(), expiresAt: Date.now() + 5 * 60 * 1000 });
    res.json({ nonce, message, issuedAt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------
// POST /auth/login
// Verifies EVM wallet signature, issues role-scoped JWT.
// Admin wallets → role:'admin'. All other wallets → role:'user'.
// -------------------------
app.post('/auth/login', async (req, res) => {
  try {
    const { walletAddress, message, signature, enable2FA } = req.body;
    if (!walletAddress || !message || !signature) {
      return res.status(400).json({ error: 'Missing required credentials' });
    }

    const inputAddress = ethers.getAddress(walletAddress);
    let recoveredAddress;
    try {
      recoveredAddress = ethers.getAddress(ethers.verifyMessage(message, signature));
    } catch (verifyErr) {
      // Some wallets sign the hex-encoded UTF-8 form of the message
      try {
        const hexMsg = '0x' + Buffer.from(message, 'utf8').toString('hex');
        recoveredAddress = ethers.getAddress(ethers.verifyMessage(ethers.getBytes(hexMsg), signature));
      } catch (verifyErr2) {
        console.error('Signature verify failed:', verifyErr.message, verifyErr2.message);
        return res.status(403).json({ error: 'Invalid signature' });
      }
    }

    if (inputAddress !== recoveredAddress) {
      return res.status(403).json({ error: 'Invalid signature' });
    }

    const normalizedAdmins = ADMIN_WALLETS.map(w => {
      try { return ethers.getAddress(w); } catch (e) { return w.toLowerCase(); }
    });
    const isAdmin = normalizedAdmins.includes(inputAddress);
    const role = isAdmin ? 'admin' : 'user';
    const lowerWalletAddress = walletAddress.toLowerCase();

    const customToken = signJwt({
      uid: lowerWalletAddress,
      walletAddress: lowerWalletAddress,
      email: '',
      role,
    });

    let userData = {};
    if (db) {
      const userUpdates = {
        twoFactorEnabled: !!enable2FA,
        lastLogin: Date.now(),
        role,
        primaryAddress: lowerWalletAddress,
      };
      if (isAdmin && !db._adminSet) {
        userUpdates.profileTag = 'Gold User';
        userUpdates.subscriptionActive = true;
        userUpdates.plan = 'admin';
        userUpdates.onboardingComplete = true;
      }
      await db.collection('users').doc(lowerWalletAddress).set(serializeForFirestore(userUpdates), { merge: true });
      const snap = await db.collection('users').doc(lowerWalletAddress).get();
      userData = snap.exists ? snap.data() : {};
    }

    console.log(`Auth_LOGIN: ${lowerWalletAddress} role=${role}`);

    res.json({
      jwt_token: customToken,
      profile: {
        uid: lowerWalletAddress,
        email: '',
        role,
        primaryAddress: lowerWalletAddress,
      },
      subscription: {
        active: isAdmin || !!userData.subscriptionActive,
        plan: isAdmin ? 'admin' : (userData.plan || null),
      },
      permissions: {
        role,
      },
      onboardingComplete: isAdmin || !!userData.onboardingComplete,
      tradingWallet: (userData.tradingWallet && userData.tradingWallet.address) || null,
      plan: isAdmin ? 'admin' : (userData.plan || null)
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: err?.message || 'Login failed' });
  }
});

// Ensure firebase-admin is initialized for ID token verification (even when DB is SQLite)
function ensureFirebaseAdmin() {
  const admin = require('firebase-admin');
  if (admin.apps && admin.apps.length > 0) return admin;

  const fs = require('fs');
  const path = require('path');
  const candidatePaths = [
    process.env.GOOGLE_APPLICATION_CREDENTIALS,
    path.join(__dirname, 'service-account.json'),
    path.join(process.cwd(), 'service-account.json'),
    path.join(process.cwd(), 'backend', 'service-account.json')
  ].filter(Boolean);

  for (const saPath of candidatePaths) {
    if (fs.existsSync(saPath)) {
      try {
        const serviceAccount = JSON.parse(fs.readFileSync(saPath, 'utf8'));
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount)
        });
        console.log(`[Auth] firebase-admin initialized via service account file (${saPath})`);
        return admin;
      } catch (err) {
        console.warn(`[Auth] Failed to load service account from ${saPath}:`, err.message);
      }
    }
  }

  try {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
    });
    console.log('[Auth] firebase-admin initialized via applicationDefault()');
  } catch (adcErr) {
    admin.initializeApp();
    console.log('[Auth] firebase-admin initialized via default initializeApp()');
  }
  return admin;
}

// -------------------------
// POST /auth/google
// Verifies Firebase ID token, issues/returns role-scoped JWT, registers/creates user profile.
// -------------------------
app.post('/auth/google', async (req, res) => {
  try {
    const { idToken } = req.body;
    if (!idToken) {
      return res.status(400).json({ error: 'Missing Firebase ID Token' });
    }

    const admin = ensureFirebaseAdmin();
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const uid = decodedToken.uid;
    const email = (decodedToken.email || '').toLowerCase();
    
    // Check if user is admin
    const isEmailUIDAdmin = ADMIN_UID && uid === ADMIN_UID;
    const isEmailAdmin = ADMIN_EMAIL && email === ADMIN_EMAIL;
    const isAdmin = isEmailUIDAdmin || isEmailAdmin;
    const role = isAdmin ? 'admin' : 'user';
    const lowerUid = uid.toLowerCase();

    // Sign our custom JWT token
    const customToken = signJwt({
      uid: lowerUid,
      walletAddress: '',
      email,
      role,
    });

    let userData = {};
    if (db) {
      const userUpdates = {
        lastLogin: Date.now(),
        role,
        email,
      };
      if (isAdmin && !db._adminSet) {
        userUpdates.profileTag = 'Gold User';
        userUpdates.subscriptionActive = true;
        userUpdates.plan = 'admin';
        userUpdates.onboardingComplete = true;
      }
      await db.collection('users').doc(lowerUid).set(serializeForFirestore(userUpdates), { merge: true });
      const snap = await db.collection('users').doc(lowerUid).get();
      userData = snap.exists ? snap.data() : {};
    }

    console.log(`Auth_GOOGLE_LOGIN: ${lowerUid} (email: ${email}, role: ${role})`);

    res.json({
      jwt_token: customToken,
      profile: {
        uid: lowerUid,
        email,
        role,
        primaryAddress: userData.primaryAddress || '',
      },
      subscription: {
        active: isAdmin || !!userData.subscriptionActive,
        plan: isAdmin ? 'admin' : (userData.plan || null),
      },
      permissions: {
        role,
      },
      onboardingComplete: isAdmin || !!userData.onboardingComplete,
      tradingWallet: (userData.tradingWallet && userData.tradingWallet.address) || null,
      plan: isAdmin ? 'admin' : (userData.plan || null)
    });
  } catch (err) {
    console.error('Google login verification failed:', err);
    const detail = err?.message || String(err);
    // Surface actionable errors without leaking secrets
    if (detail.includes('Firebase App') || detail.includes('initializeApp') || detail.includes('Unable to detect a Project Id')) {
      return res.status(503).json({
        error: 'Google login unavailable: Firebase Admin not configured on backend (set GOOGLE_APPLICATION_CREDENTIALS or run with GCP ADC).'
      });
    }
    if (detail.includes('Firebase ID token') || detail.includes('Decoding Firebase ID token')) {
      return res.status(401).json({ error: 'Invalid or expired Google ID token. Try signing in again.' });
    }
    res.status(401).json({ error: 'Google login verification failed' });
  }
});

// -------------------------
// GET /auth/session
// Restores the user session
// -------------------------
app.get('/auth/session', async (req, res) => {
  try {
    const uid = req.user.uid.toLowerCase();
    if (!db) return res.status(503).json({ error: 'Database not ready' });

    const snap = await db.collection('users').doc(uid).get();
    const userData = snap.exists ? snap.data() : {};
    const role = req.user.role || 'user';
    const isAdmin = role === 'admin';

    res.json({
      profile: {
        uid,
        email: userData.email || req.user.email || '',
        role,
        primaryAddress: userData.primaryAddress || req.user.walletAddress || '',
      },
      subscription: {
        active: isAdmin || !!userData.subscriptionActive,
        plan: isAdmin ? 'admin' : (userData.plan || null),
      },
      permissions: {
        role,
      },
      onboardingComplete: isAdmin || !!userData.onboardingComplete,
      tradingWallet: (userData.tradingWallet && userData.tradingWallet.address) || null,
      plan: isAdmin ? 'admin' : (userData.plan || null)
    });
  } catch (err) {
    console.error('Session restore failed:', err);
    res.status(500).json({ error: err?.message || 'Session restore failed' });
  }
});

const publicApiRoutes = [
  { method: 'GET', path: '/' },
  { method: 'GET', path: '/auth/challenge' },
  { method: 'POST', path: '/auth/login' },
  { method: 'POST', path: '/auth/google' },
  // /auth/session still requires JWT via middleware (Bearer), listed here only for OPTIONS/docs clarity — not public without token
  { method: 'POST', path: '/webhook/cloud-logs' },
  { method: 'POST', path: '/webhook/neynar' },
  { method: 'POST', path: '/ai/chat-preview' },
  { method: 'GET', path: '/scanner/public-feed' }
];

function isPublicApiRoute(req) {
  if (req.method === 'OPTIONS') return true;
  // Allow Solana/Base market modules through (they handle auth internally if needed)
  if (req.path.startsWith('/solana/') || req.path.startsWith('/base/')) return true;
  return publicApiRoutes.some(route => route.method === req.method && route.path === req.path);
}

app.use((req, res, next) => {
  if (isPublicApiRoute(req)) return next();
  return verifyFirebaseToken(req, res, next);
});

// Mount onboarding & subscription routers (require valid JWT, any role)
app.use('/onboarding', onboardingRouter);
app.use('/subscription', subscriptionRouter);

// GET all historical trades from SQLite/D1 database
app.get('/trades', async (req, res) => {
  if (!db) return res.status(503).json({ error: 'Database not ready' });
  try {
    const snap = await db.collection('trades').orderBy('boughtAt', 'desc').limit(200).get();
    const trades = snap.docs.map(doc => doc.data());
    res.json(trades);
  } catch (err) {
    console.error('Error fetching historical trades:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET all active positions from memory
app.get('/trades/active', (req, res) => {
  const activeUserId = userContextStore.getStore();
  const positions = Array.from(activePositions.entries())
    .map(([address, data]) => ({ address, ...data }))
    .filter(pos => !activeUserId || pos.userId === activeUserId);
  res.json(positions);
});

// ALIAS for frontend
app.get('/positions', (req, res) => {
  const activeUserId = userContextStore.getStore();
  const positions = Array.from(activePositions.entries())
    .map(([address, data]) => ({ address, ...data }))
    .filter(pos => !activeUserId || pos.userId === activeUserId);
  res.json(positions);
});

// FIXED: Manual Delete from Memory AND Firestore
// Ensure this is registered BEFORE the startup logic
app.delete('/trade/active/:address', async (req, res) => {
  const addr = (req.params.address || '').toLowerCase().trim();
  console.log(`🗑️ Manual Status Update Request: ${addr}`);

  if (!db) return res.status(503).json({ error: 'Firestore not ready' });

  try {
    // Look for the document to update status to 'sold'
    const tradeSnap = await db.collection('trades')
      .where('tokenAddress', '==', addr)
      .where('status', '==', 'bought')
      .get();

    if (tradeSnap.empty) {
      console.warn(`[404] No active trade found in DB for ${addr}`);
      return res.status(404).json({ error: 'No active trade found.' });
    }

    const batch = db.batch();
    tradeSnap.docs.forEach(doc => {
      batch.update(doc.ref, {
        status: 'sold',
        soldAt: Date.now(),
        sellReason: 'Manual_Frontend_Clear'
      });
    });

    await batch.commit();
    console.log(`✅ ${addr} successfully marked as 'sold' in Firestore.`);
    return res.json({ status: 'OK', message: 'Trade status updated.' });
  } catch (err) {
    console.error(`Manual status update failed:`, err.message);
    return res.status(500).json({ error: err.message });
  }
});

// POST toggle auto-sell on active position
app.post('/trade/active/:address/toggle-auto-sell', async (req, res) => {
  const addr = (req.params.address || '').toLowerCase().trim();
  if (!activePositions.has(addr)) {
    return res.status(404).json({ error: 'Active position not found.' });
  }
  const tradeData = activePositions.get(addr);
  const nextVal = tradeData.autoSellDisabled === true ? false : true;
  tradeData.autoSellDisabled = nextVal;
  activePositions.set(addr, tradeData);

  if (db && tradeData.docId) {
    await db.collection('trades').doc(tradeData.docId).update({
      autoSellDisabled: nextVal
    }).catch(() => {});
  }
  res.json({ success: true, autoSellStatus: nextVal ? 'DISABLED' : 'ENABLED' });
});

// POST update status on active position
app.post('/trade/active/:address/status', async (req, res) => {
  const addr = (req.params.address || '').toLowerCase().trim();
  const { status } = req.body;
  if (!activePositions.has(addr)) {
    return res.status(404).json({ error: 'Active position not found.' });
  }
  const tradeData = activePositions.get(addr);
  if (status === 'SELLING') {
    handleSellLogic(addr, tradeData, tradeData.docId, 'Manual_Frontend_Status_Trigger');
  }
  res.json({ success: true, currentStatus: status });
});

// POST force sell all positions for a tracked creator
app.post('/target-users/:address/force-sell', async (req, res) => {
  const targetAddress = (req.params.address || '').toLowerCase().trim();
  const matched = [];
  for (const [coinAddress, tradeData] of activePositions.entries()) {
    if ((tradeData.creatorAddress || '').toLowerCase() === targetAddress) {
      matched.push({ coinAddress, tradeData });
    }
  }

  for (const match of matched) {
    try {
      const tokenContract = new ethers.Contract(match.coinAddress, ['function balanceOf(address) view returns (uint256)'], ethersProvider);
      const balanceWei = await tokenContract.balanceOf(ethersWallet.address).catch(() => 0n);
      if (balanceWei > 0n) {
        handleSellLogic(match.coinAddress, match.tradeData, match.tradeData.docId, 'Creator_Force_Exit');
      }
    } catch (err) {
      console.error(`Force sell matching failed for ${match.coinAddress}:`, err.message);
    }
  }
  res.json({ success: true, message: `Initiated force sell for ${matched.length} positions.` });
});

// app.get('/', ...) removed so Vite middleware serves React SPA frontend

app.get('/status', async(req,res)=>{
  try{
    if(!ethersWallet) return res.status(503).json({status:'Not Ready'});
    
    const activeUserId = userContextStore.getStore();
    let targetAddress = ethersWallet.address;
    if (activeUserId) {
      try {
        const { loadTradingWallet } = require('./routes/onboarding');
        const loaded = await loadTradingWallet(activeUserId, process.env.ALCHEMY_RPC_URL || process.env.BASE_RPC_URL);
        targetAddress = loaded.address;
      } catch (walletErr) {
        console.warn(`[Status] Could not load user wallet for ${activeUserId}: ${walletErr.message}`);
      }
    }
    
    const balances = await getAllBalances(targetAddress);
    let activeTrades = 0;
    try{
      activeTrades = Array.from(activePositions.values()).filter(pos => !activeUserId || pos.userId === activeUserId).length;
    } catch{}
    
    const os = require('os');
    const processUptime = Math.floor(process.uptime());
    const hours = Math.floor(processUptime / 3600);
    const minutes = Math.floor((processUptime % 3600) / 60);
    const seconds = processUptime % 60;
    const uptimeStr = `${hours}h ${minutes}m ${seconds}s`;
    
    res.json({
      status: 'OK',
      wallet: targetAddress,
      tradeCurrency: botConfig.tradeCurrency,
      botState: botConfig.botState,
      vaultAddress: botConfig.vaultAddress || 'N/A',
      activeTrades: activeTrades,
      balances: {
        eth: ethers.formatEther(balances.eth),
        usdc: ethers.formatUnits(balances.usdc, 6),
      },
      ethPrice: ethPriceUsd,
      trackedCreators: trackedCreatorSet.size,
      uptime: uptimeStr,
      cpuLoad: Math.round((os.loadavg()[0] || 0.05) * 100) / 10,
      memoryUsage: `${Math.round(process.memoryUsage().rss / 1024 / 1024)} MB`
    });
  }catch(err){ res.status(500).json({ error: err?.message||String(err) }); }
});

app.get('/status/unified', async (req, res) => {
  try {
    if (!ethersWallet) return res.status(503).json({ status: 'Not Ready' });
    if (!db) return res.status(503).json({ error: 'Firestore not ready' });

    const activeUserId = userContextStore.getStore();
    let targetAddress = ethersWallet.address;
    if (activeUserId) {
      try {
        const { loadTradingWallet } = require('./routes/onboarding');
        const loaded = await loadTradingWallet(activeUserId, process.env.ALCHEMY_RPC_URL || process.env.BASE_RPC_URL);
        targetAddress = loaded.address;
      } catch (walletErr) {
        console.warn(`[Status Unified] Could not load user wallet for ${activeUserId}: ${walletErr.message}`);
      }
    }

    const balances = await getAllBalances(targetAddress);
    const processUptime = Math.floor(process.uptime());
    const hours = Math.floor(processUptime / 3600);
    const minutes = Math.floor((processUptime % 3600) / 60);
    const seconds = processUptime % 60;
    const uptimeStr = `${hours}h ${minutes}m ${seconds}s`;

    const os = require('os');
    const status = {
      botRunning: botConfig.botState === 'running',
      wsConnected: true,
      uptime: uptimeStr,
      gasPrice: 0.1, // Default or mock fallback
      ethPrice: ethPriceUsd,
      walletBalance: {
        eth: parseFloat(ethers.formatEther(balances.eth)),
        usdc: parseFloat(ethers.formatUnits(balances.usdc, 6))
      },
      cpuLoad: Math.round((os.loadavg()[0] || 0.05) * 100) / 10,
      memoryUsage: `${Math.round(process.memoryUsage().rss / 1024 / 1024)} MB`
    };

    const positions = Array.from(activePositions.entries())
      .map(([address, data]) => ({ address, ...data }))
      .filter(pos => !activeUserId || pos.userId === activeUserId);

    const tradesSnap = await db.collection('trades').orderBy('boughtAt', 'desc').limit(50).get();
    const trades = tradesSnap.docs.map(doc => doc.data());

    const creatorsSnap = await db.collection(TARGET_USERS_COLLECTION).orderBy('addedAt', 'desc').get();
    const creators = creatorsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    const botSettingsDoc = await db.collection('config').doc('botSettings').get();
    const strategy = botSettingsDoc.exists ? botSettingsDoc.data() : botConfig;

    const activitySnap = await db.collection(ACTIVITY_FEED_COLLECTION).orderBy('timestamp', 'desc').limit(50).get();
    const activityEvents = activitySnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    res.json({
      status,
      positions,
      trades,
      creators,
      strategy,
      activityEvents
    });
  } catch (err) {
    console.error('Unified status endpoint error:', err);
    res.status(500).json({ error: err?.message || String(err) });
  }
});

// --- Scanner Feed Endpoint: returns scanner events filtered by chain ---
app.get('/scanner/feed', async (req, res) => {
  try {
    const chain = req.query.chain || 'zora';
    let events = [];

    if (chain === 'zora') {
      // Fetch from activityFeed in DB, filtered by chain
      const snapshot = await db.collection(ACTIVITY_FEED_COLLECTION)
        .orderBy('timestamp', 'desc')
        .limit(50)
        .get();
      events = snapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .filter(e => !e.chain || e.chain === 'zora');
    } else {
      // Use in-memory scanner feeds from chain-specific routes
      events = sharedState.getScannerFeed(chain) || [];
    }

    res.json({ success: true, events });
  } catch (err) {
    console.error('Scanner feed error:', err.message);
    res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

const { handleAiChat, initOrchestrator } = require('./ai_orchestrator');
const { mcpRouter, initMcpServer } = require('./mcp_server');

// System getter functions to inject into AI Orchestrator and MCP Server
const systemGetters = {
  getWalletAddress: () => ethersWallet ? ethersWallet.address : '',
  getBalances: async (targetUser) => {
    try {
      if (!ethersProvider) return { eth: 0, usdc: 0 };
      let checkAddress = ethersWallet ? ethersWallet.address : null;

      if (targetUser && typeof targetUser === 'string' && targetUser !== 'null' && targetUser !== 'undefined') {
        if (targetUser.startsWith('0x')) {
          checkAddress = targetUser;
        } else {
          try {
            const { loadTradingWallet } = require('./routes/onboarding');
            let loaded = null;
            try {
              loaded = await loadTradingWallet(targetUser, process.env.ALCHEMY_RPC_URL || process.env.BASE_RPC_URL);
            } catch (_) {
              if (!targetUser.startsWith('telegram_')) {
                try {
                  loaded = await loadTradingWallet(`telegram_${targetUser}`, process.env.ALCHEMY_RPC_URL || process.env.BASE_RPC_URL);
                } catch (_) {}
              }
            }
            if (loaded && loaded.wallet) {
              checkAddress = loaded.wallet.address;
            }
          } catch (_) {}
        }
      }

      if (!checkAddress) return { eth: 0, usdc: 0 };

      let ethBalanceWei = 0n;
      let usdcBalance = 0n;
      try {
        ethBalanceWei = await ethersProvider.getBalance(checkAddress);
      } catch (e) {}
      try {
        const abi = ['function balanceOf(address) view returns (uint256)'];
        const contract = new ethers.Contract(USDC_ADDRESS, abi, ethersProvider);
        usdcBalance = await contract.balanceOf(checkAddress);
      } catch (e) {}
      return {
        eth: Number(ethBalanceWei) / 1e18,
        usdc: Number(usdcBalance) / 1e6
      };
    } catch (e) {
      return { eth: 0, usdc: 0 };
    }
  },
  getGasPrice: () => typeof gasPrice !== 'undefined' ? gasPrice : 0,
  getEthPrice: () => typeof ethPriceUsd !== 'undefined' && ethPriceUsd > 0 ? ethPriceUsd : 0,
  getEthPriceUsd: () => typeof ethPriceUsd !== 'undefined' && ethPriceUsd > 0 ? ethPriceUsd : 0,
  getBotConfig: () => typeof botConfig !== 'undefined' ? botConfig : {},
  getScannerFeed: (chain) => {
    if (chain === 'solana' && solanaRoutes && solanaRoutes.solanaScannedTokens) {
      return solanaRoutes.solanaScannedTokens;
    }
    if (chain === 'base' && baseRoutes && baseRoutes.baseScannedTokens) {
      return baseRoutes.baseScannedTokens;
    }
    return [];
  },
  getEthersWallet: () => ethersWallet || null,
  getEthersProvider: () => ethersProvider || null,
  executeBuy: async (tokenAddress, amountEth) => {
    try {
      const amountWei = ethers.parseEther(amountEth.toString());
      const res = await marketBuy(tokenAddress, amountWei);
      return {
        success: true,
        txHash: res.txHash || 'unknown',
        message: `Buy execution completed successfully. Got ${ethers.formatEther(res.received || 0n)} tokens.`
      };
    } catch (err) {
      return { success: false, error: err.message || String(err) };
    }
  },
  executeSell: async (tokenAddress, amountTokenPercent) => {
    try {
      // Phase 3: resolve active user's wallet for AI-triggered sells
      const activeUserId = userContextStore.getStore();
      let sellCheckAddress = ethersWallet ? ethersWallet.address : '';
      if (activeUserId) {
        try {
          const { loadTradingWallet } = require('./routes/onboarding');
          const loaded = await loadTradingWallet(activeUserId, process.env.ALCHEMY_RPC_URL || process.env.BASE_RPC_URL);
          sellCheckAddress = loaded.wallet.address;
        } catch (_) {}
      }
      const balanceWei = await new ethers.Contract(tokenAddress, ['function balanceOf(address) view returns (uint256)'], ethersProvider)
        .balanceOf(sellCheckAddress)
        .catch(() => 0n);
      
      if (balanceWei === 0n) {
        throw new Error('No balance to sell.');
      }
      
      const percent = parseInt(amountTokenPercent.replace('%', ''), 10);
      const sellAmount = (balanceWei * BigInt(percent)) / 100n;
      
      const manualOptions = {
        slippage: 0.05,
        maxPriorityFeePerGas: ethers.parseUnits('0.1', 'gwei')
      };
      
      const res = await marketSell(tokenAddress, sellAmount, manualOptions);
      return {
        success: true,
        txHash: res.txHash || 'unknown',
        message: `Sell exit execution completed successfully.`
      };
    } catch (err) {
      return { success: false, error: err.message || String(err) };
    }
  },
  updateConfig: async (updates) => {
    try {
      if (!db) throw new Error('Firestore not ready');
      const configRef = db.collection('config').doc('botSettings');
      await configRef.update(serializeForFirestore(updates));
      for (const [k, v] of Object.entries(updates)) {
        botConfig[k] = v;
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message || String(err) };
    }
  }
};

initOrchestrator(systemGetters);
initMcpServer(systemGetters);

// Build real backend services for Telegram Remote Controller
const telegramBackendServices = {
  getBalances: systemGetters.getBalances,
  getWalletAddress: (targetIdentifier) => {
    const val = String(targetIdentifier || '');
    if (val.startsWith('0x')) return val;
    return ethersWallet ? ethersWallet.address : '';
  },

  getPortfolio: async (targetIdentifier) => {
    try {
      let targetAddress = ethersWallet ? ethersWallet.address : '';
      let targetUid = null;
      const val = String(targetIdentifier || '');

      if (val.startsWith('0x')) {
        targetAddress = val;
      } else if (val && val !== 'null' && val !== 'undefined') {
        targetUid = val;
        try {
          const { loadTradingWallet } = require('./routes/onboarding');
          const loaded = await loadTradingWallet(targetUid, process.env.ALCHEMY_RPC_URL || process.env.BASE_RPC_URL);
          if (loaded && loaded.address) {
            targetAddress = loaded.address;
          }
        } catch (_) {}
      }

      const balances = await getAllBalances(targetAddress);
      const ethBalance = parseFloat(ethers.formatEther(balances.eth || 0n));
      const usdcBalance = parseFloat(ethers.formatUnits(balances.usdc || 0n, 6));
      const ethValUsd = ethBalance * (ethPriceUsd || 0);
      const nativeTotalUsd = ethValUsd + usdcBalance;

      const memoryPositions = Array.from(activePositions.entries())
        .map(([addr, data]) => ({ address: addr, ...data }))
        .filter(pos => !targetUid || !pos.userId || pos.userId === targetUid);

      let dbTrades = [];
      if (db) {
        try {
          const tradesSnap = await db.collection('trades')
            .orderBy('boughtAt', 'desc')
            .limit(100)
            .get();
          dbTrades = tradesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
        } catch (dbErr) {
          console.warn('[Telegram Backend Portfolio] DB query failed:', dbErr.message);
        }
      }

      const tokenMap = new Map();

      tokenMap.set('ETH', {
        symbol: 'ETH',
        name: 'Base ETH',
        address: 'N/A',
        category: 'Valuable',
        balance: ethBalance.toFixed(4),
        balanceWei: (balances.eth || 0n).toString(),
        usdValue: ethValUsd,
        sellable: false,
        liquidity: 'Native Gas Asset',
        chain: 'base'
      });

      if (usdcBalance > 0) {
        tokenMap.set('USDC', {
          symbol: 'USDC',
          name: 'USD Coin',
          address: USDC_ADDRESS,
          category: 'Valuable',
          balance: usdcBalance.toFixed(2),
          balanceWei: (balances.usdc || 0n).toString(),
          usdValue: usdcBalance,
          sellable: true,
          liquidity: 'High ($10M+)',
          chain: 'base'
        });
      }

      const combinedRecords = [...memoryPositions, ...dbTrades];
      let totalRealizedPnl = 0;
      let totalUnrealizedPnl = 0;

      for (const record of combinedRecords) {
        const coinAddr = (record.address || record.tokenAddress || '').toLowerCase();
        if (!coinAddr || coinAddr === 'n/a' || tokenMap.has(coinAddr)) continue;

        const isSold = record.status === 'sold';
        const spentUsd = (parseFloat(record.spentOnSellToken || '0') / 1e18) * (ethPriceUsd || 0);
        const receivedUsd = (parseFloat(record.received || '0') / 1e18) * (ethPriceUsd || 0);

        if (isSold) {
          totalRealizedPnl += (receivedUsd - spentUsd);
          continue;
        }

        let tokenBalanceWei = 0n;
        try {
          const tokenContract = new ethers.Contract(
            coinAddr,
            ['function balanceOf(address) view returns (uint256)'],
            ethersProvider
          );
          tokenBalanceWei = await tokenContract.balanceOf(targetAddress).catch(() => 0n);
        } catch (_) {}

        if (tokenBalanceWei === 0n && record.status !== 'bought') continue;

        let symbol = record.symbol || 'TOKEN';
        let name = record.name || 'Onchain Token';
        if (symbol === 'TOKEN') {
          try {
            const tokenContract = new ethers.Contract(coinAddr, ['function symbol() view returns (string)', 'function name() view returns (string)'], ethersProvider);
            symbol = await tokenContract.symbol().catch(() => 'TOKEN');
            name = await tokenContract.name().catch(() => 'Onchain Token');
          } catch (_) {}
        }

        const tokenBalance = tokenBalanceWei > 0n
          ? parseFloat(ethers.formatEther(tokenBalanceWei))
          : parseFloat(record.receivedBuyTokenAmount || '0');

        let currentUsdValue = 0;
        let liquidityLabel = 'Active';
        let isSellable = true;

        try {
          const coinData = await rateLimitedZoraCall(() => getCoin({ address: coinAddr, chain: base.id, apiKey: ZORA_READ_API_KEY })).catch(() => null);
          if (coinData?.data?.zora20Token) {
            const vol = coinData.data.zora20Token.volume24h || 0n;
            liquidityLabel = vol > 0n ? `Active ($${((Number(vol)/1e18)*(ethPriceUsd||0)).toFixed(0)} 24h Vol)` : 'Low Volatility';
          }
        } catch (_) {}

        currentUsdValue = spentUsd > 0 ? spentUsd : (tokenBalance * 0.05);

        let category = 'Valuable';
        if (record.isCreatorCoin) {
          category = 'Creator Coin';
        } else if (record.coinCategory) {
          category = record.coinCategory;
        } else if (currentUsdValue < 0.50) {
          category = 'Dust';
        } else if (liquidityLabel.includes('Low Volatility') && currentUsdValue < 0.10) {
          category = 'Dead Liquidity';
          isSellable = false;
        }

        tokenMap.set(coinAddr, {
          symbol,
          name,
          address: coinAddr,
          category,
          balance: tokenBalance.toLocaleString('en-US', { maximumFractionDigits: 4 }),
          balanceWei: tokenBalanceWei.toString(),
          usdValue: currentUsdValue,
          sellable: isSellable,
          liquidity: liquidityLabel,
          chain: 'base'
        });

        totalUnrealizedPnl += (currentUsdValue - spentUsd);
      }

      const tokens = Array.from(tokenMap.values());
      const totalTokenUsd = tokens.reduce((acc, t) => acc + (t.usdValue || 0), 0);
      const totalPortfolioValue = (nativeTotalUsd + totalTokenUsd).toFixed(2);
      const sellableCount = tokens.filter(t => t.sellable).length;

      const pnlSign = (totalUnrealizedPnl + totalRealizedPnl) >= 0 ? '+' : '';
      const pnlStr = `${pnlSign}$${(totalUnrealizedPnl + totalRealizedPnl).toFixed(2)}`;

      return {
        walletAddress: targetAddress,
        totalPortfolioValue,
        totalWalletBalance: `${ethBalance.toFixed(4)} ETH / ${usdcBalance.toFixed(2)} USDC`,
        pnl: pnlStr,
        totalTokens: tokens.length,
        sellableCount,
        tokens
      };
    } catch (err) {
      console.error('[Telegram Backend Portfolio Error]', err);
      return {
        walletAddress: ethersWallet ? ethersWallet.address : 'N/A',
        totalPortfolioValue: '0.00',
        totalWalletBalance: '0.00 ETH',
        pnl: '$0.00',
        totalTokens: 0,
        sellableCount: 0,
        tokens: []
      };
    }
  },

  executeSell: async ({ coinAddress, percentage, amount, userIdOrWallet }) => {
    try {
      if (!coinAddress || !ethers.isAddress(coinAddress)) {
        return { success: false, error: 'Invalid token contract address.' };
      }
      const lowerAddr = coinAddress.toLowerCase();

      let targetUser = userIdOrWallet ? String(userIdOrWallet).toLowerCase() : null;
      let signerWallet = ethersWallet;

      if (targetUser && !targetUser.startsWith('0x') && targetUser !== 'null' && targetUser !== 'undefined') {
        try {
          const { loadTradingWallet } = require('./routes/onboarding');
          let loaded = null;
          try {
            loaded = await loadTradingWallet(targetUser, process.env.ALCHEMY_RPC_URL || process.env.BASE_RPC_URL);
          } catch (_) {
            if (!targetUser.startsWith('telegram_')) {
              try {
                loaded = await loadTradingWallet(`telegram_${targetUser}`, process.env.ALCHEMY_RPC_URL || process.env.BASE_RPC_URL);
                targetUser = `telegram_${targetUser}`;
              } catch (_) {}
            }
          }
          if (loaded && loaded.wallet) {
            signerWallet = loaded.wallet;
          }
        } catch (wErr) {
          console.warn('[Telegram Sell Wallet Resolution Warning]', wErr.message);
        }
      }

      if (!signerWallet || !signerWallet.address) {
        return { success: false, error: 'NO_WALLET_FOUND: No active trading wallet is configured or loaded for this user.' };
      }

      const balanceWei = await new ethers.Contract(lowerAddr, ['function balanceOf(address) view returns (uint256)'], ethersProvider)
        .balanceOf(signerWallet.address)
        .catch(() => 0n);

      if (balanceWei === 0n) {
        return { success: false, error: 'No on-chain token balance found in wallet.' };
      }

      const perc = percentage ? parseInt(percentage, 10) : 100;
      const sellAmount = (balanceWei * BigInt(perc)) / 100n;

      const manualOptions = {
        slippage: botConfig.tradeSlippage || 0.05,
        maxPriorityFeePerGas: ethers.parseUnits('0.1', 'gwei')
      };

      console.log(`[Telegram Remote Controller] Executing real sell on-chain for ${lowerAddr} (user: ${targetUser || 'system'})...`);
      
      let sellRes;
      if (targetUser && userContextStore) {
        sellRes = await userContextStore.run(targetUser, async () => {
          return await marketSell(lowerAddr, sellAmount, manualOptions);
        });
      } else {
        sellRes = await marketSell(lowerAddr, sellAmount, manualOptions);
      }

      const receipt = sellRes.raw || {};
      const txHash = sellRes.txHash || receipt.transactionHash;
      const receivedWei = sellRes.received || 0n;
      const receivedEth = parseFloat(ethers.formatEther(receivedWei));
      const usdValue = receivedEth * (ethPriceUsd || 0);

      let gasUsedStr = 'Auto';
      if (receipt.gasUsed && receipt.effectiveGasPrice) {
        const gasCostWei = receipt.gasUsed * receipt.effectiveGasPrice;
        gasUsedStr = `${ethers.formatEther(gasCostWei)} ETH`;
      }

      if (db) {
        try {
          const tradeSnap = await db.collection('trades')
            .where('tokenAddress', 'in', [coinAddress, lowerAddr])
            .where('status', '==', 'bought')
            .get();

          if (!tradeSnap.empty) {
            const batch = db.batch();
            tradeSnap.docs.forEach(doc => {
              batch.update(doc.ref, {
                status: 'sold',
                soldAt: Date.now(),
                received: receivedWei.toString(),
                sellTx: txHash || 'TELEGRAM_SELL',
                sellReason: 'Telegram_Remote_Controller'
              });
            });
            await batch.commit();
          }

          await db.collection(ACTIVITY_FEED_COLLECTION).add({
            type: 'SELL_SUCCESS',
            coin: lowerAddr,
            amount: sellAmount.toString(),
            received: receivedWei.toString(),
            txHash,
            timestamp: Date.now(),
            context: { source: 'telegram_bot' }
          });
        } catch (dbErr) {
          console.warn('[Telegram Sell DB Update Warning]', dbErr.message);
        }
      }

      activePositions.delete(lowerAddr);

      let symbol = 'TOKEN';
      try {
        symbol = await new ethers.Contract(lowerAddr, ['function symbol() view returns (string)'], ethersProvider).symbol();
      } catch (_) {}

      return {
        success: true,
        status: 'Confirmed',
        tokenAddress: lowerAddr,
        symbol,
        soldAmount: parseFloat(ethers.formatEther(sellAmount)).toLocaleString('en-US', { maximumFractionDigits: 4 }),
        receivedAmount: `${receivedEth.toFixed(4)} ETH`,
        usdValue: `$${usdValue.toFixed(2)}`,
        gasUsed: gasUsedStr,
        txHash,
        explorerUrl: `https://basescan.org/tx/${txHash}`,
        timestamp: Date.now()
      };
    } catch (err) {
      console.error('[Telegram Remote Controller Sell Error]', err);
      return {
        success: false,
        tokenAddress: coinAddress,
        error: err.message || String(err)
      };
    }
  },

  executeBuy: async ({ coinAddress, amountEth, userIdOrWallet }) => {
    try {
      if (!coinAddress || !ethers.isAddress(coinAddress)) {
        return { success: false, error: 'Invalid token contract address.' };
      }
      const lowerAddr = coinAddress.toLowerCase();
      const amountWei = ethers.parseEther(amountEth.toString());

      // Check subscription active status
      const subCheck = await telegramBackendServices.checkSubscription(userIdOrWallet);
      if (subCheck && subCheck.active === false) {
        return { success: false, error: 'SUBSCRIPTION_INACTIVE: Trading requires an active weekly or PAYG subscription plan.' };
      }

      const targetUser = userIdOrWallet ? String(userIdOrWallet).toLowerCase() : null;
      console.log(`[Telegram Remote Controller] Executing real buy on-chain for ${lowerAddr} (${amountEth} ETH) for user ${targetUser || 'system'}...`);
      
      let buyRes;
      if (targetUser && userContextStore) {
        buyRes = await userContextStore.run(targetUser, async () => {
          return await marketBuy(lowerAddr, amountWei);
        });
      } else {
        buyRes = await marketBuy(lowerAddr, amountWei);
      }

      const txHash = buyRes.txHash || buyRes.raw?.transactionHash;
      const receivedWei = buyRes.received || 0n;
      const receivedToken = parseFloat(ethers.formatEther(receivedWei));

      if (db) {
        const tradeData = {
          tokenAddress: lowerAddr,
          status: 'bought',
          boughtAt: Date.now(),
          spentOnSellToken: amountWei.toString(),
          receivedBuyTokenAmount: receivedWei.toString(),
          txHash,
          tradeCurrency: botConfig.tradeCurrency,
          type: 'telegram',
          userId: targetUser || 'system',
          autoSellGlobal: true
        };
        activePositions.set(lowerAddr, tradeData);
        await db.collection('trades').add(tradeData);
      }

      let symbol = 'TOKEN';
      try {
        symbol = await new ethers.Contract(lowerAddr, ['function symbol() view returns (string)'], ethersProvider).symbol();
      } catch (_) {}

      return {
        success: true,
        status: 'Confirmed',
        tokenAddress: lowerAddr,
        symbol,
        boughtAmount: receivedToken.toLocaleString('en-US', { maximumFractionDigits: 4 }),
        spentAmount: `${amountEth} ETH`,
        txHash,
        explorerUrl: `https://basescan.org/tx/${txHash}`,
        timestamp: Date.now()
      };
    } catch (err) {
      console.error('[Telegram Remote Controller Buy Error]', err);
      return { success: false, tokenAddress: coinAddress, error: err.message || String(err) };
    }
  },

  registerTelegramWallet: async ({ chatId, privateKeyOrMnemonic }) => {
    try {
      if (!privateKeyOrMnemonic) {
        return { success: false, error: 'Private key or seed phrase is required.' };
      }
      const rawInput = String(privateKeyOrMnemonic).trim();
      let wallet;

      const normalizedWords = rawInput.toLowerCase().replace(/\s+/g, ' ');
      const wordsArr = normalizedWords.split(' ');

      if (wordsArr.length > 1) {
        if (![12, 15, 18, 21, 24].includes(wordsArr.length)) {
          return {
            success: false,
            error: `Invalid seed phrase length (${wordsArr.length} words detected). Mnemonic seed phrases must be 12, 15, 18, 21, or 24 words.`
          };
        }
        try {
          wallet = ethers.Wallet.fromPhrase(normalizedWords);
        } catch (phraseErr) {
          return {
            success: false,
            error: `Invalid seed phrase: ${phraseErr.message || 'Mnemonic word list or checksum failed verification.'}`
          };
        }
      } else {
        const cleanKey = rawInput.replace(/\s+/g, '');
        const formattedKey = cleanKey.startsWith('0x') ? cleanKey : `0x${cleanKey}`;
        try {
          wallet = new ethers.Wallet(formattedKey);
        } catch (keyErr) {
          return {
            success: false,
            error: `Invalid private key: ${keyErr.message || 'Must be a valid 64-character hex string.'}`
          };
        }
      }

      const { encryptText } = require('./routes/onboarding');
      const encryptedKey = await encryptText(wallet.privateKey);
      const uid = `telegram_${chatId}`;

      const userRecord = {
        uid,
        telegramId: String(chatId),
        termsAccepted: true,
        termsAcceptedAt: Date.now(),
        privacyAccepted: true,
        riskAccepted: true,
        onboardingComplete: true,
        onboardingCompletedAt: Date.now(),
        plan: 'payg',
        subscriptionActive: true,
        profileTag: 'Telegram Trader',
        tradingWallet: {
          address: wallet.address,
          encryptedKey,
          backupConfirmed: true,
          createdAt: Date.now(),
          chain: 'evm'
        },
        settings: {
          autoBuyEnabled: false,
          autoSellEnabled: true,
          takeProfit: 50,
          stopLoss: 20,
          tradeSlippage: 0.05,
          maxPriorityFeeGwei: 0.1,
          buyAmountEth: 0.01,
          sellPercentage: 100,
          tradingEnabled: true,
          chain: 'base'
        }
      };

      if (db) {
        await db.collection('users').doc(uid).set(userRecord, { merge: true });
      }

      return {
        success: true,
        address: wallet.address,
        uid,
        message: 'Wallet encrypted and registered successfully'
      };
    } catch (err) {
      console.error('[Telegram Registration Error]', err);
      return { success: false, error: `Wallet validation/encryption failed: ${err.message}` };
    }
  },

  getUserProfile: async (userIdOrWallet) => {
    if (!db || !userIdOrWallet) return null;
    try {
      const uid = String(userIdOrWallet).toLowerCase();
      const snap = await db.collection('users').doc(uid).get();
      if (snap.exists) return snap.data();
      
      const querySnap = await db.collection('users').where('telegramId', '==', String(userIdOrWallet)).get();
      if (!querySnap.empty) return querySnap.docs[0].data();
      
      return null;
    } catch (_) {
      return null;
    }
  },

  getUserSettings: async (userIdOrWallet) => {
    const profile = await telegramBackendServices.getUserProfile(userIdOrWallet);
    const userSettings = profile?.settings || {};
    const botCfg = await telegramBackendServices.getConfig();
    const defaultSettings = {
      autoBuyEnabled: botCfg.autoBuyEnabled ?? false,
      autoSellEnabled: botCfg.autoSellGlobal ?? true,
      takeProfit: botCfg.takeProfitPercent ?? 50,
      stopLoss: botCfg.stopLossPercent ?? 20,
      tradeSlippage: botCfg.tradeSlippage ?? 0.05,
      maxPriorityFeeGwei: botCfg.maxPriorityFeeGwei ?? 0.1,
      buyAmountEth: botCfg.tradeAmountEth ?? 0.01,
      sellPercentage: botCfg.sellPercentage ?? 100,
      tradingEnabled: botCfg.botState === 'running',
      chain: 'base',
      notificationsEnabled: true
    };
    return { ...defaultSettings, ...userSettings };
  },

  updateUserSettings: async (userIdOrWallet, updates) => {
    if (!db || !userIdOrWallet) return { success: false, error: 'Database or User ID missing' };
    try {
      const uid = String(userIdOrWallet).startsWith('telegram_') || String(userIdOrWallet).startsWith('0x')
        ? String(userIdOrWallet)
        : `telegram_${userIdOrWallet}`;
      const current = await telegramBackendServices.getUserSettings(uid);
      const updated = { ...current, ...updates };
      await db.collection('users').doc(uid).set({ settings: updated }, { merge: true });

      // Synchronize with global botConfig so Dashboard and Trading Engine reflect changes in real-time
      const botUpdates = {};
      if (updates.buyAmountEth !== undefined) botUpdates.tradeAmountEth = parseFloat(updates.buyAmountEth);
      if (updates.tradeSlippage !== undefined) botUpdates.tradeSlippage = parseFloat(updates.tradeSlippage);
      if (updates.maxPriorityFeeGwei !== undefined) botUpdates.maxPriorityFeeGwei = parseFloat(updates.maxPriorityFeeGwei);
      if (updates.autoBuyEnabled !== undefined) botUpdates.autoBuyEnabled = !!updates.autoBuyEnabled;
      if (updates.autoSellEnabled !== undefined) botUpdates.autoSellGlobal = !!updates.autoSellEnabled;
      if (updates.takeProfit !== undefined) botUpdates.takeProfitPercent = parseFloat(updates.takeProfit);
      if (updates.stopLoss !== undefined) botUpdates.stopLossPercent = parseFloat(updates.stopLoss);
      if (updates.sellPercentage !== undefined) botUpdates.sellPercentage = parseFloat(updates.sellPercentage);
      if (updates.tradingEnabled !== undefined) botUpdates.botState = updates.tradingEnabled ? 'running' : 'stopped';

      if (Object.keys(botUpdates).length > 0) {
        await telegramBackendServices.updateConfig(botUpdates);
      }

      return { success: true, settings: updated };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  getTrackedCreators: async () => {
    if (!db) return [];
    try {
      const snapshot = await db.collection(TARGET_USERS_COLLECTION).orderBy('addedAt', 'desc').get();
      return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    } catch (err) {
      console.error('[getTrackedCreators error]', err?.message || String(err));
      return [];
    }
  },

  addTrackedCreator: async ({ creatorAddress, name, fid, notes }) => {
    if (!db) return { success: false, error: 'Firestore unavailable' };
    if (!creatorAddress) return { success: false, error: 'Creator address required' };
    try {
      const cleanAddr = String(creatorAddress).toLowerCase();
      const docRef = db.collection(TARGET_USERS_COLLECTION).doc(cleanAddr);
      const existing = await docRef.get();
      if (existing.exists) {
        const existingData = existing.data() || {};
        if (existingData.status === 'active' && !existingData.pauseTracking) {
          return { success: false, alreadyTracked: true, error: 'Already tracked', creator: existingData };
        }
      }
      const creatorData = {
        userId: name || (existing.exists ? existing.data().userId : `Creator_${cleanAddr.slice(0, 6)}`),
        creatorAddress: cleanAddr,
        fid: fid || (existing.exists ? existing.data().fid : null),
        tokenAddresses: existing.exists ? (existing.data().tokenAddresses || []) : [],
        addedAt: existing.exists ? existing.data().addedAt : new Date().toISOString(),
        status: 'active',
        pauseTracking: false,
        notes: notes || (existing.exists ? existing.data().notes : ''),
        matchedTrades: existing.exists ? (existing.data().matchedTrades || 0) : 0
      };
      await docRef.set(creatorData, { merge: true });
      return { success: true, message: `Successfully tracked creator ${creatorData.userId}`, creator: creatorData };
    } catch (err) {
      return { success: false, error: err?.message || String(err) };
    }
  },

  updateTrackedCreator: async (creatorAddress, updates) => {
    if (!db || !creatorAddress) return { success: false, error: 'Creator address required' };
    try {
      const cleanAddr = String(creatorAddress).toLowerCase();
      const docRef = db.collection(TARGET_USERS_COLLECTION).doc(cleanAddr);
      await docRef.set(updates, { merge: true });
      return { success: true };
    } catch (err) {
      return { success: false, error: err?.message || String(err) };
    }
  },

  deleteTrackedCreator: async (creatorAddress) => {
    if (!db || !creatorAddress) return { success: false, error: 'Creator address required' };
    try {
      const cleanAddr = String(creatorAddress).toLowerCase();
      await db.collection(TARGET_USERS_COLLECTION).doc(cleanAddr).delete();
      return { success: true };
    } catch (err) {
      return { success: false, error: err?.message || String(err) };
    }
  },

  checkSubscription: async (userIdOrWallet) => {
    if (!userIdOrWallet) return { active: true, plan: 'payg', profileTag: 'Pay As You Go' };
    const ADMIN_WALLETS = (process.env.ADMIN_WALLETS || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
    if (ADMIN_WALLETS.includes(String(userIdOrWallet).toLowerCase())) {
      return { active: true, plan: 'admin', profileTag: 'Gold User' };
    }
    const profile = await telegramBackendServices.getUserProfile(userIdOrWallet);
    if (!profile) return { active: true, plan: 'payg', profileTag: 'Pay As You Go' };
    return {
      active: profile.subscriptionActive !== false,
      plan: profile.plan || 'payg',
      profileTag: profile.profileTag || (profile.plan === 'weekly' ? 'Subscribed' : 'Pay As You Go')
    };
  },

  executeWithdraw: async ({ userIdOrWallet, toAddress, amountEth }) => {
    try {
      if (!toAddress || !ethers.isAddress(toAddress)) {
        return { success: false, error: 'Invalid destination EVM address.' };
      }

      let signerWallet = ethersWallet;
      const userVal = String(userIdOrWallet || '');
      if (userVal && !userVal.startsWith('0x') && userVal !== 'null' && userVal !== 'undefined') {
        try {
          const { loadTradingWallet } = require('./routes/onboarding');
          const loaded = await loadTradingWallet(userVal, process.env.ALCHEMY_RPC_URL || process.env.BASE_RPC_URL);
          signerWallet = loaded.wallet;
        } catch (wErr) {
          console.warn('[Withdraw] Could not load custom user wallet, using system wallet:', wErr.message);
        }
      }

      const balanceWei = await ethersProvider.getBalance(signerWallet.address);
      if (balanceWei === 0n) {
        return { success: false, error: 'Wallet balance is 0 ETH.' };
      }

      const feeData = await ethersProvider.getFeeData();
      const gasPrice = feeData.gasPrice || feeData.maxFeePerGas || ethers.parseUnits('0.1', 'gwei');
      const estimatedGasWei = 21000n * gasPrice;

      let sendWei;
      if (!amountEth || String(amountEth).toLowerCase() === 'all') {
        if (balanceWei <= estimatedGasWei) {
          return { success: false, error: 'Insufficient ETH balance to cover gas fees.' };
        }
        sendWei = balanceWei - estimatedGasWei;
      } else {
        sendWei = ethers.parseEther(String(amountEth));
        if (sendWei + estimatedGasWei > balanceWei) {
          return { success: false, error: 'Insufficient ETH balance for withdrawal amount plus gas fee.' };
        }
      }

      console.log(`[Withdraw] Sending ${ethers.formatEther(sendWei)} ETH from ${signerWallet.address} to ${toAddress}...`);
      const tx = await signerWallet.sendTransaction({
        to: toAddress,
        value: sendWei,
        gasLimit: 21000n,
        gasPrice
      });

      const receipt = await tx.wait();
      const formattedAmount = ethers.formatEther(sendWei);
      const usdVal = parseFloat(formattedAmount) * (ethPriceUsd || 0);

      return {
        success: true,
        status: 'Confirmed',
        fromAddress: signerWallet.address,
        toAddress,
        amountEth: formattedAmount,
        usdValue: `$${usdVal.toFixed(2)}`,
        txHash: receipt.hash,
        explorerUrl: `https://basescan.org/tx/${receipt.hash}`,
        gasUsed: `${ethers.formatEther(receipt.gasUsed * receipt.effectiveGasPrice)} ETH`
      };
    } catch (err) {
      console.error('[Withdraw Error]', err);
      return { success: false, error: err.message || String(err) };
    }
  },

  executeSellSelected: async ({ tokenAddresses, userIdOrWallet }) => {
    const succeeded = [];
    const failed = [];
    const skipped = [];
    const unsellable = [];

    for (const addr of tokenAddresses) {
      if (addr === 'ETH' || addr === 'N/A') {
        skipped.push({ symbol: 'ETH', reason: 'Native gas currency cannot be sold' });
        continue;
      }
      const res = await telegramBackendServices.executeSell({ coinAddress: addr, percentage: 100, userIdOrWallet });
      if (res.success) {
        succeeded.push(res);
      } else if (res.error && res.error.includes('LIQUIDITY_TOO_LOW')) {
        unsellable.push({ tokenAddress: addr, reason: 'Zero liquidity pool' });
      } else if (res.error && res.error.includes('No on-chain token balance')) {
        skipped.push({ tokenAddress: addr, reason: 'Zero balance' });
      } else {
        failed.push({ tokenAddress: addr, reason: res.error });
      }
    }

    return { succeeded, failed, skipped, unsellable };
  },

  executeSellAll: async ({ userIdOrWallet }) => {
    let addresses = [];
    try {
      const inventory = await WalletInventoryScanner.scanInventory({
        targetIdentifier: userIdOrWallet,
        ethersProvider,
        ethersWallet,
        db,
        ethPriceUsd,
        ZORA_READ_API_KEY,
        rateLimitedZoraCall,
        getCoin,
        getCoins,
        getProfileCoins,
        getProfileBalances,
        getProfile
      });
      const items = inventory.items || [];
      addresses = items
        .filter(t => (t.contract || t.address) && (t.contract || t.address) !== 'N/A' && (t.contract || t.address).toLowerCase() !== 'eth')
        .map(t => t.contract || t.address);
    } catch (_) {
      const portfolio = await telegramBackendServices.getPortfolio(userIdOrWallet);
      addresses = (portfolio.tokens || [])
        .filter(t => t.address && t.address !== 'N/A' && t.address.toLowerCase() !== 'eth')
        .map(t => t.address);
    }
    return await telegramBackendServices.executeSellSelected({ tokenAddresses: addresses, userIdOrWallet });
  },

  getConfig: async () => {
    let firestoreConfig = {};
    if (db) {
      try {
        const doc = await db.collection('config').doc('botSettings').get();
        if (doc.exists) firestoreConfig = doc.data();
      } catch (_) {}
    }
    return { ...botConfig, ...firestoreConfig };
  },

  updateConfig: async (updates) => {
    try {
      Object.assign(botConfig, updates);
      if (db) {
        await db.collection('config').doc('botSettings').set(serializeForFirestore(updates), { merge: true });
        await db.collection('settings').doc('botConfig').set(serializeForFirestore(updates), { merge: true });
      }
      return { success: true, config: botConfig };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  getTokenDetails: async (coinAddress) => {
    const lowerAddr = (coinAddress || '').toLowerCase();
    let symbol = 'TOKEN';
    let name = 'Onchain Token';
    let decimals = 18;
    try {
      const contract = new ethers.Contract(lowerAddr, [
        'function symbol() view returns (string)',
        'function name() view returns (string)',
        'function decimals() view returns (uint8)'
      ], ethersProvider);
      symbol = await contract.symbol().catch(() => 'TOKEN');
      name = await contract.name().catch(() => 'Onchain Token');
      decimals = await contract.decimals().catch(() => 18);
    } catch (_) {}

    let volume24h = '0 ETH';
    try {
      const coinData = await rateLimitedZoraCall(() => getCoin({ address: lowerAddr, chain: base.id, apiKey: ZORA_READ_API_KEY })).catch(() => null);
      if (coinData?.data?.zora20Token?.volume24h) {
        volume24h = `${ethers.formatEther(coinData.data.zora20Token.volume24h)} ETH`;
      }
    } catch (_) {}

    return {
      symbol,
      name,
      contract: lowerAddr,
      decimals,
      dexPool: 'Uniswap V3 / Aerodrome (Base L2)',
      volume24h,
      honeypotRisk: 'LOW (Verified Contract)',
      ownership: 'Renounced',
      recommendedSlippage: `${((botConfig.tradeSlippage || 0.05) * 100).toFixed(1)}%`
    };
  },

  getWalletInventory: async (targetIdentifier) => {
    const { WalletInventoryScanner } = require('./walletInventory');
    return await WalletInventoryScanner.scanInventory({
      targetIdentifier,
      ethersProvider,
      ethersWallet,
      db,
      ethPriceUsd,
      ZORA_READ_API_KEY,
      USDC_ADDRESS,
      rateLimitedZoraCall,
      getCoin,
      getCoins,
      getProfileCoins,
      getProfileBalances,
      getProfile
    });
  }
};

setBackendServices(telegramBackendServices);

// REST API Endpoints for Wallet Inventory Module
app.get('/api/wallet/inventory', async (req, res) => {
  try {
    const target = req.query.target || (ethersWallet ? ethersWallet.address : null);
    const inventory = await telegramBackendServices.getWalletInventory(target);
    res.json(inventory);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/wallet/inventory/sell', async (req, res) => {
  try {
    const { coinAddress, percentage, userIdOrWallet } = req.body;
    const result = await telegramBackendServices.executeSell({ coinAddress, percentage, userIdOrWallet });
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/wallet/inventory/sell-all', async (req, res) => {
  try {
    const { userIdOrWallet } = req.body;
    const result = await telegramBackendServices.executeSellAll({ userIdOrWallet });
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// AI chat plan gate middleware
async function requireActivePlan(req, res, next) {
  const uid = req.user && (req.user.uid || req.user.walletAddress || '').toLowerCase();
  const role = req.user && req.user.role;

  // Admin users always pass
  if (role === 'admin') return next();

  // Check user's subscription status
  try {
    if (db) {
      const snap = await db.collection('users').doc(uid).get();
      const userData = snap.exists ? snap.data() : {};
      const hasActive = !!userData.subscriptionActive;
      const isPayg = userData.plan === 'payg';
      
      if (!hasActive && !isPayg) {
        return res.status(402).json({
          error: 'Subscription Required',
          message: 'To enable trading execution and bot configuration, please activate a plan (Pay As You Go or Weekly) from the FOMOCLIX dashboard.'
        });
      }

      // Attach plan context to request for orchestrator to use
      req.planContext = {
        subscriptionActive: hasActive,
        plan: userData.plan || null,
        profileTag: userData.profileTag || null,
      };
    }
  } catch (err) {
    console.warn('[Plan Gate] Could not verify subscription:', err.message);
  }
  next();
}

app.post('/ai/chat', requireActivePlan, handleAiChat);
app.post('/ai/chat-preview', require('./ai_orchestrator').handleAiPreviewChat);

app.get('/scanner/public-feed', async (req, res) => {
  try {
    const snapshot = await db.collection(ACTIVITY_FEED_COLLECTION)
      .orderBy('timestamp', 'desc')
      .limit(50)
      .get();
    const events = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json({ success: true, events });
  } catch (err) {
    console.error('Public scanner feed error:', err.message);
    res.status(500).json({ success: false, error: err?.message || String(err) });
  }
});

app.use('/mcp', mcpRouter);

app.post('/config/ai', async (req, res) => {
  if (!db) return res.status(503).json({ error: 'Firestore not ready' });
  try {
    const { geminiApiKey } = req.body;
    await db.collection('config').doc('ai').set({
      geminiApiKey: geminiApiKey || '',
      updatedAt: new Date().toISOString()
    }, { merge: true });
    res.json({ success: true, message: 'AI settings updated successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/config/ai', async (req, res) => {
  if (!db) return res.status(503).json({ error: 'Firestore not ready' });
  try {
    const doc = await db.collection('config').doc('ai').get();
    if (doc.exists) {
      const data = doc.data();
      // Obfuscate api key before sending to frontend
      const key = data.geminiApiKey || '';
      res.json({
        geminiApiKey: key ? (key.slice(0, 6) + '...' + key.slice(-4)) : ''
      });
    } else {
      res.json({ geminiApiKey: '' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/v1/ai/chat', (req, res) => {
  res.redirect(307, '/ai/chat');
});

app.get('/performance/summary', async(req, res) => {
  if (!db) return res.status(503).json({ error: 'Firestore not ready' });

  try {
    const twentyFourHoursAgo = Date.now() - (24 * 60 * 60 * 1000);
    
    const soldTradesSnap = await db.collection('trades')
      .where('status', '==', 'sold')
      .where('soldAt', '>=', twentyFourHoursAgo)
      .get();

    let totalProfit = 0n;
    let winCount = 0;
    const totalTrades = soldTradesSnap.size;

    soldTradesSnap.docs.forEach(doc => {
      const trade = doc.data();
      const profit = BigInt(trade.profit || '0');
      totalProfit += profit;
      if (profit > 0n) {
        winCount++;
      }
    });

    res.json({
      totalProfit: ethersFormatEther(totalProfit), // as ETH string
      winRate: totalTrades === 0 ? 0 : Math.round((winCount / totalTrades) * 100),
      totalTrades24h: totalTrades
    });

  } catch (err) {
    console.error('Error in /performance/summary:', err.message);
    res.status(500).json({ error: 'Failed to generate performance summary.' });
  }
});

app.post('/bot/:action', async (req, res) => {
  const { action } = req.params;
  if (!['start', 'pause'].includes(action)) {
    return res.status(400).json({ error: 'Invalid action' });
  }
  
  try {
    const newState = action === 'start' ? 'running' : 'paused';
    await db.collection('config').doc('botSettings').update({ botState: newState });
    
    await notify('BOT', `Bot state change requested: ${newState.toUpperCase()}`);
    res.json({ status: 'OK', botState: newState });
  } catch (err) {
    console.error('Failed to update bot state:', err);
    res.status(500).json({ error: 'Could not update bot state in Firestore' });
  }
});

app.post('/process-sells', async(req,res)=>{
  try{
    if(!db) return res.status(503).json({error:'Not ready'});

    console.log('CRON /process-sells: Running as fallback/janitor...');
    
    const minTime = Date.now() - botConfig.minimumHoldMinutes*60*1000;
    const snap = await db.collection('trades')
      .where('status','==','bought')
      .where('boughtAt', '<=', minTime)
      .get();
    
    let processed = 0;
    let errors = 0;

    for(const doc of snap.docs){
      const t = doc.data();
      const token = t.tokenAddress;

      if (activePositions.has(token.toLowerCase())) {
        continue;
      }
      
      console.log(`CRON: Checking missed trade ${token}...`);
      
      // --- THIS IS THE FIX ---
      // We now pass doc.id as the third argument
      const result = await handleSellLogic(token, t, doc.id);
      // --- END FIX ---

      if (result === 'SOLD') processed++;
      if (result === 'ERROR') errors++;
    }
    res.json({ processed, errors, checked: snap.size });
  } catch(err) { 
    console.error(`CRON /process-sells error: ${err.message}`);
    res.status(500).json({ error:err?.message||String(err) }); 
  }
});
// GET current targeting config
app.get('/api/config/targeting', (req, res) => {
  res.json({
    symbolTargetingEnabled: botConfig.symbolTargetingEnabled,
    targetKeywords: botConfig.targetKeywords,
    timerMinutes: botConfig.symbolTargetTimerMinutes,
    takeProfitUsd: botConfig.symbolTargetTakeProfitUsd,
    stopLossPercent: botConfig.symbolTargetStopLossPercent,
    partialProfitUsd: botConfig.symbolTargetPartialProfitUsd
  });
});

// POST update targeting config

// app.get('/', ...) removed so Vite middleware serves React SPA frontend
app.post('/api/config/targeting', async (req, res) => {
  try {
    const { 
      enabled, keywords, timer, takeProfit, stopLoss, partialProfit 
    } = req.body;

    const updates = {
      symbolTargetingEnabled: !!enabled,
      targetKeywords: keywords || botConfig.targetKeywords,
      symbolTargetTimerMinutes: parseInt(timer) || 2,
      symbolTargetTakeProfitUsd: parseFloat(takeProfit) || 60.0,
      symbolTargetStopLossPercent: parseFloat(stopLoss) || 20,
      symbolTargetPartialProfitUsd: parseFloat(partialProfit) || 100.0,
      trendingSnipingEnabled: !!req.body.trendingEnabled,
      buyNewProfilesOnly: !!req.body.newProfilesOnly,
      minTrendVolume24h: parseFloat(req.body.trendVol) || 0.5
    };

    Object.assign(botConfig, updates);

    // Persist to Firestore if available
    if (db) {
      // Use the 'config' collection and 'botSettings' doc as seen in your image
      await db.collection('config').doc('botSettings').set(updates, { merge: true });
    }

    res.json({ success: true, config: botConfig });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// ---------------------
// Telegram Tracked Creator Endpoint
// ---------------------
app.post('/api/telegram/tracked-creators/add', async (req, res) => {
  try {
    const { userId, creatorAddress, sourceCoin, telegramChatId } = req.body;
    if (!creatorAddress) {
      return res.status(400).json({ success: false, error: 'Creator address required' });
    }
    const result = await telegramBackendServices.addTrackedCreator({
      creatorAddress,
      name: userId,
      notes: sourceCoin ? `Added via Telegram from coin ${sourceCoin}` : 'Added via Telegram'
    });
    if (result.alreadyTracked) {
      return res.status(200).json(result);
    }
    if (!result.success) {
      return res.status(400).json(result);
    }
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message || 'Backend offline' });
  }
});

// ---------------------
// Configuration Update Route
// ---------------------
app.get('/target-users', async (req, res) => {
  if (!db) return res.status(503).json({ error: 'Firestore not ready' });
  try {
    const snapshot = await db.collection(TARGET_USERS_COLLECTION).orderBy('addedAt', 'desc').get();
    const users = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err?.message || String(err) });
  }
});

app.post('/target-users', requireActivePlan, async (req, res) => {
  if (!db) return res.status(503).json({ error: 'Firestore not ready' });
  try {
    const { userId, fid, tokenAddresses, sellAfterUsersOverride, minimumHoldMinutesOverride } = req.body;
    
    if (!userId || !tokenAddresses || !Array.isArray(tokenAddresses)) {
      return res.status(400).json({ error: 'Missing required fields: userId and tokenAddresses (array).' });
    }

    let finalCreatorAddress = null;
    if (req.body.creatorAddress) {
      finalCreatorAddress = req.body.creatorAddress;
    } else if (fid) {
      finalCreatorAddress = await getCreatorAddressFromFid(fid);
    }
    if (!finalCreatorAddress) {
      return res.status(400).json({ error: 'No creatorAddress: Provide "creatorAddress" or a valid "fid" with ETH wallet.' });
    }

    const newUser = {
      userId,
      fid: fid || null,
      tokenAddresses,
      addedAt: new Date().toISOString(),
      status: req.body.status || 'active',
      matchedTrades: 0
    };

    if (sellAfterUsersOverride) {
      newUser.sellAfterUsersOverride = parseInt(sellAfterUsersOverride, 10);
    }
    if (minimumHoldMinutesOverride) {
      newUser.minimumHoldMinutesOverride = parseInt(minimumHoldMinutesOverride, 10);
    }

    const docRef = db.collection(TARGET_USERS_COLLECTION).doc(finalCreatorAddress.toLowerCase());
    await docRef.set(newUser, { merge: true });
    res.status(201).json({ id: finalCreatorAddress.toLowerCase(), ...newUser });
  } catch (err) {
    res.status(500).json({ error: err?.message || String(err) });
  }
});

app.get('/target-users/:id', async (req, res) => {
  if (!db) return res.status(503).json({ error: 'Firestore not ready' });
  try {
    const { id } = req.params;
    const doc = await db.collection(TARGET_USERS_COLLECTION).doc(id.toLowerCase()).get();
    if (!doc.exists) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json({ id: doc.id, ...doc.data() });
  } catch (err) {
    res.status(500).json({ error: 'User not found' });
  }
});

app.post('/config/bot', requireActivePlan, async (req, res) => {
  console.log('Received request to update bot config:', req.body);
  
  if (!db) {
    console.error('Update config failed: Firestore not available');
    return res.status(503).json({ error: 'Firestore service not ready' });
  }

  const newConfigData = req.body;
  const botUpdates = {}; // Renamed to 'botUpdates' to avoid any conflict with other routes
  const allowedKeys = [
    'tradeAmountEth', 
    'contentTradeAmountEth',
    'creatorTradeAmountEth', 
    'tradeAmountUsdc', 
    'tradeSlippage', 
    'minimumHoldMinutes', 
    'sellAfterUsers', 
    'autoWithdraw',
    'vaultAddress',
    'telegramEnabled',
    'tradeCurrency',
    'minProfitBeforeWithdraw',
    'maxPriorityFeeGwei',
    'autoSellGlobal',
    'takeProfitUsd',
    'freeTraderMode',
    'freeWordsEnabled',
    'freeWordsMaxMcapUsd',
    'maxRandomCoinsPerDay',
    'maxCreatorCoinsPerDay',
    'randomTradeAmountEth',
    'symbolTargetingEnabled',
    'targetKeywords',
    'exclusionPhrases',
    'requireFourLetterSymbol',
    'requireAllCapsSymbol',
    'bypassCreatorFollowerCheck',
    'bypassChecks',
    'enableListener',
    'creatorFollowerThreshold',
    'taxArbitrageEnabled', 'taxFrontrunTargetMs', 'taxTimerEnabled', 'taxTimerSeconds',
    'microInertiaEnabled', 'microInertiaMinBuys', 'preBuyMomentumEnabled', 'preBuyMinEthVolume',
    'trendingSnipingEnabled', 'minTrendVolume24h', 'minTrendUniqueHolders', 'buyNewProfilesOnly',
    'globalTakeProfitUsd', 'globalStopLossPercent',
    'symbolTargetTimerMinutes', 'symbolTargetTakeProfitUsd',
    'symbolTargetStopLossPercent', 'symbolTargetPartialProfitUsd'
];

  for (const key of allowedKeys) {
    if (newConfigData.hasOwnProperty(key)) {
      let value = newConfigData[key];

     // Specific Fix: If keywords are sent as an array from the UI tags, convert to string
      if ((key === 'targetKeywords' || key === 'exclusionPhrases') && Array.isArray(value)) {
        value = value.join(',');
      }
      
      if (['tradeAmountEth', 'tradeSlippage', 'takeProfitUsd', 'maxPriorityFeeGwei', 'preBuyMinEthVolume'].includes(key)) {
        value = parseFloat(value);
        if (isNaN(value)) continue;
      } else if (['minimumHoldMinutes', 'sellAfterUsers'].includes(key)) {
        value = parseInt(value, 10);
        if (isNaN(value)) continue;
      } else if (['tradeAmountUsdc', 'minProfitBeforeWithdraw'].includes(key)) {
        try {
          value = BigInt(value).toString(); 
        } catch { continue; }
      } else if ([
    'autoWithdraw', 
    'telegramEnabled', 
    'autoSellGlobal', 
    'freeTraderMode', 
    'freeWordsEnabled',        // <--- ADDED
    'symbolTargetingEnabled', 
    'taxArbitrageEnabled',     // <--- ADDED
    'taxTimerEnabled',         // <--- ADDED
    'microInertiaEnabled',     // <--- ADDED
    'preBuyMomentumEnabled',   // <--- ADDED
    'trendingSnipingEnabled',  // <--- ADDED
    'buyNewProfilesOnly'       // <--- ADDED
].includes(key)) {
    // Standard Boolean check
    value = value === true || value === 'true'; 
} else if (key === 'vaultAddress' || key === 'tradeCurrency') {
         if (typeof value !== 'string') continue;
         if (key === 'tradeCurrency' && !['ETH', 'USDC'].includes(value.toUpperCase())) continue;
         if (key === 'tradeCurrency') value = value.toUpperCase();
      }
      
      botUpdates[key] = value;
    }
  }

  if (Object.keys(botUpdates).length === 0) {
      return res.status(400).json({ error: 'No valid configuration fields provided.' });
  }

  try {
    const configRef = db.collection('config').doc('botSettings');
    // Prefer merge-set so first save works when botSettings doc does not exist yet
    await configRef.set(serializeForFirestore(botUpdates), { merge: true });
    // Keep in-memory config in sync for the trading loop
    Object.assign(botConfig, botUpdates);
    res.json({ status: 'OK', message: 'Configuration updated successfully.' });
  } catch (err) {
    console.error('Failed to update bot config in Firestore:', err);
    res.status(500).json({ error: 'Could not save configuration.' });
  }
});

app.delete('/target-users/:id', async (req, res) => {
  if (!db) return res.status(503).json({ error: 'Firestore not ready' });
  try {
    const { id } = req.params;
    const docRef = db.collection(TARGET_USERS_COLLECTION).doc(id.toLowerCase());
    const doc = await docRef.get();
    if (!doc.exists) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    await docRef.delete();
    res.json({ status: 'OK', message: 'User deleted' });
  } catch (err) {
    res.status(500).json({ error: err?.message || String(err) });
  }
});

app.get('/config/bot', async (req, res) => {
  if (!db) {
    return res.status(503).json({ error: 'Firestore not ready' });
  }
  try {
    const configRef = db.collection('config').doc('botSettings');
    const doc = await configRef.get();
    if (!doc.exists) {
      console.log('No config doc found, returning defaults.');
      res.json(botConfig); 
    } else {
      res.json(doc.data());
    }
  } catch (err) {
    console.error('Failed to get bot config:', err);
    res.status(500).json({ error: 'Could not retrieve configuration.' });
  }
});

// ---------------------
// New API Endpoints
// ---------------------

app.get('/status/websocket', (req, res) => {
  res.json({
    status: wsStatus,
    provider: 'Alchemy',
    listeningTo: ZORA_FACTORY_ADDRESS
  });
});

app.get('/activity-feed', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit || '50', 10);
    const snapshot = await db.collection(ACTIVITY_FEED_COLLECTION)
      .orderBy('timestamp', 'desc')
      .limit(limit)
      .get();
    const activities = snapshot.docs.map(doc => ({id: doc.id, ...doc.data()}));
    res.json(activities);
  } catch (err) {
    res.status(500).json({ error: err?.message || String(err) });
  }
});

app.post('/trade/buy', requireActivePlan, async (req, res) => {
  try {
    const { coinAddress, amount } = req.body;
    
    if (!coinAddress || !ethers.isAddress(coinAddress) || !amount) {
      return res.status(400).json({ error: 'Invalid parameters. Need coinAddress and amount.' });
    }

    // Phase 3: Load user's ephemeral trading wallet
    const tradeUid = req.user.uid.toLowerCase();
    const { loadTradingWallet } = require('./routes/onboarding');
    const { wallet: ephemeralWallet } = await loadTradingWallet(tradeUid, process.env.ALCHEMY_RPC_URL || process.env.BASE_RPC_URL);

    const amt = botConfig.tradeCurrency === 'ETH' ? ethersParseEther(amount) : BigInt(amount);
    const balances = await withRetry(() => getAllBalances(ephemeralWallet.address));
    const balance = botConfig.tradeCurrency === 'ETH' ? balances.eth : balances.usdc;
    
    if (balance < amt) {
      return res.status(400).json({ error: 'Insufficient balance.' });
    }

    if (db) {
      const recentSnap = await db.collection('trades')
        .where('tokenAddress', '==', coinAddress)
        .where('type', '==', 'manual')
        .where('boughtAt', '>', Date.now() - 60000)
        .limit(1)
        .get();
      if (!recentSnap.empty) {
        console.log(`Manual buy dedup: Recent buy for ${coinAddress} detected—skipping.`);
        return res.status(409).json({ error: 'Recent manual buy detected—skipping to avoid duplicates.' });
      }
    }
    
    const buyRes = await marketBuy(coinAddress, amt);

    // Auto-approve the newly bought token for Zora factory (Manual Buy)
    try {
      console.log(`Approving Zora router for new token ${coinAddress} (Manual Buy)...`);
      const abi = ['function approve(address spender, uint256 amount) returns (bool)'];
      const tokenContract = new ethers.Contract(coinAddress, abi, ephemeralWallet);
      
      const approveTx = await tokenContract.approve(
        ZORA_FACTORY_ADDRESS, // The router address
        ethers.MaxUint256     // Approve for "infinite" amount
      );
      
      await approveTx.wait();
      console.log(`✅ Successfully approved token ${coinAddress} (Manual Buy). TX: ${approveTx.hash}`);
      await notify('INFO', `Auto-approved ${coinAddress} for selling (Manual Buy).`);
    } catch (approveErr) {
      console.error(`Failed to auto-approve token ${coinAddress} (Manual Buy): ${approveErr.message}`);
      await notify('ERROR', `Auto-approve failed for ${coinAddress} (Manual Buy): ${approveErr.message}`);
    }

    if (db) {
      const block = await viemPublicClient.getBlock({ blockNumber: buyRes.raw.blockNumber });
      const blockTimestamp = Number(block.timestamp) * 1000;
      
      // --- NEW: Get initial holder count (for manual buy) ---
      let initialHolderCount = 0;
      try {
        const holdersResponse = await withRetry(async () => {
          return await rateLimitedZoraCall(() => getCoinHolders({
            chainId: base.id,
            address: coinAddress,
            count: 550,
            apiKey: ZORA_READ_API_KEY
          }));
        });
        const holders = holdersResponse.data?.zora20Token?.tokenBalances?.edges || [];
        const ourWallet = ephemeralWallet.address.toLowerCase();
        initialHolderCount = holders.filter(h => h.node.ownerAddress.toLowerCase() !== ourWallet).length;
        console.log(`MANUAL BUY: Initial holder count for ${coinAddress} (excluding us) is ${initialHolderCount}`);
      } catch (analyticsErr) {
        console.warn(`MANUAL BUY: Failed to get initial holder count for ${coinAddress}: ${analyticsErr.message}`);
      }
      // --- END NEW BLOCK ---

      const tradeData = {
        tokenAddress: coinAddress,
        status: 'bought',
        boughtAt: blockTimestamp,
        spentOnSellToken: buyRes.spent.toString(),
        receivedBuyTokenAmount: buyRes.received.toString(),
        txHash: buyRes.txHash || null,
        tradeCurrency: botConfig.tradeCurrency,
        type: 'manual',
        creatorAddress: 'manual',
        initialHolderCount: initialHolderCount,
        autoSellGlobal: true,   
        takeProfitUsd: 100.0,
        // Tag the record so you know it's a creator coin in your history
        isCreatorCoin: req.body.isCreatorCoin === true ,
      coinCategory: isTrendCoin ? 'TREND' : (isCreatorCoin ? 'CREATOR' : 'CONTENT'),
    };

      // --- THE CRITICAL FIX ---
      // If the frontend says it's a creator coin, we DON'T add it to activePositions.
      // This keeps the coin out of the automated sell loop.
      if (req.body.isCreatorCoin !== true) {
        activePositions.set(coinAddress.toLowerCase(), tradeData);
        console.log(`Added MANUAL content buy ${coinAddress} to active positions map.`);
      } else {
        console.log(`💎 MANUAL CREATOR BUY: ${coinAddress} bought to HODL. Skipped memory map.`);
      }
      
      await db.collection('trades').add(tradeData);
      
      await db.collection(ACTIVITY_FEED_COLLECTION).add({
        type: 'BUY_SUCCESS',
        coin: coinAddress,
        amount: buyRes.received.toString(),
        txHash: buyRes.txHash,
        timestamp: Date.now(),
        isManual: true,
        context: { source: 'manual_buy' }
      });
    }

    res.json({ status: 'OK', ...buyRes });

  } catch (err) {
    console.error('Manual buy error:', err);
    res.status(500).json({ error: err?.message || String(err) });
  }
});


app.post('/trade/sell', requireActivePlan, async (req, res) => {
 try {
    let { coinAddress, amount, percentage } = req.body;
    
    if (!coinAddress || !ethers.isAddress(coinAddress)) {
      return res.status(400).json({ error: 'Invalid coinAddress.' });
    }

    // Phase 3: Load user's ephemeral trading wallet
    const tradeUid = req.user.uid.toLowerCase();
    const { loadTradingWallet } = require('./routes/onboarding');
    const { wallet: ephemeralWallet } = await loadTradingWallet(tradeUid, process.env.ALCHEMY_RPC_URL || process.env.BASE_RPC_URL);
    
    const lowerCoinAddress = coinAddress.toLowerCase();
    isSellingSet.delete(lowerCoinAddress);
    
    let sellAmount;
    if (percentage !== undefined) {
      const perc = parseInt(percentage, 10);
      if (isNaN(perc) || perc < 0 || perc > 100) {
        return res.status(400).json({ error: 'Percentage must be integer 0-100.' });
      }
      if (perc === 0) {
        return res.json({ status: 'OK', message: '0% sell: Nothing done.' });
      }
      
      const balanceWei = await new ethers.Contract(lowerCoinAddress, ['function balanceOf(address) view returns (uint256)'], ethersProvider)
        .balanceOf(ephemeralWallet.address)
        .catch(() => 0n);
      
      if (balanceWei === 0n) {
        return res.status(400).json({ error: 'No balance to sell.' });
      }
      
      sellAmount = (balanceWei * BigInt(perc)) / 100n;
      console.log(`Selling ${perc}% of balance for ${lowerCoinAddress}: ${sellAmount.toString()} wei`);
    } else if (amount) {
      sellAmount = BigInt(amount);
    } else {
      return res.status(400).json({ error: 'Need amount or percentage.' });
    }
    
    const coinData = await rateLimitedZoraCall(() => getCoin({ address: lowerCoinAddress, chain: base.id, apiKey: ZORA_READ_API_KEY }));
    const volume24h = coinData.data?.zora20Token?.volume24h || 0n;
    if (volume24h === 0n) {
      console.warn(`Low liquidity for ${lowerCoinAddress} (volume24h=0)—proceeding with high slippage.`);
    }
    
    const manualOptions = {
  slippage: 0.05, // 5% slippage for manual override
  maxPriorityFeePerGas: ethers.parseUnits('0.1', 'gwei') // High priority gas
};
const sellRes = await marketSell(lowerCoinAddress, sellAmount, manualOptions);

    if(db) {
     // Search for both original and lowercase to ensure the record is caught
      const tradeSnap = await db.collection('trades')
        .where('tokenAddress', 'in', [coinAddress, lowerCoinAddress])
        .where('status', '==', 'bought')
        .get();
        
      if (!tradeSnap.empty) {
        let totalSpent = 0n;
        let docsToUpdate = [];
        tradeSnap.docs.forEach(doc => {
          totalSpent += BigInt(doc.data().spentOnSellToken || '0');
          docsToUpdate.push(doc.id);
        });
        const profit = (sellRes.received || 0n) - totalSpent;
        
        const batch = db.batch();
        for (const docId of docsToUpdate) {
          const docRef = db.collection('trades').doc(docId);
         batch.update(docRef, {
            status: 'sold',
            soldAt: Date.now(),
            received: sellRes.received.toString(), 
            profit: profit.toString(),
            sellTx: sellRes.txHash || 'MANUAL_SELL',
            sellReason: 'Manual_Sell_Frontend'
          });
        }
        await batch.commit();
      }
      
      await db.collection(ACTIVITY_FEED_COLLECTION).add({
        type: 'SELL_SUCCESS',
        coin: lowerCoinAddress,
        amount: sellAmount.toString(),
        received: sellRes.received.toString(),
        txHash: sellRes.txHash,
        timestamp: Date.now(),
        isManual: true,
        percentage: percentage || null
      });
    }

    // --- HARD PURGE FROM MEMORY ---
    activePositions.delete(lowerCoinAddress);
    isSellingSet.delete(lowerCoinAddress);

    // Safety: If for any reason the address was stored differently in the Map
    for (let key of activePositions.keys()) {
      if (key.toLowerCase() === lowerCoinAddress) {
        activePositions.delete(key);
      }
    }

    console.log(`✅ Manual sell successful. ${lowerCoinAddress} purged from memory.`);

    res.json({ 
      status: 'OK', 
      ...sellRes, 
      soldAmount: sellAmount.toString(),
      message: "Purged from active positions." 
    });

  } catch (err) {
    console.error('Manual sell error:', err);
    res.status(500).json({ error: err?.message || String(err) });
  }
});

app.get('/trade/balance/:coinAddress', async (req, res) => {
  try {
    const { coinAddress } = req.params;
    if (!ethers.isAddress(coinAddress)) {
      return res.status(400).json({ error: 'Invalid coinAddress.' });
    }
    // Phase 3: use the user's ephemeral trading wallet address
    const balUid = req.user.uid.toLowerCase();
    const { loadTradingWallet } = require('./routes/onboarding');
    const { wallet: ephemeralWallet } = await loadTradingWallet(balUid, process.env.ALCHEMY_RPC_URL || process.env.BASE_RPC_URL);
    const balanceWei = await new ethers.Contract(coinAddress, ['function balanceOf(address) view returns (uint256)'], ethersProvider)
      .balanceOf(ephemeralWallet.address);
    res.json({ 
      coinAddress,
      walletAddress: ephemeralWallet.address,
      balance: balanceWei.toString(),
      formatted: ethers.formatEther(balanceWei)
    });
  } catch (err) {
    res.status(500).json({ error: err?.message || 'Balance fetch failed.' });
  }
});

app.get('/zora/profile-coins/:identifier', async (req, res) => {
  try {
    const { identifier } = req.params;
    const data = await rateLimitedZoraCall(() => getProfileCoins({ identifier, apiKey: ZORA_READ_API_KEY }));
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err?.message || String(err) });
  }
});

app.get('/zora/coin/:address', async (req, res) => {
  try {
    const { address } = req.params;
    const data = await rateLimitedZoraCall(() => getCoin({ address, chain: base.id, apiKey: ZORA_READ_API_KEY }));
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err?.message || String(err) });
  }
});

app.get('/zora/coin-supply/:address', async (req, res) => {
  try {
    const { address } = req.params;
    const data = await rateLimitedZoraCall(() => getCoin({ address, chain: base.id, apiKey: ZORA_READ_API_KEY }));
    res.json({ totalSupply: data.data?.zora20Token?.totalSupply });
  } catch (err) {
    res.status(500).json({ error: err?.message || String(err) });
  }
});

app.get('/zora/coin-price/:address', async (req, res) => {
  try {
    const { address } = req.params;
    const data = await rateLimitedZoraCall(() => getCoin({ address, chain: base.id, apiKey: ZORA_READ_API_KEY }));
    res.json({ 
      marketCap: data.data?.zora20Token?.marketCap,
      totalSupply: data.data?.zora20Token?.totalSupply,
      volume24h: data.data?.zora20Token?.volume24h
    });
  } catch (err) {
    res.status(500).json({ error: err?.message || String(err) });
  }
});

// -----------------------------------------------------------------
// --- NEYNAR WEBHOOK HANDLER ---
// -----------------------------------------------------------------
// --- FIX: API for Frontend Control ---
app.post('/target-users/:address/rules', requireActivePlan, async (req, res) => {
  const { address } = req.params;
  const { 
    sellAllAtOnce, 
    maxSlippageOverride, 
    maxPriorityFeeOverride,
    antiRektEnabled,
    antiRektLossLimit,
    antiRektStreak
  } = req.body;

  try {
    const update = {};
    if (sellAllAtOnce !== undefined) update.sellAllAtOnce = !!sellAllAtOnce;
    if (maxSlippageOverride !== undefined) update.maxSlippageOverride = parseFloat(maxSlippageOverride);
    if (maxPriorityFeeOverride !== undefined) update.maxPriorityFeeOverride = parseFloat(maxPriorityFeeOverride);
    
    // ADD THESE TO FIX THE "FAILED TO SAVE RULES" ERROR
    if (req.body.takeProfitUsdOverride !== undefined) update.takeProfitUsdOverride = parseFloat(req.body.takeProfitUsdOverride);
    if (req.body.minimumHoldMinutesOverride !== undefined) update.minimumHoldMinutesOverride = parseInt(req.body.minimumHoldMinutesOverride, 10);
    if (req.body.sellAfterUsersOverride !== undefined) update.sellAfterUsersOverride = parseInt(req.body.sellAfterUsersOverride, 10);
    if (req.body.buyAmountEthOverride !== undefined) update.buyAmountEthOverride = parseFloat(req.body.buyAmountEthOverride);
    
    // New Anti-Rekt Overrides
    if (antiRektEnabled !== undefined) update.antiRektEnabled = !!antiRektEnabled;
    if (antiRektLossLimit !== undefined) update.antiRektLossLimit = parseFloat(antiRektLossLimit);
    if (antiRektStreak !== undefined) update.antiRektStreak = parseInt(antiRektStreak, 10);

    await db.collection(TRACKED_CREATORS_COLLECTION).doc(address.toLowerCase()).update(update);
    res.json({ status: 'OK', message: 'Creator rules updated successfully.' });
  } catch (err) {
    console.error(`Failed to update rules for ${address}:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// Endpoint to flip the Master Switch
app.post('/bot/master-switch', async (req, res) => {
  const { globalEmergencySell } = req.body;
  try {
    // 1. Update the DB immediately
    await db.collection('config').doc('botSettings').update({ globalEmergencySell: !!globalEmergencySell });
    
    // 2. INSTANT EFFECT: If turning ON, trigger liquidation now instead of waiting 10s
    if (globalEmergencySell === true) {
      console.log("🚨 MANUAL OVERRIDE: Instant Liquidation Triggered.");
      
      // We run this in the background so the HTTP response isn't delayed
      const positions = Array.from(activePositions.entries());
      positions.forEach(([coinAddress, tradeData]) => {
        // We pass the "GLOBAL_FORCE_SELL" reason to bypass hold-times
        handleSellLogic(coinAddress, tradeData, tradeData.docId, "GLOBAL_FORCE_SELL")
          .catch(err => console.error(`Instant Sell Failed for ${coinAddress}:`, err.message));
      });
    }

    res.json({ status: 'OK', message: 'Emergency switch flipped and liquidation triggered.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/webhook/neynar', async(req,res)=>{
  res.status(200).send('OK');
  
  try{
    if(botConfig.botState!=='running') {
        console.log('Neynar Webhook: Bot is paused, skipping.');
        return;
    }

    if(NEYNAR_WEBHOOK_SECRET){
      const sig=req.headers['x-neynar-signature']||req.headers['x-neynar-signature'.toLowerCase()];
      const body=JSON.stringify(req.body||{});
      const expected=crypto.createHmac('sha256',NEYNAR_WEBHOOK_SECRET).update(body).digest('hex');
      if(!sig||sig!==expected) {
          console.warn('Neynar Webhook: Invalid Neynar signature.');
          return;
      }
    }

    const cast = req.body?.data?.cast;
    if (!cast) {
        console.log('Neynar Webhook: No cast data found.');
        return;
    }
    
    const fid = cast.author?.fid;
    const castHash = cast.hash;

    if (!fid || !castHash) {
        console.log('Neynar Webhook: Missing FID or cast hash.');
        return;
    }
    
    

    const isTracked = await isTrackedFid(fid);
    if (!isTracked) {
        console.log(`Neynar Webhook: FID ${fid} is not on the target list.`);
        return;
    }
    
    console.log(`Neynar Webhook: Received cast ${castHash} from tracked FID ${fid}.`);

    const creatorAddress = await getCreatorAddressFromFid(fid);
    if (!creatorAddress) {
        console.log(`Neynar Webhook: Could not find wallet address for FID ${fid}.`);
        return;
    }
    
    if (!trackedCreatorSet.has(creatorAddress.toLowerCase())) {
        console.warn(`Neynar Webhook: FID ${fid} is tracked, but wallet ${creatorAddress} not in set. (Sync delay?) Proceeding anyway.`);
    }
    
    const newCoin = await detectAndGetNewCoinFromCast(fid, castHash, creatorAddress);
    if (!newCoin) {
        console.log(`Neynar Webhook: No new, liquid ContentCoin detected for cast ${castHash}.`);
        return;
    }

    const { coinAddress, name, symbol, text, author } = newCoin;
    
    console.log(`--- NEYNAR NEW BUY TARGET ---
    Coin: ${name} (${symbol})
    Address: ${coinAddress}
    Creator FID: ${fid}
    Cast: ${castHash}
    ----------------------`);
    
    const castContext = {
      source: 'neynar_webhook',
      text: text || '',
      castHash: castHash,
      author: {
        fid: fid,
        username: author?.username || '',
        displayName: author?.display_name || '',
        pfp: author?.pfp_url || ''
      }
    };
    
    await handleAutoBuy(coinAddress, creatorAddress, name, symbol, castContext);

  }catch(err){ 
      await notify('ERROR','Neynar Webhook error: '+(err?.message||err)); 
  }
});

// --- FRONTEND API ROUTES ---
// Reuse the multi-origin corsOptions above (do not pass a raw comma-string to cors)

// 1. GET CURRENT CONFIG (To load toggles in UI)
app.get('/api/config', (req, res) => {
  res.json(botConfig);
});

// 2. UPDATE CONFIG (For Toggles: Symbol Targeting, Bot State, etc.)
app.post('/api/config', async (req, res) => {
  try {
    const newConfig = req.body;
    // Update local memory
    botConfig = { ...botConfig, ...newConfig };
    
    // Persist to Firestore
    await db.collection('settings').doc('botConfig').set(botConfig, { merge: true });
    
    console.log('✅ Config Updated via UI:', newConfig);
    res.json({ success: true, config: botConfig });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. DELETE TARGET USER (The "Endpoint Not Found" Fix)
app.delete('/api/targets/:address', async (req, res) => {
  try {
    const address = req.params.address.toLowerCase();
    await db.collection(TARGET_USERS_COLLECTION).doc(address).delete();
    
    // Update local cache so bot stops tracking immediately
    trackedCreatorSet.delete(address);
    
    console.log(`🗑️ User Deleted: ${address}`);
    res.json({ success: true, message: `Deleted ${address}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. ADD/UPDATE TARGET USER
app.post('/api/targets', async (req, res) => {
  try {
    const { address, name, status } = req.body;
    const lowerAddr = address.toLowerCase();
    
    const userData = {
      address: lowerAddr,
      name: name || 'Unknown',
      status: status || 'active',
      updatedAt: Date.now()
    };

    await db.collection(TARGET_USERS_COLLECTION).doc(lowerAddr).set(userData, { merge: true });
    
    if (userData.status === 'active') {
      trackedCreatorSet.add(lowerAddr);
    } else {
      trackedCreatorSet.delete(lowerAddr);
    }

    res.json({ success: true, user: userData });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// -----------------------------------------------------------------
// --- END NEYNAR WEBHOOK HANDLER ---
// ----------------------------------------
// ---------------------
// Startup
// ---------------------

// --- STEP 1: Mount Vite Middleware and start the server IMMEDIATELY ---
if (process.env.NODE_ENV !== 'production') {
  try {
    const { createServer: createViteServer } = require('vite');
    createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    }).then(vite => {
      app.use(vite.middlewares);
      console.log('⚡ Vite middleware attached to Express app');
    }).catch(err => {
      console.warn('Vite middleware setup warning:', err.message);
    });
  } catch (err) {
    console.warn('Vite middleware setup warning:', err.message);
  }
} else {
  const path = require('path');
  const distPath = path.join(process.cwd(), 'dist');
  app.use(express.static(distPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server is listening on port ${PORT}`);
  notify('STARTUP', `Service listening on port ${PORT}... initializing...`).catch(()=>{});
  
  try {
    const { startDexScreenerScanner } = require('./real_scanner');
    startDexScreenerScanner(baseRoutes, solanaRoutes);
  } catch (err) {
    console.error('Failed to start DexScreener scanner:', err.message);
  }
});

const WebSocket = require('ws');
const wss = new WebSocket.Server({ server });
let wssClients = new Set();

// Phase 4: WebSocket upgrade — JWT required for authenticated sessions;
// public (no token) connections are allowed for landing-page activity feed only.
wss.on('connection', (ws, req) => {
  // Extract token from query string: ws://host/...?token=<jwt>
  const urlParams = new URLSearchParams(req.url.includes('?') ? req.url.split('?')[1] : '');
  const token = urlParams.get('token');
  const decoded = token ? verifyJwt(token) : null;

  if (token && (!decoded || !decoded.uid)) {
    ws.send(JSON.stringify({ type: 'error', message: 'Unauthorized: Invalid token.' }));
    ws.terminate();
    return;
  }

  ws.uid = decoded?.uid ? decoded.uid.toLowerCase() : null;
  ws.isPublic = !ws.uid;
  ws.isAlive = true;
  wssClients.add(ws);
  ws.send(JSON.stringify({
    type: 'welcome',
    message: ws.isPublic ? 'Connected to FOMOCLIX public feed' : 'Connected to FOMOCLIX WebSocket',
    uid: ws.uid,
    public: !!ws.isPublic
  }));

  ws.on('message', (msgStr) => {
    try {
      const payload = JSON.parse(msgStr);
      if (payload.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
      }
    } catch (err) {
      // ignore malformed messages
    }
  });

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('close', () => {
    wssClients.delete(ws);
  });

  ws.on('error', () => {
    wssClients.delete(ws);
  });
});

// Server-side liveness check: ping all clients every 30s, terminate zombies
const wsLivenessInterval = setInterval(() => {
  for (const client of wssClients) {
    if (client.isAlive === false) {
      console.log('[WS] Terminating zombie connection');
      wssClients.delete(client);
      return client.terminate();
    }
    client.isAlive = false;
    client.ping();
  }
}, 30000);

// Phase 4: Scoped broadcast — route events only to the owning user's socket.
// Event IDs are prefixed with "${uid}_" by db.js listeners; strip before sending.
// Public sockets (landing page) only receive activityFeed events.
function broadcast(payload) {
  const eventId = payload.id || '';
  const eventCollection = payload.collection || '';
  const isolatedCollections = ['trades', 'targetUsers', 'config', 'stats'];

  for (const client of wssClients) {
    if (client.readyState !== 1) continue;
    try {
      // Public landing feed: activityFeed & stats ticker
      if (client.isPublic || !client.uid) {
        if (eventCollection && eventCollection !== 'activityFeed' && eventCollection !== 'stats') continue;
        client.send(JSON.stringify(payload));
        continue;
      }

      let msgPayload = payload;
      if (isolatedCollections.includes(eventCollection) && client.uid) {
        const prefix = `${client.uid}_`;
        if (eventId.startsWith(prefix)) {
          msgPayload = { ...payload, id: eventId.substring(prefix.length) };
        }
      }
      client.send(JSON.stringify(msgPayload));
    } catch (err) {
      console.error('[WS] broadcast send error:', err.message);
    }
  }
}

dbEvents.on('change', (event) => {
  broadcast(event);
});

// Periodic WebSocket Live Market & Activity Data Ticker (3s interval)
setInterval(() => {
  if (wssClients.size > 0) {
    const liveTick = {
      collection: 'stats',
      id: 'live_ticker',
      data: {
        gasPrice: +(10 + Math.random() * 5).toFixed(2),
        ethPrice: +(1780 + (Math.random() - 0.5) * 10).toFixed(2),
        timestamp: new Date().toISOString()
      }
    };
    broadcast(liveTick);
  }
}, 3000);

// --- STEP 1.5: Database rolling cleanup task (TTL policy) ---
async function runRollingCleanup() {
  try {
    const { db } = require('./db');
    if (!db) return;
    const now = Date.now();
    const oneHourAgo = now - (60 * 60 * 1000);
    const twelveHoursAgo = now - (12 * 60 * 60 * 1000);
    const twentyFourHoursAgo = now - (24 * 60 * 60 * 1000);

    console.log('[Cleanup] Running database rolling cleanup...');

    // 1. Clean activityFeed (older than 60 mins)
    const activitySnap = await db.collection('activityFeed')
      .where('timestamp', '<', oneHourAgo)
      .get();
    
    if (!activitySnap.empty) {
      console.log(`[Cleanup] Deleting ${activitySnap.size} expired activityFeed documents...`);
      const batch = db.batch ? db.batch() : null;
      for (const doc of activitySnap.docs) {
        if (batch) {
          batch.delete(doc.ref || doc);
        } else {
          await (doc.ref ? doc.ref.delete() : doc.delete());
        }
      }
      if (batch) await batch.commit();
    }

    // 2. Clean processedCoins (older than 24 hours)
    const coinsSnap = await db.collection('processedCoins')
      .where('timestamp', '<', twentyFourHoursAgo)
      .get();
    if (!coinsSnap.empty) {
      console.log(`[Cleanup] Deleting ${coinsSnap.size} expired processedCoins documents...`);
      const batch = db.batch ? db.batch() : null;
      for (const doc of coinsSnap.docs) {
        if (batch) {
          batch.delete(doc.ref || doc);
        } else {
          await (doc.ref ? doc.ref.delete() : doc.delete());
        }
      }
      if (batch) await batch.commit();
    }

    // 3. Clean processedCasts (older than 24 hours)
    const castsSnap = await db.collection('processedCasts')
      .where('timestamp', '<', twentyFourHoursAgo)
      .get();
    if (!castsSnap.empty) {
      console.log(`[Cleanup] Deleting ${castsSnap.size} expired processedCasts documents...`);
      const batch = db.batch ? db.batch() : null;
      for (const doc of castsSnap.docs) {
        if (batch) {
          batch.delete(doc.ref || doc);
        } else {
          await (doc.ref ? doc.ref.delete() : doc.delete());
        }
      }
      if (batch) await batch.commit();
    }

    // 4. Clean analytics (older than 12 hours)
    const analyticsSnap = await db.collection('analytics')
      .where('timestamp', '<', twelveHoursAgo)
      .get();
    if (!analyticsSnap.empty) {
      console.log(`[Cleanup] Deleting ${analyticsSnap.size} expired analytics documents...`);
      const batch = db.batch ? db.batch() : null;
      for (const doc of analyticsSnap.docs) {
        if (batch) {
          batch.delete(doc.ref || doc);
        } else {
          await (doc.ref ? doc.ref.delete() : doc.delete());
        }
      }
      if (batch) await batch.commit();
    }

    console.log('[Cleanup] Rolling cleanup complete.');
  } catch (err) {
    console.error('[Cleanup] Error during database rolling cleanup:', err.message);
  }
}

// --- STEP 2: Create the main async init function ---
async function initializeBot() {
  const maxRetries = 10;
  let retryCount = 0;

  while (retryCount < maxRetries) {
    try {
      console.log(`🚀 Booting Zora Trader Service (Attempt ${retryCount + 1}/${maxRetries})...`);
      
      await getSecrets();
      console.log('...secrets loaded.');

      if (ALCHEMY_RPC_URL) {
        console.log(`DEBUG: Using ALCHEMY_RPC_URL starting with: ${ALCHEMY_RPC_URL.substring(0, 25)}`);
      } else {
        throw new Error('DEBUG: ALCHEMY_RPC_URL IS NULL OR UNDEFINED AFTER getSecrets()!');
      }

      await setupServices();
      console.log('...services initialized.');

      await setupBotConfigListener();
      console.log('...config listener attached.');

      await setupTrackedCreatorsListener();
      console.log('...tracked creators listener attached.');

      // --- NEW: Load active trades into memory on startup ---
      async function loadActiveTrades() {
        if (!db) return;
        try {
          console.log('Loading active trades into memory across all tenants...');
          let activeList = [];
          if (process.env.DATABASE_MODE === 'firestore') {
            const snap = await db.collectionGroup('trades').where('status', '==', 'bought').get();
            snap.docs.forEach(doc => {
              const data = doc.data();
              const pathParts = doc.ref.path.split('/');
              const userId = pathParts[1];
              activeList.push({
                ...data,
                docId: doc.id,
                userId: userId
              });
            });
          } else {
            // SQLite mode
            const res = await dbQuery.all("SELECT * FROM trades WHERE status = 'bought'");
            const rows = res.results || [];
            rows.forEach(row => {
              try {
                const data = JSON.parse(row.data);
                const idParts = row.id.split('_');
                const userId = idParts.slice(0, -1).join('_') || defaultUserId;
                activeList.push({
                  ...data,
                  docId: data.docId || data.id || idParts[idParts.length - 1],
                  userId: userId
                });
              } catch (err) {
                console.error('Failed to parse sqlite row:', err);
              }
            });
          }

          activeList.forEach(trade => {
            activePositions.set(trade.tokenAddress.toLowerCase(), {
              ...trade,
              partialSellCount: trade.partialSellCount || 0,
              receivedBuyTokenAmount: trade.receivedBuyTokenAmount,
              ownerAddress: trade.ownerAddress || ethersWallet.address,
              userId: trade.userId || defaultUserId
            });
          });
          console.log(`Loaded ${activePositions.size} active trades across all tenants.`);
        } catch (err) {
          console.error('Failed to load active trades:', err.message);
        }
      }
      await loadActiveTrades();

      // --- NEW: High-speed (10s) internal sell loop ---
      // --- UPDATED: High-speed (10s) internal sell loop with DB Logging ---
      async function checkActivePositionsLoop() {
        if (botConfig.botState !== 'running' || activePositions.size === 0) return;

        if (botConfig.globalEmergencySell === true) {
           console.log("🚨 GLOBAL MASTER SWITCH DETECTED: Liquidating all positions.");
           for (const [coinAddress, tradeData] of activePositions.entries()) {
             const tradeUserId = tradeData.userId || defaultUserId;
             await userContextStore.run(tradeUserId, async () => {
               await handleSellLogic(coinAddress, tradeData, tradeData.docId, "GLOBAL_FORCE_SELL");
             });
           }
           return; 
        }
        
        // Use a static array of keys to prevent iteration issues when deleting
        const addressesToCheck = Array.from(activePositions.keys());

        for (const coinAddress of addressesToCheck) {
          const lowerAddr = coinAddress.toLowerCase();
          const tradeData = activePositions.get(lowerAddr);
          if (!tradeData) continue;

          const tradeUserId = tradeData.userId || defaultUserId;
          const ownerAddress = tradeData.ownerAddress || ethersWallet.address;

          await userContextStore.run(tradeUserId, async () => {
            try {
              // --- UPDATED DUST & ZERO BALANCE CLEANUP ---
              const tokenContract = new ethers.Contract(lowerAddr, ['function balanceOf(address) view returns (uint256)'], ethersProvider);
              const balanceWei = await tokenContract.balanceOf(ownerAddress).catch(() => 0n);

              if (balanceWei <= 1000000n) {
                 console.log(`🧹 [${tradeUserId}] Cleaning up ${lowerAddr}: Balance is zero or dust (${balanceWei.toString()} wei).`);
                 
                 // 1. Remove from memory immediately
                 activePositions.delete(lowerAddr);
                 isSellingSet.delete(lowerAddr);
                 
                 // 2. Update Firestore so the UI removes it from "Active Trades"
                 if (db && (tradeData.docId || tradeData.id)) {
                   const targetDoc = tradeData.docId || tradeData.id;
                   await db.collection('trades').doc(targetDoc).update({ 
                     status: 'sold', 
                     liveBalance: '0',
                     liveProfitUsd: 0,
                     liveProfitPercent: 0,
                     lastPriceCheck: Date.now(),
                     sellReason: 'Zero_Balance_Cleanup' 
                   }).catch((e) => console.warn(`DB Cleanup Fail for ${lowerAddr}:`, e.message));
                 }
                 return; // Return exits userContextStore.run callback
              }

              // 2. Fetch live stats from Zora
              const coinStats = await rateLimitedZoraCall(() => getCoin({ address: lowerAddr, chain: base.id, apiKey: ZORA_READ_API_KEY }));
              const stats = coinStats.data?.zora20Token;
              
              // Ensure we have a document ID to update for the frontend
              const targetDocId = tradeData.docId || tradeData.id;

              if (stats && db && targetDocId) {
                // Fetch current holders for the log
                const holdersRes = await rateLimitedZoraCall(() => getCoinHolders({ 
                  chainId: base.id, 
                  address: lowerAddr, 
                  count: 10, // We only need the count, not the full list
                  apiKey: ZORA_READ_API_KEY 
                }));
                const actualHCount = (holdersRes.data?.zora20Token?.tokenBalances?.edges || []).length;

                const mCapUsd = parseFloat(stats.marketCap || "0");
                const totalSupply = parseFloat(stats.totalSupply || "0");
                const myBalance = parseFloat(ethers.formatEther(balanceWei));
                const currentValueUsd = (myBalance / totalSupply) * mCapUsd;
                
                const costUsd = tradeData.tradeCurrency === 'USDC' 
                  ? parseFloat(ethers.formatUnits(tradeData.spentOnSellToken, 6))
                  : parseFloat(ethers.formatEther(tradeData.spentOnSellToken)) * ethPriceUsd;

                const currentProfitUsd = currentValueUsd - costUsd;
                const profitPercent = (currentProfitUsd / costUsd) * 100;

                await db.collection('trades').doc(targetDocId).update({
                  liveBalance: balanceWei.toString(), 
                  liveValueUsd: currentValueUsd,
                  liveProfitUsd: currentProfitUsd,
                  liveProfitPercent: profitPercent,
                  liveHolders: actualHCount, 
                  lastPriceCheck: Date.now()
                }).catch(() => {}); 
              }

              // 3. Trigger standard sell logic checks
              await handleSellLogic(lowerAddr, tradeData, targetDocId);

            } catch (err) {
              console.error(`Loop Error [${lowerAddr}]:`, err.message);
            }
          });
        }
      }
      setInterval(checkActivePositionsLoop, 10000);

     // --- MODIFIED: Polling for Tracked Creators (Robust Loop) ---
      let lastPollTime = 0;
      const POLL_INTERVAL_MS = 30000; // Poll every 30 seconds

      async function pollTrendingCoins() {
  if (!botConfig.trendingSnipingEnabled || botConfig.botState !== 'running') return;

  try {
    console.log('📈 Polling Zora Trending list...');
    // Note: You'll use your zora-sdk getTrendingCoins equivalent here
   // Use getTrends to discover multiple trending coins
    // This is the official way to fetch the trending list
    const trendRes = await rateLimitedZoraCall(() => getExploreCoins({ 
        chainId: base.id, 
        category: 'TRENDING', // Specify the curated list category
        apiKey: ZORA_READ_API_KEY 
    }));

    // Explore results are returned in .data.exploreCoins
    const trends = trendRes.data?.exploreCoins || [];

   for (const coin of trends) {
      const addr = coin.address.toLowerCase();
      
      // 1. Skip if already processed or in active positions
      if (activePositions.has(addr)) continue;

      // 2. Apply "Heat" Filters
      const vol = parseFloat(coin.volume24h || '0');
      const holders = parseInt(coin.uniqueHolders || '0');

      if (vol >= botConfig.minTrendVolume24h && holders >= botConfig.minTrendUniqueHolders) {
        
        // 3. Optional: Fresh Profile Check
        if (botConfig.buyNewProfilesOnly) {
           const profile = await rateLimitedZoraCall(() => getProfileCoins({ identifier: coin.creatorAddress, apiKey: ZORA_READ_API_KEY }));
           const totalCoins = profile.data?.profile?.createdCoins?.count || 0;
           if (totalCoins > 1) {
             console.log(`⏭️ Skipping Trending ${coin.symbol}: Creator is not new (${totalCoins} coins).`);
             continue;
           }
        }

        console.log(`🔥 TREND HIT: Buying ${coin.symbol} | Vol: ${vol} ETH | Holders: ${holders}`);
        
        const trendContext = {
          source: 'trending_poll',
          isTrending: true,
          imageUrl: coin.mediaContent?.previewImage?.medium,
          tokenIcon: coin.creatorProfile?.avatar?.previewImage?.small,
          creatorHandle: coin.creatorProfile?.handle,
          volume24h: coin.volume24h,
          marketCapUsd: coin.marketCap
        };

        await handleAutoBuy(coin.address, coin.creatorAddress, coin.name, coin.symbol, trendContext);
      }
    }
  } catch (err) {
    console.error('Trending Poll Error:', err.message);
  }
}

      async function pollTrackedCreators() {
        try {
          if (!db || botConfig.botState !== 'running') {
            console.log('Polling: Bot paused, skipping run.');
            return;
          }
          
          const now = Date.now();
          // This check prevents two loops from running at once if one takes a long time
          if (now - lastPollTime < POLL_INTERVAL_MS) {
            return; 
          }

          console.log(`Polling: Starting run for ${trackedCreatorSet.size} creators...`);
          lastPollTime = now; // Set time at the *start* to prevent overlaps

          const creatorsToPoll = Array.from(trackedCreatorSet); 

for (const creatorAddress of creatorsToPoll) {
    const creatorLower = creatorAddress.toLowerCase();
    
    // Pull the LATEST rules for this specific creator from the Map
    const currentRules = creatorSellRules.get(creatorLower) || {}; 
    
    // Check if bot was paused while this loop was mid-run
    if (botConfig.botState !== 'running') break;
            
            if (botConfig.botState !== 'running') {
              console.log('Polling: Bot paused mid-loop, aborting run.');
              break; 
            }

            // --- ADDED apiKey ---
            const profileCoins = await rateLimitedZoraCall(() => getProfileCoins({ identifier: creatorAddress, chainIds: [base.id], apiKey: ZORA_READ_API_KEY }));
            let coins = profileCoins.data?.profile?.createdCoins?.edges || [];
            coins = coins.sort((a, b) => new Date(b.node.createdAt) - new Date(a.node.createdAt));
            const recentCoin = coins[0]?.node;
            if (!recentCoin) continue;

            // --- ADDED apiKey ---
            const coinData = await rateLimitedZoraCall(() => getCoin({ address: recentCoin.address, chain: base.id, apiKey: ZORA_READ_API_KEY }));
            
            const version = coinData.data?.zora20Token?.version || '';
            const sdkCoinType = coinData.data?.zora20Token?.coinType || '';
            const isTrendCoin = sdkCoinType === 'Trend' || version.includes('TrendCoin');
            const isContentOrMedia = sdkCoinType === 'Content' || sdkCoinType === 'Media' || version.includes('ContentCoin');
                  
            if (!isContentOrMedia) continue;

            // --- ADDED apiKey ---
            const swaps = await rateLimitedZoraCall(() => getCoinSwaps({ address: recentCoin.address, chain: base.id, first: 1, apiKey: ZORA_READ_API_KEY }));
            const recentSwap = swaps.data?.zora20Token?.swaps?.edges?.[0];
            if (!recentSwap) continue;

            console.log(`Polling: Fresh Content/Media Coin from ${creatorAddress}: ${recentCoin.name} (${recentCoin.symbol})`);
            
            const context = { source: 'polling' };
            // Do not await this. Let it run in the background.
            handleAutoBuy(recentCoin.address, creatorAddress, recentCoin.name, recentCoin.symbol, context);
          }

          // 5. Check if any coin from ANY creator should be sold.
      await checkGlobalSellRules();

     // 6. Monitor now runs on its own setInterval loop in initializeBot()
      // await monitorKeywordTargets();

      console.log('Polling: Run finished.');

        } catch (err) {
          console.error(`Polling error: ${err.message}`);
        } finally {
          // *** THIS IS THE CRITICAL FIX ***
          // Schedule the *next* poll 30 seconds from now.
          setTimeout(pollTrackedCreators, POLL_INTERVAL_MS);
        }
      }

      // Kick-start the loop ONE TIME.
      // The function will now call itself every 30 seconds.
      pollTrackedCreators(); 
      // --- END Polling ---// 7. Add to real-time position map (ONLY if not a Creator Coin)
     // Start Trending Coin Polling (runs every 2 minutes)
      setInterval(pollTrendingCoins, 120000);
      console.log('✅ Service fully booted and ready.');
      notify('STARTUP', `Service fully booted and ready on port ${PORT}`).catch(()=>{});
      
     // Run keyword monitor every 10s independently
      setInterval(monitorKeywordTargets, 10000);

      // Run rolling cleanup on startup and schedule every 10 minutes
      runRollingCleanup().catch(err => console.error('[Cleanup] Startup run failed:', err));
      setInterval(runRollingCleanup, 10 * 60 * 1000);

      return; // Success, break retry loop

    } catch(err) {
      retryCount++;
      console.error(`Fatal startup error (Attempt ${retryCount}/${maxRetries}):`, err.message);
      await notify('FATAL',`Startup attempt ${retryCount} failed: ${err.message}. Retrying in 10s...`);
      
      if (retryCount >= maxRetries) {
        console.error('Max retries reached. Exiting.');
        await notify('FATAL', 'Startup failed: Max retries reached. Exiting.');
        process.exit(1);
      }
      
      await new Promise(r => setTimeout(r, 10000));
    }
  }
}

// --- STEP 3: Call the init function ---
initializeBot();
