/**
 * Telegram Live Scanner Module
 * Subscribes to backend discovery events in real-time.
 * Single Source of Truth: Backend Scanner Engine.
 * Does NOT run duplicate blockchain listeners or duplicate scanner logic.
 * Serves live discovery cards to public Telegram channel & watched cards to private chats.
 */

const { MessageFormatter } = require('./messageFormatter');
const { ChannelPublisher } = require('./channelPublisher');
const { TelegramAuth } = require('../../backend/telegram/auth');

export class LiveScanner {
  constructor(client = null, services = null) {
    this.client = client;
    this.services = services;
    this.channelPublisher = new ChannelPublisher();
    
    // Watched coins mapping: lowerContractAddress -> Set<{ chatId, messageId, coinObj }>
    this.watchedCoins = new Map();
    
    // Deduplication cache to prevent message spam: coinContract -> timestamp
    this.recentDiscoveries = new Map();
    
    // Active listeners attached flag
    this.subscribedToBackend = false;
  }

  setClient(client) {
    this.client = client;
  }

  setServices(services) {
    this.services = services;
  }

  /**
   * Subscribes directly to the backend event bus (dbEvents & scanner emitters)
   */
  subscribeToBackendEvents(dbEvents) {
    if (this.subscribedToBackend || !dbEvents) return;
    this.subscribedToBackend = true;

    console.log('📡 [Telegram Live Scanner] Subscribed to Backend Discovery Stream (dbEvents)');

    dbEvents.on('change', async (event) => {
      try {
        if (!event || !event.data) return;

        // 1. Activity Feed additions (SCANNING_COIN, CREATOR_COIN_PROFILE, BUY_SUCCESS, etc.)
        if (event.collection === 'activityFeed' && !event.deleted) {
          const item = event.data;
          const type = item.type || '';
          const upperType = String(type).toUpperCase();
          
          const isDiscovery = upperType.includes('COIN') ||
                              upperType.includes('SCAN') ||
                              upperType.includes('TOKEN') ||
                              upperType.includes('CREATOR') ||
                              upperType.includes('CONTENT') ||
                              upperType.includes('TREND') ||
                              upperType.includes('LAUNCH') ||
                              upperType.includes('PAIR');

          if (isDiscovery) {
            await this.handleDiscovery(item);
          } else if (upperType === 'BUY_SUCCESS' || upperType === 'SELL_SUCCESS') {
            await this.handleTradeEvent(item);
          }
        }

        // 2. Trades updates (live position updates / watched coin price updates)
        if (event.collection === 'trades' && !event.deleted) {
          const trade = event.data;
          await this.handleTradeOrPositionUpdate(trade);
        }
      } catch (err) {
        console.warn('[Telegram Live Scanner] Error in event listener:', err.message);
      }
    });
  }

  /**
   * Main entry point when backend scanner discovers a coin
   */
  async handleDiscovery(coinObj) {
    if (!this.client || !coinObj) return;

    const contract = (coinObj.contract || coinObj.contractAddress || coinObj.coin || coinObj.address || coinObj.mintAddress || '').toLowerCase();
    if (!contract || contract === 'n/a' || contract === '0x...') return;

    // Deduplicate within 15 seconds
    const now = Date.now();
    const lastSeen = this.recentDiscoveries.get(contract);
    if (lastSeen && (now - lastSeen < 15000)) {
      return;
    }
    this.recentDiscoveries.set(contract, now);

    // Prune old discoveries cache if large
    if (this.recentDiscoveries.size > 500) {
      for (const [k, v] of this.recentDiscoveries.entries()) {
        if (now - v > 60000) this.recentDiscoveries.delete(k);
      }
    }

    console.log(`🟢 [Telegram Live Scanner] Broadcasting backend discovery: ${coinObj.name || coinObj.symbol || contract}`);

    // 1. Publish immediately to public Telegram channel (if TELEGRAM_CHANNEL_ID is set)
    await this.channelPublisher.publishDiscovery(this.client, coinObj);

    // 2. Broadcast live discovery cards to all active Telegram chat sessions
    const activeSessions = TelegramAuth.getAllActiveSessions();
    if (activeSessions && activeSessions.length > 0) {
      const cardText = MessageFormatter.formatCard(coinObj, { status: 'Live Detection' });
      const keyboard = MessageFormatter.formatButtons(coinObj);
      
      for (const session of activeSessions) {
        if (!session.chatId) continue;
        try {
          await this.client.sendMessage(session.chatId, cardText, keyboard);
        } catch (err) {
          console.warn(`[Telegram Live Scanner] Failed sending discovery to chat ${session.chatId}:`, err.message);
        }
      }
    }
  }

