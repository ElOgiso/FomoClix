/**
 * Telegram Channel Publisher Module
 * Automatically publishes new scanner discoveries, Creator Coins, Content Coins,
 * and optional trade alerts to the public Telegram channel.
 * Behaves identically to the live scanner dashboard.
 */

const { MessageFormatter } = require('./messageFormatter');

export class ChannelPublisher {
  constructor(channelId = null) {
    this.channelId = channelId || process.env.TELEGRAM_CHANNEL_ID || null;
    this.sentChannelMessages = new Map(); // contract -> messageId
  }

  getChannelId() {
    return this.channelId || process.env.TELEGRAM_CHANNEL_ID || null;
  }

  setChannelId(id) {
    this.channelId = id;
  }

  /**
   * Automatically publishes a new scanner discovery to the public Telegram channel
   */
  async publishDiscovery(client, coinObj) {
    const targetChannel = this.getChannelId();
    if (!targetChannel || !client) {
      return null;
    }

    try {
      const cardText = MessageFormatter.formatCard(coinObj);
      const keyboardMarkup = MessageFormatter.formatButtons(coinObj);

      const res = await client.sendMessage(targetChannel, cardText, keyboardMarkup);
      if (res && res.ok && res.result && res.result.message_id) {
        const contract = (coinObj.contract || coinObj.contractAddress || coinObj.coin || coinObj.address || '').toLowerCase();
        if (contract) {
          this.sentChannelMessages.set(contract, res.result.message_id);
        }
        return res.result;
      }
    } catch (err) {
      console.warn('[ChannelPublisher] Failed to publish discovery to channel:', err.message);
    }
    return null;
  }

  /**
   * Publishes a buy confirmation alert to the channel
   */
  async publishBuyAlert(client, tradeRes) {
    const targetChannel = this.getChannelId();
    if (!targetChannel || !client) return null;

    try {
      const cardText = MessageFormatter.formatBuyExecuted(tradeRes);
      const res = await client.sendMessage(targetChannel, cardText);
      return res?.result || null;
    } catch (err) {
      console.warn('[ChannelPublisher] Failed to publish buy alert to channel:', err.message);
    }
    return null;
  }

  /**
   * Publishes a sell confirmation alert to the channel
   */
  async publishSellAlert(client, tradeRes) {
    const targetChannel = this.getChannelId();
    if (!targetChannel || !client) return null;

    try {
      const cardText = MessageFormatter.formatSellExecuted(tradeRes);
      const res = await client.sendMessage(targetChannel, cardText);
      return res?.result || null;
    } catch (err) {
      console.warn('[ChannelPublisher] Failed to publish sell alert to channel:', err.message);
    }
    return null;
  }

  /**
   * Updates an existing discovery message in the channel if market cap / price changes
   */
  async updateChannelMessage(client, coinObj) {
    const targetChannel = this.getChannelId();
    if (!targetChannel || !client) return null;

    const contract = (coinObj.contract || coinObj.contractAddress || coinObj.coin || coinObj.address || '').toLowerCase();
    const messageId = this.sentChannelMessages.get(contract);
    if (!messageId) return null;

    try {
      const cardText = MessageFormatter.formatCard(coinObj);
      const keyboardMarkup = MessageFormatter.formatButtons(coinObj);

      return await client.editMessageText(targetChannel, messageId, cardText, keyboardMarkup);
    } catch (err) {
      // Ignore if content not modified
      if (!err.message?.includes('message is not modified')) {
        console.warn('[ChannelPublisher] Error updating channel message:', err.message);
      }
    }
    return null;
  }
}

export default ChannelPublisher;
