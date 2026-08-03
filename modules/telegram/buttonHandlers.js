/**
 * Telegram Button Handlers Module
 * Handles inline keyboard callbacks for Buy, Sell, Watch, Unwatch buttons.
 * Delegates execution strictly to backend services and updates Telegram cards.
 */

const { MessageFormatter } = require('./messageFormatter');
const { TelegramAuth } = require('../../backend/telegram/auth');

export class ButtonHandlers {
  /**
   * Main entry point for processing button callbacks
   */
  static async handleButtonAction(query, client, services, liveScanner) {
    const data = query.data;
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;

    if (data.startsWith('buy:') || data.startsWith('buy_')) {
      await ButtonHandlers.handleBuyButton(query, client, services, liveScanner);
      return true;
    } else if (data.startsWith('sell:') || data.startsWith('sell_')) {
      await ButtonHandlers.handleSellButton(query, client, services, liveScanner);
      return true;
    } else if (data.startsWith('track_creator:')) {
      await ButtonHandlers.handleTrackCreatorButton(query, client, services);
      return true;
    } else if (data.startsWith('watch:') || data.startsWith('watch_')) {
      await ButtonHandlers.handleWatchButton(query, client, liveScanner);
      return true;
    } else if (data.startsWith('unwatch:') || data.startsWith('unwatch_')) {
      await ButtonHandlers.handleUnwatchButton(query, client, liveScanner);
      return true;
    }

    return false;
  }

  /**
   * Handles Buy Button click
   */
  static async handleBuyButton(query, client, services, liveScanner) {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const rawData = query.data.replace('buy:', '').replace('buy_', '');
    const parts = rawData.split(':');
    const coinAddress = parts[0];
    const requestedAmount = parts[1] || null;

    await client.answerCallbackQuery(query.id, '⏳ Submitting buy order to backend engine...', false);

    const session = TelegramAuth.getSession(chatId);
    const userIdOrWallet = session.uid || session.walletAddress || chatId;

    try {
      // Execute via existing backend service layer
      let buyRes = null;
      if (typeof services.executeBuy === 'function') {
        buyRes = await services.executeBuy({
          coinAddress,
          amountEth: requestedAmount,
          userIdOrWallet
        });
      }

      if (buyRes && (buyRes.success || buyRes.txHash)) {
        const livePriceFn = services && (services.getEthPriceUsd || services.getEthPrice);
        const ethPriceUsd = (typeof livePriceFn === 'function' ? livePriceFn() : 0) || 0;
        const formattedBuyCard = MessageFormatter.formatBuyExecuted({
          name: buyRes.name || buyRes.symbol || 'Onchain Coin',
          symbol: buyRes.symbol || 'TOKEN',
          walletAddress: buyRes.walletAddress || session.walletAddress || '0x...',
          amount: buyRes.amount || buyRes.received || requestedAmount || '0.01 ETH',
          price: buyRes.price || (buyRes.spent ? (parseFloat(buyRes.spent) * ethPriceUsd).toFixed(2) : '$0.00'),
          marketCap: buyRes.marketCap || buyRes.liveMarketCap || '$8,420',
          txHash: buyRes.txHash || '0x...',
          explorerUrl: buyRes.explorerUrl || `https://basescan.org/tx/${buyRes.txHash}`
        });

        await client.sendMessage(chatId, formattedBuyCard, {
          reply_markup: {
            inline_keyboard: [
              [
                { text: '🔴 Sell Position', callback_data: `sell:${coinAddress}:100` },
                { text: '🔍 Explorer', url: `https://basescan.org/tx/${buyRes.txHash}` }
              ],
              [{ text: '📊 Dashboard', callback_data: 'open_dashboard' }]
            ]
          }
        });
      } else {
        const errorMsg = buyRes?.error || 'Buy transaction rejected or insufficient gas balance.';
        await client.sendMessage(
          chatId,
          `❌ <b>Buy Order Failed</b>\n\n<b>Reason:</b> ${errorMsg}\n\n<b>Token:</b> <code>${coinAddress}</code>`
        );
      }
    } catch (err) {
      console.error('[ButtonHandlers] Buy execution error:', err.message);
      await client.sendMessage(
        chatId,
        `❌ <b>Buy Order Exception</b>\n\n${err.message}`
      );
    }
  }

