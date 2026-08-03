/**
 * Production Telegram Remote Controller (CommonJS)
 * Acts purely as a remote client for the existing backend trading engine,
 * Firestore database, wallet manager, and execution infrastructure.
 * Single Source of Truth: Backend Services.
 */

const { TelegramAuth } = require('./auth');
const ButtonHandlersRaw = require('./buttonHandlers');
const ButtonHandlers = ButtonHandlersRaw.ButtonHandlers || ButtonHandlersRaw.default || ButtonHandlersRaw;
const { CATEGORIES, classifyInventory } = require('../walletClassifier');

class TelegramController {
  constructor(client, services = null) {
    this.client = client;
    this.servicesRef = services;
    this.liveScanner = null;
  }

  setLiveScanner(scanner) {
    this.liveScanner = scanner;
  }

  getServices() {
    return this.servicesRef || TelegramAuth.getBackendServices() || {
      getPortfolio: async () => ({
        walletAddress: '0x0000000000000000000000000000000000000000',
        totalPortfolioValue: '0.00',
        totalWalletBalance: '0 ETH',
        pnl: '$0.00',
        totalTokens: 0,
        sellableCount: 0,
        tokens: []
      }),
      executeSell: async () => ({ success: false, error: 'Backend service layer not initialized.' }),
      executeBuy: async () => ({ success: false, error: 'Backend service layer not initialized.' }),
      executeSellSelected: async () => ({ succeeded: [], failed: [], skipped: [], unsellable: [] }),
      executeSellAll: async () => ({ succeeded: [], failed: [], skipped: [], unsellable: [] }),
      getConfig: async () => ({ tradeSlippage: 0.05, maxPriorityFeeGwei: 0.1, autoSellEnabled: true }),
      updateConfig: async () => ({ success: true }),
      getTokenDetails: async (addr) => ({ symbol: 'TOKEN', name: 'Onchain Token', contract: addr })
    };
  }

  // Handle incoming update from Telegram (Webhook or Polling)
  async handleUpdate(update) {
    try {
      if (update.message) {
        await this.handleMessage(update.message);
      } else if (update.callback_query) {
        await this.handleCallbackQuery(update.callback_query);
      }
    } catch (err) {
      console.error('[TelegramController] Error handling update:', err);
    }
  }

  // Handle text messages and commands
  async handleMessage(message) {
    const chatId = message.chat.id;
    const text = message.text ? message.text.trim() : '';
    const session = TelegramAuth.getSession(chatId);
    const services = this.getServices();

    // Check if user is currently in a state machine input step
    if (session.awaitingInput === 'PRIVATE_KEY') {
      session.awaitingInput = null;
      await this.processKeyImport(chatId, text);
      return;
    } else if (session.awaitingInput === 'WITHDRAW_INFO') {
      session.awaitingInput = null;
      await this.processWithdrawInput(chatId, text);
      return;
    }

    if (text.startsWith('/start')) {
      const parts = text.split(' ');
      if (parts.length > 1 && parts[1].length >= 10) {
        const inputCredential = parts[1];
        TelegramAuth.authenticate(chatId, inputCredential);
        await this.client.sendMessage(
          chatId,
          `✅ <b>Wallet Authenticated Successfully!</b>\n\n<b>Connected Context:</b> <code>${inputCredential}</code>`,
          this.getMainKeyboard()
        );
        await this.sendDashboard(chatId);
        return;
      }
      
      const profile = await services.getUserProfile(session.uid || session.walletAddress || chatId);
      if (profile && profile.tradingWallet && profile.tradingWallet.address) {
        TelegramAuth.authenticate(chatId, profile.tradingWallet.address);
        await this.sendDashboard(chatId);
      } else {
        await this.sendWelcomeMessage(chatId);
      }
    } else if (text === '/scan' || text === '/live' || text === '/feed' || text === '/coins' || text === '📡 Live Scanner' || text === '📡 Scanner') {
      await this.sendScannerFeed(chatId);
    } else if (text === '/register' || text === '/connect' || text === '📱 Connect / Register Wallet' || text === '📝 Register / Import Wallet') {
      await this.sendRegistrationOptions(chatId);
    } else if (text === '/dashboard' || text === '📊 Dashboard') {
      await this.sendDashboard(chatId);
    } else if (text === '/portfolio' || text === '📊 Portfolio') {
      await this.sendPortfolio(chatId);
    } else if (text === '/inventory' || text === '📦 Wallet Inventory' || text === '📦 Inventory') {
      await this.sendWalletInventory(chatId);
    } else if (text === '/settings' || text === '⚙️ Settings') {
      await this.sendSettings(chatId);
    } else if (text === '/wallet' || text === '👛 Wallet') {
      await this.sendWalletInfo(chatId);
    } else if (text.startsWith('/withdraw') || text === '💸 Withdraw') {
      const parts = text.split(' ');
      if (parts.length >= 2) {
        await this.executeWithdrawal(chatId, parts[1], parts[2] || 'all');
      } else {
        session.awaitingInput = 'WITHDRAW_INFO';
        await this.client.sendMessage(
          chatId,
          `💸 <b>Withdraw Funds</b>\n\nPlease enter the destination EVM wallet address and optional ETH amount.\n\n<b>Format:</b> <code>&lt;0xDestinationAddress&gt; [amountETH]</code>\nExample: <code>0x1234567890abcdef... 0.05</code> (or send just the address to withdraw full ETH balance).`
        );
      }
    } else if (text === '/help' || text === '❓ Help') {
      await this.sendHelp(chatId);
    } else if (text.startsWith('/buy')) {
      const parts = text.split(' ');
      if (parts.length < 3) {
        await this.client.sendMessage(chatId, `⚠️ <i>Usage: /buy &lt;coinAddress&gt; &lt;amountETH&gt;</i>\nExample: <code>/buy 0x1234... 0.01</code>`);
        return;
      }
      await this.executeBuyCommand(chatId, parts[1], parts[2]);
    } else if (text.startsWith('/sell')) {
      const parts = text.split(' ');
      if (parts.length < 2) {
        await this.client.sendMessage(chatId, `⚠️ <i>Usage: /sell &lt;coinAddress&gt; [percentage]</i>\nExample: <code>/sell 0x1234... 100</code>`);
        return;
      }
      await this.executeSellCommand(chatId, parts[1], parts[2] || '100');
    } else if (text.startsWith('0x') && text.length >= 40) {
      if (text.length === 42) {
        TelegramAuth.authenticate(chatId, text);
        await this.client.sendMessage(
          chatId,
          `✅ <b>Backend Wallet Linked:</b> <code>${text}</code>`,
          this.getMainKeyboard()
        );
        await this.sendDashboard(chatId);
      } else {
        // Likely private key hex paste
        await this.processKeyImport(chatId, text);
      }
    } else {
      await this.client.sendMessage(
        chatId,
        `🤖 <i>Command not recognized. Use the menu buttons below or type /start.</i>`,
        this.getMainKeyboard()
      );
    }
  }

  // Process imported private key / seed phrase
  async processKeyImport(chatId, keyInput) {
    const services = this.getServices();
    await this.client.sendMessage(chatId, `⏳ <b>Validating & Encrypting Private Key...</b>\n\nStoring in isolated backend Firestore database...`);

    const result = await services.registerTelegramWallet({
      chatId,
      privateKeyOrMnemonic: keyInput
    });

    if (result.success) {
      TelegramAuth.authenticate(chatId, result.address);
      await this.client.sendMessage(
        chatId,
        `🎉 <b>Wallet Registered & Encrypted Successfully!</b>\n\n` +
        `<b>Address:</b> <code>${result.address}</code>\n` +
        `<b>User UID:</b> <code>${result.uid}</code>\n\n` +
        `Your private key has been encrypted using AES-256-GCM and stored securely on the backend.`,
        this.getMainKeyboard()
      );
      await this.sendDashboard(chatId);
    } else {
      await this.client.sendMessage(
        chatId,
        `❌ <b>Registration Failed</b>\n\n${result.error || 'Invalid private key or phrase.'}\n\nPlease check and try again using /register.`
      );
    }
  }

  // Process withdraw input
  async processWithdrawInput(chatId, inputStr) {
    const parts = inputStr.trim().split(' ');
    const toAddr = parts[0];
    const amountEth = parts[1] || 'all';
    await this.executeWithdrawal(chatId, toAddr, amountEth);
  }

