/**
 * Telegram Message Formatter Module
 * Formats backend coin discovery objects, buy/sell execution confirmations,
 * and watch mode cards into clean Telegram HTML cards with action buttons.
 * Strictly adheres to backend discovery schema without modifying scanner logic.
 */

function safeNum(val, defaultVal = 0) {
  if (val === null || val === undefined) return defaultVal;
  const n = parseFloat(val);
  return isNaN(n) ? defaultVal : n;
}

function formatUSD(val) {
  const n = safeNum(val);
  if (n >= 1000000) return `$${(n / 1000000).toFixed(2)}M`;
  if (n >= 1000) return `$${(n / 1000).toFixed(2)}K`;
  if (n < 0.0001 && n > 0) return `$${n.toExponential(2)}`;
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 })}`;
}

function formatAge(timestamp) {
  if (!timestamp) return 'Just now';
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return `${Math.max(1, seconds)} seconds`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ago`;
}

export class MessageFormatter {
  /**
   * Main method to format any backend discovery coin object into a Telegram card text
   */
  static formatCard(coinObj, options = {}) {
    const {
      name = coinObj.name || coinObj.title || 'Unknown Coin',
      symbol = coinObj.symbol || 'COIN',
      chain = coinObj.chain || coinObj.network || 'Base',
      coinType = coinObj.coinType || coinObj.type || 'Creator Coin',
      creator = coinObj.creator || coinObj.creatorAddress || coinObj.creatorHandle || 'Unknown',
      marketCap = coinObj.marketCap || coinObj.marketCapUsd || coinObj.liveMarketCap || 0,
      liquidity = coinObj.liquidity || coinObj.liquidityUsd || 0,
      price = coinObj.price || coinObj.priceUsd || 0,
      volume24h = coinObj.volume24h || coinObj.volume || 0,
      timestamp = coinObj.timestamp || coinObj.createdAt || Date.now(),
      holders = coinObj.holders || coinObj.holdersCount || coinObj.wallets || 'N/A',
      risk = coinObj.risk || 'Medium',
      status = options.status || coinObj.status || 'Watching',
      contract = coinObj.contract || coinObj.contractAddress || coinObj.coin || coinObj.address || coinObj.mintAddress || '0x...',
      contentType = coinObj.contentType || coinObj.mediaType || 'Media'
    } = coinObj;

    const netName = String(chain).toUpperCase() === 'BASE' ? 'Base' : String(chain);
    const formattedPrice = formatUSD(price);
    const formattedMCap = formatUSD(marketCap);
    const formattedLiq = typeof liquidity === 'string' ? liquidity : formatUSD(liquidity);
    const formattedVol = typeof volume24h === 'string' ? volume24h : formatUSD(volume24h);
    const ageStr = formatAge(timestamp);
    const formattedCreator = creator.startsWith('0x') ? `<code>${creator.slice(0, 6)}...${creator.slice(-4)}</code>` : creator;

    const typeLower = String(coinType).toLowerCase();
    const isV4 = typeLower.includes('v4') || coinObj.isV4;
    const isContent = typeLower.includes('content');

    if (isContent) {
      return (
        `🟣 <b>NEW CONTENT COIN</b> [${netName}]\n\n` +
        `<b>Title</b>: ${name}\n` +
        `<b>Creator</b>: ${formattedCreator}\n` +
        `<b>Contract</b>: <code>${contract}</code>\n` +
        `<b>Content Type</b>: ${contentType}\n` +
        `<b>Price</b>: ${formattedPrice}\n` +
        `<b>Volume</b>: ${formattedVol}\n` +
        `<b>Age</b>: ${ageStr}\n` +
        `<b>Status</b>: ${status}\n\n` +
        `<b>Contract</b>:\n<code>${contract}</code>`
      );
    }

    let headerSymbol = `🟢 <b>NEW DISCOVERY</b> [${netName}]`;
    if (isV4) {
      headerSymbol = `⚡ <b>NEW ZORA V4 COIN</b> [${netName}]`;
    } else if (typeLower.includes('creator')) {
      headerSymbol = `🟢 <b>NEW CREATOR COIN</b> [${netName}]`;
    }

    return (
      `${headerSymbol}\n\n` +
      `<b>Name</b>: ${name}\n` +
      `<b>Symbol</b>: ${symbol}\n` +
      `<b>Network</b>: ${netName}\n` +
      `<b>Type</b>: ${coinType}\n` +
      `<b>Creator</b>: ${formattedCreator}\n` +
      `<b>Market Cap</b>: ${formattedMCap}\n` +
      `<b>Liquidity</b>: ${formattedLiq}\n` +
      `<b>Price</b>: ${formattedPrice}\n` +
      `<b>24H Volume</b>: ${formattedVol}\n` +
      `<b>Age</b>: ${ageStr}\n` +
      `<b>Wallets</b>: ${holders}\n` +
      `<b>Risk</b>: ${risk}\n` +
      `<b>Status</b>: ${status}\n\n` +
      `<b>Contract</b>:\n<code>${contract}</code>`
    );
  }

