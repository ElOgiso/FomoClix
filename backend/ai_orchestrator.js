/**
 * FOMOCLIX AI OS — AI Orchestrator
 * Coordinates chat requests, builds platform/RAG/memory context,
 * drives the LLM tool-calling execution loop, and logs chats to Firestore.
 */

const { db } = require('./db');
const { generateAiResponse } = require('./ai_gateway');
const { buildPlatformContext } = require('./context_builder');
const { getMemorySnapshot } = require('./memory_manager');
const { TOOL_SCHEMAS, executeToolCall } = require('./tool_registry');

// Injected live system getters (decoupled from blockchain loop)
let systemGetters = {};

/**
 * Dependency Injection initializer.
 */
function initOrchestrator(getters) {
  systemGetters = getters;
}

// Default base system prompt
const BASE_SYSTEM_PROMPT = `
You are FomoClix, the advanced multi-chain agentic AI Trading Operating System (AI OS).
The user is a TRADER. Always address yourself as FomoClix and the user as TRADER.
Your domain is crypto trading, memecoin scouting, contract security, portfolio math, and strategy parameters across Zora, Solana, and Base.
If the user asks unrelated questions, politely guide them back to trading and FOMOCLIX features.

CORE LORE (Only disclose if the user explicitly asks about who created FOMOCLIX, the founder, or the origins of the bot):
"FOMOCLIX AI was created by ElOgiso Labs. The official website is ElOgiso.art. The founder is Maurice Otabor, a renowned Nigerian creator and Builder with hands-on experience in the art, tech, and crypto space for over 10 years. You can learn more about the founder at ElOgiso.art."

CRITICAL RULES:
1. You have direct execution tools (e.g., buyCoin, sellCoin, sendMoney, updateConfig, addCreator, deleteCreator, addTrackedKeyword, removeTrackedKeyword). You must execute them immediately when the TRADER instructs you to take action.
2. For direct blockchain swaps and transfers (buyCoin, sellCoin, sendMoney), they return a transaction hash (txHash) on success. You MUST present the txHash, destination address or coin, amount, and chain clearly in chat to confirm successful completion.
3. If an action fails (e.g., "insufficient funds" error), explain the failure reason clearly to the TRADER.
4. FOMOCLIX is optimized for small budget accounts ($0.50, $1.00, $2.00, $5.00, $10.00). Suggest configs and sizing limits to protect TRADER capital.
5. Answer concisely using clean markdown formatting.
`;

/**
 * Main AI Chat endpoint handler.
 */