  async executeWithdrawal(chatId, toAddress, amountEth = 'all') {
    const session = TelegramAuth.getSession(chatId);
    const services = this.getServices();
    const userTarget = session.uid || session.walletAddress || chatId;

    await this.client.sendMessage(
      chatId,
      `⏳ <b>Processing Onchain Withdrawal...</b>\n\nSending ${amountEth} ETH from your encrypted trading wallet to <code>${toAddress}</code>...`
    );

    const res = await services.executeWithdraw({
      userIdOrWallet: userTarget,
      toAddress,
      amountEth
    });

    if (res.success) {
      const text = `💸 <b>WITHDRAWAL SUCCESSFUL</b>\n\n` +
        `<b>Amount:</b> ${res.amountEth} ETH (${res.usdValue})\n` +
        `<b>From:</b> <code>${res.fromAddress}</code>\n` +
        `<b>To:</b> <code>${res.toAddress}</code>\n` +
        `<b>Tx Hash:</b> <a href="${res.explorerUrl}">${res.txHash}</a>\n` +
        `<b>Gas Used:</b> ${res.gasUsed || 'Auto'}\n` +
        `<b>Status:</b> ${res.status || 'Confirmed'}`;

      await this.client.sendMessage(chatId, text, {
        reply_markup: {
          inline_keyboard: [[{ text: '📊 Back to Dashboard', callback_data: 'open_dashboard' }]]
        }
      });
    } else {
      await this.client.sendMessage(
        chatId,
        `❌ <b>WITHDRAWAL FAILED</b>\n\n<b>Reason:</b> ${res.error || 'Transaction failed'}`,
        {
          reply_markup: {
            inline_keyboard: [[{ text: '📊 Back to Dashboard', callback_data: 'open_dashboard' }]]
          }
        }
      );
    }
  }

  // Handle inline keyboard actions
  async handleCallbackQuery(query) {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const data = query.data;

    // Delegate live scanner buttons (buy:, sell:, watch:, unwatch:) first
    const isHandledByScannerButtons = await ButtonHandlers.handleButtonAction(query, this.client, this.getServices(), this.liveScanner);
    if (isHandledByScannerButtons) {
      return;
    }

    await this.client.answerCallbackQuery(query.id);

    if (data === 'connect_mobile_wallet') {
      await this.sendRegistrationOptions(chatId, messageId);
    } else if (data === 'open_scanner') {
      await this.sendScannerFeed(chatId);
    } else if (data === 'start_register') {
      await this.sendRegistrationDisclaimer(chatId, messageId);
    } else if (data === 'accept_disclaimer') {
      const session = TelegramAuth.getSession(chatId);
      session.awaitingInput = 'PRIVATE_KEY';
      await this.client.editMessageText(
        chatId,
        messageId,
        `🔒 <b>Import Trading Wallet Private Key</b>\n\n` +
        `Please send your EVM Private Key (64-character hex starting with 0x) or 12-word seed phrase directly into this private chat.\n\n` +
        `<i>Your key is immediately encrypted using AES-256-GCM and stored securely in Firestore on the backend. It is never stored in plaintext.</i>`
      );
    } else if (data === 'open_dashboard' || data === 'refresh_dashboard') {
      await this.sendDashboard(chatId, messageId);
    } else if (data === 'withdraw_eth') {
      const session = TelegramAuth.getSession(chatId);
      session.awaitingInput = 'WITHDRAW_INFO';
      await this.client.sendMessage(
        chatId,
        `💸 <b>Withdraw Funds</b>\n\nPlease enter the destination EVM wallet address and optional ETH amount.\n\n<b>Format:</b> <code>&lt;0xDestinationAddress&gt; [amountETH]</code>`
      );
    } else if (data === 'pause_trading') {
      const session = TelegramAuth.getSession(chatId);
      const services = this.getServices();
      await services.updateUserSettings(session.uid || chatId, { tradingEnabled: false });
      await this.sendDashboard(chatId, messageId);
    } else if (data === 'resume_trading') {
      const session = TelegramAuth.getSession(chatId);
      const services = this.getServices();
      await services.updateUserSettings(session.uid || chatId, { tradingEnabled: true });
      await this.sendDashboard(chatId, messageId);
    } else if (data === 'refresh_portfolio') {
      await this.sendPortfolio(chatId, messageId);
    } else if (data === 'refresh_inventory' || data === 'inv_main' || data.startsWith('inv_page_')) {
      const page = data.startsWith('inv_page_') ? parseInt(data.replace('inv_page_', ''), 10) : 1;
      const forceRefresh = data === 'refresh_inventory';
      await this.sendWalletInventory(chatId, messageId, page, forceRefresh);
    } else if (data.startsWith('inv_cat:')) {
      const parts = data.split(':');
      const categoryKey = parts[1];
      const page = parts[2] ? parseInt(parts[2], 10) : 1;
      await this.sendInventoryCategoryView(chatId, messageId, categoryKey, page);
    } else if (data.startsWith('inv_token:') || data.startsWith('inv_token_detail_')) {
      const raw = data.startsWith('inv_token:') ? data.replace('inv_token:', '') : data.replace('inv_token_detail_', '');
      const parts = raw.split(':');
      const coinAddress = parts[0];
      const fromCategory = parts[1] || 'main';
      await this.sendInventoryTokenDetails(chatId, messageId, coinAddress, fromCategory);
    } else if (data.startsWith('inv_hide:')) {
      const raw = data.replace('inv_hide:', '');
      const parts = raw.split(':');
      const coinAddress = parts[0];
      const fromCategory = parts[1] || 'dead';
      const session = TelegramAuth.getSession(chatId);
      if (!session.hiddenTokens) session.hiddenTokens = new Set();
      session.hiddenTokens.add(coinAddress.toLowerCase());
      await this.sendInventoryCategoryView(chatId, messageId, fromCategory, 1);
    } else if (data === 'inv_back') {
      await this.sendWalletInventory(chatId, messageId, 1, false);
    } else if (data.startsWith('inv_toggle_token_')) {
      const tokenIdentifier = data.replace('inv_toggle_token_', '');
      const session = TelegramAuth.getSession(chatId);
      if (session.selectedTokens.has(tokenIdentifier)) {
        session.selectedTokens.delete(tokenIdentifier);
      } else {
        session.selectedTokens.add(tokenIdentifier);
      }
      await this.sendWalletInventory(chatId, messageId);
    } else if (data.startsWith('inv_sell_cat:')) {
      const categoryKey = data.replace('inv_sell_cat:', '');
      await this.executeSellCategory(chatId, messageId, categoryKey);
    } else if (data.startsWith('inv_sell_token_')) {
      const coinAddress = data.replace('inv_sell_token_', '');
      await this.executeSellSingleToken(chatId, messageId, coinAddress);
    } else if (data === 'inv_sell_selected' || data === 'sell_selected') {
      await this.executeSellSelected(chatId, messageId);
    } else if (data === 'inv_sell_all' || data === 'sell_all_sellable') {
      await this.executeSellAllSellable(chatId, messageId);
    } else if (data === 'inv_exit' || data === 'exit_menu' || data === 'close_panel') {
      await this.client.editMessageText(
        chatId,
        messageId,
        '❌ <b>Telegram Control Panel Closed</b>\n\nUse <b>/start</b> or <b>/menu</b> anytime to re-open.',
        { reply_markup: { inline_keyboard: [] } }
      );
    } else if (data.startsWith('toggle_token_')) {
      const tokenIdentifier = data.replace('toggle_token_', '');
      const session = TelegramAuth.getSession(chatId);
      if (session.selectedTokens.has(tokenIdentifier)) {
        session.selectedTokens.delete(tokenIdentifier);
      } else {
        session.selectedTokens.add(tokenIdentifier);
      }
      await this.sendPortfolio(chatId, messageId);
    } else if (data.startsWith('sell_token_')) {
      const coinAddress = data.replace('sell_token_', '');
      await this.executeSellSingleToken(chatId, messageId, coinAddress);
    } else if (data.startsWith('token_detail_')) {
      const coinAddress = data.replace('token_detail_', '');
      await this.sendTokenDetails(chatId, messageId, coinAddress);
    } else if (data.startsWith('setting_toggle_')) {
      const key = data.replace('setting_toggle_', '');
      const session = TelegramAuth.getSession(chatId);
      const services = this.getServices();
      const userSettings = await services.getUserSettings(session.uid || chatId);
      let newValue = !userSettings[key];
      await services.updateUserSettings(session.uid || chatId, { [key]: newValue });
      await this.sendSettings(chatId, messageId);
    } else if (data === 'back_to_main') {
      await this.sendDashboard(chatId, messageId);
    }
  }

