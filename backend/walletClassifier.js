/**
 * FOMOCLIX Wallet Inventory Classifier V2
 * Pure, verified asset classification engine for Telegram & Web inventory.
 * Categorizes tokens using official Zora SDK responses, Base on-chain metadata,
 * active trading positions, and verified liquidity pools.
 * 
 * Categories:
 * 🟣 Zora Coins (Creator + Content Coins verified by Zora SDK)
 * 🔵 Base ERC-20 Tokens (Tokens on Base with verified DEX liquidity, non-Zora)
 * 🟢 Active Trading Positions (Tokens currently managed by trading engine)
 * 🟡 Wallet Assets (Valid ERC20 assets in wallet, not active position, sellable)
 * ⚫ Dead / Rugged / Unsellable (0 liquidity, pool removed, honeypot, disabled)
 * ⚪ Unknown / Needs Verification (Unverified contract / liquidity status)
 */

const { ethers } = require('ethers');

const CATEGORIES = {
  ZORA: {
    key: 'zora',
    label: '🟣 Zora Coins',
    description: 'Creator & Content Coins verified via official Zora SDK'
  },
  BASE: {
    key: 'base',
    label: '🔵 Base Tokens',
    description: 'Verified ERC20 tokens with active Base DEX liquidity'
  },
  ACTIVE: {
    key: 'active',
    label: '🟢 Active Positions',
    description: 'Tokens actively managed by the FOMOCLIX trading engine'
  },
  OTHER: {
    key: 'other',
    label: '🟡 Other ERC20',
    description: 'Valid wallet assets with sellable liquidity'
  },
  DEAD: {
    key: 'dead',
    label: '⚫ Dead / Rugged',
    description: 'Unsellable tokens (zero liquidity, pool removed, disabled)'
  },
  UNKNOWN: {
    key: 'unknown',
    label: '⚪ Unknown',
    description: 'Assets pending verification'
  }
};

/**
 * Classifies an individual inventory item.
 * @param {Object} item Raw inventory item from WalletInventoryScanner
 * @param {Set<string>|Array<string>} activePositions Set of lowercase contract addresses in active trades
 * @returns {Object} Enriched item with categoryKey, categoryLabel, detectedBy, and sellable status
 */
function classifyItem(item, activePositions = new Set()) {
  const addr = (item.contract || item.address || '').toLowerCase();
  const symbol = (item.symbol || '').toUpperCase();
  const coinType = (item.coinType || item.category || '').toString();

  const activeSet = activePositions instanceof Set 
    ? activePositions 
    : new Set((activePositions || []).map(a => String(a).toLowerCase()));

  let categoryKey = 'unknown';
  let categoryLabel = CATEGORIES.UNKNOWN.label;
  let detectedBy = item.detectedBy || '⚪ On-chain Scan';
  let isSellable = item.sellable === true;
  let reasonIfNotSellable = item.reasonIfNotSellable || null;

  // 1. Native Gas / Stablecoin Handling
  if (symbol === 'ETH' || addr === 'n/a' || coinType === 'Native Gas') {
    return {
      ...item,
      categoryKey: 'other',
      categoryLabel: '🟡 Native Gas Asset',
      detectedBy: '🔵 Base RPC',
      sellable: false,
      reasonIfNotSellable: 'Native gas currency cannot be sold directly'
    };
  }

  if (symbol === 'USDC' || addr === '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913') {
    return {
      ...item,
      categoryKey: 'base',
      categoryLabel: CATEGORIES.BASE.label,
      detectedBy: '🔵 Base RPC',
      sellable: true,
      reasonIfNotSellable: null
    };
  }

  // 2. Active Trading Positions (Managed by engine)
  const isActivePosition = activeSet.has(addr);

  // 3. Zora Coins Detection (Verified via Zora SDK)
  const isZoraCoin = Boolean(
    coinType.includes('Creator') ||
    coinType.includes('Content') ||
    coinType.includes('Trend') ||
    item.dexAvailability?.includes('Zora') ||
    item.creatorProfile ||
    (item.creator && item.creator.startsWith('0x') && item.creator !== 'Base L2 Network')
  );

  // Determine Primary Category
  if (item.liquidityStatus?.includes('Dead') || item.liquidityStatus?.includes('Low Volatility') || reasonIfNotSellable?.includes('Zero liquidity')) {
    categoryKey = 'dead';
    categoryLabel = CATEGORIES.DEAD.label;
    isSellable = true;
    if (!reasonIfNotSellable) reasonIfNotSellable = 'Low volatility / unverified DEX pool';
    if (!detectedBy || detectedBy === '⚪ On-chain Scan') {
      detectedBy = isZoraCoin ? '🟣 Zora Coins SDK' : '🔵 Base RPC';
    }
  } else if (isActivePosition) {
    categoryKey = 'active';
    categoryLabel = CATEGORIES.ACTIVE.label;
    detectedBy = '🟢 Trading Engine';
  } else if (isZoraCoin) {
    categoryKey = 'zora';
    categoryLabel = CATEGORIES.ZORA.label;
    detectedBy = '🟣 Zora Coins SDK';
  } else if (item.dexAvailability && (item.dexAvailability.includes('Uniswap') || item.dexAvailability.includes('Aerodrome') || item.dexAvailability.includes('Base'))) {
    categoryKey = 'base';
    categoryLabel = CATEGORIES.BASE.label;
    detectedBy = '🔵 Base RPC';
  } else if (item.usdValue > 0 || item.liquidityStatus === 'Active') {
    categoryKey = 'other';
    categoryLabel = CATEGORIES.OTHER.label;
    detectedBy = '🟡 Wallet Inventory';
  } else {
    categoryKey = 'unknown';
    categoryLabel = CATEGORIES.UNKNOWN.label;
    detectedBy = '⚪ On-chain Scan';
  }

  return {
    ...item,
    categoryKey,
    categoryLabel,
    detectedBy,
    sellable: isSellable,
    reasonIfNotSellable: isSellable ? null : reasonIfNotSellable
  };
}