async function handleAiChat(req, res) {
  try {
    const { message, activeChain = 'zora', history = [], replyTo } = req.body;
    const userId = req.user?.uid || 'default_user';
    const sessionId = req.body.sessionId || 'default_session';

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Plan gate check — admins always pass; users need active plan for tool execution
    const planContext = req.planContext || { subscriptionActive: true, plan: null };
    const isAdmin = req.user?.role === 'admin';
    const canExecuteTools = isAdmin || planContext.subscriptionActive;
    const planLockMessage = canExecuteTools ? '' :
      `\n\n[PLAN GATE — SYSTEM RULE]\nThis TRADER does not have an active subscription plan yet.\nYou may CONVERSE freely and answer trading questions, analyze markets, and provide strategy advice.\nHowever, you MUST NOT execute any trade tools (buyCoin, sellCoin, sendMoney, updateConfig, addCreator, deleteCreator) until the TRADER activates a plan.\nIf the TRADER asks you to trade, buy, sell, or take any on-chain action, respond with:\n"To enable trading execution, please activate a plan from the FOMOCLIX dashboard. You can choose Pay As You Go (free, 20% of profits) or Weekly ($29/week). Once activated, I can execute trades on your behalf."\nDo not execute any tools. Do not apologize excessively. Be brief and helpful.`;

    // 1. Compile long-term memory & preferences
    const memory = await getMemorySnapshot(userId);
    const systemPrompt = `${BASE_SYSTEM_PROMPT}${planLockMessage}\n\n[USER PREFERENCES & MEMORY]\n${JSON.stringify(memory)}`;

    // 2. Build live terminal state & RAG
    const context = await buildPlatformContext({
      userId,
      activeChain,
      currentMessage: message,
      systemGetters
    });

    // 3. Construct WhatsApp-style reply context if replyTo is provided
    let processedMessage = message;
    if (replyTo && replyTo.text) {
      const authorLabel = replyTo.author === 'user' ? 'TRADER' : 'FomoClix';
      processedMessage = `[Replying to ${authorLabel} (Message ID: ${replyTo.messageId}): "${replyTo.text}"]\n\nUser reply: "${message}"`;
    }

    // 4. Load AI API Keys
    let keys = {};
    if (db) {
      const aiConfigDoc = await db.collection('config').doc('ai').get();
      if (aiConfigDoc.exists) {
        keys = aiConfigDoc.data();
      }
    }
    if (!keys.geminiApiKey && process.env.GEMINI_API_KEY) {
      keys.geminiApiKey = process.env.GEMINI_API_KEY;
    }
    if (!keys.openaiApiKey && process.env.OPENAI_API_KEY) {
      keys.openaiApiKey = process.env.OPENAI_API_KEY;
    }

    // 5. Structure conversation dialogue
    const dialogue = history.map(h => ({
      role: h.role || (h.sender === 'user' ? 'user' : 'assistant'),
      content: h.text || h.content || ''
    }));
    dialogue.push({ role: 'user', content: processedMessage });

    // 6. Tool-calling Execution Loop (Max 5 turns)
    let turns = 0;
    let finalReply = '';
    let finalAudio = '';
    let actionBlock = null;

    while (turns < 5) {
      turns++;
      console.log(`🤖 AI OS: Generation turn ${turns}/5...`);
      
      const response = await generateAiResponse({
        messages: dialogue,
        tools: TOOL_SCHEMAS,
        systemPrompt,
        context,
        keys
      });

      if (!response) {
        // Fallback to offline rule-based responder
        const { getRuleBasedResponse } = require('./ai_orchestrator_fallback');
        finalReply = getRuleBasedResponse(message, context);
        break;
      }

      if (response.type === 'text') {
        finalReply = response.text;
        finalAudio = response.audio || '';
        break;
      }

      if (response.type === 'tool_call') {
        const { name, args, id } = response.toolCall;
        
        // Execute the tool call
        const toolResult = await executeToolCall(name, args, context);
        
        // If the tool return represents a trade/config proposal card, stop the loop and render it
        if (toolResult.actionRequired && toolResult.proposal) {
          actionBlock = toolResult.proposal;
          finalReply = `Proposing action: ${toolResult.proposal.title}. ${toolResult.proposal.description}`;
          break;
        }

        // Otherwise append the tool execution outcome to history and request model follow-up
        dialogue.push({
          role: 'assistant',
          content: `Calling tool ${name} with parameters: ${JSON.stringify(args)}`
        });
        dialogue.push({
          role: 'user',
          content: `[Tool Result for ${name}]: ${JSON.stringify(toolResult)}`
        });
      }
    }

    // 7. Format proposed action buttons if present
    if (actionBlock) {
      finalReply += `\n\n\`\`\`fomoclix-action\n${JSON.stringify(actionBlock, null, 2)}\n\`\`\``;
    }

    // 8. Log message history to Firestore
    if (db) {
      const messagesCol = db.collection('users')
        .doc(userId)
        .collection('chat_sessions')
        .doc(sessionId)
        .collection('messages');
      
      // Store user message
      await messagesCol.add({
        role: 'user',
        text: message,
        replyTo: replyTo || null,
        timestamp: new Date().toISOString()
      });

      // Store AI reply
      await messagesCol.add({
        role: 'assistant',
        text: finalReply,
        timestamp: new Date().toISOString(),
        tool_calls: actionBlock ? [actionBlock] : null
      });
    }

    res.json({ reply: finalReply, audio: finalAudio });

  } catch (err) {
    console.error('[AI Orchestrator Error]:', err);
    res.status(500).json({ error: err.message || String(err) });
  }
}

async function handleAiPreviewChat(req, res) {
  try {
    const { message, history = [] } = req.body;
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Enforce max 4 user messages limit
    const userMessageCount = history.filter(h => h.sender === 'user' || h.role === 'user').length;
    if (userMessageCount >= 4) {
      return res.json({
        reply: "Unlock unlimited AI by creating an account.",
        limitReached: true
      });
    }

    // 1. Structure prompt (preview: text chat only, no tools)
    const systemPrompt = `You are FomoClix, the advanced multi-chain agentic AI Trading Operating System (AI OS).
You are in PREVIEW mode. Speak to the user as a TRADER.
Provide helpful advice about memecoin scouting, contract security, portfolio math, and strategy parameters across Zora, Solana, and Base.
You cannot execute any tools or trades, and you do not have access to any wallet.
Answer concisely using clean markdown formatting.`;

    // 2. Load API Keys
    let keys = {};
    if (db) {
      const aiConfigDoc = await db.collection('config').doc('ai').get();
      if (aiConfigDoc.exists) {
        keys = aiConfigDoc.data();
      }
    }
    if (!keys.geminiApiKey && process.env.GEMINI_API_KEY) {
      keys.geminiApiKey = process.env.GEMINI_API_KEY;
    }

    // 3. Structure dialogue
    const dialogue = history.map(h => ({
      role: h.role || (h.sender === 'user' ? 'user' : 'assistant'),
      content: h.text || h.content || ''
    }));
    dialogue.push({ role: 'user', content: message });

    // 4. Generate response (No tools!)
    const response = await generateAiResponse({
      messages: dialogue,
      tools: [], // No tools allowed!
      systemPrompt,
      keys
    });

    const replyText = response ? response.text : "FomoClix AI is temporarily offline. Please try again later.";
    res.json({ reply: replyText, audio: response ? response.audio : '' });
  } catch (err) {
    console.error('[AI Preview Orchestrator Error]:', err);
    res.status(500).json({ error: err.message || String(err) });
  }
}

module.exports = {
  handleAiChat,
  handleAiPreviewChat,
  initOrchestrator
};