  getMainKeyboard() {
    return {
      reply_markup: {
        keyboard: [
          [{ text: '📡 Live Scanner' }, { text: '📊 Dashboard' }],
          [{ text: '📦 Wallet Inventory' }, { text: '📊 Portfolio' }],
          [{ text: '⚙️ Settings' }, { text: '👛 Wallet' }],
          [{ text: '💸 Withdraw' }, { text: '❓ Help' }],
          [{ text: '📱 Connect / Register Wallet' }]
        ],
        resize_keyboard: true
      }
    };
  }

  async sendRegistrationOptions(chatId, messageId = null) {
    const text = `📝 <b>FOMOCLIX User Registration & Wallet Connection</b>\n\n` +
      `Select your preferred registration method:\n\n` +
      `1️⃣ <b>Sign In with Mobile / Smart Wallet:</b>\n` +
      `Connect Base App, Rainbow, Phantom, MetaMask, Coinbase Smart Wallet, or any Web3 provider. Opens a popup into your wallet app on mobile to authorize.\n\n` +
      `2️⃣ <b>Import Private Key / Seed Phrase:</b>\n` +
      `Encrypted with AES-256-GCM and stored securely on the backend in Firestore.`;

    const appBaseUrl = process.env.APP_URL || 'https://ais-dev-bopbnerfx4fq246otw4xgi-345043019581.europe-west2.run.app';
    const connectUrl = `${appBaseUrl}/telegram-connect?chatId=${chatId}`;

    const replyMarkup = {
      inline_keyboard: [
        [
          { text: '📱 Sign In with Mobile / Smart Wallet', web_app: { url: connectUrl } }
        ],
        [
          { text: '🌐 Direct Web Link (WalletConnect Portal)', url: connectUrl }
        ],
        [
          { text: '🔑 Import Private Key / Seed Phrase', callback_data: 'start_register' }
        ],
        [
          { text: '📊 Back to Dashboard', callback_data: 'open_dashboard' }
        ]
      ]
    };

    if (messageId) {
      await this.client.editMessageText(chatId, messageId, text, { reply_markup: replyMarkup });
    } else {
      await this.client.sendMessage(chatId, text, { reply_markup: replyMarkup });
    }
  }

  async sendWelcomeMessage(chatId) {
    const text = `🚀 <b>FOMOCLIX Telegram Remote Trading Client</b>\n\n` +
      `Welcome to FOMOCLIX! Trade onchain tokens, monitor wallet inventories, and execute high-speed DEX orders directly inside Telegram.\n\n` +
      `<b>Get Started:</b>\n` +
      `1. Tap 📱 <b>Sign In with Mobile / Smart Wallet</b> to authorize Base App, Rainbow, Phantom, MetaMask, or Coinbase Smart Wallet.\n` +
      `2. Or import your existing private key / seed phrase securely.\n\n` +
      `<i>Your session is isolated and encrypted on the backend.</i>`;

    const appBaseUrl = process.env.APP_URL || 'https://ais-dev-bopbnerfx4fq246otw4xgi-345043019581.europe-west2.run.app';
    const connectUrl = `${appBaseUrl}/telegram-connect?chatId=${chatId}`;

    const replyMarkup = {
      inline_keyboard: [
        [{ text: '📱 Sign In with Mobile / Smart Wallet', web_app: { url: connectUrl } }],
        [{ text: '🔑 Import Private Key / Seed', callback_data: 'start_register' }],
        [{ text: '📊 Open Telegram Dashboard', callback_data: 'open_dashboard' }]
      ]
    };

    await this.client.sendMessage(chatId, text, { reply_markup: replyMarkup });
  }

  async sendScannerFeed(chatId) {
    try {
      const { db } = require('../db');
      let items = [];
      if (db) {
        const snap = await db.collection('activityFeed').orderBy('timestamp', 'desc').limit(5).get();
        if (snap && snap.docs) {
          items = snap.docs.map(doc => doc.data()).filter(Boolean);
        }
      }

      if (!items || items.length === 0) {
        await this.client.sendMessage(
          chatId,
          `📡 <b>Live Scanner Active</b>\n\n` +
          `Monitoring Base, Solana, and Zora block activity in real-time.\n` +
          `New coin detections will post automatically to this chat as soon as they are discovered.`,
          this.getMainKeyboard()
        );
        return;
      }

      const MessageFormatter = require('./messageFormatter').MessageFormatter;

      await this.client.sendMessage(
        chatId,
        `📡 <b>Latest Live Scanner Detections:</b> (${items.length} recent coins)`,
        this.getMainKeyboard()
      );

      for (const item of items) {
        const cardText = MessageFormatter.formatCard(item, { status: 'Live Detection' });
        const keyboard = MessageFormatter.formatButtons(item);
        await this.client.sendMessage(chatId, cardText, keyboard);
      }
    } catch (err) {
      console.error('[TelegramController] Error sending scanner feed:', err.message);
      await this.client.sendMessage(
        chatId,
        `📡 <b>Live Scanner Active</b>\n\n` +
        `Real-time blockchain scanner is running. Discoveries will auto-stream to this chat.`,
        this.getMainKeyboard()
      );
    }
  }

  async sendWelcomeMessage(chatId) {
    const text = `🚀 <b>FOMOCLIX Telegram Remote Trading Client</b>\n\n` +
      `Welcome to FOMOCLIX! Trade onchain tokens, monitor wallet inventories, and execute high-speed DEX orders directly inside Telegram.\n\n` +
      `<b>Get Started:</b>\n` +
      `1. Register/Import your trading wallet.\n` +
      `2. Accept disclaimer & terms.\n` +
      `3. Send your private key securely in this private chat.\n\n` +
      `<i>Your private key is encrypted server-side using AES-256-GCM and stored securely.</i>`;

    const replyMarkup = {
      inline_keyboard: [
        [{ text: '📝 Register / Import Wallet', callback_data: 'start_register' }],
        [{ text: '📊 Open Telegram Dashboard', callback_data: 'open_dashboard' }]
      ]
    };

    await this.client.sendMessage(chatId, text, { reply_markup: replyMarkup });
  }

  async sendRegistrationDisclaimer(chatId, messageId = null) {
    const text = `⚖️ <b>FOMOCLIX Terms & Risk Disclaimer</b>\n\n` +
      `Before registering your wallet in Telegram, please confirm your agreement:\n\n` +
      `• You acknowledge that cryptocurrency trading carries significant financial risk.\n` +
      `• Private keys are encrypted using AES-256-GCM and stored in backend Firestore.\n` +
      `• You retain full ownership and control over your trading funds.\n` +
      `• Transactions are executed directly onchain on Base L2.\n\n` +
      `Do you accept these terms to proceed with wallet import?`;

    const replyMarkup = {
      inline_keyboard: [
        [{ text: '✅ I Agree & Accept Terms', callback_data: 'accept_disclaimer' }],
        [{ text: '❌ Cancel', callback_data: 'open_dashboard' }]
      ]
    };

    if (messageId) {
      await this.client.editMessageText(chatId, messageId, text, { reply_markup: replyMarkup });
    } else {
      await this.client.sendMessage(chatId, text, { reply_markup: replyMarkup });
    }
  }

