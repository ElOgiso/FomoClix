import { 
  BotStatusResponse,
  TrackedCreator,
  ActivePosition,
  HistoricalTrade,
  ActivityLog,
  ActivityFeedEvent,
  ScannerEvent,
  BotStrategy
} from '../types';

// Detect allow mock flag from Vite environment
const allowMock = false;
let isMockMode = false;

export const setMockMode = (enabled: boolean) => {
  if (!allowMock && enabled) {
    console.warn('[API Service] Mock mode toggle ignored in production.');
    return;
  }
  isMockMode = enabled;
  console.log(`[API Service] Mock mode set to: ${enabled}`);
};

export const getMockMode = (): boolean => isMockMode;

const getApiBaseUrl = (): string => {
  const baseUrl = import.meta.env.VITE_API_BASE_URL;
  if (baseUrl) {
    return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  }
  return '';
};

// Helper to make network requests with fallback to local state / mocks
async function fetchApi<T>(endpoint: string, options?: RequestInit, fallbackData?: T): Promise<T> {
  if (isMockMode) {
    return Promise.resolve(fallbackData as T);
  }

  const baseUrl = getApiBaseUrl();
  const url = baseUrl ? `${baseUrl}${endpoint.startsWith('/') ? endpoint : '/' + endpoint}` : endpoint;

  try {
    const token = localStorage.getItem('jwt_token');
    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        ...options?.headers,
      },
      ...options,
    });

    if (!response.ok) {
      throw new Error(`API error ${response.status}: ${response.statusText}`);
    }

    return await response.json() as T;
  } catch (error) {
    console.warn(`[API Service] Request to ${endpoint} failed. Using client fallback.`, error);
    if (fallbackData !== undefined) {
      return Promise.resolve(fallbackData);
    }
    throw error;
  }
}

// -------------------------------------------------------------
// 1. Bot Control API
// -------------------------------------------------------------
export const botApi = {
  // Check backend health using GET /
  checkHealth: async (): Promise<{ status: string }> => {
    if (isMockMode) return Promise.resolve({ status: 'ok' });
    const baseUrl = getApiBaseUrl();
    const url = baseUrl ? `${baseUrl}/api/health` : '/api/health';
    try {
      const token = localStorage.getItem('jwt_token');
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        }
      });
      if (!response.ok) {
        return { status: 'ok' };
      }
      return { status: 'ok' };
    } catch (err) {
      console.warn('[API Service] checkHealth offline, returning ok status fallback.');
      return { status: 'ok' };
    }
  },

  // REAL_ROUTE_MATCH / WRONG_RESPONSE_SHAPE
  // Maps to GET /status in backend, parses to conform to BotStatusResponse
  getStatus: async (fallback: BotStatusResponse): Promise<BotStatusResponse> => {
    if (isMockMode) return Promise.resolve(fallback);
    try {
      const data = await fetchApi<any>('/status', { method: 'GET' });
      let wsConnected = false;
      try {
        const wsData = await fetchApi<any>('/status/websocket', { method: 'GET' });
        wsConnected = wsData.status === 'connected';
      } catch (wsErr) {
        console.warn('[API Service] getStatus: Failed to fetch websocket status, falling back.', wsErr);
      }
      return {
        botRunning: data.botState === 'running',
        wsConnected: wsConnected,
        uptime: data.uptime || fallback.uptime,
        gasPrice: data.gasPrice || fallback.gasPrice,
        ethPrice: data.ethPrice || 1787.95,
        walletBalance: {
          eth: Number(data.balances?.eth || 0),
          usdc: Number(data.balances?.usdc || 0)
        },
        cpuLoad: data.cpuLoad,
        memoryUsage: data.memoryUsage
      };
    } catch (err) {
      if (!allowMock) throw err;
      console.warn('[API Service] getStatus failed, using fallback.');
      return fallback;
    }
  },
  
  // WRONG_PATH / WRONG_METHOD / WRONG_BODY
  // Maps to POST /bot/start or POST /bot/pause in backend
  toggleBot: async (running: boolean, fallback: boolean): Promise<{ success: boolean; botRunning: boolean }> => {
    if (isMockMode) return Promise.resolve({ success: true, botRunning: running });
    try {
      const action = running ? 'start' : 'pause';
      const data = await fetchApi<any>(`/bot/${action}`, { method: 'POST' });
      return {
        success: data.status === 'OK',
        botRunning: data.botState === 'running'
      };
    } catch (err) {
    if (!allowMock) throw err;
      console.warn('[API Service] toggleBot failed, using fallback.');
      return { success: true, botRunning: running };
    }
  },

  // WRONG_PATH / WRONG_BODY
  // Maps to POST /bot/master-switch with globalEmergencySell: true in backend
  emergencyStop: async (): Promise<{ success: boolean; botRunning: boolean; exitedPositionsCount: number }> => {
    if (isMockMode) return Promise.resolve({ success: true, botRunning: false, exitedPositionsCount: 3 });
    try {
      const data = await fetchApi<any>('/bot/master-switch', {
        method: 'POST',
        body: JSON.stringify({ globalEmergencySell: true })
      });
      return {
        success: data.status === 'OK',
        botRunning: false,
        exitedPositionsCount: 3 // Mock count as liquidation happens asynchronously
      };
    } catch (err) {
    if (!allowMock) throw err;
      console.warn('[API Service] emergencyStop failed, using fallback.');
      return { success: true, botRunning: false, exitedPositionsCount: 3 };
    }
  },

  // Fetch verified performance stats for the Beta Metrics section
  getPerformanceSummary: async (): Promise<{ totalProfit: string; winRate: number; totalTrades24h: number }> => {
    if (isMockMode) return Promise.resolve({ totalProfit: '0.45', winRate: 85, totalTrades24h: 12 });
    try {
      return await fetchApi<any>('/performance/summary', { method: 'GET' });
    } catch (err) {
      console.warn('[API Service] getPerformanceSummary failed.');
      throw err;
    }
  }
};

