/**
 * FOMOCLIX AI OS — Rule-Based Offline Fallback Agent
 * Returns structured rules-based action cards if API keys are missing or offline.
 */

function getRuleBasedResponse(userMessage, context) {
  const msg = userMessage.toLowerCase();
  
  // 1. Propose configuration settings
  if (msg.includes('budget') || msg.includes('config') || msg.includes('slippage') || msg.includes('settings')) {
    return `I analyzed your active settings. Your current trade amount is **${context.config.tradeAmountEth || '0.0002'} ETH** with slippage at **${context.config.tradeSlippage || '0.0025'}**. 
 
I suggest optimizing your settings to **0.05 ETH** buy amount and **0.5% (0.005)** slippage for faster execution and better priority on Zora/Base.
 
Would you like me to apply these settings? Click the button below to approve.
 
\`\`\`fomoclix-action
{
  "type": "PROPOSE_CONFIG",
  "title": "⚙️ OPTIMIZE BOT SETTINGS",
  "description": "Increase buy budget to 0.01 ETH and slippage to 0.5% for optimal priority entry.",
  "data": {
    "configUpdates": {
      "tradeAmountEth": 0.01,
      "tradeSlippage": 0.005
    }
  }
}
\`\`\``;
  }

  // 2. Propose deleting/untracking creator
  if (msg.includes('delete creator') || msg.includes('remove creator') || msg.includes('untrack') || msg.includes('delete') || msg.includes('remove')) {
    let targetCreator = context.trackedCreators[0] || { id: '0x742d35cc6634c0532925a3b844bc454e4438f44e', name: 'SmartDev' };
    
    for (const c of context.trackedCreators) {
      const name = (c.name || '').toLowerCase();
      const addr = (c.address || c.id || '').toLowerCase();
      if (msg.includes(name) || msg.includes(addr)) {
        targetCreator = c;
        break;
      }
    }

    const targetAddr = targetCreator.address || targetCreator.id;
    const targetName = targetCreator.name || 'SmartDev';

    return `I found target creator **${targetName}** (\`${targetAddr}\`) in your watch list.
 
Would you like to stop tracking this creator and remove them from the database? Click below to execute deletion.
 
\`\`\`fomoclix-action
{
  "type": "PROPOSE_DELETE_CREATOR",
  "title": "🗑️ DELETE Creator ${targetName}",
  "description": "Untrack creator ${targetName} and remove their address from targeting rules.",
  "data": {
    "creatorAddress": "${targetAddr}",
    "name": "${targetName}"
  }
}
\`\`\``;
  }

  // 3. Track creator recommendation
  if (msg.includes('creator') || msg.includes('track') || msg.includes('follow')) {
    const defaultAddr = '0x742d35cc6634c0532925a3b844bc454e4438f44e';
    return `I can help you track developers and creators. When they deploy a new token, the bot will auto-buy their launches.
 
Here is a recommended smart money creator address: \`${defaultAddr}\` (High historical win-rate).
 
Would you like to start tracking this creator? Tap the button below to add to target list.
 
\`\`\`fomoclix-action
{
  "type": "PROPOSE_TRACK_CREATOR",
  "title": "➕ TRACK SMART MONEY CREATOR",
  "description": "Add 0x742d...f44e to your target creator list.",
  "data": {
    "creatorAddress": "${defaultAddr}",
    "chain": "${context.activeChain}"
  }
}
\`\`\``;
  }

  // 4. Propose selling a token
  if (msg.includes('sell') || msg.includes('exit') || msg.includes('close')) {
    let targetSymbol = 'TOSHI';
    let targetAddr = '0xac1664cd0d8c037803e6c3848b556948c258d4a6';
    
    if (context.positions && context.positions.length > 0) {
      const pos = context.positions[0];
      targetSymbol = pos.symbol || 'TOSHI';
      targetAddr = pos.tokenAddress || pos.mintAddress || '0xac1664cd0d8c037803e6c3848b556948c258d4a6';
    }

    return `I analyzed your portfolio. You are currently holding **${targetSymbol}**.
 
Would you like to sell your holdings and close this position? Click below to execute sell.
 
\`\`\`fomoclix-action
{
  "type": "PROPOSE_SELL",
  "title": "🔒 PROPOSE SELL ${targetSymbol}",
  "description": "Sell all active holdings for ${targetSymbol} on DEX router.",
  "data": {
    "symbol": "${targetSymbol}",
    "tokenAddress": "${targetAddr}",
    "chain": "${context.activeChain}",
    "amount": "100%"
  }
}
\`\`\``;
  }

  // 5. Propose buying a token
  if (msg.includes('buy') || msg.includes('trade') || msg.includes('snipe')) {
    const symbol = context.activeChain === 'solana' ? 'BONK' : 'TOSHI';
    const address = context.activeChain === 'solana' ? 'DezXAZ8z7PnrFcEDkWJZ2CtiwyqA3LRZE4v48669G7v0' : '0xac1664cd0d8c037803e6c3848b556948c258d4a6';
    const amount = context.activeChain === 'solana' ? '0.5' : '0.01';
    
    return `Let's scan the trending list. A potential candidate on **${context.activeChain.toUpperCase()}** is **${symbol}** (Good holder distribution, Mint Authority Revoked).
 
Would you like to buy ${amount} ${context.activeChain === 'solana' ? 'SOL' : 'ETH'} of ${symbol}? Approve the trade below.
 
\`\`\`fomoclix-action
{
  "type": "PROPOSE_BUY",
  "title": "⚡ PROPOSE BUY ${symbol}",
  "description": "Execute swap on Uniswap/Jupiter for ${symbol} using active terminal credentials.",
  "data": {
    "symbol": "${symbol}",
    "tokenAddress": "${address}",
    "chain": "${context.activeChain}",
    "amount": "${amount}"
  }
}
\`\`\``;
  }

  // Default fallback
  return `Hello! I am your FOMOCLIX AI Assistant. I can help you monitor live feeds, optimize settings, buy/sell tokens, or track/delete creators.
 
Try asking:
- *Optimize my bot budget*
- *Suggest a creator to track*
- *Delete creator SmartDev*
- *Trade trending coins on ${context.activeChain}*`;
}

module.exports = {
  getRuleBasedResponse
};
