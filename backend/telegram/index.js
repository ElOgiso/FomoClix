/**
 * Telegram Module Entry Point (CommonJS)
 * Completely isolated Telegram Control Module
 */

const { TelegramClient } = require('./client');
const { TelegramController } = require('./controller');
const { createTelegramRouter } = require('./routes');
const { TelegramAuth } = require('./auth');
const { LiveScanner } = require('./liveScanner');
const { dbEvents } = require('../db');

let activeLiveScannerInstance = null;

function initTelegramModule(app, services = null) {
  if (services) {
    TelegramAuth.setBackendServices(services);
  }

  // Ensure persistent Telegram sessions are initialized from Firestore
  TelegramAuth.initPersistence().catch(err => {
    console.warn('[Telegram Module] Session persistence init warning:', err.message);
  });

  const token = process.env.TELEGRAM_BOT_TOKEN || '';
  const channelId = process.env.TELEGRAM_CHANNEL_ID || '';

  // Startup Environment Validation & Logging
  console.log('--------------------------------------------------');
  console.log('🤖 TELEGRAM MODULE STARTUP ENVIRONMENT VALIDATION:');
  if (token) {
    console.log('  ✅ TELEGRAM_BOT_TOKEN: Configured');
  } else {
    console.warn('  ⚠️ TELEGRAM_BOT_TOKEN: Missing from environment variables');
  }

  if (channelId) {
    console.log(`  ✅ TELEGRAM_CHANNEL_ID: Configured (${channelId})`);
  } else {
    console.warn('  ⚠️ TELEGRAM_CHANNEL_ID: Missing from environment variables');
  }
  console.log('--------------------------------------------------');

  const client = new TelegramClient(token);
  const controller = new TelegramController(client, services);
  const router = createTelegramRouter(controller);

  // Initialize Telegram Live Scanner module
  const liveScanner = new LiveScanner(client, services);
  activeLiveScannerInstance = liveScanner;
  controller.setLiveScanner(liveScanner);
  
  if (dbEvents) {
    liveScanner.subscribeToBackendEvents(dbEvents);
  }

  // Mount isolated Telegram endpoints under /api/telegram
  if (app && typeof app.use === 'function') {
    app.use('/api/telegram', router);
    console.log('✅ Isolated Telegram Control Module mounted at /api/telegram');
  }

  // If bot token is provided, start background long-polling safely
  if (token) {
    console.log('🤖 Telegram Bot Token found. Starting polling listener...');
    let offset = 0;
    let isRunning = true;

    const poll = async () => {
      while (isRunning) {
        try {
          const res = await client.getUpdates(offset, 10);
          if (res && res.ok && Array.isArray(res.result)) {
            for (const update of res.result) {
              offset = update.update_id + 1;
              await controller.handleUpdate(update);
            }
          }
        } catch (err) {
          console.error('[Telegram Polling Error]', err.message);
          await new Promise(r => setTimeout(r, 5000));
        }
      }
    };

    poll();
  } else {
    console.log('ℹ️ Telegram Bot Token not set (TELEGRAM_BOT_TOKEN). Webhook mode active at /api/telegram/webhook');
  }

  return { client, controller, router, liveScanner, auth: TelegramAuth, setBackendServices: (s) => setBackendServices(s) };
}

function setBackendServices(services) {
  TelegramAuth.setBackendServices(services);
  if (activeLiveScannerInstance) {
    activeLiveScannerInstance.setServices(services);
  }
}

module.exports = { initTelegramModule, setBackendServices };