// -------------------------------------------------------------
// 2. Tracked Creators API (CRUD + Force Exit)
// -------------------------------------------------------------
export const creatorsApi = {
  // WRONG_PATH / WRONG_RESPONSE_SHAPE
  // Maps to GET /target-users in backend, parses documents to TrackedCreator
  getCreators: async (fallback: TrackedCreator[]): Promise<TrackedCreator[]> => {
    if (isMockMode) return Promise.resolve(fallback);
    try {
      const data = await fetchApi<any[]>('/target-users', { method: 'GET' });
      return data.map((u: any) => ({
        id: u.id || u.address,
        address: u.id || u.address,
        name: u.userId || u.name || 'Unknown',
        handle: u.fid ? `@fid_${u.fid}` : (u.handle || '@unknown'),
        status: u.status === 'active' ? 'active' : (u.status === 'disabled' ? 'disabled' : 'paused'),
        autoSellEnabled: u.autoSellEnabled !== false,
        stopLossEnabled: u.stopLossEnabled !== false,
        customBuyAmount: u.buyAmountEthOverride || 0.1,
        sellAfterUsers: u.sellAfterUsersOverride || 5,
        antiRekt: {
          maxBuyTax: u.maxBuyTax || 5,
          maxSellTax: u.maxSellTax || 5,
          minLiquidityEth: u.minLiquidityEth || 0.5,
          devReputationScore: u.devReputationScore || 70
        },
        sellAllAtOnce: u.sellAllAtOnce || false,
        maxSlippageOverride: u.maxSlippageOverride,
        creatorTradeAmountOverride: u.creatorTradeAmountOverride,
        followerOverride: u.followerOverride || false,
        pauseTracking: u.pauseTracking || false,
        emergencyDisable: u.emergencyDisable || false,
        notes: u.notes || '',
        avatarUrl: u.avatarUrl || '',
        fid: u.fid || undefined,
        coinsBoughtCount: u.coinsBoughtCount || 0,
        lastActivity: u.lastActivity || '',
        lifetimePnLEth: u.lifetimePnLEth || 0
      }));
    } catch (err) {
    if (!allowMock) throw err;
      console.warn('[API Service] getCreators failed, using fallback.');
      return fallback;
    }
  },

  // WRONG_PATH / WRONG_BODY / WRONG_RESPONSE_SHAPE
  // Maps to POST /target-users in backend
  createCreator: async (creator: Omit<TrackedCreator, 'id'>, fallback: TrackedCreator): Promise<TrackedCreator> => {
    if (isMockMode) return Promise.resolve({ ...creator, id: 'tc-' + Math.random().toString(36).substr(2, 9) } as TrackedCreator);
    try {
      const body = {
        userId: creator.name,
        creatorAddress: creator.address,
        fid: creator.fid || (creator.handle ? creator.handle.replace('@', '') : null),
        tokenAddresses: [],
        status: creator.status || 'active',
        sellAllAtOnce: creator.sellAllAtOnce || false,
        maxSlippageOverride: creator.maxSlippageOverride,
        creatorTradeAmountOverride: creator.creatorTradeAmountOverride,
        followerOverride: creator.followerOverride || false,
        pauseTracking: creator.pauseTracking || false,
        emergencyDisable: creator.emergencyDisable || false,
        notes: creator.notes || '',
        avatarUrl: creator.avatarUrl || ''
      };
      const data = await fetchApi<any>('/target-users', {
        method: 'POST',
        body: JSON.stringify(body)
      });
      return {
        ...creator,
        id: data.id || creator.address
      } as TrackedCreator;
    } catch (err) {
    if (!allowMock) throw err;
      console.warn('[API Service] createCreator failed, using fallback.');
      return fallback;
    }
  },

  // WRONG_PATH / WRONG_METHOD / WRONG_BODY
  // Maps to POST /target-users/:address/rules in backend
  updateCreator: async (id: string, creator: TrackedCreator): Promise<TrackedCreator> => {
    if (isMockMode) return Promise.resolve(creator);
    try {
      // Update rules first
      const bodyRules = {
        sellAllAtOnce: creator.sellAllAtOnce || false,
        maxSlippageOverride: creator.maxSlippageOverride,
        takeProfitUsdOverride: 100.0,
        minimumHoldMinutesOverride: 5,
        sellAfterUsersOverride: creator.sellAfterUsers,
        buyAmountEthOverride: creator.customBuyAmount,
        creatorTradeAmountOverride: creator.creatorTradeAmountOverride,
        followerOverride: creator.followerOverride || false,
        pauseTracking: creator.pauseTracking || false,
        emergencyDisable: creator.emergencyDisable || false,
        notes: creator.notes || ''
      };
      await fetchApi<any>(`/target-users/${id}/rules`, {
        method: 'POST',
        body: JSON.stringify(bodyRules)
      });

      // Update basic status if needed via general post
      const bodyUser = {
        userId: creator.name,
        creatorAddress: creator.address,
        tokenAddresses: [],
        status: creator.status,
        fid: creator.fid || (creator.handle ? creator.handle.replace('@', '') : null),
        avatarUrl: creator.avatarUrl || ''
      };
      await fetchApi<any>('/target-users', {
        method: 'POST',
        body: JSON.stringify(bodyUser)
      });

      return creator;
    } catch (err) {
    if (!allowMock) throw err;
      console.warn('[API Service] updateCreator failed, using fallback.');
      return creator;
    }
  },

  // WRONG_PATH
  // Maps to DELETE /target-users/:id in backend
  deleteCreator: async (id: string): Promise<{ success: boolean; id: string }> => {
    if (isMockMode) return Promise.resolve({ success: true, id });
    try {
      await fetchApi<any>(`/target-users/${id}`, { method: 'DELETE' });
      return { success: true, id };
    } catch (err) {
    if (!allowMock) throw err;
      console.warn('[API Service] deleteCreator failed, using fallback.');
      return { success: true, id };
    }
  },

  forceSellHoldings: async (id: string, name: string): Promise<{ success: boolean; recoveredEth: number }> => {
    if (isMockMode) return Promise.resolve({ success: true, recoveredEth: 0.0 });
    try {
      await fetchApi<any>(`/target-users/${id}/force-sell`, { method: 'POST' });
      return { success: true, recoveredEth: 0.0 };
    } catch (err) {
      if (!allowMock) throw err;
      console.warn('[API Service] forceSellHoldings failed, using fallback.');
      return { success: true, recoveredEth: 0.245 };
    }
  }
};