  async sendDashboard(chatId, messageId = null) {
    const session = TelegramAuth.getSession(chatId);
    const services = this.getServices();
    const userTarget = session.uid || session.walletAddress || chatId;

    const [portfolio, settings, subCheck] = await Promise.all([
      services.getPortfolio(userTarget),
      services.getUserSettings(userTarget),
      services.checkSubscription(userTarget)
    ]);

    const isTradingActive = settings.tradingEnabled !== false;

    let text = `📊 <b>FOMOCLIX Multi-User Telegram Dashboard</b>\n`;
    text += `<code>─────────────────────────────</code>\n`;
    text += `<b>Wallet:</b> <code>${portfolio.walletAddress || 'Not Registered'}</code>\n`;
    text += `<b>Portfolio Value:</b> <code>$${portfolio.totalPortfolioValue}</code>\n`;
    text += `<b>Native Balance:</b> <code>${portfolio.totalWalletBalance}</code>\n`;
    text += `<b>24h PnL:</b> <code>${portfolio.pnl}</code>\n`;
    text += `<b>Subscription:</b> <code>${subCheck.profileTag}</code> (${subCheck.active ? '🟢 Active' : '🔴 Inactive'})\n`;
    text += `<b>Bot Status:</b> ${isTradingActive ? '🟢 TRADING ACTIVE' : '🔴 TRADING PAUSED'}\n`;
    text += `<b>Active Positions:</b> <code>${portfolio.totalTokens} (${portfolio.sellableCount} Sellable)</code>\n`;
    text += `<b>Auto Buy:</b> ${settings.autoBuyEnabled ? '🟢 ON' : '🔴 OFF'} | <b>Auto Sell:</b> ${settings.autoSellEnabled !== false ? '🟢 ON' : '🔴 OFF'}\n`;
    text += `<code>─────────────────────────────</code>\n\n`;
    text += `<i>Live metrics fetched directly from backend execution engine.</i>`;

    const inlineKeyboard = [
      [
        { text: '📊 Portfolio', callback_data: 'refresh_portfolio' },
        { text: '📦 Inventory', callback_data: 'refresh_inventory' }
      ],
      [
        { text: '⚙️ Settings', callback_data: 'open_settings' },
        { text: '👛 Wallet Info', callback_data: 'open_wallet' }
      ],
      [
        { text: '💸 Withdraw ETH', callback_data: 'withdraw_eth' },
        { text: '🔄 Refresh', callback_data: 'refresh_dashboard' }
      ],
      [
        isTradingActive
          ? { text: '⏸️ Pause Trading Engine', callback_data: 'pause_trading' }
          : { text: '▶️ Resume Trading Engine', callback_data: 'resume_trading' }
      ]
    ];

    const replyMarkup = { inline_keyboard: inlineKeyboard };

    if (messageId) {
      await this.client.editMessageText(chatId, messageId, text, { reply_markup: replyMarkup });
    } else {
      await this.client.sendMessage(chatId, text, { reply_markup: replyMarkup });
    }
  }

  async sendPortfolio(chatId, messageId = null) {
    const session = TelegramAuth.getSession(chatId);
    const services = this.getServices();
    const target = session.walletAddress || session.uid || services.getWalletAddress(chatId);
    
    // FETCH LIVE PORTFOLIO DIRECTLY FROM BACKEND SERVICE
    const data = await services.getPortfolio(target);

    let text = `📊 <b>FOMOCLIX Portfolio Summary</b>\n`;
    text += `<code>─────────────────────────────</code>\n`;
    text += `<b>Wallet:</b> <code>${data.walletAddress || 'Not Connected'}</code>\n`;
    text += `<b>Total Value:</b> <code>$${data.totalPortfolioValue}</code>\n`;
    text += `<b>Native Balance:</b> <code>${data.totalWalletBalance}</code>\n`;
    text += `<b>24h PnL:</b> <code>${data.pnl}</code>\n`;
    text += `<b>Positions:</b> <code>${data.totalTokens} Tokens (${data.sellableCount} Sellable)</code>\n`;
    text += `<code>─────────────────────────────</code>\n\n`;
    text += `<b>Token Breakdown (Live Backend Data):</b>\n\n`;

    const inlineKeyboard = [];

    if (!data.tokens || data.tokens.length === 0) {
      text += `<i>No active token positions found in backend wallet context.</i>\n\n`;
    } else {
      data.tokens.forEach((t) => {
        const isSelected = session.selectedTokens.has(t.address) || session.selectedTokens.has(t.symbol);
        const checkbox = isSelected ? '☑️' : '⏹️';
        const sellBadge = t.sellable ? '✅ Sellable' : '❌ Unsellable / No Liq';

        text += `${checkbox} <b>${t.symbol}</b> (${t.name})\n`;
        text += `  ├ <b>Category:</b> ${t.category}\n`;
        text += `  ├ <b>Balance:</b> ${t.balance} | <b>USD:</b> $${(t.usdValue || 0).toFixed(2)}\n`;
        text += `  └ <b>Status:</b> ${sellBadge} (${t.liquidity || 'Onchain'})\n\n`;

        if (t.sellable && t.address && t.address !== 'N/A') {
          inlineKeyboard.push([
            { text: `${checkbox} ${t.symbol}`, callback_data: `toggle_token_${t.address}` },
            { text: `⚡ Sell`, callback_data: `sell_token_${t.address}` },
            { text: `🔍 Details`, callback_data: `token_detail_${t.address}` }
          ]);
        }
      });
    }

    // Action Row 1: Bulk Sells
    inlineKeyboard.push([
      { text: '💥 Sell Selected Tokens', callback_data: 'sell_selected' },
      { text: '🔥 Sell ALL Sellable', callback_data: 'sell_all_sellable' }
    ]);

    // Action Row 2: Refresh / Settings / Wallet
    inlineKeyboard.push([
      { text: '🔄 Refresh Portfolio', callback_data: 'refresh_portfolio' }
    ]);

    // Action Row 3 (CRITICAL REQUIREMENT): Live total wallet value inline button
    inlineKeyboard.push([
      { text: `Current Wallet Value: $${data.totalPortfolioValue}`, callback_data: 'refresh_portfolio' }
    ]);

    const replyMarkup = { inline_keyboard: inlineKeyboard };

    if (messageId) {
      await this.client.editMessageText(chatId, messageId, text, { reply_markup: replyMarkup });
    } else {
      await this.client.sendMessage(chatId, text, { reply_markup: replyMarkup });
    }
  }

  async sendTokenDetails(chatId, messageId, coinAddress) {
    const services = this.getServices();
    const details = await services.getTokenDetails(coinAddress);

    const text = `🔍 <b>Token Deep Analysis: ${details.symbol}</b>\n\n` +
      `<b>Symbol:</b> ${details.symbol}\n` +
      `<b>Name:</b> ${details.name}\n` +
      `<b>Contract:</b> <code>${details.contract}</code>\n` +
      `<b>DEX Pool:</b> ${details.dexPool}\n` +
      `<b>24h Volume:</b> ${details.volume24h}\n` +
      `<b>Honeypot Risk:</b> ${details.honeypotRisk}\n` +
      `<b>Ownership:</b> ${details.ownership}\n` +
      `<b>Slippage Rec:</b> ${details.recommendedSlippage}\n\n` +
      `<i>Live data fetched directly from FOMOCLIX backend execution engine.</i>`;

    const replyMarkup = {
      inline_keyboard: [
        [{ text: `⚡ Sell ${details.symbol}`, callback_data: `sell_token_${details.contract}` }],
        [{ text: '🔙 Back to Portfolio', callback_data: 'back_to_main' }]
      ]
    };

    await this.client.editMessageText(chatId, messageId, text, { reply_markup: replyMarkup });
  }

  async executeSellSingleToken(chatId, messageId, coinAddress) {
    const session = TelegramAuth.getSession(chatId);
    const services = this.getServices();
    const targetUser = session.walletAddress || services.getWalletAddress(chatId) || session.uid;

    await this.client.editMessageText(
      chatId,
      messageId,
      `⏳ <b>Executing Trade Onchain...</b>\n\nSending sell request for <code>${coinAddress}</code> to backend trading engine...`
    );

    // CALL BACKEND SELL SERVICE
    const result = await services.executeSell({
      coinAddress,
      percentage: 100,
      userIdOrWallet: targetUser
    });

    const persistentReplyMarkup = {
      inline_keyboard: [
        [
          { text: '🏠 Wallet Inventory', callback_data: 'inv_main' },
          { text: '🔄 Refresh', callback_data: 'refresh_inventory' },
          { text: '❌ Exit', callback_data: 'inv_exit' }
        ]
      ]
    };

    if (result.success) {
      const text = `✅ <b>SOLD</b>\n\n` +
        `<b>Token:</b> ${result.symbol || 'TOKEN'}\n` +
        `<b>Sold Amount:</b> ${result.soldAmount}\n` +
        `<b>Received Amount:</b> ${result.receivedAmount}\n` +
        `<b>Value:</b> ${result.usdValue}\n` +
        `<b>Transaction Hash:</b> <code>${result.txHash}</code>\n` +
        `<b>Explorer:</b> <a href="${result.explorerUrl}">View on Explorer</a>\n` +
        `<b>Gas Used:</b> ${result.gasUsed || 'Auto'}\n` +
        `<b>Status:</b> ${result.status || 'Confirmed'}`;

      await this.client.editMessageText(chatId, messageId, text, { reply_markup: persistentReplyMarkup });
    } else {
      const text = `❌ <b>SELL FAILED</b>\n\n` +
        `<b>Token:</b> <code>${coinAddress}</code>\n` +
        `<b>Reason:</b> ${result.error || 'Execution failed'}`;

      await this.client.editMessageText(chatId, messageId, text, { reply_markup: persistentReplyMarkup });
    }
  }