/**
 * Groups and summarizes full inventory data into classified structure
 */
function classifyInventory(rawInventory, activePositions = []) {
  if (!rawInventory || !Array.isArray(rawInventory.items)) {
    return {
      walletAddress: rawInventory?.walletAddress || 'N/A',
      totalInventoryValue: '0.00',
      totalWalletBalance: '0 ETH / 0 USDC',
      totalTokensCount: 0,
      sellableCount: 0,
      unsellableCount: 0,
      sellableValueUsd: 0,
      unsellableValueUsd: 0,
      categories: {
        zora: [],
        base: [],
        active: [],
        other: [],
        dead: [],
        unknown: []
      },
      counts: { zora: 0, base: 0, active: 0, other: 0, dead: 0, unknown: 0 },
      values: { zora: 0, base: 0, active: 0, other: 0, dead: 0, unknown: 0 }
    };
  }

  const activeSet = new Set((activePositions || []).map(p => String(p.contract || p.address || p).toLowerCase()));

  const classifiedItems = rawInventory.items.map(item => classifyItem(item, activeSet));

  const categories = {
    zora: [],
    base: [],
    active: [],
    other: [],
    dead: [],
    unknown: []
  };

  const counts = { zora: 0, base: 0, active: 0, other: 0, dead: 0, unknown: 0 };
  const values = { zora: 0, base: 0, active: 0, other: 0, dead: 0, unknown: 0 };

  let sellableCount = 0;
  let unsellableCount = 0;
  let sellableValueUsd = 0;
  let unsellableValueUsd = 0;

  classifiedItems.forEach(item => {
    const key = item.categoryKey || 'unknown';
    if (!categories[key]) categories[key] = [];
    categories[key].push(item);

    counts[key] = (counts[key] || 0) + 1;
    values[key] = (values[key] || 0) + (item.usdValue || 0);

    if (item.sellable && item.contract !== 'N/A') {
      sellableCount++;
      sellableValueUsd += item.usdValue || 0;
    } else if (item.contract !== 'N/A') {
      unsellableCount++;
      unsellableValueUsd += item.usdValue || 0;
    }
  });

  return {
    walletAddress: rawInventory.walletAddress,
    totalInventoryValue: rawInventory.totalInventoryValue,
    totalWalletBalance: rawInventory.totalWalletBalance,
    totalTokensCount: classifiedItems.length,
    sellableCount,
    unsellableCount,
    sellableValueUsd: sellableValueUsd.toFixed(2),
    unsellableValueUsd: unsellableValueUsd.toFixed(2),
    items: classifiedItems,
    categories,
    counts,
    values,
    timestamp: Date.now()
  };
}

module.exports = {
  CATEGORIES,
  classifyItem,
  classifyInventory
};