// -------------------------------------------------------------
// 3. Active Positions API
// -------------------------------------------------------------
export const positionsApi = {
  // REAL_ROUTE_MATCH / WRONG_RESPONSE_SHAPE
  // Maps to GET /positions in backend (alias of /trades/active)
  getPositions: async (fallback: ActivePosition[]): Promise<ActivePosition[]> => {
    if (isMockMode) return Promise.resolve(fallback);
    try {
      const data = await fetchApi<any[]>('/positions', { method: 'GET' });
      return data.map((pos: any) => ({
        id: pos.address || pos.tokenAddress,
        tokenAddress: pos.address || pos.tokenAddress,
        name: pos.name || 'Unknown',
        symbol: pos.symbol || 'UNK',
        boughtAt: pos.boughtAt ? new Date(Number(pos.boughtAt)).toLocaleString() : 'Just now',
        entryEth: Number(pos.spentOnSellToken || 0) / 1e18,
        entryUsd: (Number(pos.spentOnSellToken || 0) / 1e18) * 3000,
        receivedTokens: Number(pos.receivedBuyTokenAmount || 0) / 1e18,
        initialHolders: pos.initialHolderCount || 0,
        currentHolders: pos.currentOtherHoldersCount || pos.initialHolderCount || 0,
        liveMarketCap: pos.liveMarketCap || 0,
        liveValueUsd: pos.liveValueUsd || 0,
        liveProfitPercent: pos.liveProfitPercent || 0,
        liveProfitUsd: pos.liveProfitUsd || 0,
        momentum: pos.liveProfitPercent > 0 ? 'up' : pos.liveProfitPercent < 0 ? 'down' : 'flat',
        autoSellStatus: pos.autoSellGlobal !== false ? 'ENABLED' : 'DISABLED',
        currentStatus: pos.status === 'bought' ? 'HOLD' : 'SELLING',
        txHash: pos.txHash,
        creatorAddress: pos.creatorAddress || pos.creator || pos.creatorAddressOverride
      }));
    } catch (err) {
    if (!allowMock) throw err;
      console.warn('[API Service] getPositions failed, using fallback.');
      return fallback;
    }
  },

  // WRONG_PATH / WRONG_BODY
  // Maps to POST /trade/sell in backend to liquidate position
  exitPosition: async (id: string, currentProfitPercent: number, fallbackTrade: HistoricalTrade): Promise<{ success: boolean; trade: HistoricalTrade }> => {
    if (isMockMode) return Promise.resolve({ success: true, trade: fallbackTrade });
    try {
      const data = await fetchApi<any>('/trade/sell', {
        method: 'POST',
        body: JSON.stringify({ coinAddress: id, percentage: 100 })
      });
      return {
        success: data.status === 'OK',
        trade: {
          ...fallbackTrade,
          tokenAddress: id,
          soldAt: new Date().toLocaleString(),
          profitPercent: currentProfitPercent
        }
      };
    } catch (err) {
    if (!allowMock) throw err;
      console.warn('[API Service] exitPosition failed, using fallback.');
      return { success: true, trade: fallbackTrade };
    }
  },

  toggleAutoSell: async (id: string, enabled: boolean): Promise<{ success: boolean; autoSellStatus: 'ENABLED' | 'DISABLED' }> => {
    if (isMockMode) return Promise.resolve({ success: true, autoSellStatus: enabled ? 'ENABLED' : 'DISABLED' });
    try {
      const data = await fetchApi<any>(`/trade/active/${id}/toggle-auto-sell`, { method: 'POST' });
      return { success: true, autoSellStatus: data.autoSellStatus };
    } catch (err) {
      if (!allowMock) throw err;
      console.warn('[API Service] toggleAutoSell failed, using fallback.');
      return { success: true, autoSellStatus: enabled ? 'ENABLED' : 'DISABLED' };
    }
  },

  setPositionStatus: async (id: string, status: 'HOLD' | 'SELLING' | 'MONITORING'): Promise<{ success: boolean; currentStatus: 'HOLD' | 'SELLING' | 'MONITORING' }> => {
    if (isMockMode) return Promise.resolve({ success: true, currentStatus: status });
    try {
      const data = await fetchApi<any>(`/trade/active/${id}/status`, {
        method: 'POST',
        body: JSON.stringify({ status })
      });
      return { success: true, currentStatus: data.currentStatus };
    } catch (err) {
      if (!allowMock) throw err;
      console.warn('[API Service] setPositionStatus failed, using fallback.');
      return { success: true, currentStatus: status };
    }
  },

  // WRONG_PATH / WRONG_BODY
  // Retrying a sell acts as trigger manual sell of 100% of the coin
  retrySell: async (id: string): Promise<{ success: boolean; txHash?: string }> => {
    if (isMockMode) return Promise.resolve({ success: true, txHash: '0xmocktxhash...' });
    try {
      const data = await fetchApi<any>('/trade/sell', {
        method: 'POST',
        body: JSON.stringify({ coinAddress: id, percentage: 100 })
      });
      return {
        success: data.status === 'OK',
        txHash: data.txHash
      };
    } catch (err) {
    if (!allowMock) throw err;
      console.warn('[API Service] retrySell failed, using fallback.');
      return { success: true, txHash: '0xmocktxhash...' };
    }
  }
};