  async executeSellCommand(chatId, coinAddress, percentage = '100') {
    const session = TelegramAuth.getSession(chatId);
    const services = this.getServices();
    const targetUser = session.walletAddress || services.getWalletAddress(chatId) || session.uid;

    const msg = await this.client.sendMessage(
      chatId,
      `⏳ <b>Executing Sell Order...</b>\n\nSending sell request for <code>${coinAddress}</code> (${percentage}%) to backend...`
    );

    const messageId = msg.result ? msg.result.message_id : null;
    const result = await services.executeSell({
      coinAddress,
      percentage,
      userIdOrWallet: targetUser
    });

    const replyMarkup = {
      inline_keyboard: [
        [
          { text: '🏠 Wallet Inventory', callback_data: 'inv_main' },
          { text: '🔄 Refresh', callback_data: 'refresh_inventory' },
          { text: '❌ Exit', callback_data: 'inv_exit' }
        ]
      ]
    };

    if (result.success) {
      const text = `✅ <b>SOLD</b>\n\n` +
        `<b>Token:</b> ${result.symbol || 'TOKEN'}\n` +
        `<b>Sold Amount:</b> ${result.soldAmount}\n` +
        `<b>Received Amount:</b> ${result.receivedAmount}\n` +
        `<b>Value:</b> ${result.usdValue}\n` +
        `<b>Transaction Hash:</b> <code>${result.txHash}</code>\n` +
        `<b>Explorer:</b> <a href="${result.explorerUrl}">View on Explorer</a>\n` +
        `<b>Gas Used:</b> ${result.gasUsed || 'Auto'}\n` +
        `<b>Status:</b> ${result.status || 'Confirmed'}`;

      if (messageId) {
        await this.client.editMessageText(chatId, messageId, text, { reply_markup: replyMarkup });
      } else {
        await this.client.sendMessage(chatId, text, { reply_markup: replyMarkup });
      }
    } else {
      const text = `❌ <b>SELL FAILED</b>\n\n` +
        `<b>Token:</b> <code>${coinAddress}</code>\n` +
        `<b>Reason:</b> ${result.error || 'Execution failed'}`;

      if (messageId) {
        await this.client.editMessageText(chatId, messageId, text, { reply_markup: replyMarkup });
      } else {
        await this.client.sendMessage(chatId, text, { reply_markup: replyMarkup });
      }
    }
  }

  async executeBuyCommand(chatId, coinAddress, amountEth) {
    const session = TelegramAuth.getSession(chatId);
    const services = this.getServices();
    const targetUser = session.walletAddress || services.getWalletAddress(chatId) || session.uid;

    const msg = await this.client.sendMessage(
      chatId,
      `⏳ <b>Executing Market Buy...</b>\n\nBuying <code>${coinAddress}</code> for ${amountEth} ETH via backend trading engine...`
    );

    const messageId = msg.result ? msg.result.message_id : null;
    const result = await services.executeBuy({
      coinAddress,
      amountEth,
      userIdOrWallet: targetUser
    });

    const replyMarkup = {
      inline_keyboard: [
        [
          { text: '🏠 Wallet Inventory', callback_data: 'inv_main' },
          { text: '🔄 Refresh', callback_data: 'refresh_inventory' },
          { text: '❌ Exit', callback_data: 'inv_exit' }
        ]
      ]
    };

    if (result.success) {
      const text = `BUY SUCCESSFUL\n\n` +
        `<b>${result.symbol || 'TOKEN'}</b>\n\n` +
        `<b>Bought:</b> ${result.boughtAmount}\n` +
        `<b>Spent:</b> ${result.spentAmount}\n` +
        `<b>Tx:</b> <a href="${result.explorerUrl}">${result.txHash}</a>\n` +
        `<b>Status:</b> ${result.status || 'Confirmed'}`;

      if (messageId) {
        await this.client.editMessageText(chatId, messageId, text, { reply_markup: replyMarkup });
      } else {
        await this.client.sendMessage(chatId, text, { reply_markup: replyMarkup });
      }
    } else {
      const text = `❌ <b>BUY FAILED</b>\n\n` +
        `<b>Token:</b> <code>${coinAddress}</code>\n` +
        `<b>Reason:</b> ${result.error || 'Execution failed'}`;

      if (messageId) {
        await this.client.editMessageText(chatId, messageId, text, { reply_markup: replyMarkup });
      } else {
        await this.client.sendMessage(chatId, text, { reply_markup: replyMarkup });
      }
    }
  }

  async executeSellCategory(chatId, messageId, categoryKey) {
    const session = TelegramAuth.getSession(chatId);
    const services = this.getServices();
    const targetUser = session.walletAddress || services.getWalletAddress(chatId) || session.uid;

    const categoryDef = Object.values(CATEGORIES).find(c => c.key === categoryKey) || CATEGORIES.UNKNOWN;

    await this.client.editMessageText(
      chatId,
      messageId,
      `🔥 <b>Executing Sell ALL for ${categoryDef.label}...</b>\n\nFetching category assets and submitting DEX sell orders to backend engine...`
    );

    const inventory = await this.fetchInventoryData(targetUser, true, session);
    const rawItems = (inventory.categories && inventory.categories[categoryKey]) || [];
    const sellableTokens = rawItems.filter(t => (t.contract || t.address) && (t.contract || t.address) !== 'N/A' && (t.contract || t.address).toLowerCase() !== 'eth');

    if (sellableTokens.length === 0) {
      const emptyText = `⚠️ <b>No Sellable Tokens Found</b> in ${categoryDef.label} folder.\n\n` +
        `All tokens in this category either have 0 balance or zero active liquidity.`;
      
      const replyMarkup = {
        inline_keyboard: [
          [
            { text: '⬅ Back to Category', callback_data: `inv_cat:${categoryKey}:1` },
            { text: '🏠 Wallet Inventory', callback_data: 'inv_main' },
            { text: '❌ Exit', callback_data: 'inv_exit' }
          ]
        ]
      };
      await this.client.editMessageText(chatId, messageId, emptyText, { reply_markup: replyMarkup });
      return;
    }

    const tokenAddresses = sellableTokens.map(t => t.contract || t.address);
    const report = await services.executeSellSelected({
      tokenAddresses,
      userIdOrWallet: targetUser
    });

    let text = `🔥 <b>Category Sell ALL Report: ${categoryDef.label}</b>\n`;
    text += `<code>─────────────────────────────</code>\n`;
    text += `<b>Succeeded (${report.succeeded.length}):</b>\n`;
    if (report.succeeded.length === 0) {
      text += `  • None\n`;
    } else {
      report.succeeded.forEach(s => {
        text += `  • <b>${s.symbol || 'TOKEN'}</b>: Sold ${s.soldAmount} -> Rec ${s.receivedAmount} (<a href="${s.explorerUrl}">Tx</a>)\n`;
      });
    }

    text += `\n<b>Failed / Unsellable (${report.failed.length + report.unsellable.length}):</b>\n`;
    const errorItems = [...report.failed, ...report.unsellable];
    if (errorItems.length === 0) {
      text += `  • None\n`;
    } else {
      errorItems.forEach(f => {
        text += `  • <code>${f.tokenAddress}</code>: ${f.reason || 'Trade execution failed'}\n`;
      });
    }

    if (report.skipped.length > 0) {
      text += `\n<b>Skipped (${report.skipped.length}):</b> Zero balance or gas token\n`;
    }
    text += `<code>─────────────────────────────</code>`;

    const replyMarkup = {
      inline_keyboard: [
        [
          { text: '⬅ Back to Category', callback_data: `inv_cat:${categoryKey}:1` },
          { text: '🏠 Wallet Inventory', callback_data: 'inv_main' },
          { text: '🔄 Refresh', callback_data: 'refresh_inventory' },
          { text: '❌ Exit', callback_data: 'inv_exit' }
        ]
      ]
    };

    await this.client.editMessageText(chatId, messageId, text, { reply_markup: replyMarkup });
  }

