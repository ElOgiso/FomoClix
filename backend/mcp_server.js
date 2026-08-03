/**
 * FOMOCLIX AI OS — Model Context Protocol (MCP) Express Router
 * Exposes platform tools and executors via standardized MCP endpoints.
 */

const express = require('express');
const router = express.Router();
const { TOOL_SCHEMAS, executeToolCall } = require('./tool_registry');
const { buildPlatformContext } = require('./context_builder');

// Get global system getters injected on initialization
let mcpSystemGetters = {};

function initMcpServer(getters) {
  mcpSystemGetters = getters;
}

/**
 * GET /mcp/tools
 * Lists all registered tools with standard descriptions and schemas.
 */
router.get('/tools', (req, res) => {
  res.json({
    tools: TOOL_SCHEMAS.map(schema => ({
      name: schema.name,
      description: schema.description,
      inputSchema: schema.parameters
    }))
  });
});

/**
 * POST /mcp/execute
 * Executes a specific tool with parameter arguments.
 */
router.post('/execute', async (req, res) => {
  try {
    const { name, arguments: args, activeChain = 'zora' } = req.body;
    const userId = req.user?.uid || 'default_user';

    if (!name) {
      return res.status(400).json({ error: 'Tool name is required' });
    }

    // 1. Gather live terminal context
    const context = await buildPlatformContext({
      userId,
      activeChain,
      currentMessage: `Running MCP Tool: ${name}`,
      systemGetters: mcpSystemGetters
    });

    // 2. Execute the tool call
    const result = await executeToolCall(name, args || {}, context);
    res.json({ result });

  } catch (err) {
    console.error('[MCP Tool Server Error]:', err);
    res.status(500).json({ error: err.message || String(err) });
  }
});

module.exports = {
  mcpRouter: router,
  initMcpServer
};