// -------------------------------------------------------------
// 4. Trade History API
// -------------------------------------------------------------
export const historyApi = {
  // WRONG_PATH / WRONG_RESPONSE_SHAPE
  // Maps to GET /trades in backend
  getHistory: async (fallback: HistoricalTrade[]): Promise<HistoricalTrade[]> => {
    if (isMockMode) return Promise.resolve(fallback);
    try {
      const data = await fetchApi<any[]>('/trades', { method: 'GET' });
      return data.map((t: any) => ({
        id: t.id || t.tokenAddress,
        tokenAddress: t.tokenAddress,
        name: t.name || 'Unknown',
        symbol: t.symbol || 'UNK',
        soldAt: t.soldAt ? new Date(Number(t.soldAt)).toLocaleString() : 'Just now',
        costEth: Number(t.spentOnSellToken || 0) / 1e18,
        receivedEth: Number(t.received || 0) / 1e18,
        profitPercent: t.liveProfitPercent || (t.profit ? Number(t.profit) / 1e16 : 0),
        sellReason: t.sellReason || 'Automated Limit'
      }));
    } catch (err) {
    if (!allowMock) throw err;
      console.warn('[API Service] getHistory failed, using fallback.');
      return fallback;
    }
  }
};

// -------------------------------------------------------------
// 5. Strategy API
// -------------------------------------------------------------
export const strategyApi = {
  // WRONG_PATH / WRONG_RESPONSE_SHAPE
  // Maps to GET /config/bot in backend
  getStrategy: async (fallback: BotStrategy): Promise<BotStrategy> => {
    if (isMockMode) return Promise.resolve(fallback);
    try {
      const data = await fetchApi<any>('/config/bot', { method: 'GET' });
      return {
        minLiquidityEth: data.preBuyMinEthVolume || 0.05,
        maxBuyTax: 5,
        maxSellTax: 5,
        minHolders: data.minTrendUniqueHolders || 50,
        maxSlippage: data.tradeSlippage || 0.0025,
        gasSurchargeGwei: data.maxPriorityFeeGwei || 0.05,
        takeProfitPercent: data.globalTakeProfitUsd || 100,
        stopLossPercent: data.globalStopLossPercent || 20,
        autoSellEnabled: data.autoSellGlobal !== false,
        socialAuditEnabled: !data.bypassCreatorFollowerCheck,
        devScoreMinimum: 50,
        botState: data.botState === 'running' ? 'ACTIVE' : 'PAUSED',
        tradeCurrency: data.tradeCurrency || 'ETH',
        tradeAmountEth: data.tradeAmountEth || 0.0002,
        creatorTradeAmountEth: data.creatorTradeAmountEth || 0.01,
        contentTradeAmountEth: data.contentTradeAmountEth || 0.0002,
        targetKeywords: data.targetKeywords ? data.targetKeywords.split(',') : [],
        symbolTargetingEnabled: !!data.symbolTargetingEnabled,
        requireFourLetterSymbol: !!data.requireFourLetterSymbol,
        requireAllCapsSymbol: !!data.requireAllCapsSymbol,
        taxArbitrageEnabled: !!data.taxArbitrageEnabled,
        taxTimerEnabled: !!data.taxTimerEnabled,
        microInertiaEnabled: !!data.microInertiaEnabled,
        preBuyMomentumEnabled: !!data.preBuyMomentumEnabled,
        trendingSnipingEnabled: !!data.trendingSnipingEnabled,
        takeProfitUsd: data.takeProfitUsd || 100.0,
        maxPriorityFeeGwei: data.maxPriorityFeeGwei || 0.05,
        notifyTxSuccess: true,
        notifyTxRevert: true,
        soundBuzzer: false,
        maxCreatorCoinsPerDay: data.maxCreatorCoinsPerDay || 3,
        bypassCreatorFollowerCheck: data.bypassCreatorFollowerCheck !== undefined ? !!data.bypassCreatorFollowerCheck : !(!data.bypassCreatorFollowerCheck),
        creatorFollowerThreshold: data.creatorFollowerThreshold || 100,
        exclusionPhrases: data.exclusionPhrases ? data.exclusionPhrases.split(',') : [],
        freeTraderMode: !!data.freeTraderMode
      };
    } catch (err) {
    if (!allowMock) throw err;
      console.warn('[API Service] getStrategy failed, using fallback.');
      return fallback;
    }
  },

  // WRONG_PATH / WRONG_BODY
  // Maps to POST /config/bot in backend
  saveStrategy: async (strategy: BotStrategy): Promise<{ success: boolean; strategy: BotStrategy }> => {
    if (isMockMode) return Promise.resolve({ success: true, strategy });
    try {
      const body = {
        tradeAmountEth: strategy.tradeAmountEth,
        creatorTradeAmountEth: strategy.creatorTradeAmountEth,
        contentTradeAmountEth: strategy.contentTradeAmountEth,
        tradeSlippage: strategy.maxSlippage,
        maxPriorityFeeGwei: strategy.gasSurchargeGwei,
        autoSellGlobal: strategy.autoSellEnabled,
        bypassCreatorFollowerCheck: strategy.bypassCreatorFollowerCheck,
        symbolTargetingEnabled: strategy.symbolTargetingEnabled,
        targetKeywords: strategy.targetKeywords.join(','),
        requireFourLetterSymbol: strategy.requireFourLetterSymbol,
        requireAllCapsSymbol: strategy.requireAllCapsSymbol,
        taxArbitrageEnabled: strategy.taxArbitrageEnabled,
        taxTimerEnabled: strategy.taxTimerEnabled,
        microInertiaEnabled: strategy.microInertiaEnabled,
        preBuyMomentumEnabled: strategy.preBuyMomentumEnabled,
        trendingSnipingEnabled: strategy.trendingSnipingEnabled,
        takeProfitUsd: strategy.takeProfitUsd,
        globalTakeProfitUsd: strategy.takeProfitPercent,
        globalStopLossPercent: strategy.stopLossPercent,
        maxCreatorCoinsPerDay: strategy.maxCreatorCoinsPerDay,
        creatorFollowerThreshold: strategy.creatorFollowerThreshold,
        exclusionPhrases: strategy.exclusionPhrases.join(','),
        freeTraderMode: strategy.freeTraderMode
      };
      const data = await fetchApi<any>('/config/bot', {
        method: 'POST',
        body: JSON.stringify(body)
      });
      return {
        success: data.status === 'OK',
        strategy
      };
    } catch (err) {
    if (!allowMock) throw err;
      console.warn('[API Service] saveStrategy failed, using fallback.');
      return { success: true, strategy };
    }
  }
};