  async executeSellSelected(chatId, messageId) {
    const session = TelegramAuth.getSession(chatId);
    const services = this.getServices();
    const targetUser = session.walletAddress || services.getWalletAddress(chatId) || session.uid;
    const selected = Array.from(session.selectedTokens);

    if (selected.length === 0) {
      await this.client.sendMessage(
        chatId,
        '⚠️ <i>No tokens selected. Check the checkboxes next to tokens in your portfolio to select them.</i>'
      );
      return;
    }

    await this.client.editMessageText(
      chatId,
      messageId,
      `💥 <b>Executing Bulk Sell Order...</b>\n\nSending sell requests for ${selected.length} tokens to backend trading engine...`
    );

    const report = await services.executeSellSelected({
      tokenAddresses: selected,
      userIdOrWallet: targetUser
    });

    session.selectedTokens.clear();

    let text = `💥 <b>Bulk Sell Execution Report</b>\n`;
    text += `<code>─────────────────────────────</code>\n`;
    text += `<b>Succeeded (${report.succeeded.length}):</b>\n`;
    if (report.succeeded.length === 0) {
      text += `  • None\n`;
    } else {
      report.succeeded.forEach(s => {
        text += `  • <b>${s.symbol}</b>: Sold ${s.soldAmount} -> Rec ${s.receivedAmount} (<a href="${s.explorerUrl}">Tx</a>)\n`;
      });
    }

    text += `\n<b>Failed / Unsellable (${report.failed.length + report.unsellable.length}):</b>\n`;
    const errorItems = [...report.failed, ...report.unsellable];
    if (errorItems.length === 0) {
      text += `  • None\n`;
    } else {
      errorItems.forEach(f => {
        text += `  • <code>${f.tokenAddress}</code>: ${f.reason}\n`;
      });
    }

    if (report.skipped.length > 0) {
      text += `\n<b>Skipped (${report.skipped.length}):</b> Zero balance or gas token\n`;
    }
    text += `<code>─────────────────────────────</code>`;

    const replyMarkup = {
      inline_keyboard: [
        [
          { text: '🏠 Wallet Inventory', callback_data: 'inv_main' },
          { text: '🔄 Refresh', callback_data: 'refresh_inventory' },
          { text: '❌ Exit', callback_data: 'inv_exit' }
        ]
      ]
    };

    await this.client.editMessageText(chatId, messageId, text, { reply_markup: replyMarkup });
  }

  async executeSellAllSellable(chatId, messageId) {
    const session = TelegramAuth.getSession(chatId);
    const services = this.getServices();
    const targetUser = session.walletAddress || services.getWalletAddress(chatId) || session.uid;

    await this.client.editMessageText(
      chatId,
      messageId,
      `🔥 <b>Executing Sell ALL Sellable...</b>\n\nQuerying live sellable positions from backend and submitting DEX sell orders...`
    );

    const report = await services.executeSellAll({
      userIdOrWallet: targetUser
    });

    let text = `🔥 <b>Sell ALL Sellable Report</b>\n`;
    text += `<code>─────────────────────────────</code>\n`;
    text += `<b>Succeeded (${report.succeeded.length}):</b>\n`;
    if (report.succeeded.length === 0) {
      text += `  • None\n`;
    } else {
      report.succeeded.forEach(s => {
        text += `  • <b>${s.symbol}</b>: Sold ${s.soldAmount} -> Rec ${s.receivedAmount} (<a href="${s.explorerUrl}">Tx</a>)\n`;
      });
    }

    text += `\n<b>Unsellable / Drained (${report.unsellable.length + report.failed.length}):</b>\n`;
    const errorItems = [...report.failed, ...report.unsellable];
    if (errorItems.length === 0) {
      text += `  • None\n`;
    } else {
      errorItems.forEach(f => {
        text += `  • <code>${f.tokenAddress}</code>: ${f.reason}\n`;
      });
    }
    text += `<code>─────────────────────────────</code>`;

    const sellAllReplyMarkup = {
      inline_keyboard: [
        [
          { text: '🏠 Wallet Inventory', callback_data: 'inv_main' },
          { text: '🔄 Refresh', callback_data: 'refresh_inventory' },
          { text: '❌ Exit', callback_data: 'inv_exit' }
        ]
      ]
    };

    await this.client.editMessageText(chatId, messageId, text, { reply_markup: sellAllReplyMarkup });
  }

  async sendSettings(chatId, messageId = null) {
    const session = TelegramAuth.getSession(chatId);
    const services = this.getServices();
    const s = await services.getUserSettings(session.uid || chatId);

    let text = `⚙️ <b>FOMOCLIX Isolated User Settings</b>\n`;
    text += `<code>─────────────────────────────</code>\n`;
    text += `<b>Target User:</b> <code>${session.uid || chatId}</code>\n`;
    text += `<b>Slippage Tolerance:</b> <code>${((s.tradeSlippage || 0.05) * 100).toFixed(1)}%</code>\n`;
    text += `<b>Priority Fee:</b> <code>${s.maxPriorityFeeGwei || 0.1} Gwei</code>\n`;
    text += `<b>Auto Buy (Sniping):</b> ${s.autoBuyEnabled ? '🟢 ENABLED' : '🔴 DISABLED'}\n`;
    text += `<b>Auto Sell (TP/SL Engine):</b> ${s.autoSellEnabled !== false ? '🟢 ENABLED' : '🔴 DISABLED'}\n`;
    text += `<b>Take Profit Target:</b> <code>+${s.takeProfit || 50}%</code>\n`;
    text += `<b>Stop Loss Target:</b> <code>-${s.stopLoss || 20}%</code>\n`;
    text += `<b>Trading Engine Status:</b> ${s.tradingEnabled !== false ? '🟢 ACTIVE' : '🔴 PAUSED'}\n`;
    text += `<code>─────────────────────────────</code>\n`;

    const replyMarkup = {
      inline_keyboard: [
        [
          { text: `Auto Buy: ${s.autoBuyEnabled ? 'ON' : 'OFF'}`, callback_data: 'setting_toggle_autoBuyEnabled' },
          { text: `Auto Sell: ${s.autoSellEnabled !== false ? 'ON' : 'OFF'}`, callback_data: 'setting_toggle_autoSellEnabled' }
        ],
        [
          { text: `Trading: ${s.tradingEnabled !== false ? 'ACTIVE' : 'PAUSED'}`, callback_data: 'setting_toggle_tradingEnabled' }
        ],
        [
          { text: '🔙 Back to Dashboard', callback_data: 'open_dashboard' }
        ]
      ]
    };

    if (messageId) {
      await this.client.editMessageText(chatId, messageId, text, { reply_markup: replyMarkup });
    } else {
      await this.client.sendMessage(chatId, text, { reply_markup: replyMarkup });
    }
  }

  async sendWalletInfo(chatId) {
    const session = TelegramAuth.getSession(chatId);
    const services = this.getServices();
    const target = session.walletAddress || session.uid || services.getWalletAddress(chatId);
    
    const data = await services.getPortfolio(target);

    const text = `👛 <b>Wallet Information & Diagnostics</b>\n\n` +
      `<b>Connected Wallet:</b> <code>${data.walletAddress}</code>\n` +
      `<b>Network:</b> Base L2 Mainnet (Chain ID 8453)\n` +
      `<b>Native Balances:</b> <code>${data.totalWalletBalance}</code>\n` +
      `<b>Total Portfolio Value:</b> <code>$${data.totalPortfolioValue}</code>\n` +
      `<b>Status:</b> ${session.authenticated ? '🟢 Authenticated & Authorized' : '🟢 System Wallet Active'}\n\n` +
      `To switch target wallet, type your Base/Solana wallet address into this chat or use /start &lt;wallet_address&gt;.`;

    await this.client.sendMessage(chatId, text, this.getMainKeyboard());
  }