  /**
   * Handles Sell Button click
   */
  static async handleSellButton(query, client, services, liveScanner) {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const rawData = query.data.replace('sell:', '').replace('sell_', '');
    const parts = rawData.split(':');
    const coinAddress = parts[0];
    const sellPercentage = parts[1] || '100';

    await client.answerCallbackQuery(query.id, '⏳ Executing sell order on DEX...', false);

    const session = TelegramAuth.getSession(chatId);
    const userIdOrWallet = session.uid || session.walletAddress || chatId;

    try {
      let sellRes = null;
      if (typeof services.executeSell === 'function') {
        sellRes = await services.executeSell({
          coinAddress,
          percentage: sellPercentage,
          userIdOrWallet
        });
      }

      if (sellRes && (sellRes.success || sellRes.txHash)) {
        const formattedSellCard = MessageFormatter.formatSellExecuted({
          name: sellRes.name || 'Onchain Coin',
          symbol: sellRes.symbol || 'TOKEN',
          amountSold: sellRes.amountSold || `${sellPercentage}%`,
          received: sellRes.received || sellRes.ethReceived || '0.00 ETH',
          txHash: sellRes.txHash || '0x...',
          newWalletBalance: sellRes.newWalletBalance || 'ETH Balance Updated'
        });

        await client.sendMessage(chatId, formattedSellCard, {
          reply_markup: {
            inline_keyboard: [
              [
                { text: '🔍 Explorer', url: `https://basescan.org/tx/${sellRes.txHash}` },
                { text: '🏠 Wallet', callback_data: 'inv_main' },
                { text: '❌ Exit', callback_data: 'inv_exit' }
              ]
            ]
          }
        });
      } else {
        const errorMsg = sellRes?.error || 'Sell transaction failed. Check liquidity or approval.';
        await client.sendMessage(
          chatId,
          `❌ <b>Sell Order Failed</b>\n\n<b>Reason:</b> ${errorMsg}\n\n<b>Token:</b> <code>${coinAddress}</code>`,
          {
            reply_markup: {
              inline_keyboard: [
                [
                  { text: '🏠 Wallet Inventory', callback_data: 'inv_main' },
                  { text: '❌ Exit', callback_data: 'inv_exit' }
                ]
              ]
            }
          }
        );
      }
    } catch (err) {
      console.error('[ButtonHandlers] Sell execution error:', err.message);
      await client.sendMessage(
        chatId,
        `❌ <b>Sell Order Exception</b>\n\n${err.message}`
      );
    }
  }

  /**
   * Handles Watch Button click
   */
  static async handleWatchButton(query, client, liveScanner) {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const contract = query.data.replace('watch:', '').replace('watch_', '');

    if (liveScanner && typeof liveScanner.watchCoin === 'function') {
      liveScanner.watchCoin(chatId, messageId, contract);
    }

    await client.answerCallbackQuery(query.id, '⭐ Added to Watch List! Live updates enabled.', true);

    // Update button text to Unwatch
    try {
      const keyboard = query.message.reply_markup?.inline_keyboard || [];
      const updatedKeyboard = keyboard.map(row =>
        row.map(btn => {
          if (btn.callback_data && (btn.callback_data.startsWith('watch:') || btn.callback_data.startsWith('watch_'))) {
            return { text: '⭐ Unwatch', callback_data: `unwatch:${contract}` };
          }
          return btn;
        })
      );
      await client.call('editMessageReplyMarkup', {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: { inline_keyboard: updatedKeyboard }
      });
    } catch (_) {}
  }