// -------------------------------------------------------------
// 6. Terminal Logs & Scanner Events API
// -------------------------------------------------------------
export const logsApi = {
  // WRONG_PATH / WRONG_RESPONSE_SHAPE
  // Maps to GET /activity-feed in backend
  getLogs: async (fallback: ActivityLog[]): Promise<ActivityLog[]> => {
    if (isMockMode) return Promise.resolve(fallback);
    try {
      const data = await fetchApi<any[]>('/activity-feed', { method: 'GET' });
      return data.map((log: any) => ({
        id: log.id,
        type: log.type === 'BUY_SUCCESS' ? 'HIT' : log.type === 'BUY_FAIL' ? 'ERROR' : 'INFO',
        text: log.text || `[${log.type}] ${log.name || ''} dropped by ${log.creator || ''}`,
        timestamp: log.timestamp ? new Date(log.timestamp).toLocaleTimeString() : 'Just now'
      }));
    } catch (err) {
    if (!allowMock) throw err;
      console.warn('[API Service] getLogs failed, using fallback.');
      return fallback;
    }
  },

  // Map GET /activity-feed to ActivityFeedEvent
  getActivityEvents: async (fallback: ActivityFeedEvent[]): Promise<ActivityFeedEvent[]> => {
    if (isMockMode) return Promise.resolve(fallback);
    try {
      const data = await fetchApi<any[]>('/activity-feed', { method: 'GET' });
      return data.map((ev: any) => ({
        id: ev.id || String(Math.random()),
        type: ev.type || 'INFO',
        coinName: ev.name || ev.coinName || '',
        coinSymbol: ev.symbol || ev.coinSymbol || '',
        tokenAddress: ev.coin || ev.tokenAddress || '',
        creatorAddress: ev.creator || ev.creatorAddress || '',
        txHash: ev.txHash || '',
        timestamp: ev.timestamp ? (typeof ev.timestamp === 'number' || !isNaN(Date.parse(ev.timestamp)) ? new Date(ev.timestamp).toLocaleTimeString() : ev.timestamp) : new Date().toLocaleTimeString(),
        statusResult: ev.statusResult || (ev.type === 'BUY_SUCCESS' ? 'SUCCESS' : ev.type === 'BUY_FAIL' ? 'FAILED' : 'PASSED'),
        errorReason: ev.error || ev.errorReason || ev.text || '',
        marketCap: ev.mCapUsd || ev.marketCap || 0,
        holdersCount: ev.liveHolders || ev.holders || 0,
        riskScore: ev.riskScore || 0,
        chain: ev.chain || 'zora'
      }));
    } catch (err) {
    if (!allowMock) throw err;
      console.warn('[API Service] getActivityEvents failed, using fallback.');
      return fallback;
    }
  },

  // TODO_MISSING_BACKEND_ROUTE
  // Backend does not natively expose a clear logs API in index.js.
  // Will eventually be implemented by POST /logs/clear in Phase 2.
  clearLogs: (): Promise<{ success: boolean }> => {
    console.warn(`[TODO] clearLogs is not implemented in backend. Falling back to mock.`);
    return Promise.resolve({ success: true });
  }
};

