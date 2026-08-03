/**
 * Base Protocol Adapter interface.
 * All chain/AMM integration adapters must extend this class.
 */
class ProtocolAdapter {
  constructor(chainId, protocolId) {
    this.chainId = chainId;
    this.protocolId = protocolId;
  }

  /**
   * Generates pricing quotes directly from AMM contract or routing API.
   * @param {string} inputToken 
   * @param {string} outputToken 
   * @param {string} inputAmount 
   * @param {number} slippageTolerance 
   * @returns {Promise<any>}
   */
  async getQuote(inputToken, outputToken, inputAmount, slippageTolerance) {
    throw new Error('Not implemented');
  }

  /**
   * Generates a raw transaction payload ready to be signed or executed.
   * @param {string} userAddress 
   * @param {any} quote 
   * @param {string} [walletPrivateKey] 
   * @returns {Promise<any>}
   */
  async buildSwapTransaction(userAddress, quote, walletPrivateKey) {
    throw new Error('Not implemented');
  }

  /**
   * Sends transaction to a priority RPC node, parses receipt, and returns unified status.
   * @param {any} signedTxPayload 
   * @returns {Promise<any>}
   */
  async executeTrade(signedTxPayload) {
    throw new Error('Not implemented');
  }

  /**
   * Scans and verifies pool security rules (Rug verification, honeypot analysis).
   * @param {string} tokenAddress 
   * @returns {Promise<{isHoneypot: boolean, liquidityLocked: boolean, creatorAlloc: number, score: number}>}
   */
  async getSecurityAudit(tokenAddress) {
    throw new Error('Not implemented');
  }
}

module.exports = ProtocolAdapter;