  /**
   * Handles buy or sell trade events emitted by backend
   */
  async handleTradeEvent(tradeItem) {
    if (!this.client || !tradeItem) return;

    const userId = tradeItem.userId || tradeItem.targetUserId;
    const ownerAddress = tradeItem.ownerAddress;

    // Strict multi-user privacy isolation: send ONLY to the trade owner's private chat
    const session = TelegramAuth.findSessionByUser(userId || ownerAddress);
    if (session && session.chatId) {
      try {
        if (tradeItem.type === 'BUY_SUCCESS') {
            const services = TelegramAuth.getBackendServices() || this.services;
            const livePriceFn = services && (services.getEthPriceUsd || services.getEthPrice);
            const ethPriceUsd = (typeof livePriceFn === 'function' ? livePriceFn() : 0) || 0;
            const calcPrice = tradeItem.spentOnSellToken ? `$${(parseFloat(tradeItem.spentOnSellToken) / 1e18 * ethPriceUsd).toFixed(2)}` : '$0.00';
            const buyCard = MessageFormatter.formatBuyExecuted({
              name: tradeItem.name || 'Onchain Coin',
              symbol: tradeItem.symbol || 'TOKEN',
              walletAddress: tradeItem.ownerAddress || session.walletAddress || '0x...',
              amount: tradeItem.amount || tradeItem.receivedBuyTokenAmount || '0.01 ETH',
              price: calcPrice,
            marketCap: tradeItem.marketCapUsd || '$8,420',
            txHash: tradeItem.txHash || '0x...',
            explorerUrl: `https://basescan.org/tx/${tradeItem.txHash}`
          });
          await this.client.sendMessage(session.chatId, buyCard);
        } else if (tradeItem.type === 'SELL_SUCCESS') {
          const sellCard = MessageFormatter.formatSellExecuted({
            name: tradeItem.name || 'Onchain Coin',
            symbol: tradeItem.symbol || 'TOKEN',
            amountSold: tradeItem.amountSold || '100%',
            received: tradeItem.received || '0.00 ETH',
            txHash: tradeItem.txHash || '0x...',
            newWalletBalance: tradeItem.newBalance || 'ETH Updated'
          });
          await this.client.sendMessage(session.chatId, sellCard);
        }
      } catch (err) {
        console.warn(`[Telegram Live Scanner] Error sending trade event to chat ${session.chatId}:`, err.message);
      }
    }
  }

  /**
   * Handles position updates and watched coin price updates
   */
  async handleTradeOrPositionUpdate(trade) {
    if (!this.client || !trade) return;

    const contract = (trade.tokenAddress || trade.contract || '').toLowerCase();
    if (!contract || !this.watchedCoins.has(contract)) return;

    const watchedSet = this.watchedCoins.get(contract);
    if (!watchedSet || watchedSet.size === 0) return;

    const services = TelegramAuth.getBackendServices() || this.services;
    const livePriceFn = services && (services.getEthPriceUsd || services.getEthPrice);
    const ethPriceUsd = (typeof livePriceFn === 'function' ? livePriceFn() : 0) || 0;

    const updateData = {
      price: trade.livePriceEth ? trade.livePriceEth * ethPriceUsd : trade.priceUsd,
      marketCap: trade.liveMarketCap || trade.marketCapUsd,
      liquidity: trade.liquidity,
      volume24h: trade.volume24h,
      holders: trade.lastHolderCount || trade.holders,
      pnl: trade.liveProfitPercent ? `${parseFloat(trade.liveProfitPercent).toFixed(2)}%` : null,
      status: trade.status === 'bought' ? 'Holding (Live)' : 'Watching'
    };

    // Edit message in-place for all watched subscribers (no duplicate messages)
    for (const watcher of Array.from(watchedSet)) {
      try {
        const updatedCardText = MessageFormatter.formatWatchUpdate(watcher.coinObj, updateData);
        const keyboard = MessageFormatter.formatButtons(watcher.coinObj, { isWatched: true });
        
        await this.client.editMessageText(watcher.chatId, watcher.messageId, updatedCardText, keyboard);
      } catch (err) {
        // Remove watcher if message was deleted
        if (err.message?.includes('message to edit not found')) {
          watchedSet.delete(watcher);
        }
      }
    }

    // Also update public channel message if watched
    await this.channelPublisher.updateChannelMessage(this.client, { ...trade, contract });
  }

  /**
   * Adds a coin to the watch list for live in-place edits
   */
  watchCoin(chatId, messageId, coinAddress, coinObj = {}) {
    const contract = coinAddress.toLowerCase();
    if (!this.watchedCoins.has(contract)) {
      this.watchedCoins.set(contract, new Set());
    }
    const watchedSet = this.watchedCoins.get(contract);
    
    // Check if already watching
    for (const existing of watchedSet) {
      if (existing.chatId === chatId && existing.messageId === messageId) {
        return;
      }
    }

    watchedSet.add({
      chatId,
      messageId,
      coinObj: {
        contract,
        name: coinObj.name || 'Watched Coin',
        symbol: coinObj.symbol || 'TOKEN',
        chain: coinObj.chain || 'Base',
        coinType: coinObj.coinType || 'Creator Coin',
        creator: coinObj.creator || 'Unknown',
        price: coinObj.price || 0,
        marketCap: coinObj.marketCap || 0,
        ...coinObj
      }
    });

    console.log(`⭐ [Telegram Live Scanner] Chat ${chatId} watching coin ${contract}`);
  }

  /**
   * Removes a coin from the watch list
   */
  unwatchCoin(chatId, messageId, coinAddress) {
    const contract = coinAddress.toLowerCase();
    if (!this.watchedCoins.has(contract)) return;

    const watchedSet = this.watchedCoins.get(contract);
    for (const existing of Array.from(watchedSet)) {
      if (existing.chatId === chatId && (!messageId || existing.messageId === messageId)) {
        watchedSet.delete(existing);
      }
    }
    if (watchedSet.size === 0) {
      this.watchedCoins.delete(contract);
    }
    console.log(`⭐ [Telegram Live Scanner] Chat ${chatId} unwatched coin ${contract}`);
  }
}

export default LiveScanner;