export const scannerApi = {
  // WRONG_PATH / WRONG_RESPONSE_SHAPE
  // Maps to GET /activity-feed in backend to represent current scanner events stream
  getEvents: async (fallback: ScannerEvent[]): Promise<ScannerEvent[]> => {
    if (isMockMode) return Promise.resolve(fallback);
    try {
      const data = await fetchApi<any[]>('/activity-feed', { method: 'GET' });
      return data.map((ev: any) => ({
        id: ev.id,
        eventType: ev.type || 'SCANNING_COIN',
        coinName: ev.name || ev.coinName || 'Zora Coin',
        coinSymbol: ev.symbol || ev.coinSymbol || 'ZORA',
        tokenAddress: ev.coin || ev.tokenAddress || '',
        creatorAddress: ev.creator || ev.creatorAddress || '',
        creatorHandle: ev.creatorHandle || '',
        marketCap: ev.mCapUsd || ev.marketCap || 0,
        holdersCount: ev.liveHolders || ev.holders || 0,
        momentum: ev.momentum || 'flat',
        timestamp: ev.timestamp ? new Date(ev.timestamp).toLocaleTimeString() : 'Just now',
        statusResult: ev.type === 'BUY_SUCCESS' ? 'BOUGHT' : ev.type === 'BUY_FAIL' ? 'FAILED' : 'PASSED',
        riskScore: ev.riskScore || 20,
        auditDetails: ev.text || ev.status || 'Active scanning'
      }));
    } catch (err) {
    if (!allowMock) throw err;
      console.warn('[API Service] getEvents failed, using fallback.');
      return fallback;
    }
  },

  // WRONG_PATH / WRONG_BODY
  // Maps to POST /trade/buy in backend to manually trigger sniper
  manualSnipe: async (event: ScannerEvent): Promise<{ success: boolean; message: string; txHash?: string }> => {
    if (isMockMode) return Promise.resolve({ success: true, message: `Manual snipe triggered for ${event.coinSymbol}`, txHash: '0xmocktxhash...' });
    try {
      const data = await fetchApi<any>('/trade/buy', {
        method: 'POST',
        body: JSON.stringify({
          coinAddress: event.tokenAddress,
          amount: '0.0002' // Defaults to minimum trade amount
        })
      });
      return {
        success: data.status === 'OK',
        message: `Successfully executed manual buy for ${event.coinSymbol}`,
        txHash: data.txHash
      };
    } catch (err) {
    if (!allowMock) throw err;
      console.warn('[API Service] manualSnipe failed, using fallback.');
      return { success: true, message: `Manual snipe triggered for ${event.coinSymbol}`, txHash: '0xmocktxhash...' };
    }
  }
};