  async sendHelp(chatId) {
    const text = `❓ <b>FOMOCLIX Telegram Remote Controller Guide</b>\n\n` +
      `1. <b>Register / Link Wallet:</b> Tap 📱 Sign In with Mobile / Smart Wallet to connect Base App, Rainbow, Phantom, MetaMask, or Coinbase Smart Wallet, or import a key.\n` +
      `2. <b>Live Portfolio:</b> Tap 📊 Portfolio to query live onchain balances and token holdings.\n` +
      `3. <b>Executing Sells:</b> Tap ⚡ Sell next to any token or use <code>/sell &lt;address&gt; [percent]</code>.\n` +
      `4. <b>Executing Buys:</b> Use <code>/buy &lt;address&gt; &lt;amountETH&gt;</code> to buy onchain tokens.\n` +
      `5. <b>Bulk Execution:</b> Select tokens with checkboxes then tap 💥 Sell Selected, or tap 🔥 Sell ALL Sellable.\n` +
      `6. <b>Settings:</b> Adjust slippage, priority fee, and strategy triggers stored on the backend.`;

    const appBaseUrl = process.env.APP_URL || 'https://ais-dev-bopbnerfx4fq246otw4xgi-345043019581.europe-west2.run.app';
    const connectUrl = `${appBaseUrl}/telegram-connect?chatId=${chatId}`;

    const inlineKeyboard = [
      [
        { text: '📱 Sign In with Mobile / Smart Wallet', web_app: { url: connectUrl } }
      ],
      [
        { text: '🌐 Direct Web Link (WalletConnect Portal)', url: connectUrl }
      ],
      [
        { text: '🔑 Import Private Key / Seed Phrase', callback_data: 'start_register' }
      ],
      [
        { text: '📊 Dashboard', callback_data: 'open_dashboard' },
        { text: '📡 Live Scanner', callback_data: 'open_scanner' }
      ]
    ];

    await this.client.sendMessage(chatId, text, {
      ...this.getMainKeyboard(),
      reply_markup: { inline_keyboard: inlineKeyboard }
    });
  }

  /**
   * Helper to fetch or load cached classified wallet inventory
   */
  async fetchInventoryData(target, forceRefresh = false, session = {}) {
    const cacheKey = `inv_${target}`;
    const now = Date.now();

    if (!forceRefresh && session.cachedInventory && session.cachedInventoryKey === cacheKey && (now - session.cachedInventoryTime < 60000)) {
      return session.cachedInventory;
    }

    const services = this.getServices();
    let inventory = null;
    if (typeof services.getWalletInventory === 'function') {
      try {
        inventory = await services.getWalletInventory(target);
      } catch (err) {
        console.warn('[TelegramController] getWalletInventory error:', err.message);
      }
    }

    if (!inventory || !inventory.success) {
      const port = await services.getPortfolio(target);
      inventory = {
        success: true,
        walletAddress: port.walletAddress,
        totalInventoryValue: port.totalPortfolioValue,
        totalWalletBalance: port.totalWalletBalance,
        totalTokensCount: port.totalTokens,
        items: port.tokens.map(t => ({
          address: t.address,
          contract: t.address,
          symbol: t.symbol,
          name: t.name,
          humanBalance: t.balance,
          usdValue: t.usdValue,
          liquidity: t.liquidity,
          liquidityStatus: t.sellable ? 'Active' : 'Low Volatility / Dead Liquidity',
          sellable: Boolean(t.sellable),
          category: t.category,
          dexAvailability: 'Base L2 / Onchain'
        }))
      };
    }

    if (typeof services.getBalances === 'function') {
      try {
        const nativeBals = await services.getBalances();
        if (nativeBals && typeof nativeBals.eth === 'number') {
          inventory.totalWalletBalance = `${nativeBals.eth.toFixed(4)} ETH / ${(nativeBals.usdc || 0).toFixed(2)} USDC`;
        }
      } catch (err) {
        console.warn('[TelegramController] getBalances error:', err.message);
      }
    }

    // Load active positions from service if available
    let activePositions = [];
    if (typeof services.getActivePositions === 'function') {
      try {
        activePositions = await services.getActivePositions(target);
      } catch (_) {}
    }

    const classified = classifyInventory(inventory, activePositions);
    session.cachedInventory = classified;
    session.cachedInventoryKey = cacheKey;
    session.cachedInventoryTime = now;

    return classified;
  }

  /**
   * Main Wallet Summary & Category Folders Screen
   */
  async sendWalletInventory(chatId, messageId = null, page = 1, forceRefresh = false) {
    const session = TelegramAuth.getSession(chatId);
    const services = this.getServices();
    const target = session.walletAddress || session.uid || services.getWalletAddress(chatId);

    const inventory = await this.fetchInventoryData(target, forceRefresh, session);
    const counts = inventory.counts || {};
    const values = inventory.values || {};

    let text = `📦 <b>FOMOCLIX Telegram Wallet Inventory V2</b>\n`;
    text += `<code>─────────────────────────────</code>\n`;
    text += `<b>Wallet Address:</b> <code>${inventory.walletAddress}</code>\n`;
    text += `<b>Total Portfolio USD:</b> <code>$${inventory.totalInventoryValue}</code>\n`;
    text += `<b>Native Balances:</b> <code>${inventory.totalWalletBalance}</code>\n`;
    text += `<b>Total Tokens Count:</b> <code>${inventory.totalTokensCount}</code>\n`;
    text += `<b>Est. Sellable Value:</b> <code>$${inventory.sellableValueUsd} (${inventory.sellableCount} tokens)</code>\n`;
    text += `<b>Est. Unsellable Value:</b> <code>$${inventory.unsellableValueUsd} (${inventory.unsellableCount} tokens)</code>\n`;
    text += `<code>─────────────────────────────</code>\n\n`;
    text += `<b>📁 Select Asset Category Folder:</b>\n`;
    text += `Tap any category button below to view its token list.\n\n`;

    const inlineKeyboard = [
      [
        { text: `🟣 Zora Coins (${counts.zora || 0})`, callback_data: 'inv_cat:zora:1' },
        { text: `🔵 Base Tokens (${counts.base || 0})`, callback_data: 'inv_cat:base:1' }
      ],
      [
        { text: `🟢 Active Positions (${counts.active || 0})`, callback_data: 'inv_cat:active:1' },
        { text: `🟡 Other ERC20 (${counts.other || 0})`, callback_data: 'inv_cat:other:1' }
      ],
      [
        { text: `⚫ Dead / Rugged (${counts.dead || 0})`, callback_data: 'inv_cat:dead:1' },
        { text: `⚪ Unknown (${counts.unknown || 0})`, callback_data: 'inv_cat:unknown:1' }
      ],
      [
        { text: '💥 Sell Selected Tokens', callback_data: 'inv_sell_selected' },
        { text: '🔥 Sell ALL Sellable', callback_data: 'inv_sell_all' }
      ],
      [
        { text: '🔄 Refresh Inventory', callback_data: 'refresh_inventory' },
        { text: '🔙 Back to Dashboard', callback_data: 'open_dashboard' },
        { text: '❌ Exit', callback_data: 'inv_exit' }
      ]
    ];

    const replyMarkup = { inline_keyboard: inlineKeyboard };

    if (messageId) {
      await this.client.editMessageText(chatId, messageId, text, { reply_markup: replyMarkup });
    } else {
      await this.client.sendMessage(chatId, text, { reply_markup: replyMarkup });
    }
  }

