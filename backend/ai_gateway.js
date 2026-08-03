/**
 * FOMOCLIX AI OS — AI Gateway
 * Connects directly to Google Gemini and OpenAI REST endpoints.
 * Implements fallback failover chain: Gemini ➔ OpenAI ➔ Offline Fallback.
 * Standardizes messages and tool-calling models.
 */

const fetch = globalThis.fetch || require('node-fetch');

// Model configuration
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

/**
 * Standardizes conversation history format for OpenAI.
 */
function formatMessagesForOpenAI(messages, systemPrompt, context) {
  const safeContextStr = JSON.stringify(context, (k, v) => typeof v === 'bigint' ? v.toString() : v);
  const result = [{ role: 'system', content: `${systemPrompt}\n\n[LIVE PLATFORM CONTEXT]\n${safeContextStr}` }];
  messages.forEach(m => {
    // Standard role mapping
    const role = m.role === 'model' || m.role === 'assistant' ? 'assistant' : 'user';
    result.push({ role, content: m.content });
  });
  return result;
}

/**
 * Standardizes conversation history format for Gemini.
 */
function formatContentsForGemini(messages) {
  return messages.map(m => {
    const role = m.role === 'assistant' || m.role === 'model' ? 'model' : 'user';
    return {
      role,
      parts: [{ text: m.content }]
    };
  });
}

/**
 * Executes a call to OpenAI API using raw HTTP fetch.
 */
async function callOpenAI(messages, tools, systemPrompt, context, apiKey) {
  const formattedMsgs = formatMessagesForOpenAI(messages, systemPrompt, context);
  const body = {
    model: OPENAI_MODEL,
    messages: formattedMsgs,
    temperature: 0.2
  };

  // Only append tools if they are defined and non-empty
  if (tools && tools.length > 0) {
    body.tools = tools.map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters
      }
    }));
    body.tool_choice = 'auto';
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI API Error (${response.status}): ${errText}`);
  }

  const json = await response.json();
  const choice = json.choices[0];
  
  if (choice.message.tool_calls && choice.message.tool_calls.length > 0) {
    // Map OpenAI tool call format to standardized format
    const toolCall = choice.message.tool_calls[0];
    return {
      type: 'tool_call',
      toolCall: {
        name: toolCall.function.name,
        args: JSON.parse(toolCall.function.arguments),
        id: toolCall.id
      }
    };
  }

  return {
    type: 'text',
    text: choice.message.content
  };
}

/**
 * Executes a call to Grok API using raw HTTP fetch.
 */
async function callGrok(messages, tools, systemPrompt, context, apiKey) {
  const formattedMsgs = formatMessagesForOpenAI(messages, systemPrompt, context);
  const body = {
    model: 'grok-beta',
    messages: formattedMsgs,
    temperature: 0.2
  };

  if (tools && tools.length > 0) {
    body.tools = tools.map(t => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters
      }
    }));
    body.tool_choice = 'auto';
  }

  const response = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Grok API Error (${response.status}): ${errText}`);
  }

  const json = await response.json();
  const choice = json.choices[0];
  
  if (choice.message.tool_calls && choice.message.tool_calls.length > 0) {
    const toolCall = choice.message.tool_calls[0];
    return {
      type: 'tool_call',
      toolCall: {
        name: toolCall.function.name,
        args: JSON.parse(toolCall.function.arguments),
        id: toolCall.id
      }
    };
  }

  return {
    type: 'text',
    text: choice.message.content
  };
}

/**
 * Executes a call to Gemini API using raw HTTP fetch.
 */