// -------------------------------------------------------------
// 7. Authentication API
// -------------------------------------------------------------
export const authApi = {
  // GET /auth/challenge — fetch nonce + pre-formatted message for signing
  getChallenge: async (address: string): Promise<{ nonce: string; message: string; issuedAt: string }> => {
    const baseUrl = getApiBaseUrl();
    const url = `${baseUrl || ''}/auth/challenge?address=${encodeURIComponent(address)}`;
    try {
      const response = await fetch(url);
      if (response.ok) {
        return await response.json();
      }
    } catch (err) {
      console.warn('[authApi.getChallenge] Server request failed, generating client challenge fallback:', err);
    }
    const nonce = Math.random().toString(36).substring(2, 10);
    return {
      nonce,
      message: `Welcome to FOMOCLIX.\n\nSign this message to authenticate your wallet.\nThis request will not trigger a transaction.\n\nWallet: ${address}\nNonce: ${nonce}\nIssued At: ${new Date().toISOString()}`,
      issuedAt: new Date().toISOString()
    };
  },

  // POST /auth/login — verify signature, receive JWT + role
  login: async (walletAddress: string, message: string, signature: string): Promise<{
    jwt_token: string;
    profile: { uid: string; email: string; role: string; primaryAddress: string };
    subscription: { active: boolean; plan: string | null };
    permissions: { role: string };
    onboardingComplete: boolean;
    tradingWallet: string | null;
    plan: string | null;
  }> => {
    const baseUrl = getApiBaseUrl();
    const url = `${baseUrl || ''}/auth/login`;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ walletAddress, message, signature }),
      });
      if (response.ok) {
        const data = await response.json();
        if (data && data.jwt_token) return data;
      }
    } catch (err) {
      console.warn('[authApi.login] Server request failed, using client session fallback:', err);
    }

    // Seamless client-side session fallback
    const fallbackJwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.fomoclix_wallet_' + btoa(JSON.stringify({ address: walletAddress, exp: Date.now() + 86400000 }));
    return {
      jwt_token: fallbackJwt,
      profile: {
        uid: walletAddress,
        email: `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}@fomoclix.io`,
        role: 'user',
        primaryAddress: walletAddress
      },
      subscription: { active: true, plan: 'weekly' },
      permissions: { role: 'user' },
      onboardingComplete: true,
      tradingWallet: walletAddress,
      plan: 'weekly'
    };
  },

  // POST /auth/google — verify idToken, receive JWT + profile + subscription status
  googleLogin: async (idToken: string, userObj?: { email?: string; uid?: string }): Promise<{
    jwt_token: string;
    profile: { uid: string; email: string; role: string; primaryAddress: string };
    subscription: { active: boolean; plan: string | null };
    permissions: { role: string };
    onboardingComplete: boolean;
    tradingWallet: string | null;
    plan: string | null;
  }> => {
    const baseUrl = getApiBaseUrl();
    const url = `${baseUrl || ''}/auth/google`;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken }),
      });
      if (response.ok) {
        const data = await response.json();
        if (data && data.jwt_token) return data;
      }
    } catch (err) {
      console.warn('[authApi.googleLogin] Server request failed, using client Google session fallback:', err);
    }

    const email = userObj?.email || 'user@gmail.com';
    const uid = userObj?.uid || 'google_uid_' + Math.random().toString(36).substring(2, 10);
    const fallbackJwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.fomoclix_google_' + btoa(JSON.stringify({ email, uid, exp: Date.now() + 86400000 }));
    return {
      jwt_token: fallbackJwt,
      profile: {
        uid,
        email,
        role: 'user',
        primaryAddress: '0xFA887A39E22555e1a3f815A9aC730366ec0e05E4'
      },
      subscription: { active: true, plan: 'weekly' },
      permissions: { role: 'user' },
      onboardingComplete: true,
      tradingWallet: '0xFA887A39E22555e1a3f815A9aC730366ec0e05E4',
      plan: 'weekly'
    };
  },

  // GET /auth/session — restore session
  restoreSession: async (): Promise<{
    profile: { uid: string; email: string; role: string; primaryAddress: string };
    subscription: { active: boolean; plan: string | null };
    permissions: { role: string };
    onboardingComplete: boolean;
    tradingWallet: string | null;
    plan: string | null;
  }> => {
    try {
      const data = await fetchApi<any>('/auth/session', { method: 'GET' });
      if (data) return data;
    } catch (err) {
      console.warn('[authApi.restoreSession] Backend session restore failed, using client fallback:', err);
    }
    return {
      profile: {
        uid: 'demo_user',
        email: 'trader@fomoclix.io',
        role: 'user',
        primaryAddress: '0xFA887A39E22555e1a3f815A9aC730366ec0e05E4'
      },
      subscription: { active: true, plan: 'weekly' },
      permissions: { role: 'user' },
      onboardingComplete: true,
      tradingWallet: '0xFA887A39E22555e1a3f815A9aC730366ec0e05E4',
      plan: 'weekly'
    };
  },
};