  /**
   * Handles Unwatch Button click
   */
  static async handleUnwatchButton(query, client, liveScanner) {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const contract = query.data.replace('unwatch:', '').replace('unwatch_', '');

    if (liveScanner && typeof liveScanner.unwatchCoin === 'function') {
      liveScanner.unwatchCoin(chatId, messageId, contract);
    }

    await client.answerCallbackQuery(query.id, 'Removed from Watch List.', false);

    // Update button text back to Watch
    try {
      const keyboard = query.message.reply_markup?.inline_keyboard || [];
      const updatedKeyboard = keyboard.map(row =>
        row.map(btn => {
          if (btn.callback_data && (btn.callback_data.startsWith('unwatch:') || btn.callback_data.startsWith('unwatch_'))) {
            return { text: '⭐ Watch', callback_data: `watch:${contract}` };
          }
          return btn;
        })
      );
      await client.call('editMessageReplyMarkup', {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: { inline_keyboard: updatedKeyboard }
      });
    } catch (_) {}
  }

  /**
   * Handles Track Creator Button click from discovery card
   */
  static async handleTrackCreatorButton(query, client, services) {
    const chatId = query.message?.chat?.id || query.from?.id;
    const rawData = query.data.replace('track_creator:', '');
    const parts = rawData.split(':');
    const creatorAddress = parts[0];
    const creatorName = parts[1] || 'Creator';

    if (!creatorAddress) {
      await client.answerCallbackQuery(query.id, '❌ Creator address missing in coin data', true);
      return;
    }

    try {
      let res = null;
      if (services && typeof services.addTrackedCreator === 'function') {
        res = await services.addTrackedCreator({ creatorAddress, name: creatorName });
      } else {
        res = await fetch('http://127.0.0.1:3000/api/telegram/tracked-creators/add', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: creatorName, creatorAddress, telegramChatId: chatId })
        }).then(r => r.json()).catch(err => ({ success: false, error: err.message || 'Backend offline' }));
      }

      if (res && res.alreadyTracked) {
        await client.answerCallbackQuery(query.id, 'ℹ️ Creator already being tracked.', true);
        if (chatId) {
          await client.sendMessage(
            chatId,
            `ℹ️ <b>Creator Already Tracked</b>\n\n` +
            `<b>Creator:</b> ${creatorName}\n` +
            `<b>Wallet:</b> <code>${creatorAddress}</code>\n\n` +
            `This creator is already active in your FOMOCLIX monitoring list.`,
            {
              parse_mode: 'HTML',
              reply_markup: {
                inline_keyboard: [
                  [{ text: '👤 View Creator', callback_data: `setting_creator_details:${creatorAddress.toLowerCase()}` }],
                  [{ text: '❌ Close', callback_data: 'delete_message' }]
                ]
              }
            }
          );
        }
        return;
      }

      if (res && res.success) {
        await client.answerCallbackQuery(query.id, '✅ Creator Added', true);
        if (chatId) {
          await client.sendMessage(
            chatId,
            `✅ <b>Creator Added</b>\n\n` +
            `<b>Creator:</b>\n${creatorName}\n<code>${creatorAddress}</code>\n\n` +
            `<b>Monitoring Status:</b>\n🟢 Active\n\n` +
            `Future launches from this creator will now be automatically monitored using your existing FOMOCLIX trading engine.`,
            {
              parse_mode: 'HTML',
              reply_markup: {
                inline_keyboard: [
                  [{ text: '👤 View Creator', callback_data: `setting_creator_details:${creatorAddress.toLowerCase()}` }],
                  [{ text: '❌ Close', callback_data: 'delete_message' }]
                ]
              }
            }
          );
        }
      } else {
        const errorMsg = res?.error || 'Firestore unavailable';
        await client.answerCallbackQuery(query.id, `❌ ${errorMsg}`, true);
        if (chatId) {
          await client.sendMessage(
            chatId,
            `❌ <b>Failed to Track Creator</b>\n\n` +
            `<b>Reason:</b> ${errorMsg}`,
            { parse_mode: 'HTML' }
          );
        }
      }
    } catch (err) {
      console.error('[ButtonHandlers] Track creator error:', err.message);
      await client.answerCallbackQuery(query.id, `❌ Error: ${err.message}`, true);
    }
  }
}

module.exports = { ButtonHandlers };
module.exports.ButtonHandlers = ButtonHandlers;
module.exports.default = ButtonHandlers;