  /**
   * Generates Telegram Inline Keyboard Buttons for the card
   */
  static formatButtons(coinObj, options = {}) {
    const contract = coinObj.contract || coinObj.contractAddress || coinObj.coin || coinObj.address || coinObj.mintAddress || '';
    const creatorAddress = coinObj.creatorAddress || coinObj.ownerAddress || coinObj.userId || coinObj.targetUserId || '';
    const creatorName = coinObj.creatorName || coinObj.creator || coinObj.userId || 'Creator';
    const isWatched = options.isWatched || false;

    const dexUrl = coinObj.dexUrl || `https://dexscreener.com/base/${contract}`;
    const zoraUrl = coinObj.zoraUrl || `https://zora.co/coin/base:${contract}`;
    const explorerUrl = coinObj.explorerUrl || `https://basescan.org/token/${contract}`;
    const creatorUrl = coinObj.creatorUrl || (creatorAddress ? `https://basescan.org/address/${creatorAddress}` : zoraUrl);

    const isContent = String(coinObj.coinType || coinObj.type || '').toLowerCase().includes('content');

    // Quick Buy presets row
    const quickBuyRow = [
      { text: '🟢 Buy Default', callback_data: `buy:${contract}` },
      { text: '0.001', callback_data: `buy:${contract}:0.001` },
      { text: '0.005', callback_data: `buy:${contract}:0.005` },
      { text: '0.01', callback_data: `buy:${contract}:0.01` }
    ];

    const row2 = [
      { text: '📈 Chart', url: dexUrl },
      { text: '👤 Creator', url: creatorUrl },
      { text: isContent ? '🎬 Content' : '🌐 Zora', url: zoraUrl }
    ];

    const row3 = [
      creatorAddress ? { text: '⭐ Track Creator', callback_data: `track_creator:${creatorAddress}:${creatorName}` } : { text: '🔍 Explorer', url: explorerUrl },
      { text: '🔍 Explorer', url: explorerUrl },
      { text: isWatched ? '⭐ Unwatch' : '⭐ Watch', callback_data: isWatched ? `unwatch:${contract}` : `watch:${contract}` }
    ].filter((btn, idx, self) => btn && self.findIndex(b => b.text === btn.text) === idx);

    return {
      reply_markup: {
        inline_keyboard: [quickBuyRow, row2, row3]
      }
    };
  }

  /**
   * Formats Buy Executed confirmation card
   */
  static formatBuyExecuted(tradeRes) {
    const {
      name = 'Onchain Coin',
      symbol = 'TOKEN',
      walletAddress = '0x...',
      amount = '0',
      price = '0',
      marketCap = '0',
      txHash = '0x...',
      explorerUrl = `https://basescan.org/tx/${txHash}`
    } = tradeRes;

    return (
      `✅ <b>Buy Executed</b>\n\n` +
      `<b>Token</b>: ${name} (${symbol})\n` +
      `<b>Wallet</b>: <code>${walletAddress}</code>\n` +
      `<b>Amount</b>: ${amount}\n` +
      `<b>Price</b>: ${typeof price === 'number' ? formatUSD(price) : price}\n` +
      `<b>Market Cap</b>: ${typeof marketCap === 'number' ? formatUSD(marketCap) : marketCap}\n` +
      `<b>Transaction Hash</b>: <code>${txHash}</code>\n` +
      `<b>Explorer Link</b>: <a href="${explorerUrl}">View on Basescan</a>`
    );
  }

  /**
   * Formats Sell Executed confirmation card
   */
  static formatSellExecuted(tradeRes) {
    const {
      name = 'Onchain Coin',
      symbol = 'TOKEN',
      amountSold = '0',
      received = '0 ETH',
      txHash = '0x...',
      newWalletBalance = '0 ETH'
    } = tradeRes;

    return (
      `🔴 <b>Sell Executed</b>\n\n` +
      `<b>Token</b>: ${name} (${symbol})\n` +
      `<b>Amount Sold</b>: ${amountSold}\n` +
      `<b>Received</b>: ${received}\n` +
      `<b>Transaction Hash</b>: <code>${txHash}</code>\n` +
      `<b>New Wallet Balance</b>: ${newWalletBalance}`
    );
  }

  /**
   * Formats live watch update card
   */
  static formatWatchUpdate(coinObj, watchData = {}) {
    const pnlStr = watchData.pnl ? `\n<b>PnL</b>: ${watchData.pnl}` : '';
    const updatedStatus = watchData.status || 'Watching (Live)';
    return MessageFormatter.formatCard(
      { ...coinObj, ...watchData, status: updatedStatus },
      { status: updatedStatus }
    ) + pnlStr;
  }
}

module.exports = { MessageFormatter };
module.exports.MessageFormatter = MessageFormatter;
module.exports.default = MessageFormatter;