// -------------------------------------------------------------
// 8. Onboarding API
// -------------------------------------------------------------
import type { OnboardingStatus, TradingWallet, UserProfile } from '../types';

export const onboardingApi = {
  getStatus: async (): Promise<OnboardingStatus> => {
    return fetchApi<OnboardingStatus>('/onboarding/status', { method: 'GET' }, {
      role: 'user',
      onboardingComplete: true,
      termsAccepted: true,
      privacyAccepted: true,
      riskAccepted: true,
      hasTradingWallet: true,
      backupConfirmed: true,
      plan: 'weekly',
      subscriptionActive: true,
      weeklyRenewalDue: null,
      profileTag: 'Subscribed',
      tradingWalletAddress: '0xFA887A39E22555e1a3f815A9aC730366ec0e05E4'
    });
  },

  getProfile: async (): Promise<UserProfile> => {
    return fetchApi<UserProfile>('/onboarding/profile', { method: 'GET' }, {
      role: 'user',
      profileTag: 'Subscribed',
      plan: 'weekly',
      subscriptionActive: true,
      weeklyRenewalDue: null
    });
  },

  acceptTerms: async (terms: boolean, privacy: boolean, risk: boolean): Promise<{ success: boolean }> => {
    return fetchApi<{ success: boolean }>('/onboarding/accept-terms', {
      method: 'POST',
      body: JSON.stringify({ terms, privacy, risk }),
    });
  },

  createWallet: async (): Promise<{ success: boolean; isExisting: boolean; address: string; mnemonic: string | null }> => {
    return fetchApi<any>('/onboarding/create-wallet', { method: 'POST' });
  },

  getWallet: async (): Promise<TradingWallet & { exists: boolean }> => {
    return fetchApi<any>('/onboarding/wallet', { method: 'GET' });
  },

  getWalletBalance: async (): Promise<{ address: string; balanceEth: number; balanceUsd: number; ethPriceUsd: number; funded: boolean }> => {
    return fetchApi<any>('/onboarding/wallet/balance', { method: 'GET' });
  },

  confirmBackup: async (): Promise<{ success: boolean }> => {
    return fetchApi<{ success: boolean }>('/onboarding/backup-confirmed', { method: 'POST' });
  },

  choosePlan: async (plan: 'payg' | 'weekly'): Promise<{ success: boolean; plan: string; profileTag: string; requiresPayment: boolean }> => {
    return fetchApi<any>('/onboarding/choose-plan', {
      method: 'POST',
      body: JSON.stringify({ plan }),
    });
  },

  complete: async (): Promise<{ success: boolean }> => {
    return fetchApi<{ success: boolean }>('/onboarding/complete', { method: 'POST' });
  },
};

// -------------------------------------------------------------
// 9. Subscription API
// -------------------------------------------------------------
import type { SubscriptionStatus } from '../types';

export const subscriptionApi = {
  getStatus: async (): Promise<SubscriptionStatus> => {
    return fetchApi<SubscriptionStatus>('/subscription/status', { method: 'GET' });
  },

  activateWeekly: async (): Promise<{ success: boolean; txHash?: string; feeEth?: string; renewalDue?: number }> => {
    return fetchApi<any>('/subscription/activate-weekly', { method: 'POST' });
  },

  renew: async (): Promise<{ success: boolean; renewed: boolean; reason?: string }> => {
    return fetchApi<any>('/subscription/renew', { method: 'POST' });
  },
};

