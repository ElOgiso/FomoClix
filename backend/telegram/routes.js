/**
 * Express Router for Telegram Integration (CommonJS)
 * Mounted cleanly at /api/telegram
 */

const express = require('express');
const { TelegramAuth } = require('./auth');
const { getConnectPageHtml } = require('./connectPage');

function createTelegramRouter(telegramController) {
  const router = express.Router();

  // Status check
  router.get('/status', (req, res) => {
    res.json({
      success: true,
      module: 'telegram',
      status: 'active',
      activeSessions: TelegramAuth.getAllActiveSessions().length
    });
  });

  // Serve Web3 Wallet Connect Portal Page
  router.get('/connect-page', (req, res) => {
    const chatId = req.query.chatId || '';
    res.setHeader('Content-Type', 'text/html');
    res.send(getConnectPageHtml(chatId));
  });

  // Link external or smart wallet to Telegram user
  router.post('/link-wallet', async (req, res) => {
    try {
      const { chatId, address, signature, message, walletType } = req.body;
      if (!chatId || !address) {
        return res.status(400).json({ success: false, error: 'chatId and address are required' });
      }

      const cleanAddr = String(address).trim();
      const cleanChatId = String(chatId).trim();
      const uid = `telegram_${cleanChatId}`;

      const { db } = require('../db');
      const ethers = require('ethers');

      // Attempt signature verification if provided
      if (signature && message) {
        try {
          const recovered = ethers.verifyMessage(message, signature);
          if (recovered.toLowerCase() !== cleanAddr.toLowerCase()) {
            console.warn(`[Telegram Link Wallet] Recovered address ${recovered} differs from ${cleanAddr}`);
          }
        } catch (sigErr) {
          console.warn('[Telegram Link Wallet] Signature check notice:', sigErr.message);
        }
      }

      const userRecord = {
        uid,
        telegramId: cleanChatId,
        termsAccepted: true,
        termsAcceptedAt: Date.now(),
        privacyAccepted: true,
        riskAccepted: true,
        onboardingComplete: true,
        onboardingCompletedAt: Date.now(),
        plan: 'payg',
        subscriptionActive: true,
        profileTag: 'Telegram External Wallet',
        tradingWallet: {
          address: cleanAddr,
          isExternal: true,
          walletType: walletType || 'Mobile / Smart Wallet',
          linkedAt: Date.now(),
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

      // Authenticate session in TelegramAuth
      TelegramAuth.authenticate(cleanChatId, cleanAddr);

      // Notify Telegram Chat directly
      if (telegramController && telegramController.client) {
        await telegramController.client.sendMessage(
          cleanChatId,
          `🎉 <b>Mobile / Smart Wallet Linked Successfully!</b>\n\n` +
          `<b>Connected Wallet:</b> <code>${cleanAddr}</code>\n` +
          `<b>Wallet App:</b> ${walletType || 'Base App / Web3 Wallet'}\n` +
          `<b>Telegram User ID:</b> <code>${uid}</code>\n\n` +
          `Your wallet is registered and connected to your FOMOCLIX Telegram session! You can now view your portfolio, monitor inventory, or execute trades directly in Telegram.`,
          telegramController.getMainKeyboard()
        );
        await telegramController.sendDashboard(cleanChatId);
      }

      return res.json({
        success: true,
        address: cleanAddr,
        uid,
        message: 'Wallet linked successfully to Telegram account'
      });
    } catch (err) {
      console.error('[Telegram Link Wallet Error]', err);
      return res.status(500).json({ success: false, error: err.message || 'Failed to link wallet' });
    }
  });

  // Telegram Webhook Endpoint
  router.post('/webhook', async (req, res) => {
    try {
      const update = req.body;
      if (update && telegramController) {
        await telegramController.handleUpdate(update);
      }
      res.json({ ok: true });
    } catch (err) {
      console.error('[Telegram Webhook Error]', err);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Send Push Notification to active Telegram chats
  router.post('/notify', async (req, res) => {
    try {
      const { type, details, chatId } = req.body;
      if (!type || !details) {
        return res.status(400).json({ success: false, error: 'type and details required' });
      }

      if (chatId) {
        await telegramController.sendNotification(chatId, type, details);
      } else {
        const sessions = TelegramAuth.getAllActiveSessions();
        for (const session of sessions) {
          await telegramController.sendNotification(session.chatId, type, details);
        }
      }

      res.json({ success: true, message: 'Notification dispatched' });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
}

module.exports = { createTelegramRouter };