async function callGemini(messages, tools, systemPrompt, context, apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const contents = formatContentsForGemini(messages);
  
  const safeContextStr = JSON.stringify(context, (k, v) => typeof v === 'bigint' ? v.toString() : v);
  contents.push({
    role: 'user',
    parts: [{ text: `[LIVE PLATFORM CONTEXT]\n${safeContextStr}\n\nProcess the conversation and generate response.` }]
  });

  const body = {
    contents,
    systemInstruction: {
      parts: [{ text: systemPrompt }]
    },
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 1500,
      responseModalities: ["TEXT"]
    }
  };

  // Only append tools if defined
  if (tools && tools.length > 0) {
    body.tools = [{
      functionDeclarations: tools.map(t => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters
      }))
    }];
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini API Error (${response.status}): ${errText}`);
  }

  const json = await response.json();
  const candidate = json.candidates && json.candidates[0];
  if (!candidate || !candidate.content) {
    throw new Error('Empty response from Gemini API');
  }

  const part = candidate.content.parts[0];
  if (part.functionCall) {
    return {
      type: 'tool_call',
      toolCall: {
        name: part.functionCall.name,
        args: part.functionCall.args,
        id: 'gemini-call-' + Date.now()
      }
    };
  }

  return {
    type: 'text',
    text: part.text
  };
}

/**
 * Converts Linear 16-bit PCM (audio/l16) base64 to standard WAV base64.
 */
function pcmToWav(pcmBase64, sampleRate = 24000) {
  const pcmBytes = Buffer.from(pcmBase64, 'base64');
  const wavHeader = Buffer.alloc(44);
  
  wavHeader.write('RIFF', 0);
  wavHeader.writeUInt32LE(36 + pcmBytes.length, 4);
  wavHeader.write('WAVE', 8);
  
  wavHeader.write('fmt ', 12);
  wavHeader.writeUInt32LE(16, 16);
  wavHeader.writeUInt16LE(1, 20); // PCM
  wavHeader.writeUInt16LE(1, 22); // Mono
  wavHeader.writeUInt32LE(sampleRate, 24);
  wavHeader.writeUInt32LE(sampleRate * 2, 28);
  wavHeader.writeUInt16LE(2, 32);
  wavHeader.writeUInt16LE(16, 34); // 16-bit
  
  wavHeader.write('data', 36);
  wavHeader.writeUInt32LE(pcmBytes.length, 40);
  
  const wavBytes = Buffer.concat([wavHeader, pcmBytes]);
  return wavBytes.toString('base64');
}

/**
 * Generates natural human-sounding base64 audio response from text input.
 */
async function generateAudioFromText(text, apiKey) {
  if (!text) return '';
  // Strip markdown formatting characters to prevent text reading bugs
  const cleanText = text
    .replace(/\*\*([\s\S]*?)\*\*/g, '$1')
    .replace(/\*([\s\S]*?)\*/g, '$1')
    .replace(/`/g, '')
    .trim();
  if (!cleanText) return '';

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-tts-preview:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: `Please read the following text in your natural voice: ${cleanText}` }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: "Aoede"
              }
            }
          }
        }
      })
    });
    
    if (!res.ok) {
      const errText = await res.text();
      console.warn(`[TTS] Gemini Audio API error (${res.status}):`, errText);
      return '';
    }
    const data = await res.json();
    const inlineData = data.candidates?.[0]?.content?.parts?.[0]?.inlineData;
    if (inlineData && inlineData.data) {
      return pcmToWav(inlineData.data, 24000);
    }
  } catch (err) {
    console.error('[TTS] Audio generation failed:', err.message);
  }
  return '';
}

/**
 * Main AI Gateway router with fallback failover logic.
 */
async function generateAiResponse({ messages, tools, systemPrompt, context, keys = {} }) {
  const geminiKey = keys.geminiApiKey || process.env.GEMINI_API_KEY;
  const openaiKey = keys.openaiApiKey || process.env.OPENAI_API_KEY;
  const xaiKey = keys.xaiApiKey || process.env.XAI_API_KEY;

  let result = null;

  // Decide model routing based on user task/messages
  const lastMessage = messages[messages.length - 1]?.content || '';
  const isComplexReasoning = lastMessage.toLowerCase().includes('strategy') || 
                             lastMessage.toLowerCase().includes('performance') ||
                             lastMessage.toLowerCase().includes('calculate');

  // Try Grok first if request is complex, or fallback to OpenAI
  if (isComplexReasoning && xaiKey) {
    console.log('🤖 AI Gateway: Routing complex request to Grok xAI...');
    try {
      result = await callGrok(messages, tools, systemPrompt, context, xaiKey);
    } catch (err) {
      console.warn('⚠️ Grok call failed. Falling back to Gemini...', err.message);
    }
  }

  // Primary Router: Gemini
  if (!result && geminiKey) {
    console.log('🤖 AI Gateway: Routing request to Gemini Flash...');
    try {
      result = await callGemini(messages, tools, systemPrompt, context, geminiKey);
    } catch (err) {
      console.warn('⚠️ Gemini call failed. Falling back to Grok...', err.message);
    }
  }

  // Secondary Router: Grok (Fallback)
  if (!result && xaiKey) {
    console.log('🤖 AI Gateway: Falling back to Grok xAI...');
    try {
      result = await callGrok(messages, tools, systemPrompt, context, xaiKey);
    } catch (err) {
      console.warn('⚠️ Grok fallback failed. Trying OpenAI...', err.message);
    }
  }

  // Tertiary Router: OpenAI (Fallback)
  if (!result && openaiKey) {
    console.log('🤖 AI Gateway: Falling back to OpenAI GPT...');
    try {
      result = await callOpenAI(messages, tools, systemPrompt, context, openaiKey);
    } catch (err) {
      console.error('❌ OpenAI fallback failed:', err.message);
    }
  }

  // Post-process text to add high quality native human audio voice if geminiKey is available
  if (result && result.type === 'text' && geminiKey) {
    console.log('🗣️ AI Gateway: Generating natural human audio voice using gemini-3.1-flash-tts-preview...');
    const audioData = await generateAudioFromText(result.text, geminiKey);
    if (audioData) {
      result.audio = audioData;
    }
  }

  return result;
}

module.exports = {
  generateAiResponse
};