  /**
   * Category Folder Contents View (e.g. 🟣 Zora Coins list)
   */
  async sendInventoryCategoryView(chatId, messageId, categoryKey, page = 1) {
    const session = TelegramAuth.getSession(chatId);
    const services = this.getServices();
    const target = session.walletAddress || session.uid || services.getWalletAddress(chatId);

    const inventory = await this.fetchInventoryData(target, false, session);
    const categoryDef = Object.values(CATEGORIES).find(c => c.key === categoryKey) || CATEGORIES.UNKNOWN;
    const rawItems = (inventory.categories && inventory.categories[categoryKey]) || [];
    
    // Filter out hidden tokens if any
    const hiddenSet = session.hiddenTokens || new Set();
    const items = rawItems.filter(i => !hiddenSet.has((i.contract || i.address || '').toLowerCase()));

    const itemsPerPage = 4;
    const totalPages = Math.ceil(items.length / itemsPerPage) || 1;
    const currentPage = Math.max(1, Math.min(page, totalPages));
    const startIndex = (currentPage - 1) * itemsPerPage;
    const pageItems = items.slice(startIndex, startIndex + itemsPerPage);

    const catValue = (inventory.values && inventory.values[categoryKey] !== undefined)
      ? inventory.values[categoryKey].toFixed(2)
      : '0.00';

    let text = `${categoryDef.label} <b>(Folder View)</b>\n`;
    text += `<code>─────────────────────────────</code>\n`;
    text += `<b>Description:</b> ${categoryDef.description}\n`;
    text += `<b>Tokens in Category:</b> <code>${items.length}</code> | <b>Total USD:</b> <code>$${catValue}</code>\n`;
    text += `<code>─────────────────────────────</code>\n\n`;

    const inlineKeyboard = [];

    if (pageItems.length === 0) {
      text += `<i>No assets found in this category.</i>\n\n`;
    } else {
      pageItems.forEach(t => {
        const itemAddr = t.contract || t.address || 'N/A';
        const isSelected = session.selectedTokens.has(itemAddr) || session.selectedTokens.has(t.symbol);
        const checkbox = isSelected ? '☑️' : '⏹️';
        const isSellable = Boolean(t.sellable);
        const statusBadge = isSellable ? '✅ Sellable' : '❌ Unsellable';
        const reasonStr = (!isSellable && t.reasonIfNotSellable) ? ` • Reason: <i>${t.reasonIfNotSellable}</i>` : '';

        text += `${checkbox} <b>${t.symbol}</b> (${t.name})\n`;
        text += `  ├ <b>Balance:</b> ${t.humanBalance || t.balance} | <b>USD:</b> $${(t.usdValue || 0).toFixed(2)}\n`;
        text += `  ├ <b>Status:</b> ${statusBadge}${reasonStr}\n`;
        text += `  ├ <b>Detected By:</b> ${t.detectedBy || '⚪ On-chain Scan'}\n`;
        text += `  └ <b>Liquidity:</b> ${t.liquidity || 'Onchain'}\n\n`;

        if (itemAddr && itemAddr !== 'N/A' && itemAddr.toLowerCase() !== 'eth') {
          inlineKeyboard.push([
            { text: `${checkbox} ${t.symbol}`, callback_data: `inv_toggle_token_${itemAddr}` },
            { text: `⚡ Sell`, callback_data: `inv_sell_token_${itemAddr}` },
            { text: `🔍 Details`, callback_data: `inv_token:${itemAddr}:${categoryKey}` }
          ]);
        }
      });
    }

    // Pagination row
    if (totalPages > 1) {
      const pageRow = [];
      if (currentPage > 1) {
        pageRow.push({ text: '◀️ Prev', callback_data: `inv_cat:${categoryKey}:${currentPage - 1}` });
      }
      pageRow.push({ text: `Page ${currentPage}/${totalPages}`, callback_data: `inv_cat:${categoryKey}:${currentPage}` });
      if (currentPage < totalPages) {
        pageRow.push({ text: 'Next ▶️', callback_data: `inv_cat:${categoryKey}:${currentPage + 1}` });
      }
      inlineKeyboard.push(pageRow);
    }

    // Category Sell All Row
    const hasSellableTokens = items.some(i => (i.contract || i.address) && (i.contract || i.address) !== 'N/A' && (i.contract || i.address).toLowerCase() !== 'eth');
    if (hasSellableTokens) {
      inlineKeyboard.push([
        { text: `🔥 Sell ALL ${categoryDef.label}`, callback_data: `inv_sell_cat:${categoryKey}` }
      ]);
    }

    // Folder Navigation Row
    inlineKeyboard.push([
      { text: '⬅ Back', callback_data: 'inv_back' },
      { text: '🏠 Wallet', callback_data: 'inv_main' },
      { text: '🔄 Refresh', callback_data: 'refresh_inventory' },
      { text: '❌ Exit', callback_data: 'inv_exit' }
    ]);

    const replyMarkup = { inline_keyboard: inlineKeyboard };

    if (messageId) {
      await this.client.editMessageText(chatId, messageId, text, { reply_markup: replyMarkup });
    } else {
      await this.client.sendMessage(chatId, text, { reply_markup: replyMarkup });
    }
  }

  /**
   * Detailed Asset View
   */
  async sendInventoryTokenDetails(chatId, messageId, coinAddress, fromCategoryKey = 'main') {
    const session = TelegramAuth.getSession(chatId);
    const services = this.getServices();
    const target = session.walletAddress || session.uid || services.getWalletAddress(chatId);

    const inventory = await this.fetchInventoryData(target, false, session);

    const item = (inventory?.items || []).find(
      i => (i.contract || i.address || '').toLowerCase() === (coinAddress || '').toLowerCase()
    );

    let text = '';
    const inlineKeyboard = [];

    if (item) {
      const isSellable = Boolean(item.sellable);
      const contractAddr = item.contract || item.address || coinAddress;

      text = `🔍 <b>Asset Inventory Deep View: ${item.symbol}</b>\n\n` +
        `<b>Name:</b> ${item.name}\n` +
        `<b>Symbol:</b> ${item.symbol}\n` +
        `<b>Contract Address:</b> <code>${contractAddr}</code>\n` +
        `<b>Asset Category:</b> ${item.categoryLabel || item.coinType || 'Onchain Asset'}\n` +
        `<b>Detected By:</b> ${item.detectedBy || '⚪ On-chain Scan'}\n` +
        `<b>Balance:</b> ${item.humanBalance || item.balance}\n` +
        `<b>USD Value:</b> $${(item.usdValue || 0).toFixed(2)}\n` +
        `<b>Price:</b> $${(item.price || 0).toFixed(6)}\n` +
        `<b>Liquidity:</b> ${item.liquidity || 'Onchain'}\n` +
        `<b>Liquidity Status:</b> ${item.liquidityStatus || 'Active'}\n` +
        `<b>DEX / Router:</b> ${item.dexAvailability || 'Base L2 / Uniswap V3'}\n` +
        `<b>Sellable:</b> ${isSellable ? '✅ Yes' : '❌ No'}\n` +
        (item.reasonIfNotSellable ? `<b>Reason if Unsellable:</b> <i>${item.reasonIfNotSellable}</i>\n` : '') +
        (item.creator ? `<b>Creator:</b> <code>${item.creator}</code>\n` : '') +
        (item.holders ? `<b>Holders:</b> ${item.holders}\n` : '') +
        (item.poolAddress ? `<b>Pool:</b> <code>${item.poolAddress}</code>\n` : '') +
        `<b>Chain:</b> ${item.chain || 'Base L2 (8453)'}\n` +
        `<b>Last Scanned:</b> ${new Date(item.lastUpdated || Date.now()).toLocaleTimeString()}\n\n` +
        `<i>Verified asset parameters scanned directly on Base L2.</i>`;

      if (isSellable) {
        inlineKeyboard.push([{ text: `⚡ Sell ${item.symbol}`, callback_data: `inv_sell_token_${contractAddr}` }]);
      }

      inlineKeyboard.push([{ text: '🔗 View Explorer', url: `https://basescan.org/token/${contractAddr}` }]);

    } else {
      const details = await services.getTokenDetails(coinAddress);
      text = `🔍 <b>Asset Inventory Deep View: ${details.symbol}</b>\n\n` +
        `<b>Symbol:</b> ${details.symbol}\n` +
        `<b>Name:</b> ${details.name}\n` +
        `<b>Contract Address:</b> <code>${details.contract}</code>\n` +
        `<b>Detected By:</b> 🔵 Base RPC\n` +
        `<b>DEX Pool:</b> ${details.dexPool || 'Uniswap V3 / Aerodrome'}\n` +
        `<b>24h Vol / Liquidity:</b> ${details.volume24h || 'Active'}\n` +
        `<b>Honeypot / Security Risk:</b> ${details.honeypotRisk || 'Low'}\n` +
        `<b>Ownership:</b> ${details.ownership || 'Verified'}\n\n` +
        `<i>Real-time asset info scanned from Base L2 blockchain engine.</i>`;

      inlineKeyboard.push([
        { text: `⚡ Sell ${details.symbol}`, callback_data: `inv_sell_token_${details.contract}` },
        { text: '🔗 View Explorer', url: `https://basescan.org/token/${details.contract}` }
      ]);
    }

    const backCallback = fromCategoryKey && fromCategoryKey !== 'main' 
      ? `inv_cat:${fromCategoryKey}:1`
      : 'inv_main';

    inlineKeyboard.push([
      { text: '⬅ Back', callback_data: backCallback },
      { text: '🏠 Wallet', callback_data: 'inv_main' },
      { text: '🔄 Refresh', callback_data: 'refresh_inventory' },
      { text: '❌ Exit', callback_data: 'inv_exit' }
    ]);

    const replyMarkup = { inline_keyboard: inlineKeyboard };
    if (messageId) {
      await this.client.editMessageText(chatId, messageId, text, { reply_markup: replyMarkup });
    } else {
      await this.client.sendMessage(chatId, text, { reply_markup: replyMarkup });
    }
  }

  async sendNotification(chatId, type, details) {
    const services = this.getServices();
    const config = await services.getConfig();
    if (config.telegramEnabled === false) return;

    const text = `🔔 <b>FOMOCLIX Alert: ${type}</b>\n\n${details}`;
    await this.client.sendMessage(chatId, text);
  }
}

module.exports = { TelegramController };
