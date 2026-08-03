/**
 * Isolated Telegram Bot API Client (CommonJS)
 * Uses native fetch / node-fetch to avoid adding external dependencies.
 */
let fetchFn;
if (typeof globalThis.fetch === 'function') {
  fetchFn = globalThis.fetch.bind(globalThis);
} else {
  fetchFn = require('node-fetch');
}

class TelegramClient {
  constructor(token) {
    this.token = token;
    this.baseUrl = `https://api.telegram.org/bot${token}`;
  }

  async call(method, body = {}) {
    if (!this.token) {
      console.warn('[TelegramClient] No bot token configured.');
      return { ok: false, error: 'No Telegram bot token provided' };
    }
    try {
      const res = await fetchFn(`${this.baseUrl}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      return await res.json();
    } catch (err) {
      console.error(`[TelegramClient Error] ${method}:`, err.message);
      return { ok: false, error: err.message };
    }
  }

  async sendMessage(chatId, text, options = {}) {
    return this.call('sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...options
    });
  }

  async editMessageText(chatId, messageId, text, options = {}) {
    return this.call('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      ...options
    });
  }

  async answerCallbackQuery(callbackQueryId, text = '', showAlert = false) {
    return this.call('answerCallbackQuery', {
      callback_query_id: callbackQueryId,
      text,
      show_alert: showAlert
    });
  }

  async setWebhook(url) {
    return this.call('setWebhook', { url });
  }

  async getUpdates(offset = 0, timeout = 30) {
    return this.call('getUpdates', { offset, timeout });
  }
}

module.exports = { TelegramClient };
