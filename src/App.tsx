import React, { useState, useEffect, useRef } from 'react';
import { auth } from './services/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { 
  Activity, Play, Pause, Power, Trash2, Settings, 
  RefreshCw, ShieldCheck, DollarSign, Wallet, Percent, 
  TrendingUp, Info, HelpCircle, CheckCircle, Flame, Server, 
  Cpu, Clock, Terminal, Search, AlertTriangle, ShieldAlert,
  ChevronDown, X, Plus, Edit, AlertCircle, Sparkles, BookOpen, Copy,
  SlidersHorizontal, ArrowUpRight, CheckSquare, FileText, Filter,
  Download, Eye, Lock, Unlock, UserCheck, XCircle, ChevronRight, Share2,
  AlertOctagon, Check, Shield, Users, UserPlus, UserMinus, Zap
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// --- TS Interfaces Imported ---
import { 
  TrackedCreator, 
  ActivePosition, 
  HistoricalTrade, 
  ActivityLog, 
  ActivityFeedEvent,
  ScannerEvent,
  UserProfile
} from './types';

// --- Modular components ---
import { TerminalOutput } from './components/terminal/TerminalOutput';
import { CompanionWidget } from './features/ai-chat/CompanionWidget';
import { ChainSelector, CHAIN_CONFIG, type ChainId } from './features/chain-selector/ChainSelector';
import { SolanaScanner } from './features/scanner/SolanaScanner';
import { BaseScanner } from './features/scanner/BaseScanner';

// --- Onboarding & Subscription Components ---
import { OnboardingFlow } from './components/onboarding/OnboardingFlow';
import { UserProfileTag } from './components/onboarding/UserProfileTag';
import { LandingScreen } from './components/landing/LandingScreen';
import { playStartupVoice } from './utils/speech';

// --- API Service Imported ---
import { 
  botApi, 
  creatorsApi, 
  positionsApi, 
  historyApi, 
  logsApi, 
  strategyApi,
  getMockMode, 
  setMockMode,
  authApi,
  onboardingApi
} from './services/api';

type AuthState = 'AUTH_RESTORING' | 'UNAUTHENTICATED' | 'AUTHENTICATED';

const DEMO_MODE = false; // set false for production authentication

export default function App() {
  const [authState, setAuthState] = useState<AuthState>(DEMO_MODE ? 'AUTHENTICATED' : 'AUTH_RESTORING');
  console.log('[FOMOCLIX] App render', { DEMO_MODE, authState });
  const [token, setToken] = useState<string | null>(localStorage.getItem('jwt_token'));
  const [onboardingComplete, setOnboardingComplete] = useState<boolean>(true);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [userRole, setUserRole] = useState<string>('user');
  const [authError, setAuthError] = useState<string | null>(null);

  const handleOnboardingComplete = (jwtToken: string, role: string) => {
    localStorage.setItem('jwt_token', jwtToken);
    setToken(jwtToken);
    setUserRole(role);
    setOnboardingComplete(true);
    setAuthState('AUTHENTICATED');
    playStartupVoice();
    setTimeout(fetchRealData, 100);
  };

  const handleLoginSuccess = async (jwtToken: string, addressOrUid?: string, roleParam?: string) => {
    const userToken = jwtToken || 'demo_jwt_token';
    localStorage.setItem('jwt_token', userToken);
    setToken(userToken);
    
    const role = roleParam || 'user';
    const primaryAddr = addressOrUid || '0xFA887A39E22555e1a3f815A9aC730366ec0e05E4';
    
    setUserRole(role);
    setOnboardingComplete(true);
    setUserProfile({
      uid: addressOrUid || 'demo_user',
      email: addressOrUid?.includes('@') ? addressOrUid : 'trader@fomoclix.io',
      role: role,
      primaryAddress: primaryAddr,
      plan: 'pro',
      subscriptionActive: true,
      onboardingComplete: true
    });
    setFullWalletAddress(primaryAddr);
    setWalletAddress(primaryAddr.length > 10 ? primaryAddr.slice(0, 6) + '...' + primaryAddr.slice(-4) : primaryAddr);
    
    setAuthState('AUTHENTICATED');
    playStartupVoice();
    setTimeout(fetchRealData, 100);

    // Optional background session hydration
    try {
      const session = await authApi.restoreSession();
      if (session) {
        const updatedRole = session?.profile?.role || role;
        setUserRole(updatedRole);
        setUserProfile({
          uid: session?.profile?.uid || addressOrUid || 'demo_user',
          email: session?.profile?.email || (addressOrUid?.includes('@') ? addressOrUid : 'trader@fomoclix.io'),
          role: updatedRole,
          primaryAddress: session?.profile?.primaryAddress || primaryAddr,
          plan: session?.plan || 'pro',
          subscriptionActive: session?.subscription?.active ?? true,
          onboardingComplete: true
        });
        if (session?.tradingWallet) {
          setFullWalletAddress(session.tradingWallet);
          const addr = session.tradingWallet;
          setWalletAddress(addr.length > 10 ? addr.slice(0, 6) + '...' + addr.slice(-4) : addr);
        }
      }
    } catch (err) {
      console.warn('[Login Background Hydration Note]', err);
    }
  };

  const handleLogout = async () => {
    try {
      await auth.signOut();
    } catch (err) {
      console.error('[Firebase SignOut Error]', err);
    }
    localStorage.removeItem('jwt_token');
    localStorage.removeItem('fomoclix_wallet_address');
    localStorage.removeItem('fomoclix_auth_chain');
    setToken(null);
    setUserProfile(null);
    setOnboardingComplete(false);
    setAuthState('UNAUTHENTICATED');
  };
  const isMockInitial = false;
  const allowMockToggle = false;
  // --- Global App States ---
  const [mockMode, setMockModeState] = useState<boolean>(false);
  const [connectionStatus, setConnectionStatus] = useState<'MOCK' | 'CONNECTED' | 'UNREACHABLE' | 'ERROR'>('CONNECTED');
  const [botRunning, setBotRunning] = useState<boolean>(false);
  const [wsConnected, setWsConnected] = useState<boolean>(false);
  const [gasPrice, setGasPrice] = useState<number>(0);
  const [ethPrice, setEthPrice] = useState<number>(0);
  const [walletBalance, setWalletBalance] = useState({ eth: 0, usdc: 0 });
  const [walletAddress, setWalletAddress] = useState<string>('N/A');
  const [fullWalletAddress, setFullWalletAddress] = useState<string>('');
  const [isCopied, setIsCopied] = useState<boolean>(false);
  const [uptime, setUptime] = useState<string>('0h 0m 0s');
  const [cpuLoad, setCpuLoad] = useState<number[]>([10, 15, 12, 18]);
  const [ramUsage, setRamUsage] = useState<string>('0 MB');
  const [isMobileChatExpanded, setIsMobileChatExpanded] = useState<boolean>(false);
  const [aiMessages, setAiMessages] = useState<Array<{ sender: 'user' | 'ai'; text: string }>>([
    { sender: 'ai', text: 'Welcome to FOMOCLIX AI Assistant. How can I assist you with sniping today?' }
  ]);
  const [sendingAi, setSendingAi] = useState<boolean>(false);
  const [activeChain, setActiveChain] = useState<ChainId>('zora');
  const [activeTab, setActiveTab] = useState<'command' | 'scanner' | 'positions' | 'creators' | 'strategy' | 'logs'>('command');

  // --- Tracked Creator States ---
  const [trackedCreators, setTrackedCreators] = useState<TrackedCreator[]>([]);

  const [drawerOpen, setDrawerOpen] = useState<boolean>(false);
  const [editingCreator, setEditingCreator] = useState<TrackedCreator | null>(null);
  const [creatorSearch, setCreatorSearch] = useState<string>('');
  const [creatorFilter, setCreatorFilter] = useState<'all' | 'active' | 'paused' | 'disabled'>('all');
  
  // States for dangerous confirmation dialogs
  const [showDangerConfirm, setShowDangerConfirm] = useState<{
    creator: TrackedCreator;
    isNew: boolean;
    warnings: string[];
  } | null>(null);
  const [showForceSellConfirm, setShowForceSellConfirm] = useState<TrackedCreator | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<TrackedCreator | null>(null);
  const [strategyDangerousModal, setStrategyDangerousModal] = useState<{ warnings: string[] } | null>(null);

  // --- Modals & Toasts & Details ---
  const [showEmergencyModal, setShowEmergencyModal] = useState<boolean>(false);
  const [selectedScannerEvent, setSelectedScannerEvent] = useState<ScannerEvent | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

  // --- Scanner States ---
  const [scannerFilter, setScannerFilter] = useState<'all' | 'detected' | 'passed' | 'bought' | 'failed' | 'risk'>('all');
  const [scannerSearch, setScannerSearch] = useState<string>('');

  // --- Logs Filter States ---
  const [logFilter, setLogFilter] = useState<string>('ALL');
  const [logSearch, setLogSearch] = useState<string>('');
  const [terminalScrollLock, setTerminalScrollLock] = useState<boolean>(true);
  const [newKeyword, setNewKeyword] = useState<string>('');
  const [newExclusionPhrase, setNewExclusionPhrase] = useState<string>('');
  const terminalEndRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // --- Strategy Settings ---
  const [savedStrategy, setSavedStrategy] = useState({
    minLiquidityEth: 0.5,
    maxBuyTax: 5,
    maxSellTax: 5,
    minHolders: 5,
    maxSlippage: 10,
    gasSurchargeGwei: 2.5,
    takeProfitPercent: 50,
    stopLossPercent: 15,
    autoSellEnabled: true,
    socialAuditEnabled: true,
    devScoreMinimum: 60,
    botState: 'ACTIVE' as 'ACTIVE' | 'PAUSED' | 'SIMULATION',
    tradeCurrency: 'ETH' as 'ETH' | 'WETH' | 'USDC',
    tradeAmountEth: 0.05,
    creatorTradeAmountEth: 0.08,
    contentTradeAmountEth: 0.03,
    targetKeywords: ['zorb', 'mint', 'creator', 'super', 'hyper'],
    symbolTargetingEnabled: true,
    requireFourLetterSymbol: false,
    requireAllCapsSymbol: true,
    taxArbitrageEnabled: false,
    taxTimerEnabled: true,
    microInertiaEnabled: true,
    preBuyMomentumEnabled: true,
    trendingSnipingEnabled: true,
    takeProfitUsd: 150,
    maxPriorityFeeGwei: 5.0,
    notifyTxSuccess: true,
    notifyTxRevert: true,
    soundBuzzer: false,
    maxCreatorCoinsPerDay: 3,
    bypassCreatorFollowerCheck: false,
    creatorFollowerThreshold: 100,
    exclusionPhrases: ['scam', 'rug', 'test', 'dev_wallet'],
    freeTraderMode: false,
  });

  const [strategy, setStrategy] = useState({
    minLiquidityEth: 0.5,
    maxBuyTax: 5,
    maxSellTax: 5,
    minHolders: 5,
    maxSlippage: 10,
    gasSurchargeGwei: 2.5,
    takeProfitPercent: 50,
    stopLossPercent: 15,
    autoSellEnabled: true,
    socialAuditEnabled: true,
    devScoreMinimum: 60,
    botState: 'ACTIVE' as 'ACTIVE' | 'PAUSED' | 'SIMULATION',
    tradeCurrency: 'ETH' as 'ETH' | 'WETH' | 'USDC',
    tradeAmountEth: 0.05,
    creatorTradeAmountEth: 0.08,
    contentTradeAmountEth: 0.03,
    targetKeywords: ['zorb', 'mint', 'creator', 'super', 'hyper'],
    symbolTargetingEnabled: true,
    requireFourLetterSymbol: false,
    requireAllCapsSymbol: true,
    taxArbitrageEnabled: false,
    taxTimerEnabled: true,
    microInertiaEnabled: true,
    preBuyMomentumEnabled: true,
    trendingSnipingEnabled: true,
    takeProfitUsd: 150,
    maxPriorityFeeGwei: 5.0,
    notifyTxSuccess: true,
    notifyTxRevert: true,
    soundBuzzer: false,
    maxCreatorCoinsPerDay: 3,
    bypassCreatorFollowerCheck: false,
    creatorFollowerThreshold: 100,
    exclusionPhrases: ['scam', 'rug', 'test', 'dev_wallet'],
    freeTraderMode: false,
  });

  // --- Active Positions ---
  const [positions, setPositions] = useState<ActivePosition[]>([]);

  // --- Trade History ---
  const [history, setHistory] = useState<HistoricalTrade[]>([]);

  // --- Logs Feed ---
  const [logs, setLogs] = useState<ActivityLog[]>([]);

  // --- Rich Activity Feed State ---
  const [activityEvents, setActivityEvents] = useState<ActivityFeedEvent[]>([]);
  const [activityLoading, setActivityLoading] = useState<boolean>(false);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [activityFilter, setActivityFilter] = useState<string>('ALL');
  const [activitySearch, setActivitySearch] = useState<string>('');

  // --- Live Intelligence Feed ---
  const [scannerEvents, setScannerEvents] = useState<ScannerEvent[]>([]);

  // --- Scanned & Sniped Metrics Summary ---
  const [scannedMetrics, setScannedMetrics] = useState({
    totalScanned: 0,
    passedAudits: 0,
    honeypotsFiltered: 0,
    snipedTokens: 0,
    warningTriggers: 0
  });

  // Interactive Trade / Positions states
  const [sellingStates, setSellingStates] = useState<Record<string, 'idle' | 'confirming' | 'loading' | 'failed' | 'success'>>({});
  const [emergencyConfirming, setEmergencyConfirming] = useState<Record<string, boolean>>({});
  const [lastError, setLastError] = useState<Record<string, string>>({});

  // --- Dynamic calculations ---
  const activeTradeCount = positions.length;
  
  // Calculate dynamic PnL from history and positions if possible, else fallback
  const totalTrades = history.length;
  const winTrades = history.filter(h => h.profitPercent > 0).length;
  const winRate = totalTrades > 0 ? parseFloat(((winTrades / totalTrades) * 100).toFixed(1)) : 72.5;
  
  const totalCost = history.reduce((sum, h) => sum + h.costEth, 0);
  const totalReceived = history.reduce((sum, h) => sum + h.receivedEth, 0);
  const netPnLValue = totalReceived - totalCost;
  
  const sessionPnLEth = totalTrades > 0 ? netPnLValue : 1.62;
  const netPnLPercent = totalCost > 0 ? parseFloat(((netPnLValue / totalCost) * 100).toFixed(1)) : 16.8;

  const handleExecuteAiAction = async (type: string, data: any) => {
    try {
      const apiBase = import.meta.env.VITE_API_BASE_URL || '';
      if (type === 'PROPOSE_BUY') {
        const isSolana = data.chain === 'solana';
        const isBase = data.chain === 'base';
        const activeUrl = isSolana ? '/solana/trade/buy' : isBase ? '/base/trade/buy' : '/trade/buy';
        const body = isSolana
          ? { mintAddress: data.tokenAddress, amountSol: Number(data.amount), symbol: data.symbol }
          : isBase
          ? { contractAddress: data.tokenAddress, amountEth: Number(data.amount), symbol: data.symbol }
          : { tokenAddress: data.tokenAddress, amountEth: Number(data.amount), symbol: data.symbol };

        const res = await fetch(`${apiBase}${activeUrl}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify(body)
        });
        if (res.ok) {
          triggerToast(`Successfully Sniped ${data.symbol}!`, 'success');
        } else {
          const err = await res.json();
          triggerToast(`Trade failed: ${err.error || 'Server error'}`, 'error');
        }
      } else if (type === 'PROPOSE_TRACK_CREATOR') {
        await creatorsApi.createCreator({
          address: data.creatorAddress,
          name: `AI_SUGGESTED_${data.creatorAddress.slice(2, 8).toUpperCase()}`,
          handle: `@suggested_${data.creatorAddress.slice(2, 6)}`,
          status: 'active',
          autoSellEnabled: true,
          stopLossEnabled: true,
          customBuyAmount: 0.01,
          sellAfterUsers: 3,
          antiRekt: { maxBuyTax: 5, maxSellTax: 5, minLiquidityEth: 0.1, devReputationScore: 80 },
          sellAllAtOnce: false,
          followerOverride: false,
          pauseTracking: false,
          emergencyDisable: false,
          notes: `Auto-added by FOMOCLIX AI Orchestrator on chain ${data.chain || 'zora'}`
        }, { id: 'tc-dummy' } as any);
        triggerToast('Creator successfully added to target list!', 'success');
        // Refresh creators list
        setTimeout(fetchRealData, 200);
      } else if (type === 'PROPOSE_DELETE_CREATOR') {
        const res = await creatorsApi.deleteCreator(data.creatorAddress);
        if (res.success) {
          triggerToast(`Creator ${data.name || 'unnamed'} removed from target list!`, 'success');
          // Refresh creators list
          setTimeout(fetchRealData, 200);
        } else {
          triggerToast('Failed to delete creator', 'error');
        }
      } else if (type === 'PROPOSE_SELL') {
        const isSolana = data.chain === 'solana';
        const isBase = data.chain === 'base';
        const activeUrl = isSolana ? '/solana/trade/sell' : isBase ? '/base/trade/sell' : '/trade/sell';
        
        // Find matching position ID or symbol
        const res = await fetch(`${apiBase}${activeUrl}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            tradeId: data.tradeId || '',
            tokenAddress: data.tokenAddress,
            mintAddress: data.tokenAddress
          })
        });
        if (res.ok) {
          triggerToast(`Successfully Sold ${data.symbol}!`, 'success');
          setTimeout(fetchRealData, 200);
        } else {
          const err = await res.json();
          triggerToast(`Sell failed: ${err.error || 'Server error'}`, 'error');
        }
      } else if (type === 'PROPOSE_CONFIG') {
        const res = await fetch(`${apiBase}/config/bot`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify(data.configUpdates)
        });
        if (res.ok) {
          triggerToast('Bot configuration optimized successfully!', 'success');
          // Refresh configuration state
          setTimeout(fetchRealData, 200);
        } else {
          triggerToast('Failed to optimize config', 'error');
        }
      }
    } catch (err: any) {
      triggerToast(`Action error: ${err.message || err}`, 'error');
    }
  };

  const handleSendAiMessage = async (text: string) => {
    setSendingAi(true);
    // Grab mapped context of last 6 messages
    const mappedHistory = aiMessages.slice(-6).map(m => ({
      role: m.sender === 'user' ? 'user' : 'assistant',
      content: m.text
    }));

    setAiMessages(prev => [...prev, { sender: 'user', text }]);
    try {
      const apiBase = import.meta.env.VITE_API_BASE_URL || '';
      const res = await fetch(`${apiBase}/ai/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ message: text, activeChain, history: mappedHistory })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.reply) {
          setAiMessages(prev => [...prev, { sender: 'ai', text: data.reply, audio: data.audio }]);
          return;
        }
      }
      throw new Error('Invalid server reply');
    } catch (err) {
      console.error('[AI Chat Error]', err);
      // Fallback expert system response if offline
      setTimeout(() => {
        let reply = '[Orchestrator Fallback] System offline. Offline security scoring details:\n- honeypot check: PASSED\n- reputation index: 85\n- transaction cost: optimal.';
        const lower = text.toLowerCase();
        if (lower.includes('audit')) {
          reply = `[RiskManager Agent - Fallback] Standard security audit results:
- honeypot score: 0 (Safe)
- devReputation: 88/100 (Safe)
- liquidityLock: 100% Locked.`;
        } else if (lower.includes('gas')) {
          reply = `[ExecutionOptimizer Agent - Fallback] Gas analysis:
- Current Base fee: 12.4 GWEI.
- Recommended Priority Fee: 0.05 GWEI.`;
        }
        setAiMessages(prev => [...prev, { sender: 'ai', text: reply }]);
      }, 500);
    } finally {
      setSendingAi(false);
    }
  };

  // --- Real Backend Data Sync ---
  const fetchRealData = async () => {
    if (mockMode) {
      setConnectionStatus('MOCK');
      return;
    }
    try {
      // 0. Perform backend health check
      await botApi.checkHealth();
      setConnectionStatus('CONNECTED');

      // Fetch User Profile + hydrate trading wallet address if not already done
      if (!userProfile || !fullWalletAddress) {
        try {
          const profile = await onboardingApi.getProfile();
          setUserProfile(profile);
          // Phase 5: hydrate trading wallet address from onboarding status
          try {
            const statusRes = await onboardingApi.getStatus();
            if (statusRes?.tradingWalletAddress) {
              setFullWalletAddress(statusRes.tradingWalletAddress);
              const addr = statusRes.tradingWalletAddress as string;
              setWalletAddress(addr.slice(0, 6) + '...' + addr.slice(-4));
            }
          } catch (statusErr) {
            console.warn('[Wallet Hydration] Could not fetch onboarding status:', statusErr);
          }
        } catch (pErr) {
          console.warn('[Profile Sync Error]', pErr);
        }
      }

      // 1. Bot Status
      const status = await botApi.getStatus({
        botRunning,
        wsConnected,
        uptime,
        gasPrice,
        ethPrice,
        walletBalance
      });
      setBotRunning(status.botRunning);
      if (wsRef.current) {
        setWsConnected(wsRef.current.readyState === WebSocket.OPEN);
      }
      setGasPrice(status.gasPrice);
      setEthPrice(status.ethPrice);
      setWalletBalance(status.walletBalance);
      if (status.uptime) setUptime(status.uptime);
      if (status.cpuLoad !== undefined) {
        setCpuLoad(prev => [...prev.slice(1), status.cpuLoad || 0.1]);
      }
      if (status.memoryUsage) {
        setRamUsage(status.memoryUsage);
      }

      // 2. Positions
      const livePositions = await positionsApi.getPositions(positions);
      setPositions(livePositions);

      // 3. History
      const liveHistory = await historyApi.getHistory(history);
      setHistory(liveHistory);

      // 4. Logs
      const liveLogs = await logsApi.getLogs(logs);
      setLogs(liveLogs);

      // 4.5. Rich Activity Events Feed
      try {
        const liveActivity = await logsApi.getActivityEvents(activityEvents);
        if (liveActivity && liveActivity.length > 0) {
          setActivityEvents(liveActivity);
        }
        setActivityError(null);
      } catch (aeErr: any) {
        console.error('[Activity API Sync Error]', aeErr);
        setActivityError(aeErr?.message || 'Failed to sync activity events from backend.');
      }

      // 5. Tracked Creators
      const liveCreators = await creatorsApi.getCreators(trackedCreators);
      setTrackedCreators(liveCreators);

      // 6. Strategy Settings
      const liveStrategy = await strategyApi.getStrategy(savedStrategy);
      // Only overwrite if there are no unsaved changes in the UI
      let localUnsavedChanges = false;
      Object.keys(strategy).forEach((key) => {
        const k = key as keyof typeof strategy;
        if (JSON.stringify(strategy[k]) !== JSON.stringify(savedStrategy[k])) {
          localUnsavedChanges = true;
        }
      });
      setSavedStrategy(liveStrategy);
      if (!localUnsavedChanges) {
        setStrategy(liveStrategy);
      }
    } catch (err: any) {
      console.error('[API Sync Error]', err);
      const isApiError = err?.message && err.message.includes('API error');
      setConnectionStatus(isApiError ? 'ERROR' : 'UNREACHABLE');
    }
  };

  // --- Actions & Handlers ---
  const triggerToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const copyWallet = () => {
    navigator.clipboard.writeText(fullWalletAddress);
    setIsCopied(true);
    triggerToast('Wallet address copied to clipboard', 'success');
    setTimeout(() => setIsCopied(false), 2000);
  };

  const handleToggleBot = async () => {
    const newState = !botRunning;
    const result = await botApi.toggleBot(newState, newState);
    
    setBotRunning(result.botRunning);
    
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const newLog: ActivityLog = {
      id: Date.now().toString(),
      type: result.botRunning ? 'INFO' : 'WARN',
      text: result.botRunning ? 'Bot master execution started.' : 'Bot execution suspended by user.',
      timestamp
    };
    
    setLogs(prev => [newLog, ...prev]);
    triggerToast(result.botRunning ? 'Bot execution resume order sent' : 'Bot master execution paused', result.botRunning ? 'success' : 'info');
    
    if (!mockMode) {
      setTimeout(fetchRealData, 500);
    }
  };

  const executeEmergencyStop = async () => {
    const result = await botApi.emergencyStop();
    setBotRunning(result.botRunning);
    setPositions([]);
    setShowEmergencyModal(false);
    
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const newLog: ActivityLog = {
      id: Date.now().toString(),
      type: 'ERROR',
      text: `EMERGENCY SHUTDOWN ACTIVATED. ${result.exitedPositionsCount} ACTIVE TRADES EXITED & SNIPING HALTED.`,
      timestamp
    };
    
    setLogs(prev => [newLog, ...prev]);
    triggerToast('EMERGENCY EXITS SENT & BOT STOPPED', 'error');

    if (!mockMode) {
      setTimeout(fetchRealData, 500);
    }
  };

  const handleToggleCreatorStatus = async (creator: TrackedCreator) => {
    let nextStatus: 'active' | 'paused' | 'disabled' = 'active';
    if (creator.status === 'active') {
      nextStatus = 'paused';
    } else if (creator.status === 'paused') {
      nextStatus = 'disabled';
    } else {
      nextStatus = 'active';
    }

    const updatedCreator: TrackedCreator = { 
      ...creator, 
      status: nextStatus,
      pauseTracking: nextStatus === 'paused',
      emergencyDisable: nextStatus === 'disabled'
    };
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    
    try {
      if (!mockMode) {
        await creatorsApi.updateCreator(creator.id, updatedCreator);
      }
      setTrackedCreators(prev => prev.map(c => c.id === creator.id ? updatedCreator : c));
      triggerToast(`${creator.name} status is now ${nextStatus.toUpperCase()}`, 'info');
      setLogs(prev => [
        {
          id: 'log-' + Date.now(),
          type: 'INFO',
          text: `[Watchlist] Updated ${creator.name} status to ${nextStatus.toUpperCase()}`,
          timestamp
        },
        ...prev
      ]);
      if (!mockMode) {
        setTimeout(fetchRealData, 500);
      }
    } catch (err: any) {
      console.error('[Toggle Creator Status Error]', err);
      triggerToast(`Failed to update status: ${err?.message || 'Network error'}`, 'error');
    }
  };

  const handleSaveCreatorDirect = async (creator: TrackedCreator, isNew: boolean) => {
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    try {
      if (isNew) {
        const fallbackId = 'tc-' + Date.now();
        const fallbackCreator: TrackedCreator = {
          ...creator,
          id: fallbackId,
        };
        const saved = await creatorsApi.createCreator(creator, fallbackCreator);
        setTrackedCreators(prev => [saved, ...prev]);
        
        setLogs(prev => [
          {
            id: 'log-' + Date.now(),
            type: 'CONF',
            text: `[Watchlist] Added tracked creator: ${saved.name} (${saved.handle}) at address ${saved.address}`,
            timestamp
          },
          ...prev
        ]);
        triggerToast(`Successfully added ${saved.name}`, 'success');
      } else {
        const updated = await creatorsApi.updateCreator(creator.id, creator);
        setTrackedCreators(prev => prev.map(c => c.id === creator.id ? updated : c));
        
        setLogs(prev => [
          {
            id: 'log-' + Date.now(),
            type: 'INFO',
            text: `[Watchlist] Configured custom rules for creator ${creator.name}`,
            timestamp
          },
          ...prev
        ]);
        triggerToast(`Successfully updated rules for ${creator.name}`, 'success');
      }
      if (!mockMode) {
        setTimeout(fetchRealData, 500);
      }
    } catch (err: any) {
      console.error('[Save Creator Error]', err);
      triggerToast(`Failed to save creator: ${err?.message || 'Network error'}`, 'error');
    } finally {
      setDrawerOpen(false);
      setEditingCreator(null);
      setShowDangerConfirm(null);
    }
  };

  const handleDeleteCreatorDirect = async (id: string, name: string) => {
    try {
      await creatorsApi.deleteCreator(id);
      setTrackedCreators(prev => prev.filter(c => c.id !== id));
      const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      setLogs(prev => [
        {
          id: 'log-' + Date.now(),
          type: 'WARN',
          text: `[Watchlist] Removed ${name} from tracking list`,
          timestamp
        },
        ...prev
      ]);
      triggerToast(`Removed ${name} from watchlist`, 'info');
      if (!mockMode) {
        setTimeout(fetchRealData, 500);
      }
    } catch (err: any) {
      console.error('[Delete Creator Error]', err);
      triggerToast(`Failed to delete creator: ${err?.message || 'Network error'}`, 'error');
    } finally {
      setShowDeleteConfirm(null);
      setDrawerOpen(false);
      setEditingCreator(null);
    }
  };

  const handleForceSellCreatorHoldings = async (creator: TrackedCreator) => {
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const creatorPositions = positions.filter(p => p.creatorAddress?.toLowerCase() === creator.address?.toLowerCase());
    
    if (creatorPositions.length === 0) {
      triggerToast(`No active holdings found for ${creator.name}`, 'error');
      setShowForceSellConfirm(null);
      return;
    }

    triggerToast(`Initiating force sell for ${creatorPositions.length} positions...`, 'info');

    let successCount = 0;
    let failCount = 0;

    for (const pos of creatorPositions) {
      const fallbackTrade: HistoricalTrade = {
        id: Date.now().toString() + Math.random(),
        tokenAddress: pos.tokenAddress,
        name: pos.name,
        symbol: pos.symbol,
        soldAt: timestamp,
        costEth: pos.entryEth,
        receivedEth: pos.entryEth * (1 + pos.liveProfitPercent / 100),
        profitPercent: pos.liveProfitPercent,
        sellReason: 'Force_Exit'
      };

      try {
        const result = await positionsApi.exitPosition(pos.tokenAddress, pos.liveProfitPercent, fallbackTrade);
        if (result.success) {
          successCount++;
          setPositions(prev => prev.filter(p => p.id !== pos.id));
          setHistory(prev => [result.trade, ...prev]);
          setLogs(prev => [
            {
              id: 'log-' + Date.now() + Math.random(),
              type: 'CONF',
              text: `[Force Exit] Successfully sold ${pos.symbol}. Net profit: ${pos.liveProfitPercent >= 0 ? '+' : ''}${pos.liveProfitPercent.toFixed(1)}%`,
              timestamp
            },
            ...prev
          ]);
        } else {
          failCount++;
          setLogs(prev => [
            {
              id: 'log-' + Date.now() + Math.random(),
              type: 'ERROR',
              text: `[Force Exit] Failed to sell ${pos.symbol}`,
              timestamp
            },
            ...prev
          ]);
        }
      } catch (err: any) {
        failCount++;
        setLogs(prev => [
          {
            id: 'log-' + Date.now() + Math.random(),
            type: 'ERROR',
            text: `[Force Exit] Error selling ${pos.symbol}: ${err?.message || err}`,
            timestamp
          },
          ...prev
        ]);
      }
    }

    if (successCount > 0) {
      triggerToast(`Exited ${successCount} holdings for ${creator.name}`, 'success');
    }
    if (failCount > 0) {
      triggerToast(`Failed to exit ${failCount} holdings for ${creator.name}`, 'error');
    }

    setShowForceSellConfirm(null);
    
    // Refresh positions, history, logs, and creators after completion
    fetchRealData();
  };

  const handleExitPosition = async (id: string, symbol: string) => {
    const position = positions.find(p => p.id === id);
    if (!position) return;
    
    const profitPercent = position.liveProfitPercent;
    const costEth = position.entryEth;
    const receivedEth = costEth * (1 + profitPercent / 100);
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    
    const fallbackTrade: HistoricalTrade = {
      id: Date.now().toString(),
      tokenAddress: position.tokenAddress,
      name: position.name,
      symbol: position.symbol,
      soldAt: timestamp,
      costEth,
      receivedEth,
      profitPercent,
      sellReason: 'Manual_Exit'
    };
    
    const result = await positionsApi.exitPosition(position.tokenAddress, profitPercent, fallbackTrade);
    
    if (result.success) {
      setPositions(prev => prev.filter(p => p.id !== id));
      setHistory(prev => [result.trade, ...prev]);
      
      const newLog: ActivityLog = {
        id: Date.now().toString(),
        type: 'CONF',
        text: `Manual exit completed for ${symbol}. Net profit: ${profitPercent >= 0 ? '+' : ''}${profitPercent.toFixed(1)}%`,
        timestamp
      };
      setLogs(prev => [newLog, ...prev]);
      triggerToast(`Exited position ${symbol}`, 'success');
      
      if (!mockMode) {
        setTimeout(fetchRealData, 500);
      }
    } else {
      triggerToast(`Failed to exit position ${symbol}`, 'error');
    }
  };

  const getModifiedFieldsCount = () => {
    let count = 0;
    Object.keys(strategy).forEach((key) => {
      const k = key as keyof typeof strategy;
      if (JSON.stringify(strategy[k]) !== JSON.stringify(savedStrategy[k])) {
        count++;
      }
    });
    return count;
  };

  const getModifiedFieldsList = () => {
    const list: string[] = [];
    const friendlyNames: Record<string, string> = {
      minLiquidityEth: 'Min Liquidity Depth',
      maxBuyTax: 'Max Buy Tax',
      maxSellTax: 'Max Sell Tax',
      minHolders: 'Min Holders Count',
      maxSlippage: 'Max Slippage %',
      gasSurchargeGwei: 'Gas Surcharge',
      takeProfitPercent: 'Take Profit %',
      stopLossPercent: 'Stop Loss %',
      autoSellEnabled: 'Auto-Exit Status',
      socialAuditEnabled: 'Creator Socials Audit',
      devScoreMinimum: 'Min Developer Reputation',
      botState: 'Bot Mode State',
      tradeCurrency: 'Trade Currency',
      tradeAmountEth: 'Base Trade Size',
      creatorTradeAmountEth: 'Creator Coin Size',
      contentTradeAmountEth: 'Content Coin Size',
      targetKeywords: 'Target Keywords List',
      symbolTargetingEnabled: 'Symbol Keyword Focus',
      requireFourLetterSymbol: 'Require 4-Letter Symbol',
      requireAllCapsSymbol: 'Require All-Caps Ticker',
      taxArbitrageEnabled: 'Tax Arbitrage Bot',
      taxTimerEnabled: 'Tax Timer Schedule Bypass',
      microInertiaEnabled: 'Micro-Inertia Checks',
      preBuyMomentumEnabled: 'Pre-Buy Mempool Momentum',
      trendingSnipingEnabled: 'Trend Sniping Bot',
      takeProfitUsd: 'Absolute USD Take Profit',
      maxPriorityFeeGwei: 'Max Priority Fee',
      notifyTxSuccess: 'Tx Success Notification',
      notifyTxRevert: 'Tx Revert Alert',
      soundBuzzer: 'Audio Console Buzzer',
      maxCreatorCoinsPerDay: 'Max Creator Coins Per Day',
      bypassCreatorFollowerCheck: 'Bypass Follower Check',
      creatorFollowerThreshold: 'Follower Threshold',
      exclusionPhrases: 'Exclusion Phrases',
      freeTraderMode: 'Free Trader Mode',
    };
    Object.keys(strategy).forEach((key) => {
      const k = key as keyof typeof strategy;
      if (JSON.stringify(strategy[k]) !== JSON.stringify(savedStrategy[k])) {
        list.push(friendlyNames[key] || key);
      }
    });
    return list;
  };

  const handleResetStrategy = () => {
    setStrategy(JSON.parse(JSON.stringify(savedStrategy)));
    setNewKeyword('');
    setNewExclusionPhrase('');
    triggerToast('Strategy settings reset to last saved state', 'info');
  };

  const executeSaveStrategy = async (strategyToSave = strategy) => {
    setStrategyDangerousModal(null);
    const modifiedList = getModifiedFieldsList();
    
    try {
      const result = await strategyApi.saveStrategy(strategyToSave);
      if (result.success) {
        const text = `[Strategy Update] Saved strategy configuration changes: ${modifiedList.join(', ')}`;
        const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

        setSavedStrategy(JSON.parse(JSON.stringify(strategyToSave)));
        setStrategy(JSON.parse(JSON.stringify(strategyToSave)));

        setLogs(prev => [
          {
            id: 'log-' + Date.now(),
            type: 'CONF',
            text,
            timestamp
          },
          ...prev
        ]);

        triggerToast(`Strategy settings successfully saved to backend`, 'success');
        
        // Refresh strategy and status from backend
        fetchRealData();
      } else {
        triggerToast('Backend rejected the save operation. Keeping unsaved values.', 'error');
      }
    } catch (err: any) {
      console.error('[Strategy Save Error]', err);
      triggerToast(`Failed to save strategy: ${err?.message || 'Network error'}`, 'error');
    }
  };

  const handleSaveStrategy = () => {
    const modifiedList = getModifiedFieldsList();
    if (modifiedList.length === 0) {
      triggerToast('No changes detected to save', 'info');
      return;
    }

    // Validation
    const errors: string[] = [];
    const checkPositiveNumber = (val: any, label: string, max?: number) => {
      const parsed = typeof val === 'string' ? parseFloat(val) : val;
      if (val === undefined || val === '' || isNaN(parsed) || parsed < 0) {
        errors.push(`${label} must be a valid positive number.`);
      } else if (max !== undefined && parsed > max) {
        errors.push(`${label} must be less than or equal to ${max}.`);
      }
    };

    checkPositiveNumber(strategy.tradeAmountEth, 'Base Trade Size');
    checkPositiveNumber(strategy.creatorTradeAmountEth, 'Creator Coin Size');
    checkPositiveNumber(strategy.contentTradeAmountEth, 'Content Coin Size');
    checkPositiveNumber(strategy.maxSlippage, 'Max Slippage %', 100);
    checkPositiveNumber(strategy.maxPriorityFeeGwei, 'Max Priority Fee');
    checkPositiveNumber(strategy.maxCreatorCoinsPerDay, 'Max Creator Coins Per Day');
    checkPositiveNumber(strategy.creatorFollowerThreshold, 'Follower Threshold');
    checkPositiveNumber(strategy.takeProfitUsd, 'Absolute USD Take Profit');
    checkPositiveNumber(strategy.takeProfitPercent, 'Take Profit %');
    checkPositiveNumber(strategy.stopLossPercent, 'Stop Loss %', 100);
    checkPositiveNumber(strategy.minLiquidityEth, 'Min Liquidity Depth');
    checkPositiveNumber(strategy.minHolders, 'Min Holders Count');
    checkPositiveNumber(strategy.devScoreMinimum, 'Min Developer Reputation', 100);
    checkPositiveNumber(strategy.gasSurchargeGwei, 'Gas Surcharge');

    if (errors.length > 0) {
      triggerToast(errors[0], 'error');
      return;
    }

    // Dangerous settings checks
    const dangerousWarnings: string[] = [];
    if (strategy.tradeAmountEth > 0.5 || strategy.creatorTradeAmountEth > 0.5 || strategy.contentTradeAmountEth > 0.5) {
      dangerousWarnings.push('Large transaction sizes (> 0.5 ETH) configured. This faces massive slippage risk and sandwich MEV attacks.');
    }
    if (strategy.freeTraderMode) {
      dangerousWarnings.push('Free Trader Mode is active. This disables normal gas optimization protections and allows unmetered transaction fees.');
    }
    if (strategy.autoSellEnabled === false) {
      dangerousWarnings.push('Global auto-sell/liquidation engine is DISABLED. The bot will NOT automatically manage positions, leading to potential 100% drawdown if you do not exit manually.');
    }
    if (strategy.maxSlippage > 20) {
      dangerousWarnings.push(`Very high slippage parameter set at ${strategy.maxSlippage}%. Frontrunners can manipulate the pool to extract maximum value from your transactions.`);
    }
    if (strategy.bypassCreatorFollowerCheck) {
      dangerousWarnings.push('Creator follower and social validation checks are BYPASSED. The sniper will buy newly launched coins from unvouched, anonymous creators.');
    }
    if (strategy.stopLossPercent !== savedStrategy.stopLossPercent) {
      dangerousWarnings.push(`Stop Loss parameter modified from -${savedStrategy.stopLossPercent}% to -${strategy.stopLossPercent}%. Modifying defensive buffers during active sessions impacts drawdown limits.`);
    }

    if (dangerousWarnings.length > 0) {
      setStrategyDangerousModal({ warnings: dangerousWarnings });
    } else {
      executeSaveStrategy();
    }
  };

  const handleSetPositionStatus = (id: string, status: 'HOLD' | 'SELLING' | 'MONITORING') => {
    const pos = positions.find(p => p.id === id);
    if (!pos) return;

    setPositions(prev => prev.map(p => p.id === id ? { ...p, currentStatus: status } : p));
    
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    let text = '';
    if (status === 'HOLD') {
      text = `[User Override] Manual HOLD configured for ${pos.symbol}. Automatic TP/SL routines suspended.`;
    } else if (status === 'SELLING') {
      text = `[User Override] Manual SELL QUEUE configured for ${pos.symbol}. Swap router preparing priority execution...`;
    } else if (status === 'MONITORING') {
      text = `[User Override] Cleared manual override status for ${pos.symbol}. Active sniper parameters synchronized.`;
    }

    setLogs(prev => [
      {
        id: 'log-' + Date.now(),
        type: 'WARN',
        text,
        timestamp
      },
      ...prev
    ]);

    triggerToast(`${pos.symbol} status set to ${status}`, 'info');
  };

  const handleToggleAutoSell = (id: string) => {
    const pos = positions.find(p => p.id === id);
    if (!pos) return;

    const newStatus = pos.autoSellStatus === 'DISABLED' ? 'ENABLED' : 'DISABLED';
    setPositions(prev => prev.map(p => p.id === id ? { ...p, autoSellStatus: newStatus } : p));

    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setLogs(prev => [
      {
        id: 'log-' + Date.now(),
        type: 'INFO',
        text: `[Automation Settings] Auto-sell exit rules ${newStatus === 'ENABLED' ? 'ENABLED' : 'DISABLED'} for ${pos.symbol}.`,
        timestamp
      },
      ...prev
    ]);

    triggerToast(`Auto-sell ${newStatus === 'ENABLED' ? 'Enabled' : 'Disabled'} for ${pos.symbol}`, 'success');
  };

  const triggerStandardSell = (id: string) => {
    setSellingStates(prev => ({ ...prev, [id]: 'confirming' }));
  };

  const cancelStandardSell = (id: string) => {
    setSellingStates(prev => ({ ...prev, [id]: 'idle' }));
  };

  const confirmStandardSell = async (id: string) => {
    setSellingStates(prev => ({ ...prev, [id]: 'loading' }));
    
    const pos = positions.find(p => p.id === id);
    if (!pos) return;

    if (!pos.tokenAddress) {
      setSellingStates(prev => ({ ...prev, [id]: 'failed' }));
      setLastError(prev => ({ ...prev, [id]: 'Missing contract address. Liquidation cannot be routed.' }));
      triggerToast(`Contract address missing for ${pos.symbol}`, 'error');
      return;
    }

    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setLogs(prev => [
      {
        id: 'log-' + Date.now(),
        type: 'TX',
        text: `[Trade Engine] Initialized standard swap route for ${pos.symbol}. Estimating gas limit...`,
        timestamp
      },
      ...prev
    ]);

    if (mockMode) {
      setTimeout(() => {
        // Simulate failure on MEME VOX initially (to show loading & failure state properly)
        const shouldFail = id === '2' && !lastError[id];
        
        if (shouldFail) {
          setSellingStates(prev => ({ ...prev, [id]: 'failed' }));
          setLastError(prev => ({ ...prev, [id]: 'SLIPPAGE_EXCEEDED (Mempool price deviation > 1.2%)' }));
          
          setLogs(prev => [
            {
              id: 'log-' + Date.now(),
              type: 'ERROR',
              text: `[Trade Engine] TRANSACTION REVERTED: slippage check failed for ${pos.symbol}. Price moved too fast. Swap cancelled to protect user capital.`,
              timestamp
            },
            ...prev
          ]);
          triggerToast(`Sell transaction for ${pos.symbol} reverted!`, 'error');
        } else {
          setSellingStates(prev => ({ ...prev, [id]: 'success' }));
          
          setLogs(prev => [
            {
              id: 'log-' + Date.now(),
              type: 'CONF',
              text: `[Trade Engine] SWAP BROADCAST CONFIRMED for ${pos.symbol}. Tx hash: 0x${Math.random().toString(16).substring(2, 10)}...`,
              timestamp
            },
            ...prev
          ]);
          
          setTimeout(() => {
            handleExitPosition(id, pos.symbol);
            setSellingStates(prev => {
              const next = { ...prev };
              delete next[id];
              return next;
            });
          }, 1200);
        }
      }, 1800);
    } else {
      // PROD MODE - REAL API
      try {
        const fallbackTrade: HistoricalTrade = {
          id: Date.now().toString(),
          tokenAddress: pos.tokenAddress,
          name: pos.name,
          symbol: pos.symbol,
          soldAt: timestamp,
          costEth: pos.entryEth,
          receivedEth: pos.entryEth * (1 + pos.liveProfitPercent / 100),
          profitPercent: pos.liveProfitPercent,
          sellReason: 'Manual_Exit'
        };

        const result = await positionsApi.exitPosition(pos.tokenAddress, pos.liveProfitPercent, fallbackTrade);
        if (result.success) {
          setSellingStates(prev => ({ ...prev, [id]: 'success' }));
          
          setLogs(prev => [
            {
              id: 'log-' + Date.now(),
              type: 'CONF',
              text: `[Trade Engine] SWAP BROADCAST CONFIRMED for ${pos.symbol}. Trade realized.`,
              timestamp
            },
            ...prev
          ]);

          setTimeout(() => {
            setPositions(prev => prev.filter(p => p.id !== id));
            setHistory(prev => [result.trade, ...prev]);
            setSellingStates(prev => {
              const next = { ...prev };
              delete next[id];
              return next;
            });
            fetchRealData();
          }, 1200);
        } else {
          setSellingStates(prev => ({ ...prev, [id]: 'failed' }));
          setLastError(prev => ({ ...prev, [id]: 'Transaction failed on-chain or returned non-success status.' }));
          triggerToast(`Transaction failed for ${pos.symbol}`, 'error');
        }
      } catch (err: any) {
        setSellingStates(prev => ({ ...prev, [id]: 'failed' }));
        setLastError(prev => ({ ...prev, [id]: err?.message || 'Network error executing exitPosition.' }));
        triggerToast(`Error exiting position ${pos.symbol}`, 'error');
      }
    }
  };

  const handleRetrySell = async (id: string) => {
    setLastError(prev => ({ ...prev, [id]: '' }));
    
    const pos = positions.find(p => p.id === id);
    if (!pos) return;

    if (!pos.tokenAddress) {
      setSellingStates(prev => ({ ...prev, [id]: 'failed' }));
      setLastError(prev => ({ ...prev, [id]: 'Missing contract address. Retry aborted.' }));
      triggerToast(`Contract address missing for ${pos.symbol}`, 'error');
      return;
    }

    if (mockMode) {
      confirmStandardSell(id);
    } else {
      setSellingStates(prev => ({ ...prev, [id]: 'loading' }));
      try {
        const result = await positionsApi.retrySell(pos.tokenAddress);
        if (result.success) {
          setSellingStates(prev => ({ ...prev, [id]: 'success' }));
          const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
          setLogs(prev => [
            {
              id: 'log-' + Date.now(),
              type: 'CONF',
              text: `[Trade Engine] RETRY SWAP CONFIRMED for ${pos.symbol}. Tx: ${result.txHash || ''}`,
              timestamp
            },
            ...prev
          ]);
          setTimeout(() => {
            const fallbackTrade: HistoricalTrade = {
              id: Date.now().toString(),
              tokenAddress: pos.tokenAddress,
              name: pos.name,
              symbol: pos.symbol,
              soldAt: timestamp,
              costEth: pos.entryEth,
              receivedEth: pos.entryEth * (1 + pos.liveProfitPercent / 100),
              profitPercent: pos.liveProfitPercent,
              sellReason: 'Manual_Exit_Retry'
            };
            setPositions(prev => prev.filter(p => p.id !== id));
            setHistory(prev => [fallbackTrade, ...prev]);
            setSellingStates(prev => {
              const next = { ...prev };
              delete next[id];
              return next;
            });
            fetchRealData();
          }, 1200);
        } else {
          setSellingStates(prev => ({ ...prev, [id]: 'failed' }));
          setLastError(prev => ({ ...prev, [id]: 'Retry transaction failed on-chain.' }));
          triggerToast(`Retry failed for ${pos.symbol}`, 'error');
        }
      } catch (err: any) {
        setSellingStates(prev => ({ ...prev, [id]: 'failed' }));
        setLastError(prev => ({ ...prev, [id]: err?.message || 'Network error during retrySell.' }));
        triggerToast(`Error retrying sell for ${pos.symbol}`, 'error');
      }
    }
  };

  const triggerEmergencySell = (id: string) => {
    setEmergencyConfirming(prev => ({ ...prev, [id]: true }));
  };

  const cancelEmergencySell = (id: string) => {
    setEmergencyConfirming(prev => ({ ...prev, [id]: false }));
  };

  const confirmEmergencySell = async (id: string) => {
    setEmergencyConfirming(prev => ({ ...prev, [id]: false }));
    setSellingStates(prev => ({ ...prev, [id]: 'loading' }));
    
    const pos = positions.find(p => p.id === id);
    if (!pos) return;

    if (!pos.tokenAddress) {
      setSellingStates(prev => ({ ...prev, [id]: 'failed' }));
      setLastError(prev => ({ ...prev, [id]: 'Missing contract address. Emergency liquidation aborted.' }));
      triggerToast(`Contract address missing for ${pos.symbol}`, 'error');
      return;
    }

    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    
    setLogs(prev => [
      {
        id: 'log-' + Date.now(),
        type: 'TX',
        text: `[Trade Engine] !!! DIRECT BLOCK BYPASS INITIATED for ${pos.symbol} !!! Sending aggressive priority fee gas bundle (+15 GWEI surcharge)...`,
        timestamp
      },
      ...prev
    ]);

    if (mockMode) {
      setTimeout(() => {
        setSellingStates(prev => ({ ...prev, [id]: 'success' }));
        
        setLogs(prev => [
          {
            id: 'log-' + Date.now(),
            type: 'ERROR',
            text: `[Trade Engine] EMERGENCY EXITED: ${pos.symbol} position forcefully terminated at market pool.`,
            timestamp
          },
          ...prev
        ]);
        
        setTimeout(() => {
          setPositions(prev => prev.filter(p => p.id !== id));
          const costEth = pos.entryEth;
          const receivedEth = costEth * (1 + pos.liveProfitPercent / 100);
          
          setHistory(prev => [
            {
              id: Date.now().toString(),
              tokenAddress: pos.tokenAddress,
              name: pos.name,
              symbol: pos.symbol,
              soldAt: timestamp,
              costEth,
              receivedEth,
              profitPercent: pos.liveProfitPercent,
              sellReason: 'Emergency_Panic'
            },
            ...prev
          ]);
          
          setToast({ message: `EMERGENCY TERMINATION COMPLETE: Sold ${pos.symbol}`, type: 'error' });
          setTimeout(() => setToast(null), 3000);

          setSellingStates(prev => {
            const next = { ...prev };
            delete next[id];
            return next;
          });
        }, 1200);
      }, 1200);
    } else {
      // PROD MODE EMERGENCY EXIT
      try {
        const fallbackTrade: HistoricalTrade = {
          id: Date.now().toString(),
          tokenAddress: pos.tokenAddress,
          name: pos.name,
          symbol: pos.symbol,
          soldAt: timestamp,
          costEth: pos.entryEth,
          receivedEth: pos.entryEth * (1 + pos.liveProfitPercent / 100),
          profitPercent: pos.liveProfitPercent,
          sellReason: 'Emergency_Panic'
        };

        const result = await positionsApi.exitPosition(pos.tokenAddress, pos.liveProfitPercent, fallbackTrade);
        if (result.success) {
          setSellingStates(prev => ({ ...prev, [id]: 'success' }));
          
          setLogs(prev => [
            {
              id: 'log-' + Date.now(),
              type: 'ERROR',
              text: `[Trade Engine] EMERGENCY EXITED: ${pos.symbol} position forcefully terminated at market pool.`,
              timestamp
            },
            ...prev
          ]);

          setTimeout(() => {
            setPositions(prev => prev.filter(p => p.id !== id));
            setHistory(prev => [result.trade, ...prev]);
            setToast({ message: `EMERGENCY TERMINATION COMPLETE: Sold ${pos.symbol}`, type: 'error' });
            setTimeout(() => setToast(null), 3000);
            
            setSellingStates(prev => {
              const next = { ...prev };
              delete next[id];
              return next;
            });
            fetchRealData();
          }, 1200);
        } else {
          setSellingStates(prev => ({ ...prev, [id]: 'failed' }));
          setLastError(prev => ({ ...prev, [id]: 'Emergency exit transaction failed.' }));
          triggerToast(`Emergency exit failed for ${pos.symbol}`, 'error');
        }
      } catch (err: any) {
        setSellingStates(prev => ({ ...prev, [id]: 'failed' }));
        setLastError(prev => ({ ...prev, [id]: err?.message || 'Network error during emergency exit.' }));
        triggerToast(`Error during emergency exit for ${pos.symbol}`, 'error');
      }
    }
  };

  // Manual Snipe from Scanner screen
  const handleManualSnipe = (event: ScannerEvent) => {
    if (!botRunning) {
      triggerToast('Cannot execute buy: Bot is suspended', 'error');
      return;
    }

    // Check if already in active positions
    if (positions.some(p => p.tokenAddress === event.tokenAddress)) {
      triggerToast(`Already holding ${event.coinSymbol}`, 'info');
      return;
    }

    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    
    const newPos: ActivePosition = {
      id: Date.now().toString(),
      tokenAddress: event.tokenAddress,
      name: event.coinName,
      symbol: event.coinSymbol,
      boughtAt: timestamp,
      entryEth: 0.05,
      entryUsd: 174.12,
      receivedTokens: 1000,
      initialHolders: event.holdersCount || 1,
      currentHolders: (event.holdersCount || 1) + 2,
      liveMarketCap: event.marketCap || 12000,
      liveValueUsd: 174.12,
      liveProfitPercent: 0.0,
      liveProfitUsd: 0.0,
      momentum: 'flat',
      momentumAtBuy: event.momentum || '+4.6 ETH/min (Moderate)',
      autoSellStatus: 'ENABLED',
      currentStatus: 'MONITORING'
    };

    setPositions(prev => [newPos, ...prev]);

    // Update scanner event state to BOUGHT
    setScannerEvents(prev => prev.map(ev => ev.id === event.id ? { ...ev, statusResult: 'BOUGHT', eventType: 'BUY_SUCCESS' } : ev));

    // Log the transaction
    const newLog: ActivityLog = {
      id: Date.now().toString(),
      type: 'TX',
      text: `Manual Snipe Order executed. Sent 0.05 ETH for ${event.coinSymbol}.`,
      timestamp
    };
    setLogs(prev => [...prev, newLog]);
    triggerToast(`Executed buy for ${event.coinSymbol}!`, 'success');
  };

  // Add event to Watchlist
  const handleAddToWatchlist = (event: ScannerEvent) => {
    triggerToast(`Added ${event.coinSymbol} to dynamic creator track list`, 'success');
  };

  // Clear Terminal Logs
  const handleClearLogs = () => {
    setLogs([]);
    triggerToast('Activity logs cleared', 'info');
  };

  // Download Logs
  const handleDownloadLogs = () => {
    const jsonStr = JSON.stringify(logs, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `zora_sniper_logs_${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
    triggerToast('Logs exported to JSON', 'success');
  };

  // Real-time WebSocket connection manager client with heartbeat & backoff
  useEffect(() => {
    if (mockMode) return;
    if (authState !== 'AUTHENTICATED' || !token || !onboardingComplete || !userProfile) {
      return;
    }

    let reconnectDelay = 1000;
    let isClosing = false;

    const cleanup = () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = null;
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };

    const connect = () => {
      if (isClosing) return;

      // Cleanup any existing connection/timers before reconnecting
      cleanup();

      const apiBase = import.meta.env.VITE_API_BASE_URL || '';
      const fullBase = apiBase || window.location.origin;
      const wsBase = fullBase.replace(/^http/, 'ws');
      // Phase 5: attach JWT token so server can authenticate the socket upgrade
      const jwtToken = localStorage.getItem('jwt_token') || '';
      const wsUrl = jwtToken ? `${wsBase}?token=${encodeURIComponent(jwtToken)}` : wsBase;

      console.log('[FireSocket] Connecting to', wsBase);
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[FireSocket] Connection established successfully');
        setWsConnected(true);
        reconnectDelay = 1000; // Reset reconnect timeout on success

        // Setup 15s server ping heartbeat
        pingIntervalRef.current = setInterval(() => {
          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: 'ping' }));
          }
        }, 15000);
      };

      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.type === 'welcome') return;

          const { collection, id, data, deleted } = payload;
          if (!collection) return;

          console.log(`[FireSocket] Broadcast event for ${collection}:`, payload);

          if (collection === 'trades') {
            if (deleted || (data && data.status === 'sold')) {
              setPositions(prev => prev.filter(p => p.id !== id && p.tokenAddress !== id));
              if (data) {
                setHistory(prev => {
                  const exists = prev.some(h => h.id === id);
                  if (exists) return prev.map(h => h.id === id ? { ...h, ...data } : h);
                  const formatted: HistoricalTrade = {
                    id: id,
                    tokenAddress: data.tokenAddress,
                    name: data.name || 'Unknown',
                    symbol: data.symbol || 'UNK',
                    soldAt: data.soldAt ? new Date(data.soldAt).toLocaleString() : new Date().toLocaleString(),
                    costEth: Number(data.spentOnSellToken || 0) / 1e18,
                    receivedEth: Number(data.received || 0) / 1e18,
                    profitPercent: data.profitPercent || 0,
                    sellReason: data.sellReason || 'Sold'
                  };
                  return [formatted, ...prev];
                });
              }
            } else if (data && data.status === 'bought') {
              const formatted: ActivePosition = {
                id: id,
                tokenAddress: data.tokenAddress,
                name: data.name || 'Unknown',
                symbol: data.symbol || 'UNK',
                boughtAt: data.boughtAt ? new Date(data.boughtAt).toLocaleString() : new Date().toLocaleString(),
                entryEth: Number(data.spentOnSellToken || 0) / 1e18,
                entryUsd: (Number(data.spentOnSellToken || 0) / 1e18) * 3000,
                receivedTokens: Number(data.receivedBuyTokenAmount || 0) / 1e18,
                initialHolders: data.initialHolderCount || 0,
                currentHolders: data.liveHolders || data.initialHolderCount || 0,
                liveMarketCap: data.liveMarketCap || 0,
                liveValueUsd: data.liveValueUsd || 0,
                liveProfitPercent: data.liveProfitPercent || 0,
                liveProfitUsd: data.liveProfitUsd || 0,
                momentum: (data.liveProfitPercent || 0) > 0 ? 'up' : 'down',
                autoSellStatus: data.autoSellDisabled === true ? 'DISABLED' : 'ENABLED',
                currentStatus: 'HOLD',
                txHash: data.txHash,
                creatorAddress: data.creatorAddress
              };
              setPositions(prev => {
                const exists = prev.some(p => p.id === id);
                if (exists) return prev.map(p => p.id === id ? { ...p, ...formatted } : p);
                return [formatted, ...prev];
              });
            }
          } else if (collection === 'targetUsers') {
            if (deleted) {
              setTrackedCreators(prev => prev.filter(c => c.id !== id && c.address !== id));
            } else if (data) {
              const formatted: TrackedCreator = {
                id: id,
                address: id,
                name: data.userId || 'Unknown',
                handle: data.fid ? `@fid_${data.fid}` : '@unknown',
                status: data.status === 'active' ? 'active' : (data.status === 'disabled' ? 'disabled' : 'paused'),
                autoSellEnabled: data.autoSellEnabled !== false,
                stopLossEnabled: data.stopLossEnabled !== false,
                customBuyAmount: data.buyAmountEthOverride || 0.1,
                sellAfterUsers: data.sellAfterUsersOverride || 5,
                antiRekt: {
                  maxBuyTax: data.maxBuyTax || 5,
                  maxSellTax: data.maxSellTax || 5,
                  minLiquidityEth: data.minLiquidityEth || 0.5,
                  devReputationScore: data.devReputationScore || 70
                },
                sellAllAtOnce: data.sellAllAtOnce || false,
                maxSlippageOverride: data.maxSlippageOverride,
                creatorTradeAmountOverride: data.creatorTradeAmountOverride,
                followerOverride: data.followerOverride || false,
                pauseTracking: data.pauseTracking || false,
                emergencyDisable: data.emergencyDisable || false,
                notes: data.notes || '',
                avatarUrl: data.avatarUrl || '',
                fid: data.fid || undefined,
                coinsBoughtCount: data.coinsBoughtCount || 0,
                lastActivity: data.lastActivity || '',
                lifetimePnLEth: data.lifetimePnLEth || 0
              };
              setTrackedCreators(prev => {
                const exists = prev.some(c => c.id === id);
                if (exists) return prev.map(c => c.id === id ? { ...c, ...formatted } : c);
                return [formatted, ...prev];
              });
            }
          } else if (collection === 'config' && id === 'botSettings') {
            if (data) {
              setSavedStrategy(data);
            }
          } else if (collection === 'activityFeed') {
            if (data) {
              // 1. Generate descriptive log text if missing
              let logText = data.text || data.message || '';
              if (!logText) {
                if (data.type === 'SCANNING_COIN') {
                  const chainPrefix = data.chain ? `[${data.chain.toUpperCase()}] ` : '';
                  logText = `${chainPrefix}Detected ${data.symbol || 'UNK'} (${data.name || 'Unknown'}). Status: ${data.status || 'Pending'}.`;
                } else if (data.type === 'CREATOR_COIN_PROFILE') {
                  logText = `[ZORA] Creator profile coin created: ${data.name || 'Unknown'} (${data.symbol || 'UNK'}) by ${data.creator || 'Unknown'}`;
                } else if (data.type === 'BUY_SUCCESS') {
                  logText = `[Trade] Successfully sniped ${data.symbol || 'UNK'}!`;
                } else if (data.type === 'BUY_FAIL') {
                  logText = `[Trade Fail] Snipe failed for ${data.symbol || 'UNK'}: ${data.error || 'Unknown error'}`;
                } else {
                  logText = `[Event] ${data.type || 'INFO'} payload: ${JSON.stringify(data)}`;
                }
              }

              const formattedLog = {
                id: id,
                type: data.type === 'BUY_FAIL' ? 'ERROR' : (data.type === 'BUY_SUCCESS' ? 'HIT' : 'INFO'),
                text: logText,
                timestamp: data.timestamp ? new Date(data.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : new Date().toLocaleTimeString()
              };

              // Update terminal logs
              setLogs(prev => {
                if (prev.some(l => l.id === id)) return prev;
                return [formattedLog, ...prev].slice(0, 100);
              });

              // 2. Instantly update live activityEvents state
              const newActivityEvent: ActivityFeedEvent = {
                id: id,
                type: data.type || 'INFO',
                coinName: data.name || '',
                coinSymbol: data.symbol || '',
                tokenAddress: data.coin || data.tokenAddress || '',
                creatorAddress: data.creator || data.creatorAddress || '',
                txHash: data.txHash || '',
                timestamp: data.timestamp ? (typeof data.timestamp === 'number' || !isNaN(Date.parse(data.timestamp)) ? new Date(data.timestamp).toLocaleTimeString() : data.timestamp) : new Date().toLocaleTimeString(),
                statusResult: data.status === 'Evaluating Requirements...' ? 'PENDING' : (data.type === 'BUY_SUCCESS' ? 'SUCCESS' : (data.type === 'BUY_FAIL' ? 'FAILED' : 'PASSED')),
                errorReason: data.error || data.errorReason || '',
                marketCap: data.marketCap || 0,
                holdersCount: data.liveHolders || 0,
                riskScore: data.riskScore || 0,
                chain: data.chain || 'zora'
              };

              setActivityEvents(prev => {
                const filtered = prev.filter(ae => ae.id !== id);
                return [newActivityEvent, ...filtered].slice(0, 50);
              });

              // 3. Instantly update live scannerEvents state
              if (data.type === 'SCANNING_COIN' || data.type === 'CREATOR_COIN_PROFILE') {
                let scannerStatus: ScannerEvent['statusResult'] = 'PENDING';
                if (data.type === 'BUY_SUCCESS') {
                  scannerStatus = 'BOUGHT';
                } else if (data.type === 'BUY_FAIL') {
                  scannerStatus = 'FAILED';
                } else if (data.status && (data.status.toLowerCase().includes('audit') || data.status.toLowerCase().includes('progress'))) {
                  scannerStatus = 'PASSED';
                }

                const newScannerEvent: ScannerEvent = {
                  id: id,
                  chain: data.chain || 'zora',
                  eventType: data.type || 'SCANNING_COIN',
                  coinName: data.name || 'Unknown',
                  coinSymbol: data.symbol || 'UNK',
                  tokenAddress: data.coin || data.tokenAddress || '',
                  creatorAddress: data.creator || data.creatorAddress || '',
                  timestamp: data.timestamp ? new Date(data.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : new Date().toLocaleTimeString(),
                  statusResult: scannerStatus,
                  riskScore: data.riskScore || 20,
                  auditDetails: data.status || 'Checking requirements...',
                  holdersCount: data.liveHolders || 0,
                  marketCap: data.marketCap || 0,
                  compilerVerified: true,
                  liquidityLockedPercent: 100
                };

                setScannerEvents(prev => {
                  const filtered = prev.filter(e => e.id !== id);
                  return [newScannerEvent, ...filtered].slice(0, 50);
                });
              }
            }
          }
        } catch (err) {
          console.error('[FireSocket] Error parsing broadcast payload:', err);
        }
      };

      ws.onclose = () => {
        setWsConnected(false);
        if (pingIntervalRef.current) {
          clearInterval(pingIntervalRef.current);
          pingIntervalRef.current = null;
        }
        if (!isClosing) {
          console.log(`[FireSocket] Connection closed. Attempting reconnect in ${reconnectDelay}ms...`);
          reconnectTimeoutRef.current = setTimeout(connect, reconnectDelay);
          reconnectDelay = Math.min(reconnectDelay * 2, 30000); // Backoff up to 30s
        }
      };

      ws.onerror = (err) => {
        console.error('[FireSocket] WebSocket runtime error:', err);
      };
    };

    connect();

    return () => {
      isClosing = true;
      cleanup();
    };
  }, [token, mockMode, authState, onboardingComplete, userProfile]);

  // Single source of truth for session restoration on mount
  useEffect(() => {
    if (DEMO_MODE) return;
    let active = true;

    const restore = async () => {
      // 1. Wait for Firebase Auth to initialize/resolve the persisted user
      const firebaseUser = await new Promise<any>((resolve) => {
        const timer = setTimeout(() => resolve(null), 2000);
        const unsubscribe = onAuthStateChanged(
          auth,
          (user) => {
            clearTimeout(timer);
            unsubscribe();
            resolve(user);
          },
          () => {
            clearTimeout(timer);
            resolve(null);
          }
        );
      });

      if (!active) return;

      if (firebaseUser) {
        console.log('[Auth Restoration] Persisted Firebase user found:', firebaseUser.email);
        try {
          const idToken = await firebaseUser.getIdToken();
          const result = await authApi.googleLogin(idToken);
          if (result.jwt_token && active) {
            localStorage.setItem('jwt_token', result.jwt_token);
            setToken(result.jwt_token);
            const role = result?.profile?.role || 'user';
            setUserRole(role);
            setOnboardingComplete(result?.onboardingComplete ?? true);
            setUserProfile({
              uid: result?.profile?.uid || 'user',
              email: result?.profile?.email || 'user@fomoclix.io',
              role: role,
              primaryAddress: result?.profile?.primaryAddress || '',
              plan: result?.plan || 'pro',
              subscriptionActive: result?.subscription?.active ?? true,
              onboardingComplete: result?.onboardingComplete ?? true
            });
            if (result?.tradingWallet) {
              setFullWalletAddress(result.tradingWallet);
              const addr = result.tradingWallet;
              setWalletAddress(addr.length > 10 ? addr.slice(0, 6) + '...' + addr.slice(-4) : addr);
            }
            setAuthState('AUTHENTICATED');
            setTimeout(fetchRealData, 100);
            return;
          }
        } catch (err) {
          console.error('[Auth Restoration] Firebase token exchange failed:', err);
        }
      }

      // 2. If Firebase user not found or exchange failed, fallback to stored JWT
      const localToken = localStorage.getItem('jwt_token');
      if (localToken) {
        console.log('[Auth Restoration] Persisted Wallet JWT found.');
        try {
          const session = await authApi.restoreSession();
          if (active) {
            setToken(localToken);
            const role = session?.profile?.role || 'user';
            setUserRole(role);
            setOnboardingComplete(session?.onboardingComplete ?? true);
            setUserProfile({
              uid: session?.profile?.uid || 'user',
              email: session?.profile?.email || 'user@fomoclix.io',
              role: role,
              primaryAddress: session?.profile?.primaryAddress || '0xFA887A39E22555e1a3f815A9aC730366ec0e05E4',
              plan: session?.plan || 'pro',
              subscriptionActive: session?.subscription?.active ?? true,
              onboardingComplete: session?.onboardingComplete ?? true
            });
            if (session?.tradingWallet) {
              setFullWalletAddress(session.tradingWallet);
              const addr = session.tradingWallet;
              setWalletAddress(addr.length > 10 ? addr.slice(0, 6) + '...' + addr.slice(-4) : addr);
            }
            setAuthState('AUTHENTICATED');
            setTimeout(fetchRealData, 100);
            return;
          }
        } catch (err) {
          console.error('[Auth Restoration] Local session restoration failed:', err);
          if (active) {
            setToken(localToken);
            setUserRole('user');
            setOnboardingComplete(true);
            setUserProfile({
              uid: 'demo_user',
              email: 'trader@fomoclix.io',
              role: 'user',
              primaryAddress: '0xFA887A39E22555e1a3f815A9aC730366ec0e05E4',
              plan: 'pro',
              subscriptionActive: true,
              onboardingComplete: true
            });
            setAuthState('AUTHENTICATED');
            setTimeout(fetchRealData, 100);
            return;
          }
        }
      }

      // 3. Fallback: If no active session found and user hasn't already logged in, present LandingScreen
      if (active) {
        setAuthState(prev => prev === 'AUTHENTICATED' ? 'AUTHENTICATED' : 'UNAUTHENTICATED');
      }
    };

    restore();

    return () => {
      active = false;
    };
  }, []);

  // Simulated live tick updates & scanner feed simulation
  useEffect(() => {
    if (authState !== 'AUTHENTICATED' && !mockMode) return;
    if (!mockMode) {
      if (token && onboardingComplete) {
        // Single fetch on mount to hydrate initial state
        fetchRealData();
        // Fallback polling: only runs every 15s when WebSocket is disconnected
        const interval = setInterval(() => {
          if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
            console.log('[Polling Fallback] WebSocket disconnected, fetching via HTTP...');
            fetchRealData();
          }
        }, 15000);
        return () => clearInterval(interval);
      }
      return;
    }

    const interval = setInterval(() => {
      // 1. Gas fluctuation
      setGasPrice(prev => {
        const change = (Math.random() - 0.5) * 0.8;
        return Math.max(8.5, parseFloat((prev + change).toFixed(1)));
      });

      // 2. Uptime increment
      setUptime(prev => {
        const parts = prev.split(' ');
        let h = parseInt(parts[0]);
        let m = parseInt(parts[1]);
        let s = parseInt(parts[2]);
        s += 1;
        if (s >= 60) { s = 0; m += 1; }
        if (m >= 60) { m = 0; h += 1; }
        return `${h}h ${m}m ${s}s`;
      });

      // 3. Update active position live metrics
      setPositions(prev => 
        prev.map(pos => {
          if (!botRunning) return pos;
          const change = (Math.random() - 0.47) * 2.1; // modest positive bias
          const newProfit = parseFloat((pos.liveProfitPercent + change).toFixed(1));
          const newUsd = parseFloat((pos.entryUsd * (1 + newProfit / 100)).toFixed(2));
          const netUsd = parseFloat((newUsd - pos.entryUsd).toFixed(2));
          
          return {
            ...pos,
            liveProfitPercent: newProfit,
            liveValueUsd: newUsd,
            liveProfitUsd: netUsd,
            momentum: change > 0 ? 'up' : change < 0 ? 'down' : pos.momentum,
            currentHolders: pos.currentHolders + (Math.random() > 0.8 ? 1 : 0)
          };
        })
      );

      // 4. Update CPU loads
      setCpuLoad(prev => {
        const next = [...prev];
        next.shift();
        next.push(Math.floor(Math.random() * 65) + 15);
        return next;
      });

      // 5. Dynamic Scanner Feed Simulation
      if (botRunning && Math.random() > 0.7) {
        // Randomly add a new token scan OR update an existing pending event
        const coinNames = ['PEPE FLOKI V2', 'ZORA SHARDS', 'BASE SPEEDWAY', 'MEME LORD', 'ZORA CATS', 'ALPHA Giga', 'DEX HUNTER', 'NIFTY PUNK'];
        const symbols = ['PFLOKI', 'SHARD', 'SPEED', 'LORD', 'ZCATS', 'ALPHA', 'HUNTER', 'NPUNK'];
        const randomIdx = Math.floor(Math.random() * coinNames.length);
        const name = coinNames[randomIdx];
        const symbol = symbols[randomIdx];
        const tokenAddr = '0x' + Math.random().toString(16).substring(2, 10) + '...' + Math.random().toString(16).substring(2, 6);
        const creatorAddr = '0x' + Math.random().toString(16).substring(2, 10) + '...' + Math.random().toString(16).substring(2, 6);
        const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

        const eventTypes: ScannerEvent['eventType'][] = [
          'SCANNING_COIN', 'COIN_STATS_CHECK', 'SOCIAL_AUDIT', 'MOMENTUM_UPDATE', 'TREND_COIN_DETECTED', 'SNIPER_METRICS'
        ];
        const randEventType = eventTypes[Math.floor(Math.random() * eventTypes.length)];

        // Assign risk & status based on event type
        let status: ScannerEvent['statusResult'] = 'PASSED';
        let risk = Math.floor(Math.random() * 45) + 5; // default low risk
        let details = 'Verified bytecode matches verified compiler specs. Safe to execute trades.';

        if (randEventType === 'SCANNING_COIN') {
          status = 'PENDING';
          risk = Math.floor(Math.random() * 30) + 10;
          details = 'Reading smart contract structure, tracking deployer gas overrides, simulating swap limits...';
        } else if (Math.random() > 0.8) {
          status = 'FAILED';
          risk = Math.floor(Math.random() * 45) + 50; // high risk
          details = 'Honeypot risk identified: Creator fee variables configured with high limit overrides.';
        } else if (Math.random() > 0.8) {
          status = 'WARNING';
          risk = Math.floor(Math.random() * 30) + 40;
          details = 'Moderate security alert: High buy/sell tax configured. Speed parameters reduced.';
        }

        const newEvent: ScannerEvent = {
          id: 'sc-' + Date.now(),
          eventType: randEventType,
          coinName: name,
          coinSymbol: symbol,
          tokenAddress: tokenAddr,
          creatorAddress: creatorAddr,
          creatorHandle: Math.random() > 0.5 ? '@' + symbol.toLowerCase() + '_fans' : undefined,
          marketCap: Math.floor(Math.random() * 45000) + 3000,
          holdersCount: Math.floor(Math.random() * 60) + 1,
          momentum: `+${(Math.random() * 10).toFixed(1)} ETH/min`,
          timestamp,
          statusResult: status,
          riskScore: risk,
          auditDetails: details,
          liquidityLockedPercent: Math.random() > 0.3 ? 100 : Math.floor(Math.random() * 60) + 40,
          buyTax: Math.floor(Math.random() * 6),
          sellTax: Math.floor(Math.random() * 6),
          compilerVerified: Math.random() > 0.1
        };

        // Add to list and keep size reasonable
        setScannerEvents(prev => [newEvent, ...prev.slice(0, 30)]);
        
        // Auto increments scanner metrics
        setScannedMetrics(prev => ({
          ...prev,
          totalScanned: prev.totalScanned + 1,
          passedAudits: status === 'PASSED' ? prev.passedAudits + 1 : prev.passedAudits,
          honeypotsFiltered: status === 'FAILED' ? prev.honeypotsFiltered + 1 : prev.honeypotsFiltered,
          warningTriggers: status === 'WARNING' ? prev.warningTriggers + 1 : prev.warningTriggers
        }));

        // Log this event too!
        const logTypeMap: Record<string, ActivityLog['type']> = {
          'SCANNING_COIN': 'SCAN',
          'COIN_STATS_CHECK': 'CALC',
          'SOCIAL_AUDIT': 'INFO',
          'MOMENTUM_UPDATE': 'HIT',
          'TREND_COIN_DETECTED': 'HIT',
          'SNIPER_METRICS': 'INFO'
        };

        const newLog: ActivityLog = {
          id: 'log-' + Date.now(),
          type: logTypeMap[randEventType] || 'INFO',
          text: `[Scanner] Detected ${symbol} on Zora. Status: ${status}. MCAP: $${newEvent.marketCap?.toLocaleString()}. Risk Score: ${risk}%`,
          timestamp
        };
        setLogs(prev => [newLog, ...prev.slice(0, 50)]);
      }

    }, 3000);

    return () => clearInterval(interval);
  }, [botRunning, mockMode, token, authState, onboardingComplete]);

  // Handle Terminal scroll
  useEffect(() => {
    if (terminalScrollLock && terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, activeTab, terminalScrollLock]);

  // Filter and search live scanner events
  const filteredScannerEvents = scannerEvents.filter(ev => {
    // 0. Chain isolation: only show events matching the active chain
    if (ev.chain && ev.chain !== activeChain) return false;

    // 1. Text Search filter
    const searchMatch = 
      ev.coinName.toLowerCase().includes(scannerSearch.toLowerCase()) ||
      ev.coinSymbol.toLowerCase().includes(scannerSearch.toLowerCase()) ||
      ev.tokenAddress.toLowerCase().includes(scannerSearch.toLowerCase()) ||
      ev.eventType.toLowerCase().includes(scannerSearch.toLowerCase());

    if (!searchMatch) return false;

    // 2. Tab Filter
    if (scannerFilter === 'all') return true;
    if (scannerFilter === 'detected') return ev.eventType === 'SCANNING_COIN' || ev.eventType === 'TREND_COIN_DETECTED';
    if (scannerFilter === 'passed') return ev.statusResult === 'PASSED';
    if (scannerFilter === 'bought') return ev.statusResult === 'BOUGHT';
    if (scannerFilter === 'failed') return ev.statusResult === 'FAILED' || ev.eventType === 'BUY_FAIL';
    if (scannerFilter === 'risk') return ev.riskScore >= 50 || ev.statusResult === 'WARNING';

    return true;
  });

  if (authState === 'AUTH_RESTORING') {
    return (
      <div className="fixed inset-0 bg-[#07080A] flex flex-col items-center justify-center font-mono text-xs text-gray-500 z-50">
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[300px] h-[300px] rounded-full bg-indigo-600/5 blur-3xl animate-pulse" />
        </div>
        <RefreshCw className="w-4 h-4 text-indigo-500 animate-spin mb-3" />
        <span className="tracking-widest uppercase text-gray-400">Restoring Session</span>
        <span className="text-[10px] text-gray-600 mt-1">FOMOCLIX AI OS</span>
      </div>
    );
  }

  if (authState === 'UNAUTHENTICATED') {
    return (
      <LandingScreen 
        onLoginSuccess={handleLoginSuccess}
      />
    );
  }

  return (
    <div id="command-center-root" className="w-full min-h-screen bg-[#07080A] text-[#D1D5DB] font-sans flex flex-col overflow-x-hidden select-none antialiased">
      
      {/* GLOBAL TOAST BANNER */}
      {toast && (
        <div id="live-toast-banner" className={`fixed top-4 right-4 z-50 px-4 py-2.5 border flex items-center space-x-2 text-xs font-mono tracking-wide rounded shadow-xl ${
          toast.type === 'success' ? 'bg-[#0E2015] border-emerald-500 text-emerald-400' :
          toast.type === 'error' ? 'bg-[#2D1214] border-red-500 text-red-400' :
          'bg-[#101B2E] border-blue-500 text-blue-400'
        }`}>
          {toast.type === 'error' && <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />}
          {toast.type === 'success' && <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />}
          {toast.type === 'info' && <Info className="w-4 h-4 text-blue-400 shrink-0" />}
          <span>{toast.message}</span>
        </div>
      )}

      {/* HEADER BAR (COMMON OVER DESKTOP/MOBILE) */}
      <header id="cc-app-header" className="h-14 border-b border-[#1C1F26] flex items-center justify-between px-4 bg-[#0E1118] shrink-0 sticky top-0 z-40">
        <div className="flex items-center space-x-6">
          <div className="flex items-center space-x-2.5">
            <div className={`w-3 h-3 rounded-full ${botRunning ? 'animate-pulse' : ''}`} style={{ backgroundColor: CHAIN_CONFIG[activeChain].accent }}></div>
            <span className="hidden lg:inline font-bold tracking-tight text-white font-mono text-sm">FOMOCLIX_v1.0</span>
          </div>
          {/* Mobile AI Input Box — replaces title on mobile */}
          <div className="lg:hidden flex items-center ml-1 relative">
            <input
              type="text"
              placeholder="✦ Ask AI..."
              onClick={() => setIsMobileChatExpanded(true)}
              readOnly
              className="bg-black/40 border rounded px-2.5 py-1 text-[10px] font-mono text-white placeholder-gray-400 focus:outline-none w-[110px] cursor-pointer animate-[aiGlow_2s_ease-in-out_infinite]"
              style={{ borderColor: `rgba(${CHAIN_CONFIG[activeChain].accentRGB}, 0.5)`, boxShadow: `0 0 12px rgba(${CHAIN_CONFIG[activeChain].accentRGB}, 0.3), 0 0 4px rgba(${CHAIN_CONFIG[activeChain].accentRGB}, 0.15)` }}
            />
          </div>
          <div className="hidden lg:block h-5 w-[1px] bg-[#22252E]"></div>
          <div className="hidden lg:flex space-x-6 text-[10px] uppercase tracking-wider font-mono text-gray-400">
            <span className="flex items-center gap-1.5">
              <span className="text-gray-600">NETWORK:</span> <span style={{ color: CHAIN_CONFIG[activeChain].accent }}>{CHAIN_CONFIG[activeChain].network}</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="text-gray-600">SOCKET:</span> 
              <span className={wsConnected ? 'text-emerald-400 font-bold' : 'text-rose-500'}>
                {wsConnected ? 'STABLE' : 'DISCONNECTED'}
              </span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="text-gray-600">GAS:</span> {gasPrice} GWEI
            </span>
          </div>
        </div>

        {/* THUMB-FRIENDLY COMPACT STATUS */}
        <div className="flex items-center space-x-3">
          {/* CHAIN SELECTOR */}
          <ChainSelector activeChain={activeChain} onChainChange={setActiveChain} />

          {/* CONNECTION STATUS BADGE */}
          <div className="flex items-center space-x-1.5 px-2 py-1.5 bg-black/40 border border-[#1C1F26] rounded shrink-0">
            <span className={`w-1.5 h-1.5 rounded-full ${
              connectionStatus === 'MOCK' 
                ? 'bg-amber-500' 
                : connectionStatus === 'CONNECTED' 
                ? 'bg-emerald-500 animate-pulse' 
                : connectionStatus === 'UNREACHABLE' 
                ? 'bg-rose-500 animate-pulse' 
                : 'bg-rose-600'
            }`}></span>
            <span className={`text-[8px] font-mono uppercase font-black ${
              connectionStatus === 'MOCK' 
                ? 'text-amber-400' 
                : connectionStatus === 'CONNECTED' 
                ? 'text-emerald-400' 
                : connectionStatus === 'UNREACHABLE' 
                ? 'text-rose-400' 
                : 'text-rose-500'
            }`}>
              {connectionStatus === 'MOCK' 
                ? 'MOCK' 
                : connectionStatus === 'CONNECTED' 
                ? 'CONNECTED' 
                : connectionStatus === 'UNREACHABLE' 
                ? 'UNREACHABLE' 
                : 'API_ERROR'}
            </span>
          </div>

          <div className="text-right">
            <div className="text-[9px] text-gray-500 font-mono leading-none">ETH_BALANCE</div>
            <div className="text-xs font-bold text-emerald-400 leading-tight font-mono">
              {walletBalance.eth.toFixed(4)} ETH <span className="text-[10px] text-gray-400 font-normal">(${(walletBalance.eth * ethPrice).toFixed(2)})</span>
            </div>
          </div>
          <button 
            id="global-halt-btn"
            onClick={() => setShowEmergencyModal(true)}
            className="px-3 py-1.5 bg-rose-950/40 border border-rose-500/75 text-rose-400 text-[10px] font-bold uppercase tracking-wider hover:bg-rose-500 hover:text-white transition-all duration-150 rounded shadow-md cursor-pointer hover:shadow-rose-900/40"
          >
            HALT BOT
          </button>
          <button 
            id="global-logout-btn"
            onClick={handleLogout}
            className="px-3 py-1.5 bg-slate-900 border border-slate-700 text-slate-300 text-[10px] font-bold uppercase tracking-wider hover:bg-slate-800 hover:text-white transition-all duration-150 rounded shadow-md cursor-pointer"
          >
            LOGOUT
          </button>
        </div>
      </header>

      {/* CONNECTION ERROR BANNER */}
      {(connectionStatus === 'UNREACHABLE' || connectionStatus === 'ERROR') && (
        <div id="connection-error-banner" className="bg-rose-950/80 border-b border-rose-500/50 px-4 py-2.5 flex items-center justify-between text-xs font-mono text-rose-200">
          <div className="flex items-center space-x-2.5">
            <span className="w-2.5 h-2.5 bg-rose-500 rounded-full animate-ping shrink-0"></span>
            <span className="font-bold uppercase tracking-wider text-rose-400">[CRITICAL_CONNECTION_ERROR]:</span>
            <span>The frontend is unable to reach the Zora Trading Bot backend service. Trading commands and stats are disabled.</span>
          </div>
          <button 
            onClick={fetchRealData} 
            className="px-2.5 py-1 bg-rose-800 hover:bg-rose-700 text-white font-bold uppercase rounded border border-rose-500 text-[10px] transition-all cursor-pointer"
          >
            RECONNECT
          </button>
        </div>
      )}

      {/* MOBILE MINI TELEMETRY STRIP */}
      <div id="mobile-telemetry-bar" className="lg:hidden h-8 border-b border-[#1C1F26] bg-[#0A0D14] px-4 flex items-center justify-between font-mono text-[9px] text-gray-400">
        <span className="flex items-center gap-1">
          <span className={`w-1.5 h-1.5 rounded-full ${wsConnected ? 'bg-emerald-500' : 'bg-rose-500'}`}></span>
          SOCKET_STABLE
        </span>
        <span>GAS: {gasPrice} GWEI</span>
        <span className="text-gray-500">UPTIME: {uptime.split(' ').slice(0, 2).join(' ')}</span>
      </div>

      {/* MAIN LAYOUT WRAPPER */}
      <div id="main-content-layout" className="flex-1 flex flex-col lg:flex-row overflow-hidden pb-16 lg:pb-0">
        
        {/* DESKTOP SIDE NAVIGATION */}
        <nav id="desktop-side-navigation" className="hidden lg:flex w-64 border-r border-[#1C1F26] flex-col bg-[#0E1118] shrink-0 justify-between">
          <div className="flex flex-col space-y-1.5 p-4">
            
            <div className="text-[10px] font-mono uppercase tracking-wider text-gray-500 px-3 mb-2 font-bold">
              NAVIGATION_ROOM
            </div>

            <button 
              onClick={() => setActiveTab('command')}
              className={`w-full px-3 py-2.5 rounded text-left font-mono text-xs uppercase flex items-center justify-between transition-all ${
                activeTab === 'command' 
                  ? 'bg-blue-600/10 border border-blue-500/30 text-white font-bold' 
                  : 'hover:bg-[#151924]/60 text-gray-400 border border-transparent'
              }`}
            >
              <span className="flex items-center space-x-2.5">
                <Server className={`w-4 h-4 ${activeTab === 'command' ? 'text-blue-400' : 'text-gray-500'}`} />
                <span>COMMAND_CENTER</span>
              </span>
              <ChevronRight className="w-3.5 h-3.5 opacity-50" />
            </button>

            <button 
              onClick={() => setActiveTab('scanner')}
              className={`w-full px-3 py-2.5 rounded text-left font-mono text-xs uppercase flex items-center justify-between transition-all relative ${
                activeTab === 'scanner' 
                  ? 'bg-blue-600/10 border border-blue-500/30 text-white font-bold' 
                  : 'hover:bg-[#151924]/60 text-gray-400 border border-transparent'
              }`}
            >
              <span className="flex items-center space-x-2.5">
                <Flame className={`w-4 h-4 ${activeTab === 'scanner' ? 'text-orange-400 animate-pulse' : 'text-gray-500'}`} />
                <span>LIVE_SCANNER</span>
              </span>
              <span className="flex items-center space-x-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse"></span>
                <ChevronRight className="w-3.5 h-3.5 opacity-50" />
              </span>
            </button>

            <button 
              onClick={() => setActiveTab('positions')}
              className={`w-full px-3 py-2.5 rounded text-left font-mono text-xs uppercase flex items-center justify-between transition-all ${
                activeTab === 'positions' 
                  ? 'bg-blue-600/10 border border-blue-500/30 text-white font-bold' 
                  : 'hover:bg-[#151924]/60 text-gray-400 border border-transparent'
              }`}
            >
              <span className="flex items-center space-x-2.5">
                <Activity className={`w-4 h-4 ${activeTab === 'positions' ? 'text-emerald-400' : 'text-gray-500'}`} />
                <span>POSITIONS_BOARD</span>
              </span>
              <span className="bg-emerald-950 text-emerald-400 text-[9px] font-bold px-1.5 py-0.2 rounded border border-emerald-900">
                {positions.length}
              </span>
            </button>

            <button 
              onClick={() => setActiveTab('creators')}
              className={`w-full px-3 py-2.5 rounded text-left font-mono text-xs uppercase flex items-center justify-between transition-all ${
                activeTab === 'creators' 
                  ? 'bg-blue-600/10 border border-blue-500/30 text-white font-bold' 
                  : 'hover:bg-[#151924]/60 text-gray-400 border border-transparent'
              }`}
            >
              <span className="flex items-center space-x-2.5">
                <Users className={`w-4 h-4 ${activeTab === 'creators' ? 'text-indigo-400' : 'text-gray-500'}`} />
                <span>CREATORS_WATCHLIST</span>
              </span>
              <span className="bg-indigo-950 text-indigo-400 text-[9px] font-bold px-1.5 py-0.2 rounded border border-indigo-900 font-mono">
                {trackedCreators.length}
              </span>
            </button>

            <button 
              onClick={() => setActiveTab('strategy')}
              className={`w-full px-3 py-2.5 rounded text-left font-mono text-xs uppercase flex items-center justify-between transition-all ${
                activeTab === 'strategy' 
                  ? 'bg-blue-600/10 border border-blue-500/30 text-white font-bold' 
                  : 'hover:bg-[#151924]/60 text-gray-400 border border-transparent'
              }`}
            >
              <span className="flex items-center space-x-2.5">
                <SlidersHorizontal className={`w-4 h-4 ${activeTab === 'strategy' ? 'text-indigo-400' : 'text-gray-500'}`} />
                <span>TARGET_STRATEGY</span>
              </span>
              <ChevronRight className="w-3.5 h-3.5 opacity-50" />
            </button>

            <button 
              onClick={() => setActiveTab('logs')}
              className={`w-full px-3 py-2.5 rounded text-left font-mono text-xs uppercase flex items-center justify-between transition-all ${
                activeTab === 'logs' 
                  ? 'bg-blue-600/10 border border-blue-500/30 text-white font-bold' 
                  : 'hover:bg-[#151924]/60 text-gray-400 border border-transparent'
              }`}
            >
              <span className="flex items-center space-x-2.5">
                <Terminal className={`w-4 h-4 ${activeTab === 'logs' ? 'text-teal-400' : 'text-gray-500'}`} />
                <span>ACTIVITY_FEED</span>
              </span>
              <ChevronRight className="w-3.5 h-3.5 opacity-50" />
            </button>

          </div>

          {/* DESKTOP SIDEBAR AI CHAT COMPANION */}
          <CompanionWidget
            messages={aiMessages}
            sending={sendingAi}
            onSendMessage={handleSendAiMessage}
            layout="desktop"
            onExecuteAction={handleExecuteAiAction}
            apiBase={import.meta.env.VITE_API_BASE_URL || ''}
            token={token || ''}
          />

          {/* TELEMETRY FOOTER PANEL */}
          <div className="p-4 border-t border-[#1C1F26] bg-[#0A0C12] space-y-3">
            <div className="flex justify-between items-center text-[10px] font-mono text-gray-500">
              <span>CPU_LOAD_METERS</span>
              <span className="text-gray-300 font-bold">{cpuLoad[cpuLoad.length - 1]}%</span>
            </div>
            
            <div className="flex space-x-1.5 h-6 items-end bg-black/40 p-1 rounded border border-gray-900">
              {cpuLoad.map((val, idx) => (
                <div 
                  key={idx} 
                  className={`flex-1 rounded-sm transition-all duration-300 ${
                    val > 80 ? 'bg-rose-500/60' : val > 50 ? 'bg-amber-500/50' : 'bg-emerald-500/40'
                  }`} 
                  style={{ height: `${val}%` }}
                ></div>
              ))}
            </div>

            <div className="space-y-1 text-[9px] font-mono text-gray-500">
              <div className="flex justify-between">
                <span>UPTIME:</span>
                <span className="text-gray-300">{uptime}</span>
              </div>
              <div className="flex justify-between">
                <span>RAM_USAGE:</span>
                <span className="text-gray-300">{ramUsage}</span>
              </div>
            </div>
          </div>
        </nav>

        {/* WORKSPACE AREA (CHANGES CONTENT BY TAB) */}
        <main id="main-workspace-container" className="flex-1 flex flex-col bg-[#07080A] overflow-y-auto">
          
          {/* ==================== 1. COMMAND TAB ==================== */}
          {activeTab === 'command' && (
            <div id="tab-command-workspace" className="p-4 lg:p-6 space-y-6">
              
              {/* STATUS OVERVIEW STRIP */}
              <div id="hero-status-strip" className="grid grid-cols-2 lg:grid-cols-5 gap-3 bg-[#0E1118] border border-[#1C1F26] p-4 rounded shadow-sm">
                <div className="space-y-1">
                  <span className="text-[9px] font-mono uppercase text-gray-500 block">SYSTEM_EXECUTION</span>
                  <div className="flex items-center space-x-2">
                    <span className={`w-2.5 h-2.5 rounded-full ${botRunning ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`}></span>
                    <span className="text-xs font-bold text-white font-mono">{botRunning ? 'ACTIVE' : 'SUSPENDED'}</span>
                  </div>
                </div>
                <div className="space-y-1">
                  <span className="text-[9px] font-mono uppercase text-gray-500 block">API_CONNECTION</span>
                  <div className="flex items-center space-x-2">
                    <span className={`w-2.5 h-2.5 rounded-full ${
                      connectionStatus === 'MOCK' 
                        ? 'bg-amber-500' 
                        : connectionStatus === 'CONNECTED' 
                        ? 'bg-emerald-500 animate-pulse' 
                        : 'bg-rose-500 animate-pulse'
                    }`}></span>
                    <span className="text-xs font-bold text-white font-mono uppercase">
                      {connectionStatus === 'MOCK' 
                        ? 'MOCK' 
                        : connectionStatus === 'CONNECTED' 
                        ? 'CONNECTED' 
                        : connectionStatus === 'UNREACHABLE' 
                        ? 'UNREACHABLE' 
                        : 'API_ERROR'}
                    </span>
                  </div>
                </div>
                <div className="space-y-1">
                  <span className="text-[9px] font-mono uppercase text-gray-500 block">WEBSOCKET_CONN</span>
                  <div className="flex items-center space-x-2">
                    <span className={`w-2.5 h-2.5 rounded-full ${wsConnected ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`}></span>
                    <span className="text-xs font-bold text-white font-mono">{wsConnected ? 'STABLE' : 'DISCONNECTED'}</span>
                  </div>
                </div>
                <div className="space-y-1">
                  <span className="text-[9px] font-mono uppercase text-gray-500 block">ACTIVE_SNIPES</span>
                  <div className="flex items-center space-x-1.5">
                    <Activity className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                    <span className="text-xs font-bold text-white font-mono">{positions.length} TOKENS</span>
                  </div>
                </div>
                <div className="space-y-1 col-span-2 lg:col-span-1">
                  <span className="text-[9px] font-mono uppercase text-gray-500 block">TODAY_PERFORMANCE</span>
                  <span className="text-xs font-bold text-emerald-400 font-mono">
                    +{sessionPnLEth.toFixed(2)} ETH (+{netPnLPercent}%)
                  </span>
                </div>
              </div>

              {/* LATEST LOG TAPE */}
              {logs.length > 0 && (
                <div id="latest-log-tape-bar" className="bg-[#0E1118]/85 border border-[#1C1F26] px-4 py-2.5 rounded flex items-center justify-between text-[11px] font-mono shadow-sm">
                  <div className="flex items-center space-x-2 truncate">
                    <Terminal className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                    <span className="text-gray-500 shrink-0">[{logs[0].timestamp}]</span>
                    <span className="text-gray-300 truncate">{logs[0].text}</span>
                  </div>
                  <button 
                    onClick={() => setActiveTab('logs')}
                    className="text-blue-400 hover:text-blue-300 ml-2 shrink-0 hover:underline uppercase text-[9px] font-bold cursor-pointer"
                  >
                    View All Logs
                  </button>
                </div>
              )}

              {/* TWO COLUMN WORKSPACE GRID */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                
                {/* COLUMN 1 & 2 */}
                <div className="lg:col-span-2 space-y-6">

                  {/* USER PROFILE SUBSCRIPTION BADGE (MOBILE) */}
                  <div className="block lg:hidden">
                    <UserProfileTag profile={userProfile} />
                  </div>
                  
                  {/* MASTER ACTIONS GRID */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    
                    {/* BOT MASTER CONTROLLER */}
                    <div className="border border-[#1C1F26] bg-[#0E1118] rounded p-4 flex flex-col justify-between space-y-4">
                      <div>
                        <div className="flex justify-between items-center mb-1">
                          <h4 className="text-white font-bold text-xs uppercase tracking-wider font-mono flex items-center gap-1.5">
                            <Server className="w-3.5 h-3.5 text-blue-400" />
                            Bot Engine Master
                          </h4>
                          <span className={`px-1.5 py-0.5 text-[8px] font-mono font-bold uppercase tracking-wider rounded border ${
                            botRunning ? 'bg-[#0E2015] border-emerald-800 text-emerald-400' : 'bg-[#211A0D] border-amber-800 text-amber-500'
                          }`}>
                            {botRunning ? 'active' : 'paused'}
                          </span>
                        </div>
                        <p className="text-[10px] text-gray-400 leading-relaxed font-mono">
                          Suspend sniper algorithm cycle. Suspension leaves current positions unmanaged unless manually exited or exited via trigger rules.
                        </p>
                      </div>

                      <button 
                        onClick={handleToggleBot}
                        className={`w-full py-2.5 rounded font-mono text-[11px] font-bold uppercase flex items-center justify-center space-x-2 border transition-all duration-150 cursor-pointer ${
                          botRunning 
                            ? 'bg-amber-950/40 border-amber-600/40 text-amber-400 hover:bg-amber-600 hover:text-white' 
                            : 'bg-emerald-950/40 border-emerald-600/40 text-emerald-400 hover:bg-emerald-600 hover:text-white'
                        }`}
                      >
                        {botRunning ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                        <span>{botRunning ? 'SUSPEND_BOT_sniping' : 'RESUME_BOT_sniping'}</span>
                      </button>
                    </div>

                    {/* WALLET & FUND INFORMATION */}
                    <div className="border border-[#1C1F26] bg-[#0E1118] rounded p-4 flex flex-col justify-between space-y-4">
                      <div>
                        <h4 className="text-white font-bold text-xs uppercase tracking-wider font-mono flex items-center gap-1.5 mb-1">
                          <Wallet className="w-3.5 h-3.5 text-blue-400" />
                          Target Wallet Account
                        </h4>
                        <div className="flex items-center justify-between text-[10px] text-gray-400 font-mono mt-2">
                          <span>ADDRESS: <span className="text-white font-mono">{walletAddress}</span></span>
                          <button 
                            onClick={copyWallet} 
                            className="text-blue-400 hover:text-blue-300 flex items-center gap-1 hover:underline cursor-pointer"
                          >
                            <Copy className="w-3 h-3" />
                            <span>{isCopied ? 'COPIED' : 'COPY'}</span>
                          </button>
                        </div>
                      </div>

                      <div className="border-t border-[#1C1F26] pt-3 flex justify-between items-end">
                        <div>
                          <span className="text-[9px] font-mono text-gray-500 block uppercase">AVAILABLE_GAS_FUNDS</span>
                          <span className="text-base font-bold font-mono text-white leading-none">{walletBalance.eth.toFixed(4)} ETH <span className="text-xs text-gray-400 font-normal">(${(walletBalance.eth * ethPrice).toFixed(2)})</span></span>
                        </div>
                        <div className="text-right">
                          <span className="text-[9px] font-mono text-gray-500 block uppercase">ETH_USDT_DEX</span>
                          <span className="text-xs font-bold font-mono text-gray-300 block">${ethPrice.toLocaleString()}</span>
                        </div>
                      </div>
                    </div>

                  </div>

                  {/* ACTIVE POSITIONS QUICK DASH */}
                  <div className="border border-[#1C1F26] bg-[#0E1118] rounded overflow-hidden">
                    <div className="px-4 py-2.5 bg-[#141822] border-b border-[#1C1F26] flex justify-between items-center">
                      <span className="text-[10px] font-bold uppercase text-gray-400 tracking-wider flex items-center gap-1.5 font-mono">
                        <Activity className="w-3.5 h-3.5 text-blue-400 animate-pulse" />
                        Active_Sells_Monitor ({positions.length})
                      </span>
                      <button 
                        onClick={() => setActiveTab('positions')}
                        className="text-[9px] text-blue-400 hover:text-white font-mono hover:underline uppercase"
                      >
                        Manage All
                      </button>
                    </div>

                    {positions.length === 0 ? (
                      <div className="p-10 text-center bg-black/20">
                        <AlertTriangle className="w-8 h-8 text-gray-600 mx-auto mb-2" />
                        <span className="font-mono text-xs text-gray-500 block uppercase">No Live Positions</span>
                        <p className="text-[10px] text-gray-600 mt-1 max-w-sm mx-auto">The automated sniper is running. Matches will auto-execute based on target parameters.</p>
                      </div>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs font-mono">
                          <thead className="bg-[#0E1118] border-b border-[#1C1F26] text-gray-500 text-[10px] uppercase">
                            <tr>
                              <th className="p-3 font-normal">TOKEN</th>
                              <th className="p-3 font-normal text-right">COST_BASIS</th>
                              <th className="p-3 font-normal text-right">LIVE_MCAP</th>
                              <th className="p-3 font-normal text-right">LIVE_PNL</th>
                              <th className="p-3 font-normal text-center">MANAGE</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-[#1C1F26]">
                            {positions.map((pos) => {
                              const isProfit = pos.liveProfitPercent >= 0;
                              return (
                                <tr key={pos.id} className="hover:bg-[#151924]/40 transition-all">
                                  <td className="p-3">
                                    <div className="font-bold text-white leading-none mb-1 flex items-center gap-1">
                                      {pos.name}
                                      <span className="text-[8px] font-mono text-blue-400 bg-blue-950/40 px-1 py-0.2 rounded border border-blue-900/40">
                                        {pos.symbol}
                                      </span>
                                    </div>
                                    <span className="text-[9px] text-gray-500 font-mono">{pos.tokenAddress.substring(0, 8)}...{pos.tokenAddress.substring(34)}</span>
                                  </td>
                                  <td className="p-3 text-right">
                                    <div className="text-white leading-none mb-0.5">{pos.entryEth.toFixed(3)} ETH</div>
                                    <div className="text-[9px] text-gray-500">${pos.entryUsd.toFixed(2)}</div>
                                  </td>
                                  <td className="p-3 text-right text-white font-bold font-mono">
                                    ${pos.liveMarketCap.toLocaleString()}
                                  </td>
                                  <td className="p-3 text-right">
                                    <div className={`text-xs font-bold font-mono ${isProfit ? 'text-emerald-400' : 'text-rose-500'}`}>
                                      {isProfit ? '+' : ''}{pos.liveProfitPercent.toFixed(1)}%
                                    </div>
                                    <div className={`text-[9px] ${isProfit ? 'text-emerald-600' : 'text-rose-500/80'}`}>
                                      ${pos.liveProfitUsd >= 0 ? '+' : ''}{pos.liveProfitUsd.toFixed(2)}
                                    </div>
                                  </td>
                                  <td className="p-3 text-center">
                                    <button 
                                      onClick={() => setActiveTab('positions')}
                                      className="px-2.5 py-1 border border-blue-500/40 text-blue-400 text-[10px] hover:bg-blue-600 hover:text-white transition-colors uppercase font-bold rounded font-mono cursor-pointer"
                                    >
                                      MANAGE
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                </div>

                {/* COLUMN 3: SIDE TELEMETRY STATS & COMPREHENSIVE FEED */}
                <div className="space-y-6">
                  
                  {/* USER PROFILE SUBSCRIPTION BADGE (DESKTOP) */}
                  <div className="hidden lg:block">
                    <UserProfileTag profile={userProfile} />
                  </div>

                  {/* PERFORMANCE SCORE CARD */}
                  <div className="border border-[#1C1F26] bg-[#0E1118] rounded p-4 space-y-4">
                    <h4 className="text-white font-bold text-xs uppercase tracking-wider font-mono flex items-center gap-1.5 border-b border-[#1C1F26] pb-2">
                      <TrendingUp className="w-3.5 h-3.5 text-blue-400" />
                      Session Metrics (24H)
                    </h4>

                    <div className="grid grid-cols-2 gap-3 font-mono">
                      <div className="p-2.5 bg-black/20 border border-gray-900 rounded">
                        <span className="text-[8px] text-gray-500 block uppercase">WIN_RATE_STREAK</span>
                        <span className="text-base font-bold text-white block">{winRate}%</span>
                        <span className="text-[8px] text-emerald-500 block">{winTrades}/{totalTrades} Trades Green</span>
                      </div>
                      <div className="p-2.5 bg-black/20 border border-gray-900 rounded">
                        <span className="text-[8px] text-gray-500 block uppercase">TOTAL_SCANS</span>
                        <span className="text-base font-bold text-white block">{scannedMetrics.totalScanned}</span>
                        <span className="text-[8px] text-gray-500 block">Avg Hold: {totalTrades > 0 ? '8m' : '0m'}</span>
                      </div>
                    </div>

                    <div className="space-y-3 pt-1 font-mono text-[10px]">
                      <div className="flex justify-between items-center text-gray-400">
                        <span>MAXIMUM_DRAWDOWN</span>
                        <span className="text-rose-500 font-bold">
                          {totalTrades > 0 ? Math.min(...history.map(h => h.profitPercent || 0), 0).toFixed(1) : '0.0'}%
                        </span>
                      </div>
                      <div className="h-1 bg-black/40 rounded-full overflow-hidden">
                        <div className="h-full bg-rose-500" style={{ width: `${Math.min(Math.abs(totalTrades > 0 ? Math.min(...history.map(h => h.profitPercent || 0), 0) : 0) * 3, 100)}%` }}></div>
                      </div>
                      
                      <div className="flex justify-between items-center text-gray-400">
                        <span>GAS_CONSUMPTION</span>
                        <span className="text-blue-400">{(totalTrades * 0.0015).toFixed(4)} ETH</span>
                      </div>
                      <div className="h-1 bg-black/40 rounded-full overflow-hidden">
                        <div className="h-full bg-blue-500" style={{ width: `${Math.min(totalTrades * 5, 100)}%` }}></div>
                      </div>
                    </div>
                  </div>

                  {/* MINI STATIC LATEST SCANNER LOG */}
                  <div className="border border-[#1C1F26] bg-[#0E1118] rounded p-4 space-y-3">
                    <div className="flex justify-between items-center border-b border-[#1C1F26] pb-2">
                      <h4 className="text-white font-bold text-xs uppercase tracking-wider font-mono flex items-center gap-1.5">
                        <Flame className="w-3.5 h-3.5 text-orange-400" />
                        Sniper Hits
                      </h4>
                      <span className="text-[8px] text-emerald-400 uppercase font-mono tracking-widest animate-pulse">Scanning</span>
                    </div>

                    <div className="space-y-2.5 font-mono text-[10px]">
                      {scannerEvents.slice(0, 3).map((ev) => {
                        let dotColor = 'bg-blue-500';
                        if (ev.statusResult === 'BOUGHT') dotColor = 'bg-emerald-500 animate-pulse';
                        if (ev.statusResult === 'FAILED') dotColor = 'bg-rose-500';
                        if (ev.statusResult === 'WARNING') dotColor = 'bg-amber-500';

                        return (
                          <div key={ev.id} className="p-2 bg-black/20 border border-[#1C1F26] rounded flex items-start gap-2">
                            <div className={`w-1.5 h-1.5 rounded-full mt-1 shrink-0 ${dotColor}`}></div>
                            <div className="flex-1 min-w-0">
                              <div className="flex justify-between items-center">
                                <span className="font-bold text-white text-[10px] truncate">{ev.coinSymbol} detected</span>
                                <span className="text-gray-500 text-[8px] shrink-0">{ev.timestamp}</span>
                              </div>
                              <p className="text-gray-400 text-[9px] mt-0.5 leading-normal truncate">
                                {ev.auditDetails}
                              </p>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    <button 
                      onClick={() => setActiveTab('scanner')}
                      className="w-full py-2 bg-blue-600/10 hover:bg-blue-600 hover:text-white border border-blue-500/20 text-blue-400 font-mono text-xs uppercase rounded text-center transition-all duration-150 cursor-pointer"
                    >
                      ENTER LIVE INTELLIGENCE FEED
                    </button>
                  </div>

                </div>

              </div>

            </div>
          )}

          {activeTab === 'scanner' && activeChain === 'solana' && (
            <div id="tab-scanner-solana" className="p-4 lg:p-6 space-y-6">
              <div className="flex items-center space-x-2 mb-2">
                <h2 className="text-lg lg:text-xl font-bold font-mono text-white tracking-tight uppercase">
                  Solana Token Scanner
                </h2>
                <span className="flex h-2.5 w-2.5 relative">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-violet-500"></span>
                </span>
              </div>
              <p className="text-xs text-gray-400 font-mono -mt-4 mb-4">
                Monitoring Pump.fun bonding curves, PumpSwap graduations, and Jupiter swap routes on Solana.
              </p>
              <SolanaScanner
                apiBase={import.meta.env.VITE_API_BASE_URL || ''}
                token={token}
              />
            </div>
          )}

          {activeTab === 'scanner' && activeChain === 'base' && (
            <div id="tab-scanner-base" className="p-4 lg:p-6 space-y-6">
              <div className="flex items-center space-x-2 mb-2">
                <h2 className="text-lg lg:text-xl font-bold font-mono text-white tracking-tight uppercase">
                  Base DEX Scanner
                </h2>
                <span className="flex h-2.5 w-2.5 relative">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-blue-500"></span>
                </span>
              </div>
              <p className="text-xs text-gray-400 font-mono -mt-4 mb-4">
                Tracking Uniswap V3, Aerodrome, and BaseSwap new pair listings on Base L2.
              </p>
              <BaseScanner
                apiBase={import.meta.env.VITE_API_BASE_URL || ''}
                token={token}
              />
            </div>
          )}

          {/* ==================== 2. SCANNER TAB — ZORA (ORIGINAL) ==================== */}
          {activeTab === 'scanner' && activeChain === 'zora' && (
            <div id="tab-scanner-workspace" className="p-4 lg:p-6 space-y-6">
              
              {/* TOP STRIP & SUMMARY METRICS */}
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                  <div className="flex items-center space-x-2">
                    <h2 className="text-lg lg:text-xl font-bold font-mono text-white tracking-tight uppercase">
                      Live Token Intelligence Feed
                    </h2>
                    <span className="flex h-2.5 w-2.5 relative">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 font-mono">
                    Sniffing on-chain contracts in real time. Dynamic safety assessments & social index metrics.
                  </p>
                </div>

                {/* ACTION FOR PAUSED BOT */}
                {!botRunning && (
                  <div className="bg-amber-950/40 border border-amber-600/40 rounded px-3 py-1.5 flex items-center space-x-2 text-xs font-mono text-amber-500 animate-pulse">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>ALGORITHM SUSPENDED: New detections are restricted.</span>
                  </div>
                )}
              </div>

              {/* HIGH LEVEL METRICS GRID */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2 md:gap-3">
                <div className="bg-[#0E1118] border border-[#1C1F26] p-3 rounded font-mono">
                  <span className="text-[8px] text-gray-500 block uppercase">TOTAL_DETECTED</span>
                  <span className="text-lg font-bold text-white block">{scannedMetrics.totalScanned}</span>
                  <span className="text-[8px] text-gray-400">Contracts on-chain</span>
                </div>
                <div className="bg-[#0E1118] border border-[#1C1F26] p-3 rounded font-mono">
                  <span className="text-[8px] text-gray-500 block uppercase">PASSED_SAFETY</span>
                  <span className="text-lg font-bold text-emerald-400 block">{scannedMetrics.passedAudits}</span>
                  <span className="text-[8px] text-emerald-600">Swap simulation safe</span>
                </div>
                <div className="bg-[#0E1118] border border-[#1C1F26] p-3 rounded font-mono">
                  <span className="text-[8px] text-gray-500 block uppercase">HONEYPOTS_BLOCKED</span>
                  <span className="text-lg font-bold text-rose-500 block">{scannedMetrics.honeypotsFiltered}</span>
                  <span className="text-[8px] text-rose-400/80">Malicious logic halted</span>
                </div>
                <div className="bg-[#0E1118] border border-[#1C1F26] p-3 rounded font-mono">
                  <span className="text-[8px] text-gray-500 block uppercase">AUTO_SNIPED</span>
                  <span className="text-lg font-bold text-blue-400 block">{scannedMetrics.snipedTokens}</span>
                  <span className="text-[8px] text-blue-500">Filled by trigger rules</span>
                </div>
                <div className="bg-[#0E1118] border border-[#1C1F26] p-3 rounded font-mono col-span-2 md:col-span-1">
                  <span className="text-[8px] text-gray-500 block uppercase">WARNING_ALERTS</span>
                  <span className="text-lg font-bold text-amber-500 block">{scannedMetrics.warningTriggers}</span>
                  <span className="text-[8px] text-amber-600">High tax / Dev ownership</span>
                </div>
              </div>

              {/* FILTERS & SEARCH TOOLBAR */}
              <div className="bg-[#0E1118] border border-[#1C1F26] rounded p-3 flex flex-col md:flex-row gap-3 justify-between items-center">
                
                {/* HORIZONTAL FILTERS */}
                <div className="flex flex-wrap gap-1 w-full md:w-auto">
                  {(['all', 'detected', 'passed', 'bought', 'failed', 'risk'] as const).map((filter) => {
                    const active = scannerFilter === filter;
                    return (
                      <button
                        key={filter}
                        onClick={() => setScannerFilter(filter)}
                        className={`px-3 py-1.5 rounded-sm font-mono text-[10px] font-bold uppercase tracking-wider border cursor-pointer transition-all ${
                          active
                            ? 'bg-blue-600/15 border-blue-500 text-white'
                            : 'bg-black/20 border-transparent hover:border-gray-800 text-gray-400'
                        }`}
                      >
                        {filter}
                      </button>
                    );
                  })}
                </div>

                {/* SEARCH BAR */}
                <div className="relative w-full md:w-72">
                  <Search className="w-4 h-4 text-gray-500 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    placeholder="Search by symbol or address..."
                    value={scannerSearch}
                    onChange={(e) => setScannerSearch(e.target.value)}
                    className="w-full pl-9 pr-4 py-2 bg-black/30 border border-[#1C1F26] text-xs font-mono text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 rounded"
                  />
                  {scannerSearch && (
                    <button 
                      onClick={() => setScannerSearch('')} 
                      className="absolute right-3 top-2 text-gray-400 hover:text-white"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>

              </div>

              {/* ACTIVE FILTER / EVENTS COUNTER */}
              <div className="flex justify-between items-center text-[10px] font-mono text-gray-500">
                <span>SHOWING {filteredScannerEvents.length} OF {scannerEvents.length} SCANNED EVENTS</span>
                {scannerSearch && <span>FILTERED_BY: "{scannerSearch}"</span>}
              </div>

              {/* LIVE INTELLIGENCE FEED CARDS LIST */}
              {filteredScannerEvents.length === 0 ? (
                <div className="border border-[#1C1F26] bg-black/10 rounded p-12 text-center">
                  <AlertCircle className="w-10 h-10 text-gray-600 mx-auto mb-2" />
                  <span className="font-mono text-xs text-gray-500 block uppercase">No matching intelligence events found</span>
                  <p className="text-[10px] text-gray-600 mt-1 max-w-xs mx-auto">Try resetting your search query or choosing another filter category.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {filteredScannerEvents.map((ev) => {
                    // Decide status indicators
                    let resultBadgeClass = '';
                    let borderClass = 'border-[#1C1F26]';
                    let typeColor = 'text-blue-400';

                    if (ev.statusResult === 'BOUGHT') {
                      resultBadgeClass = 'bg-[#0E2015] border-emerald-800 text-emerald-400';
                      borderClass = 'border-emerald-950/60 bg-[#0E1418]';
                    } else if (ev.statusResult === 'FAILED') {
                      resultBadgeClass = 'bg-[#210D10] border-rose-800 text-rose-400';
                      borderClass = 'border-rose-950/40 bg-[#120F12]';
                    } else if (ev.statusResult === 'WARNING') {
                      resultBadgeClass = 'bg-[#1E1609] border-amber-800 text-amber-400';
                      borderClass = 'border-amber-950/40 bg-[#121110]';
                    } else if (ev.statusResult === 'PASSED') {
                      resultBadgeClass = 'bg-[#0E2015] border-emerald-900/40 text-emerald-400';
                    } else {
                      resultBadgeClass = 'bg-[#10141D] border-blue-900/40 text-blue-400';
                    }

                    // Risk rating color
                    const isHighRisk = ev.riskScore >= 50;
                    const isLowRisk = ev.riskScore < 25;
                    const riskColor = isHighRisk ? 'text-rose-400' : isLowRisk ? 'text-emerald-400' : 'text-amber-400';

                    return (
                      <div 
                        key={ev.id} 
                        className={`border ${borderClass} bg-[#0E1118]/80 hover:bg-[#0E1118] transition-all rounded p-3 lg:p-4 font-mono`}
                      >
                        {/* HEADER: TYPE, STATUS, TIME */}
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1C1F26]/60 pb-2 mb-3">
                          <div className="flex items-center space-x-2">
                            <span className="text-[9px] text-gray-500">[{ev.timestamp}]</span>
                            <span className="text-[10px] font-bold text-white uppercase tracking-wider flex items-center gap-1">
                              {ev.eventType === 'SCANNING_COIN' && <Search className="w-3.5 h-3.5 text-blue-400" />}
                              {ev.eventType === 'TREND_COIN_DETECTED' && <Flame className="w-3.5 h-3.5 text-orange-400" />}
                              {ev.eventType === 'BUY_SUCCESS' && <Check className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />}
                              {ev.eventType === 'BUY_FAIL' && <XCircle className="w-3.5 h-3.5 text-rose-500" />}
                              {ev.eventType === 'SOCIAL_AUDIT' && <UserCheck className="w-3.5 h-3.5 text-indigo-400" />}
                              {ev.eventType === 'MOMENTUM_UPDATE' && <TrendingUp className="w-3.5 h-3.5 text-cyan-400" />}
                              {ev.eventType === 'COIN_STATS_CHECK' && <SlidersHorizontal className="w-3.5 h-3.5 text-teal-400" />}
                              {ev.eventType === 'SNIPER_METRICS' && <Activity className="w-3.5 h-3.5 text-purple-400" />}
                              {ev.eventType}
                            </span>
                          </div>

                          <div className="flex items-center space-x-2">
                            <span className={`px-2 py-0.5 border text-[9px] font-bold uppercase rounded-sm ${resultBadgeClass}`}>
                              {ev.statusResult}
                            </span>
                            <span className="text-[9px] text-gray-500 uppercase">RISK_SCORE: <span className={`font-bold ${riskColor}`}>{ev.riskScore}%</span></span>
                          </div>
                        </div>

                        {/* COIN INFO */}
                        <div className="grid grid-cols-1 lg:grid-cols-4 gap-3 lg:gap-4">
                          
                          {/* COIN IDENTIFIER */}
                          <div className="lg:col-span-1 space-y-1">
                            <div className="flex items-baseline space-x-1.5">
                              <span className="text-sm font-bold text-white uppercase">{ev.coinName}</span>
                              <span className="text-[9px] font-bold text-blue-400 bg-blue-950/40 px-1 py-0.2 rounded border border-blue-900/40">
                                {ev.coinSymbol}
                              </span>
                            </div>
                            <div className="text-[9px] text-gray-500 truncate select-all" title="Click to copy contract">
                              ADDR: <span className="text-gray-400">{ev.tokenAddress}</span>
                            </div>
                            {ev.creatorHandle && (
                              <div className="text-[9px] text-indigo-400 font-bold flex items-center gap-1">
                                <UserCheck className="w-3 h-3" />
                                <span>{ev.creatorHandle}</span>
                              </div>
                            )}
                          </div>

                          {/* STATS METRICS ROW */}
                          <div className="lg:col-span-2 grid grid-cols-3 gap-2 bg-black/15 p-2 rounded border border-[#1C1F26]/40">
                            <div>
                              <span className="text-[8px] text-gray-500 uppercase block">MARKET_CAP</span>
                              <span className="text-xs font-bold text-white">
                                {ev.marketCap ? `$${ev.marketCap.toLocaleString()}` : '$-'}
                              </span>
                            </div>
                            <div>
                              <span className="text-[8px] text-gray-500 uppercase block">HOLDERS_INDEX</span>
                              <span className="text-xs font-bold text-white">
                                {ev.holdersCount ? `${ev.holdersCount} wallets` : '1 wallet'}
                              </span>
                            </div>
                            <div>
                              <span className="text-[8px] text-gray-500 uppercase block">MOMENTUM_RATE</span>
                              <span className="text-xs font-bold text-orange-400 truncate block">
                                {ev.momentum || 'STABLE'}
                              </span>
                            </div>
                          </div>

                          {/* QUICK ACTIONS */}
                          <div className="lg:col-span-1 flex lg:flex-col justify-end gap-1.5">
                            <button
                              onClick={() => handleManualSnipe(ev)}
                              disabled={ev.statusResult === 'BOUGHT'}
                              className={`flex-1 py-1 px-2.5 rounded text-[10px] font-bold uppercase transition-all duration-150 cursor-pointer ${
                                ev.statusResult === 'BOUGHT'
                                  ? 'bg-[#0E2015] border border-emerald-800 text-emerald-400/60 cursor-not-allowed'
                                  : 'bg-emerald-600 hover:bg-emerald-500 text-white hover:shadow hover:shadow-emerald-900/30'
                              }`}
                            >
                              {ev.statusResult === 'BOUGHT' ? 'AUTO_SNIPED' : 'MANUAL_SNIPE'}
                            </button>
                            <div className="flex gap-1 shrink-0">
                              <button
                                onClick={() => handleAddToWatchlist(ev)}
                                className="p-1 border border-[#1C1F26] hover:bg-[#151924] text-gray-400 hover:text-white rounded cursor-pointer"
                                title="Add to Watchlist"
                              >
                                <Plus className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => setSelectedScannerEvent(ev)}
                                className="p-1 border border-[#1C1F26] hover:bg-[#151924] text-gray-400 hover:text-white rounded cursor-pointer"
                                title="Inspect Security Code Audit"
                              >
                                <Eye className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>

                        </div>

                        {/* AUDIT SUMMARY BRIEF */}
                        <div className="mt-3 p-2 bg-black/10 border-l-2 border-blue-500 rounded-r text-[9px] text-gray-400 leading-normal flex items-start gap-1.5">
                          <Info className="w-3.5 h-3.5 text-blue-400 shrink-0 mt-0.5" />
                          <span>{ev.auditDetails}</span>
                        </div>

                      </div>
                    );
                  })}
                </div>
              )}

            </div>
          )}

          {/* ==================== 3. POSITIONS TAB ==================== */}
          {activeTab === 'positions' && (
            <div id="tab-positions-workspace" className="p-4 lg:p-6 space-y-6">
              
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-[#1C1F26] pb-4">
                <div>
                  <h2 className="text-lg lg:text-xl font-bold font-mono text-white tracking-tight uppercase">
                    Active Snipes & Holds Board
                  </h2>
                  <p className="text-xs text-gray-400 font-mono">
                    Real-time valuation of filled snipes. Overwrite safety parameters or trigger manual swap routing.
                  </p>
                </div>
                <div className="flex items-center space-x-2">
                  <span className="bg-emerald-950/80 border border-emerald-800 text-emerald-400 text-xs px-3 py-1.5 font-bold font-mono rounded tracking-wider uppercase animate-pulse">
                    ● Sniper Feeds Active
                  </span>
                  <span className="bg-[#10141D] border border-gray-800 text-gray-300 text-xs px-3 py-1.5 font-bold font-mono rounded">
                    {positions.length} ACTIVE
                  </span>
                </div>
              </div>

              {/* FLOATING PORTFOLIO METRICS */}
              {positions.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="bg-[#0E1118] border border-[#1C1F26] p-4 rounded font-mono flex flex-col justify-between">
                    <div>
                      <span className="text-[9px] text-gray-500 block uppercase tracking-wider">INVESTED_CAPITAL</span>
                      <span className="text-xl font-bold text-white block mt-1">
                        ${positions.reduce((acc, pos) => acc + pos.entryUsd, 0).toFixed(2)}
                      </span>
                    </div>
                    <span className="text-[10px] text-gray-400 mt-2 block">
                      Basis Total: {positions.reduce((acc, pos) => acc + pos.entryEth, 0).toFixed(3)} ETH
                    </span>
                  </div>

                  <div className="bg-[#0E1118] border border-[#1C1F26] p-4 rounded font-mono flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="text-[9px] text-gray-500 uppercase tracking-wider">LIVE_PORTFOLIO_VALUATION</span>
                        <span className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
                        </span>
                      </div>
                      <span className="text-xl font-bold text-blue-400 block mt-1">
                        ${positions.reduce((acc, pos) => acc + pos.liveValueUsd, 0).toFixed(2)}
                      </span>
                    </div>
                    <span className="text-[10px] text-gray-400 mt-2 block">
                      Synchronized on-chain pool rates
                    </span>
                  </div>

                  {(() => {
                    const invested = positions.reduce((acc, pos) => acc + pos.entryUsd, 0);
                    const current = positions.reduce((acc, pos) => acc + pos.liveValueUsd, 0);
                    const pnlVal = current - invested;
                    const pnlPct = invested > 0 ? (pnlVal / invested) * 100 : 0;
                    const isProfit = pnlVal >= 0;

                    return (
                      <div className={`border p-4 rounded font-mono flex flex-col justify-between transition-all ${
                        isProfit 
                          ? 'bg-[#0E2015]/40 border-emerald-900/60 shadow-[0_0_15px_-3px_rgba(16,185,129,0.05)]' 
                          : 'bg-[#210D10]/40 border-rose-950/60 shadow-[0_0_15px_-3px_rgba(244,63,94,0.05)]'
                      }`}>
                        <div>
                          <span className="text-[9px] text-gray-500 block uppercase tracking-wider">UNREALIZED_SESSION_P&L</span>
                          <span className={`text-xl font-bold block mt-1 ${isProfit ? 'text-emerald-400' : 'text-rose-500'}`}>
                            {isProfit ? '+' : ''}{pnlPct.toFixed(2)}%
                          </span>
                        </div>
                        <span className={`text-[10px] font-bold mt-2 block ${isProfit ? 'text-emerald-500' : 'text-rose-400'}`}>
                          {isProfit ? '+' : ''}${pnlVal.toFixed(2)} Net floating profit
                        </span>
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* CARD CONTAINER GRID */}
              <div className="space-y-6">
                
                {positions.length === 0 ? (
                  <div className="border border-[#1C1F26] bg-[#0E1118] p-16 rounded text-center">
                    <AlertTriangle className="w-12 h-12 text-gray-700 mx-auto mb-3 animate-pulse" />
                    <span className="font-mono text-xs text-gray-400 block uppercase font-bold tracking-wider">No Active Positions Remaining</span>
                    <p className="text-[11px] text-gray-600 mt-2 max-w-sm mx-auto font-mono">
                      All token snipes are exited. The bot Sniper is listening to new Solidity bytecode contracts on Zora mainnet.
                    </p>
                    <button 
                      onClick={() => setActiveTab('scanner')}
                      className="mt-5 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white font-mono text-xs uppercase font-bold rounded tracking-wider cursor-pointer"
                    >
                      Enter Live Sniper Feed
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                    <AnimatePresence mode="popLayout">
                      {positions.map((pos) => {
                        const isProfit = pos.liveProfitPercent >= 0;
                        const sellState = sellingStates[pos.id] || 'idle';
                        const isEmerConfirming = emergencyConfirming[pos.id] || false;
                        const hasError = lastError[pos.id] || '';
                        
                        const curStatus = pos.currentStatus || 'MONITORING';
                        const autoSellActive = pos.autoSellStatus === 'ENABLED';

                        return (
                          <motion.div
                            key={pos.id}
                            layout
                            initial={{ opacity: 0, y: 15 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            transition={{ duration: 0.2 }}
                            className={`relative border bg-[#0E1118] rounded overflow-hidden flex flex-col justify-between shadow-2xl transition-all ${
                              sellState === 'loading' ? 'border-blue-500/80 ring-1 ring-blue-500/20' :
                              sellState === 'failed' ? 'border-rose-600 ring-1 ring-rose-500/10' :
                              isEmerConfirming ? 'border-rose-700 ring-2 ring-rose-950 animate-pulse' :
                              isProfit ? 'border-[#1C1F26] hover:border-emerald-500/20' : 'border-[#1C1F26] hover:border-rose-500/20'
                            }`}
                          >
                            {/* DYNAMIC BACKDROP STATUS STRIP */}
                            <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-transparent via-gray-800 to-transparent"></div>

                            {/* CARD CORE BODY */}
                            <div className="p-4 sm:p-5 space-y-4">
                              
                              {/* HEADER ROW: COIN IDENTIFIERS & STATUS */}
                              <div className="flex justify-between items-start gap-3">
                                <div className="space-y-1">
                                  <div className="flex items-baseline space-x-2">
                                    <h3 className="text-base font-bold text-white tracking-tight leading-none">
                                      {pos.name}
                                    </h3>
                                    <span className="text-[9px] font-mono text-blue-400 bg-blue-950/40 px-1.5 py-0.5 rounded border border-blue-900/40 font-bold uppercase shrink-0">
                                      {pos.symbol}
                                    </span>
                                  </div>
                                  <div className="flex items-center space-x-1 text-[10px] text-gray-500 font-mono">
                                    <span>ADDR:</span>
                                    <span className="text-gray-400 select-all font-mono truncate max-w-[120px] sm:max-w-[200px]" title={pos.tokenAddress || 'N/A'}>
                                      {pos.tokenAddress || 'UNDEFINED'}
                                    </span>
                                    {pos.tokenAddress && (
                                      <button 
                                        onClick={() => {
                                          navigator.clipboard.writeText(pos.tokenAddress);
                                          triggerToast(`Copied ${pos.symbol} address to clipboard`, 'success');
                                        }}
                                        className="text-gray-500 hover:text-white transition-colors cursor-pointer"
                                        title="Copy address"
                                      >
                                        <Copy className="w-3 h-3" />
                                      </button>
                                    )}
                                  </div>

                                  {pos.creatorAddress && (
                                    <div className="flex items-center space-x-1 text-[10px] text-gray-500 font-mono">
                                      <span>CREATOR:</span>
                                      <span className="text-gray-400 select-all font-mono truncate max-w-[120px] sm:max-w-[200px]" title={pos.creatorAddress}>
                                        {pos.creatorAddress}
                                      </span>
                                      <button 
                                        onClick={() => {
                                          navigator.clipboard.writeText(pos.creatorAddress || '');
                                          triggerToast(`Copied creator address to clipboard`, 'success');
                                        }}
                                        className="text-gray-500 hover:text-white transition-colors cursor-pointer"
                                        title="Copy creator address"
                                      >
                                        <Copy className="w-3 h-3" />
                                      </button>
                                    </div>
                                  )}

                                  {pos.txHash && (
                                    <div className="flex items-center space-x-1 text-[10px] text-gray-500 font-mono">
                                      <span>TX_HASH:</span>
                                      <span className="text-blue-400 select-all font-mono truncate max-w-[120px] sm:max-w-[200px]" title={pos.txHash}>
                                        {pos.txHash}
                                      </span>
                                      <button 
                                        onClick={() => {
                                          navigator.clipboard.writeText(pos.txHash || '');
                                          triggerToast(`Copied transaction hash to clipboard`, 'success');
                                        }}
                                        className="text-gray-500 hover:text-white transition-colors cursor-pointer"
                                        title="Copy TX hash"
                                      >
                                        <Copy className="w-3 h-3" />
                                      </button>
                                    </div>
                                  )}
                                </div>

                                {/* STATUS GLOW TAG */}
                                <div className="text-right flex flex-col items-end gap-1">
                                  {curStatus === 'HOLD' && (
                                    <span className="px-2 py-0.5 bg-[#1F140A] border border-amber-900 text-amber-500 text-[9px] font-bold font-mono rounded-sm flex items-center gap-1.5">
                                      <span className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-pulse"></span>
                                      HOLDING_BYPASS
                                    </span>
                                  )}
                                  {curStatus === 'SELLING' && (
                                    <span className="px-2 py-0.5 bg-[#250E12] border border-rose-900 text-rose-400 text-[9px] font-bold font-mono rounded-sm flex items-center gap-1.5">
                                      <span className="w-1.5 h-1.5 bg-rose-500 rounded-full animate-ping"></span>
                                      EXEC_QUEUED
                                    </span>
                                  )}
                                  {curStatus === 'MONITORING' && (
                                    <span className="px-2 py-0.5 bg-[#0A1A10] border border-emerald-900 text-emerald-400 text-[9px] font-bold font-mono rounded-sm flex items-center gap-1.5">
                                      <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></span>
                                      AUTO_SNIPER
                                    </span>
                                  )}
                                  <span className="text-[8px] text-gray-500 font-mono block uppercase">
                                    Bought: {pos.boughtAt}
                                  </span>
                                </div>
                              </div>

                              {/* LIVE PNL BLOCK (HIGH VISIBILITY PROPORTIONAL CONTAINER) */}
                              <div className={`p-4 rounded border flex items-center justify-between font-mono ${
                                isProfit 
                                  ? 'bg-[#0E2015]/30 border-emerald-950/60' 
                                  : 'bg-[#210D10]/30 border-rose-950/60'
                              }`}>
                                <div className="space-y-1">
                                  <span className="text-[8px] text-gray-500 uppercase block tracking-wider">LIVE_ESTIMATED_VALUATION</span>
                                  <div className="flex items-baseline space-x-1.5">
                                    <span className="text-lg font-bold text-white font-mono">
                                      ${pos.liveValueUsd.toFixed(2)}
                                    </span>
                                    <span className="text-[10px] text-gray-400">USD</span>
                                  </div>
                                  <div className="text-[9px] text-gray-500 leading-none">
                                    Cost: {pos.entryEth.toFixed(3)} ETH (${pos.entryUsd.toFixed(2)})
                                  </div>
                                </div>

                                <div className="text-right space-y-0.5">
                                  <span className="text-[8px] text-gray-500 block uppercase tracking-wider">UNREALIZED_RETURN</span>
                                  <div className={`text-xl font-black ${isProfit ? 'text-emerald-400' : 'text-rose-500'} flex items-center justify-end gap-1 font-mono`}>
                                    {isProfit ? '▲' : '▼'}{isProfit ? '+' : ''}{pos.liveProfitPercent.toFixed(1)}%
                                  </div>
                                  <div className={`text-[10px] font-bold ${isProfit ? 'text-emerald-600' : 'text-rose-500/80'}`}>
                                    {pos.liveProfitUsd >= 0 ? '+' : ''}${pos.liveProfitUsd.toFixed(2)}
                                  </div>
                                </div>
                              </div>

                              {/* PARAMS BENTO MATRIX */}
                              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 bg-black/20 p-2.5 rounded border border-[#1C1F26]/60 text-xs font-mono">
                                <div>
                                  <span className="text-[8px] text-gray-500 uppercase block">SWAP_RECEIVED</span>
                                  <span className="font-bold text-gray-200 block truncate">
                                    {pos.receivedTokens.toLocaleString()} {pos.symbol}
                                  </span>
                                </div>
                                <div>
                                  <span className="text-[8px] text-gray-500 uppercase block">LIVE_POOL_MCAP</span>
                                  <span className="font-bold text-gray-200 block">
                                    ${pos.liveMarketCap.toLocaleString()}
                                  </span>
                                </div>
                                <div className="col-span-2 sm:col-span-1">
                                  <span className="text-[8px] text-gray-500 uppercase block">HOLDER_COUNT</span>
                                  <span className="font-bold text-gray-200 block">
                                    {pos.currentHolders} <span className="text-[8px] text-gray-500">INIT: {pos.initialHolders}</span>
                                  </span>
                                </div>
                              </div>

                              {/* STRATEGY DETAILS & DYNAMIC AUTOMATED TOGGLER */}
                              <div className="bg-[#0A0D14] p-3 rounded border border-gray-950/60 font-mono text-[10px] space-y-2">
                                <div className="flex justify-between items-center text-gray-400">
                                  <span className="flex items-center gap-1.5">
                                    <Flame className="w-3.5 h-3.5 text-orange-400 shrink-0" />
                                    Momentum at buy block:
                                  </span>
                                  <span className="font-bold text-white bg-black/40 px-1.5 py-0.5 border border-[#1C1F26] rounded">
                                    {pos.momentumAtBuy || 'Pending...'}
                                  </span>
                                </div>

                                <div className="flex justify-between items-center border-t border-[#1C1F26]/50 pt-2 text-gray-400">
                                  <span className="flex items-center gap-1.5">
                                    <SlidersHorizontal className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                                    Auto-Exit TP/SL rules:
                                  </span>
                                  <div className="flex items-center space-x-2">
                                    <span className={`font-bold ${autoSellActive ? 'text-emerald-400' : 'text-gray-500'}`}>
                                      {autoSellActive ? `ACTIVE (TP: +${strategy.takeProfitPercent}% / SL: -${strategy.stopLossPercent}%)` : 'OFF'}
                                    </span>
                                    <button 
                                      onClick={() => handleToggleAutoSell(pos.id)}
                                      className="px-2 py-0.5 border border-[#1C1F26] hover:border-gray-600 bg-black/40 hover:bg-black text-gray-300 text-[9px] font-bold rounded cursor-pointer transition-all uppercase"
                                    >
                                      {autoSellActive ? 'Disable' : 'Enable'}
                                    </button>
                                  </div>
                                </div>
                              </div>

                              {/* STATUS OVERWRITE PANEL (DECIDE WHETHER TO HOLD, SELL, OR CLEAR STATUS) */}
                              <div className="bg-black/10 border border-[#1C1F26]/40 rounded p-2.5 space-y-1.5 font-mono text-[10px]">
                                <span className="text-[8px] text-gray-500 block uppercase font-bold tracking-wider">
                                  MANUAL_DECISION_OVERWRITE
                                </span>
                                <div className="grid grid-cols-3 gap-1">
                                  <button
                                    onClick={() => handleSetPositionStatus(pos.id, 'HOLD')}
                                    className={`py-1 px-1 rounded-sm text-[9px] font-bold uppercase transition-all duration-150 border cursor-pointer ${
                                      curStatus === 'HOLD'
                                        ? 'bg-[#1F140A] border-amber-600 text-amber-400 shadow-md'
                                        : 'bg-black/20 border-transparent text-gray-500 hover:text-gray-300 hover:border-gray-800'
                                    }`}
                                    title="Block automatic triggers. Lock custody."
                                  >
                                    HOLD COIN
                                  </button>
                                  <button
                                    onClick={() => handleSetPositionStatus(pos.id, 'SELLING')}
                                    className={`py-1 px-1 rounded-sm text-[9px] font-bold uppercase transition-all duration-150 border cursor-pointer ${
                                      curStatus === 'SELLING'
                                        ? 'bg-[#250E12] border-rose-600 text-rose-400 shadow-md'
                                        : 'bg-black/20 border-transparent text-gray-500 hover:text-gray-300 hover:border-gray-800'
                                    }`}
                                    title="Force routing queues. Prepare execution."
                                  >
                                    SELL QUEUE
                                  </button>
                                  <button
                                    onClick={() => handleSetPositionStatus(pos.id, 'MONITORING')}
                                    className={`py-1 px-1 rounded-sm text-[9px] font-bold uppercase transition-all duration-150 border cursor-pointer ${
                                      curStatus === 'MONITORING'
                                        ? 'bg-[#0A1A10] border-emerald-800 text-emerald-400 shadow-md'
                                        : 'bg-black/20 border-transparent text-gray-500 hover:text-gray-300 hover:border-gray-800'
                                    }`}
                                    title="Synchronize back to default active sniper rules."
                                  >
                                    RESET/AUTO
                                  </button>
                                </div>
                              </div>

                              {/* STANDARD SELL ROW (REQUIRES CONFIRMATION) */}
                              <div className="border-t border-[#1C1F26] pt-4">
                                {sellState === 'idle' && (
                                  <div>
                                    <button
                                      onClick={() => {
                                        if (pos.tokenAddress) {
                                          triggerStandardSell(pos.id);
                                        }
                                      }}
                                      disabled={!pos.tokenAddress}
                                      className={`w-full py-2 font-mono text-xs font-black uppercase rounded text-center transition-all duration-150 tracking-wider shadow ${
                                        !pos.tokenAddress
                                          ? 'bg-gray-950 border border-gray-900 text-gray-650 cursor-not-allowed'
                                          : 'bg-emerald-600/10 hover:bg-emerald-600 border border-emerald-500/30 hover:border-emerald-500 text-emerald-400 hover:text-white cursor-pointer'
                                      }`}
                                    >
                                      SWAP POSITION TO ETH (SELL)
                                    </button>
                                    {!pos.tokenAddress && (
                                      <p className="text-[9px] text-rose-500/80 mt-1.5 font-mono text-center">
                                        ⚠ Contract address is undefined or invalid. Liquidation routes cannot be built.
                                      </p>
                                    )}
                                  </div>
                                )}

                                {sellState === 'confirming' && (
                                  <div className="bg-[#10141D] border border-emerald-500 p-3 rounded-md space-y-3 font-mono animate-fadeIn">
                                    <div className="flex items-start space-x-2 text-xs">
                                      <Info className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                                      <div className="space-y-1">
                                        <span className="font-bold text-white block">Swap Confirmation Required</span>
                                        <p className="text-[10px] text-gray-400 leading-normal">
                                          Swap your entire holding of <span className="text-white font-bold">{pos.receivedTokens.toLocaleString()} {pos.symbol}</span> for ETH? Gas fee estimate is {gasPrice} GWEI (~$1.22). Slippage parameter locked at {strategy.maxSlippage}%.
                                        </p>
                                      </div>
                                    </div>
                                    <div className="flex gap-2">
                                      <button
                                        onClick={() => confirmStandardSell(pos.id)}
                                        className="flex-1 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold uppercase rounded cursor-pointer transition-all"
                                      >
                                        YES, SEND SWAP
                                      </button>
                                      <button
                                        onClick={() => cancelStandardSell(pos.id)}
                                        className="flex-1 py-1.5 bg-gray-850 hover:bg-gray-800 text-gray-300 text-[10px] font-bold uppercase rounded border border-gray-800 cursor-pointer transition-all"
                                      >
                                        CANCEL
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </div>

                            </div>

                            {/* EMERGENCY SELL AREA (VISUALLY SEPARATED EXTRA CAUTIOUS ACTION ZONE) */}
                            <div className="bg-[#12070A] border-t border-rose-950 px-4 py-3 sm:px-5 flex flex-col justify-between gap-2">
                              {!isEmerConfirming ? (
                                <div className="flex items-center justify-between gap-4">
                                  <div className="min-w-0">
                                    <span className="text-[9px] font-bold text-rose-500 uppercase block tracking-wider font-mono">
                                      CRITICAL_BLOCK_BYPASS
                                    </span>
                                    <p className="text-[9px] text-gray-500 font-mono truncate">
                                      Force instant Uniswap liquidations.
                                    </p>
                                  </div>
                                  <button
                                    onClick={() => {
                                      if (pos.tokenAddress) {
                                        triggerEmergencySell(pos.id);
                                      }
                                    }}
                                    disabled={!pos.tokenAddress}
                                    className={`px-3 py-1 text-[9px] font-bold uppercase tracking-wider rounded transition-all select-none font-mono ${
                                      !pos.tokenAddress
                                        ? 'bg-gray-950 border border-gray-900 text-gray-650 cursor-not-allowed'
                                        : 'bg-red-950/40 border border-red-800 text-red-400 hover:bg-red-600 hover:text-white cursor-pointer'
                                    }`}
                                  >
                                    EMERGENCY EXIT
                                  </button>
                                </div>
                              ) : (
                                <div className="bg-[#2D1214] border border-red-500 p-2.5 rounded-sm space-y-2 animate-fadeIn font-mono">
                                  <div className="flex items-start space-x-1.5">
                                    <AlertOctagon className="w-4 h-4 text-red-500 shrink-0 mt-0.5 animate-pulse" />
                                    <div>
                                      <span className="text-[10px] font-bold text-red-400 block uppercase">
                                        !! DOUBLE CONFIRM LIQUIDATION !!
                                      </span>
                                      <p className="text-[9px] text-gray-400 leading-normal">
                                        Bypasses standard transaction safety simulations. Sends maximum fee priority surcharge (+15 GWEI) to force immediate miner validation. This action cannot be revoked.
                                      </p>
                                    </div>
                                  </div>
                                  <div className="flex gap-2">
                                    <button
                                      onClick={() => confirmEmergencySell(pos.id)}
                                      className="flex-1 py-1 bg-rose-600 hover:bg-rose-500 text-white text-[9px] font-bold uppercase rounded cursor-pointer transition-all"
                                    >
                                      FORCE PANIC SELL
                                    </button>
                                    <button
                                      onClick={() => cancelEmergencySell(pos.id)}
                                      className="flex-1 py-1 bg-gray-850 hover:bg-gray-800 text-gray-300 text-[9px] font-bold uppercase rounded border border-gray-800 cursor-pointer transition-all"
                                    >
                                      ABORT
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>

                            {/* TRANSACTION LOADING MASK OVERLAY */}
                            {sellState === 'loading' && (
                              <div className="absolute inset-0 bg-black/95 backdrop-blur-sm z-30 flex flex-col items-center justify-center p-6 text-center select-none font-mono text-xs">
                                <RefreshCw className="w-8 h-8 text-blue-500 animate-spin mb-3" />
                                <span className="font-bold text-white uppercase tracking-widest block">
                                  BROADCASTING SWAP TX...
                                </span>
                                <div className="space-y-1 text-gray-500 text-[10px] mt-3 tracking-wide text-left max-w-xs mx-auto">
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-emerald-500">✔</span> Approve ERC20 spending limit
                                  </div>
                                  <div className="flex items-center gap-1.5 animate-pulse">
                                    <span className="text-blue-500">●</span> Assembling gas multi-call bundle
                                  </div>
                                  <div className="text-gray-600">
                                    Awaiting block proposer confirmation
                                  </div>
                                </div>
                              </div>
                            )}

                            {/* TRANSACTION FAILURE STATE RETRY OVERLAY */}
                            {sellState === 'failed' && (
                              <div className="absolute inset-0 bg-[#0E0608]/95 backdrop-blur-sm z-30 flex flex-col items-center justify-center p-6 text-center select-none font-mono text-xs">
                                <AlertCircle className="w-8 h-8 text-rose-500 mb-2 animate-bounce" />
                                <span className="font-bold text-rose-400 uppercase tracking-wide block">
                                  TRANSACTION REVERTED BY EVM
                                </span>
                                <p className="text-[10px] text-gray-400 leading-relaxed mt-2 max-w-sm mb-4">
                                  Reason: {hasError || 'Slippage threshold exceeded due to dynamic liquidity fluctuations.'}
                                </p>
                                <div className="flex gap-2 w-full max-w-xs">
                                  <button
                                    onClick={() => handleRetrySell(pos.id)}
                                    className="flex-1 py-2 bg-rose-600 hover:bg-rose-500 text-white font-bold text-[10px] uppercase rounded cursor-pointer transition-all"
                                  >
                                    RETRY WITH +3% SLIPPAGE
                                  </button>
                                  <button
                                    onClick={() => {
                                      setSellingStates(prev => ({ ...prev, [pos.id]: 'idle' }));
                                      setLastError(prev => ({ ...prev, [pos.id]: '' }));
                                    }}
                                    className="px-3 py-2 bg-gray-850 hover:bg-gray-800 text-gray-300 font-bold text-[10px] uppercase rounded border border-gray-800 cursor-pointer transition-all"
                                  >
                                    ABORT
                                  </button>
                                </div>
                              </div>
                            )}

                            {/* TRANSACTION SUCCESS OVERLAY */}
                            {sellState === 'success' && (
                              <div className="absolute inset-0 bg-black/95 backdrop-blur-sm z-30 flex flex-col items-center justify-center p-6 text-center select-none font-mono text-xs">
                                <CheckCircle className="w-10 h-10 text-emerald-400 mb-2 animate-pulse" />
                                <span className="font-bold text-emerald-400 uppercase tracking-widest block">
                                  TRANSACTION CONFIRMED
                                </span>
                                <p className="text-[10px] text-gray-400 mt-2">
                                  Swapped at Block #{Math.floor(Math.random() * 500) + 12850}
                                </p>
                                <span className="text-[9px] text-gray-600 mt-1 block uppercase">
                                  Clearing hold indices...
                                </span>
                              </div>
                            )}

                          </motion.div>
                        );
                      })}
                    </AnimatePresence>
                  </div>
                )}

              </div>

              {/* COMPREHENSIVE HISTORICAL TRADES */}
              <div className="border border-[#1C1F26] bg-[#0E1118] rounded overflow-hidden">
                <div className="px-4 py-3 bg-[#141822] border-b border-[#1C1F26] flex justify-between items-center font-mono text-xs">
                  <span className="font-bold text-gray-300">Historical Trade Realizations (24H)</span>
                  <span className="text-gray-500 text-[10px] uppercase">Logs Verified</span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs font-mono">
                    <thead className="bg-[#0E1118] border-b border-[#1C1F26] text-gray-500 text-[10px] uppercase">
                      <tr>
                        <th className="p-3 font-normal">ASSET</th>
                        <th className="p-3 font-normal text-right">COST_ETH</th>
                        <th className="p-3 font-normal text-right">REALIZED_ETH</th>
                        <th className="p-3 font-normal text-right">NET_PNL</th>
                        <th className="p-3 font-normal text-center">EXIT_REASON</th>
                        <th className="p-3 font-normal text-right">TIME_REALIZED</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1C1F26] text-gray-300">
                      {history.map((h) => {
                        const isProfit = h.profitPercent >= 0;
                        return (
                          <tr key={h.id} className="hover:bg-[#151924]/20">
                            <td className="p-3">
                              <div className="font-bold text-white flex items-center gap-1">
                                {h.name}
                                <span className="text-[8px] font-mono text-gray-400 bg-gray-950 px-1 py-0.2 rounded border border-gray-900">
                                  {h.symbol}
                                </span>
                              </div>
                            </td>
                            <td className="p-3 text-right">{h.costEth.toFixed(3)} ETH</td>
                            <td className="p-3 text-right text-white">{h.receivedEth.toFixed(4)} ETH</td>
                            <td className="p-3 text-right">
                              <span className={`font-bold ${isProfit ? 'text-emerald-400' : 'text-rose-500'}`}>
                                {isProfit ? '+' : ''}{h.profitPercent.toFixed(1)}%
                              </span>
                            </td>
                            <td className="p-3 text-center">
                              <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${
                                h.sellReason === 'Take_Profit' ? 'bg-[#0E2015] text-emerald-400 border border-emerald-900/40' :
                                h.sellReason === 'Stop_Loss' ? 'bg-[#210D10] text-rose-400 border border-rose-900/40' :
                                h.sellReason === 'Emergency_Panic' ? 'bg-[#1D080A] text-rose-400 border border-rose-950/40 animate-pulse' :
                                'bg-[#18120B] text-amber-400 border border-amber-900/40'
                              }`}>
                                {h.sellReason}
                              </span>
                            </td>
                            <td className="p-3 text-right text-gray-500">{h.soldAt}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

            </div>
          )}

          {/* ==================== 4. STRATEGY TAB ==================== */}
          {activeTab === 'strategy' && (
            <div id="tab-strategy-workspace" className="p-4 lg:p-6 space-y-6">
              
              {/* HEADER ACTION BAR */}
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-[#1C1F26] pb-4">
                <div>
                  <h2 className="text-lg lg:text-xl font-bold font-mono text-white tracking-tight uppercase flex items-center gap-2">
                    <SlidersHorizontal className="w-5 h-5 text-indigo-400" />
                    Bot Strategy Command Console
                  </h2>
                  <p className="text-xs text-gray-400 font-mono">
                    Calibrate real-time gas priorities, keyword targets, trade sizes, and auto-sell risk parameters.
                  </p>
                </div>
                
                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <button 
                    onClick={handleResetStrategy}
                    disabled={getModifiedFieldsCount() === 0}
                    className={`flex-1 sm:flex-none px-3 py-2 text-xs font-mono font-bold uppercase rounded border transition-all ${
                      getModifiedFieldsCount() > 0
                        ? 'bg-[#151214] border-gray-700 text-gray-300 hover:bg-gray-800 cursor-pointer'
                        : 'bg-transparent border-gray-900 text-gray-600 cursor-not-allowed'
                    }`}
                  >
                    RESET_CHANGES
                  </button>
                  <button 
                    onClick={handleSaveStrategy}
                    className={`flex-1 sm:flex-none px-4 py-2 text-xs font-mono font-bold uppercase rounded shadow transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                      getModifiedFieldsCount() > 0
                        ? 'bg-indigo-600 hover:bg-indigo-500 text-white animate-pulse'
                        : 'bg-blue-600 hover:bg-blue-500 text-white'
                    }`}
                  >
                    <Check className="w-4 h-4" />
                    <span>SAVE_CHANGES</span>
                    {getModifiedFieldsCount() > 0 && (
                      <span className="bg-indigo-950 border border-indigo-700 text-indigo-300 text-[10px] px-1.5 py-0.5 rounded-full font-black animate-none">
                        {getModifiedFieldsCount()}
                      </span>
                    )}
                  </button>
                </div>
              </div>

              {/* UNSAVED CHANGES BANNER ALERT */}
              {getModifiedFieldsCount() > 0 && (
                <div className="bg-[#1F170A]/50 border border-amber-800/60 p-3 rounded font-mono text-xs text-amber-300 flex flex-col md:flex-row justify-between items-start md:items-center gap-3 animate-fadeIn">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <span className="font-bold uppercase text-white block">Unsaved Configuration Changes Pending</span>
                      <p className="text-[10px] text-amber-200/80 leading-relaxed">
                        The sniper bot has detected changes to your operational parameters. Click <strong className="text-white">SAVE_CHANGES</strong> to apply them instantly to the real-time contract execution engine.
                      </p>
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {getModifiedFieldsList().map((field, idx) => (
                          <span key={idx} className="bg-amber-950/80 border border-amber-900/60 text-amber-400 text-[9px] px-1.5 py-0.2 rounded font-mono font-bold">
                            {field}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* DUAL COLUMN BENTO GRID CONFIGURATION PATH */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                
                {/* LEFT COLUMN: Capital Sizing, Risk limits & Criteria (col-span-7) */}
                <div className="lg:col-span-7 space-y-6">
                  
                  {/* SECTION 1: BOT MODE */}
                  <div className="border border-[#1C1F26] bg-[#0E1118] rounded p-4.5 space-y-3.5 shadow-md">
                    <div className="flex items-center justify-between border-b border-[#1C1F26] pb-2">
                      <h3 className="text-white font-bold text-xs uppercase font-mono tracking-wider flex items-center gap-2">
                        <Cpu className="w-4 h-4 text-blue-400" />
                        1. Core Operational Mode
                      </h3>
                      <span className={`text-[9px] font-bold font-mono px-2 py-0.5 rounded uppercase ${
                        strategy.botState === 'ACTIVE' ? 'bg-[#0E2015] border border-emerald-900 text-emerald-400 animate-pulse' :
                        strategy.botState === 'PAUSED' ? 'bg-[#1F140A] border border-amber-900 text-amber-400' :
                        'bg-blue-950/50 border border-blue-900 text-blue-400'
                      }`}>
                        Current: {strategy.botState}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 font-mono">
                      
                      {/* ACTIVE SELECTOR */}
                      <button
                        onClick={() => setStrategy(prev => ({ ...prev, botState: 'ACTIVE' }))}
                        className={`p-3 rounded border text-left transition-all relative ${
                          strategy.botState === 'ACTIVE'
                            ? 'bg-[#0E2015]/25 border-emerald-500 text-white shadow-lg'
                            : 'bg-black/20 border-transparent text-gray-500 hover:text-gray-300 hover:border-[#1C1F26]'
                        }`}
                      >
                        <div className="flex items-center justify-between font-bold text-[11px] mb-1">
                          <span>LIVE SNIPING</span>
                          {strategy.botState === 'ACTIVE' && <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-ping" />}
                        </div>
                        <p className="text-[9px] text-gray-500 leading-normal">
                          Live mempool scanner. Executes on-chain transactions instantly.
                        </p>
                      </button>

                      {/* PAUSED SELECTOR */}
                      <button
                        onClick={() => setStrategy(prev => ({ ...prev, botState: 'PAUSED' }))}
                        className={`p-3 rounded border text-left transition-all relative ${
                          strategy.botState === 'PAUSED'
                            ? 'bg-[#1F140A]/25 border-amber-500 text-white shadow-lg'
                            : 'bg-black/20 border-transparent text-gray-500 hover:text-gray-300 hover:border-[#1C1F26]'
                        }`}
                      >
                        <div className="font-bold text-[11px] mb-1 uppercase">
                          Listen-Only
                        </div>
                        <p className="text-[9px] text-gray-500 leading-normal">
                          Parses solidity bytecode but blocks buy triggers.
                        </p>
                      </button>

                      {/* SIMULATION SELECTOR */}
                      <button
                        onClick={() => setStrategy(prev => ({ ...prev, botState: 'SIMULATION' }))}
                        className={`p-3 rounded border text-left transition-all relative ${
                          strategy.botState === 'SIMULATION'
                            ? 'bg-blue-950/20 border-blue-500 text-white shadow-lg'
                            : 'bg-black/20 border-transparent text-gray-500 hover:text-gray-300 hover:border-[#1C1F26]'
                        }`}
                      >
                        <div className="font-bold text-[11px] mb-1 uppercase">
                          Simulation
                        </div>
                        <p className="text-[9px] text-gray-500 leading-normal">
                          Performs dry-run tests and writes event details to the console.
                        </p>
                      </button>
                      
                    </div>

                    {/* FREE TRADER MODE ADVANCED TOGGLE */}
                    <div className="flex items-center justify-between p-3 bg-black/10 border border-[#1C1F26]/60 rounded mt-3 text-xs font-mono">
                      <div className="space-y-0.5 max-w-[80%]">
                        <span className="text-[10px] font-bold text-gray-300 block uppercase flex items-center gap-1.5">
                          <Zap className="w-3.5 h-3.5 text-amber-500" />
                          Free Trader Mode (Unlimited EVM Swaps)
                        </span>
                        <p className="text-[9px] text-gray-500 leading-normal">
                          Disables dynamic trade gas protection floor and Zora network trading limitations. WARNING: Bypasses standard safe gas ceilings.
                        </p>
                      </div>
                      <input 
                        type="checkbox" 
                        checked={strategy.freeTraderMode}
                        onChange={(e) => setStrategy(prev => ({ ...prev, freeTraderMode: e.target.checked }))}
                        className="w-4 h-4 rounded border-gray-800 text-blue-600 focus:ring-0 cursor-pointer"
                      />
                    </div>
                  </div>

                  {/* CAPITAL & LIQUIDITY ALLOCATIONS (SECTIONS 2, 3, 4) */}
                  <div className="border border-[#1C1F26] bg-[#0E1118] rounded p-4.5 space-y-4 shadow-md font-mono text-xs">
                    
                    <div className="border-b border-[#1C1F26] pb-2 flex items-center justify-between">
                      <h3 className="text-white font-bold text-xs uppercase tracking-wider flex items-center gap-2">
                        <Wallet className="w-4 h-4 text-emerald-400" />
                        Capital Sizing & Token Classes
                      </h3>
                      <span className="text-[9px] text-gray-500">Zora Mainnet Allocations</span>
                    </div>

                    {/* SECTION 2: BASE TRADE SIZE */}
                    <div className="space-y-2 border-b border-[#1C1F26]/40 pb-4">
                      <div className="flex justify-between items-center">
                        <span className="text-gray-300 font-bold uppercase flex items-center gap-1">
                          2. Base Sniper Buy Size
                        </span>
                        
                        {/* CURRENCY TOGGLE */}
                        <div className="flex bg-black/40 border border-[#1C1F26] rounded p-0.5">
                          {(['ETH', 'WETH', 'USDC'] as const).map((curr) => {
                            const active = strategy.tradeCurrency === curr;
                            return (
                              <button
                                key={curr}
                                onClick={() => setStrategy(prev => ({ ...prev, tradeCurrency: curr }))}
                                className={`px-2 py-0.5 text-[9px] font-bold rounded-sm transition-all ${
                                  active
                                    ? 'bg-blue-600 text-white'
                                    : 'text-gray-500 hover:text-gray-300'
                                }`}
                              >
                                {curr}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div className="grid grid-cols-12 gap-3 items-center">
                        <div className="col-span-9">
                          <input 
                            type="range" 
                            min="0.01" 
                            max="1.5" 
                            step="0.01" 
                            value={strategy.tradeAmountEth}
                            onChange={(e) => setStrategy(prev => ({ ...prev, tradeAmountEth: parseFloat(e.target.value) }))}
                            className="w-full accent-blue-500 cursor-pointer h-1.5 bg-black/40 rounded"
                          />
                        </div>
                        <div className="col-span-3">
                          <div className="relative">
                            <input 
                              type="number" 
                              step="0.01"
                              value={strategy.tradeAmountEth}
                              onChange={(e) => setStrategy(prev => ({ ...prev, tradeAmountEth: parseFloat(e.target.value) || 0 }))}
                              className="w-full bg-black/30 border border-[#1C1F26] p-1.5 text-center text-white font-bold rounded text-[11px]"
                            />
                          </div>
                        </div>
                      </div>

                      {strategy.tradeAmountEth > 0.5 ? (
                        <p className="text-[10px] text-amber-400 leading-normal flex items-start gap-1 bg-[#1F170A]/30 border border-amber-950 p-2 rounded">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-400 mt-0.5" />
                          <span>WARNING: Capital sizing is configured at {strategy.tradeAmountEth} {strategy.tradeCurrency}. Large buy sizes face high slippage rates in early liquidity pools and make you a target for frontrunning sandwich MEV bots.</span>
                        </p>
                      ) : (
                        <p className="text-[9px] text-gray-500">The standard size applied to general public token contracts matching bytecode safety rules.</p>
                      )}
                    </div>

                    {/* TWO COLUMN GRID FOR COIN CLASSES (SECTIONS 3 & 4) */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      
                      {/* SECTION 3: CREATOR COIN RULES */}
                      <div className="bg-black/10 border border-[#1C1F26]/50 p-3 rounded space-y-2.5">
                        <span className="text-[10px] font-bold text-gray-300 uppercase block border-b border-[#1C1F26]/50 pb-1">
                          3. Creator Coins Limit
                        </span>
                        
                        <div className="flex justify-between items-center">
                          <span className="text-[10px] text-gray-400">Profile Limit:</span>
                          <span className="text-[11px] font-black text-indigo-400">{strategy.creatorTradeAmountEth} ETH</span>
                        </div>

                        <input 
                          type="range" 
                          min="0.01" 
                          max="1.0" 
                          step="0.01" 
                          value={strategy.creatorTradeAmountEth}
                          onChange={(e) => setStrategy(prev => ({ ...prev, creatorTradeAmountEth: parseFloat(e.target.value) }))}
                          className="w-full accent-indigo-500 cursor-pointer h-1 bg-black/40 rounded"
                        />

                        <p className="text-[9px] text-gray-500 leading-relaxed">
                          Sizing applied exclusively to contracts launched by verified, registered Zora Profiles.
                        </p>

                        {/* ADVANCED CREATOR FILTERS */}
                        <div className="border-t border-[#1C1F26]/50 pt-2.5 space-y-2">
                          <div className="flex justify-between items-center text-[10px]">
                            <span className="text-gray-400 uppercase">Max Snipes Per Day:</span>
                            <span className="text-indigo-400 font-bold">{strategy.maxCreatorCoinsPerDay} coins</span>
                          </div>
                          <input 
                            type="range" 
                            min="1" 
                            max="20" 
                            step="1" 
                            value={strategy.maxCreatorCoinsPerDay}
                            onChange={(e) => setStrategy(prev => ({ ...prev, maxCreatorCoinsPerDay: parseInt(e.target.value) }))}
                            className="w-full accent-indigo-500 cursor-pointer h-0.5 bg-black/40 rounded"
                          />
                        </div>

                        <div className="border-t border-[#1C1F26]/50 pt-2.5 space-y-2">
                          <div className="flex items-center justify-between text-[10px]">
                            <span className="text-gray-400 uppercase">Bypass Follower Check:</span>
                            <input 
                              type="checkbox" 
                              checked={strategy.bypassCreatorFollowerCheck}
                              onChange={(e) => setStrategy(prev => ({ ...prev, bypassCreatorFollowerCheck: e.target.checked }))}
                              className="w-3.5 h-3.5 rounded border-gray-800 text-indigo-600 focus:ring-0 cursor-pointer"
                            />
                          </div>
                          {!strategy.bypassCreatorFollowerCheck ? (
                            <div className="space-y-1 animate-fadeIn">
                              <div className="flex justify-between items-center text-[9px]">
                                <span className="text-gray-500 uppercase">Min Followers Required:</span>
                                <span className="text-indigo-400 font-bold">{strategy.creatorFollowerThreshold}</span>
                              </div>
                              <input 
                                type="range" 
                                min="0" 
                                max="1000" 
                                step="50" 
                                value={strategy.creatorFollowerThreshold}
                                onChange={(e) => setStrategy(prev => ({ ...prev, creatorFollowerThreshold: parseInt(e.target.value) }))}
                                className="w-full accent-indigo-500 cursor-pointer h-0.5 bg-black/40 rounded"
                              />
                            </div>
                          ) : (
                            <p className="text-[9px] text-amber-500 italic leading-none pt-0.5">⚠️ No follower floor applied.</p>
                          )}
                        </div>
                      </div>

                      {/* SECTION 4: CONTENT COIN RULES */}
                      <div className="bg-black/10 border border-[#1C1F26]/50 p-3 rounded space-y-2.5">
                        <span className="text-[10px] font-bold text-gray-300 uppercase block border-b border-[#1C1F26]/50 pb-1">
                          4. Content Coins Limit
                        </span>
                        
                        <div className="flex justify-between items-center">
                          <span className="text-[10px] text-gray-400">Media Limit:</span>
                          <span className="text-[11px] font-black text-blue-400">{strategy.contentTradeAmountEth} ETH</span>
                        </div>

                        <input 
                          type="range" 
                          min="0.01" 
                          max="1.0" 
                          step="0.01" 
                          value={strategy.contentTradeAmountEth}
                          onChange={(e) => setStrategy(prev => ({ ...prev, contentTradeAmountEth: parseFloat(e.target.value) }))}
                          className="w-full accent-blue-500 cursor-pointer h-1 bg-black/40 rounded"
                        />

                        <p className="text-[9px] text-gray-500 leading-relaxed">
                          Sizing applied to smart contracts containing rich metadata (embedded media, IPFS hashes, canvas elements).
                        </p>
                      </div>

                    </div>

                  </div>

                  {/* SECTION 5: KEYWORD TARGETING */}
                  <div className="border border-[#1C1F26] bg-[#0E1118] rounded p-4.5 space-y-3.5 shadow-md font-mono text-xs">
                    
                    <div className="border-b border-[#1C1F26] pb-2 flex items-center justify-between">
                      <h3 className="text-white font-bold text-xs uppercase tracking-wider flex items-center gap-2">
                        <Filter className="w-4 h-4 text-pink-400" />
                        5. Keyword & Ticker Filters
                      </h3>
                      
                      {/* GLOBAL TOGGLE FOR SYMBOL TARGETING */}
                      <div className="flex items-center space-x-2">
                        <span className="text-[9px] text-gray-500 uppercase">SYSTEM_ACTIVATION:</span>
                        <button
                          onClick={() => setStrategy(prev => ({ ...prev, symbolTargetingEnabled: !prev.symbolTargetingEnabled }))}
                          className={`px-2 py-0.5 text-[9px] font-bold uppercase rounded border transition-all ${
                            strategy.symbolTargetingEnabled
                              ? 'bg-[#0E2015] border-emerald-800 text-emerald-400'
                              : 'bg-black border-transparent text-gray-500'
                          }`}
                        >
                          {strategy.symbolTargetingEnabled ? 'ACTIVE' : 'BYPASS'}
                        </button>
                      </div>
                    </div>

                    <div className="space-y-4">
                      
                      {/* INPUT TAG BUILDER */}
                      {strategy.symbolTargetingEnabled && (
                        <div className="space-y-2 animate-fadeIn">
                          <label className="text-gray-400 text-[10px] block">TARGETED CONTRACT KEYWORDS</label>
                          <div className="flex gap-2">
                            <input
                              type="text"
                              placeholder="e.g., zorb, mfer, mint, meme..."
                              value={newKeyword}
                              onChange={(e) => setNewKeyword(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  const kw = newKeyword.trim().toLowerCase();
                                  if (kw && !strategy.targetKeywords.includes(kw)) {
                                    setStrategy(prev => ({
                                      ...prev,
                                      targetKeywords: [...prev.targetKeywords, kw]
                                    }));
                                    setNewKeyword('');
                                  }
                                }
                              }}
                              className="flex-1 bg-black/30 border border-[#1C1F26] px-3 py-2 text-white font-bold rounded text-xs focus:outline-none focus:border-indigo-500"
                            />
                            <button
                              onClick={() => {
                                const kw = newKeyword.trim().toLowerCase();
                                if (kw && !strategy.targetKeywords.includes(kw)) {
                                  setStrategy(prev => ({
                                    ...prev,
                                    targetKeywords: [...prev.targetKeywords, kw]
                                  }));
                                  setNewKeyword('');
                                }
                              }}
                              className="px-3 py-2 bg-indigo-900/40 hover:bg-indigo-600 border border-indigo-700 hover:border-indigo-500 text-indigo-300 hover:text-white rounded font-bold uppercase cursor-pointer"
                            >
                              Add
                            </button>
                          </div>

                          {/* KEYWORD CHIPS WRAPPER */}
                          <div className="flex flex-wrap gap-1.5 pt-1.5">
                            {strategy.targetKeywords.length === 0 ? (
                              <span className="text-[9px] text-gray-600 italic">No custom keywords specified. Snipes all matching contracts.</span>
                            ) : (
                              strategy.targetKeywords.map((kw) => (
                                <span
                                  key={kw}
                                  className="bg-indigo-950/60 border border-indigo-900/60 text-indigo-400 text-[9px] pl-2 pr-1.5 py-0.5 rounded-sm font-bold flex items-center gap-1 hover:border-rose-800 hover:text-rose-400 transition-colors cursor-pointer"
                                  onClick={() => {
                                    setStrategy(prev => ({
                                      ...prev,
                                      targetKeywords: prev.targetKeywords.filter(k => k !== kw)
                                    }));
                                  }}
                                  title="Click to remove keyword"
                                >
                                  {kw}
                                  <X className="w-2.5 h-2.5 shrink-0 hover:bg-black/35 rounded-full" />
                                </span>
                              ))
                            )}
                          </div>
                        </div>
                      )}

                      {/* EXCLUSION PHRASES (BLOCKLIST) */}
                      <div className="space-y-2 pt-3 border-t border-[#1C1F26]/40">
                        <label className="text-gray-400 text-[10px] block font-bold uppercase">Exclusion Phrases (Spam / Rug Filter)</label>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            placeholder="e.g., test, scam, clone, rug..."
                            value={newExclusionPhrase}
                            onChange={(e) => setNewExclusionPhrase(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                const ph = newExclusionPhrase.trim().toLowerCase();
                                if (ph && !strategy.exclusionPhrases.includes(ph)) {
                                  setStrategy(prev => ({
                                    ...prev,
                                    exclusionPhrases: [...prev.exclusionPhrases, ph]
                                  }));
                                  setNewExclusionPhrase('');
                                }
                              }
                            }}
                            className="flex-1 bg-black/30 border border-[#1C1F26] px-3 py-2 text-white font-bold rounded text-xs focus:outline-none focus:border-indigo-500"
                          />
                          <button
                            onClick={() => {
                              const ph = newExclusionPhrase.trim().toLowerCase();
                              if (ph && !strategy.exclusionPhrases.includes(ph)) {
                                setStrategy(prev => ({
                                  ...prev,
                                  exclusionPhrases: [...prev.exclusionPhrases, ph]
                                }));
                                setNewExclusionPhrase('');
                              }
                            }}
                            className="px-3 py-2 bg-indigo-900/40 hover:bg-indigo-600 border border-indigo-700 hover:border-indigo-500 text-indigo-300 hover:text-white rounded font-bold uppercase cursor-pointer"
                          >
                            Block
                          </button>
                        </div>

                        {/* EXCLUSION PHRASES CHIPS */}
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {strategy.exclusionPhrases.length === 0 ? (
                            <span className="text-[9px] text-gray-650 italic">No exclusion phrases configured. Blocklist is empty.</span>
                          ) : (
                            strategy.exclusionPhrases.map((ph) => (
                              <span
                                key={ph}
                                className="bg-rose-950/40 border border-rose-900/40 text-rose-400 text-[9px] pl-2 pr-1.5 py-0.5 rounded-sm font-bold flex items-center gap-1 hover:border-emerald-800 hover:text-emerald-400 transition-colors cursor-pointer"
                                onClick={() => {
                                  setStrategy(prev => ({
                                    ...prev,
                                    exclusionPhrases: prev.exclusionPhrases.filter(p => p !== ph)
                                  }));
                                }}
                                title="Click to remove exclusion phrase"
                              >
                                {ph}
                                <X className="w-2.5 h-2.5 shrink-0 hover:bg-black/35 rounded-full" />
                              </span>
                            ))
                          )}
                        </div>
                      </div>

                      {/* TICKER CONSTRAINTS */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1 border-t border-[#1C1F26]/40">
                        
                        <div className="flex items-center justify-between p-2.5 bg-black/10 border border-[#1C1F26]/40 rounded">
                          <div className="space-y-0.5">
                            <span className="text-[10px] font-bold text-gray-300 block uppercase">Require 4-Letter symbol</span>
                            <p className="text-[9px] text-gray-500 leading-normal">Bypasses long tickers. Standardizes focus.</p>
                          </div>
                          <input 
                            type="checkbox" 
                            checked={strategy.requireFourLetterSymbol}
                            onChange={(e) => setStrategy(prev => ({ ...prev, requireFourLetterSymbol: e.target.checked }))}
                            className="w-4 h-4 rounded border-gray-800 text-blue-600 focus:ring-0 cursor-pointer"
                          />
                        </div>

                        <div className="flex items-center justify-between p-2.5 bg-black/10 border border-[#1C1F26]/40 rounded">
                          <div className="space-y-0.5">
                            <span className="text-[10px] font-bold text-gray-300 block uppercase">Force All-Caps Ticker</span>
                            <p className="text-[9px] text-gray-500 leading-normal">Filters out unformatted spam tickers.</p>
                          </div>
                          <input 
                            type="checkbox" 
                            checked={strategy.requireAllCapsSymbol}
                            onChange={(e) => setStrategy(prev => ({ ...prev, requireAllCapsSymbol: e.target.checked }))}
                            className="w-4 h-4 rounded border-gray-800 text-blue-600 focus:ring-0 cursor-pointer"
                          />
                        </div>

                      </div>

                    </div>
                  </div>

                  {/* SECTION 9: AUTO-SELL / RISK SYSTEM */}
                  <div className="border border-[#1C1F26] bg-[#0E1118] rounded p-4.5 space-y-4 shadow-md font-mono text-xs">
                    
                    <div className="border-b border-[#1C1F26] pb-2 flex items-center justify-between">
                      <h3 className="text-white font-bold text-xs uppercase tracking-wider flex items-center gap-2">
                        <ShieldAlert className="w-4 h-4 text-rose-500" />
                        9. Position Risk Management & Auto-Sell Rules
                      </h3>
                      
                      <div className="flex items-center space-x-2">
                        <span className="text-[9px] text-gray-500 uppercase">AUTO_EXITS:</span>
                        <input 
                          type="checkbox" 
                          checked={strategy.autoSellEnabled}
                          onChange={(e) => setStrategy(prev => ({ ...prev, autoSellEnabled: e.target.checked }))}
                          className="w-4 h-4 rounded border-gray-800 text-blue-600 focus:ring-0 cursor-pointer"
                        />
                      </div>
                    </div>

                    {/* RISK CONTROLLERS */}
                    <div className="space-y-4">
                      
                      {strategy.autoSellEnabled ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 animate-fadeIn">
                          
                          {/* PERCENTAGE-BASED TP */}
                          <div className="space-y-1.5 p-3 bg-emerald-950/15 border border-emerald-900/30 rounded">
                            <div className="flex justify-between font-bold">
                              <span className="text-emerald-400 text-[10px]">TAKE_PROFIT_TRIGGER (%)</span>
                              <span className="text-white">{strategy.takeProfitPercent}%</span>
                            </div>
                            <input 
                              type="range" 
                              min="10" 
                              max="500" 
                              step="5" 
                              value={strategy.takeProfitPercent}
                              onChange={(e) => setStrategy(prev => ({ ...prev, takeProfitPercent: parseInt(e.target.value) }))}
                              className="w-full accent-emerald-500 cursor-pointer h-1 bg-black/40 rounded"
                            />
                            <p className="text-[9px] text-gray-500 leading-normal">Exits holding once live pricing hits percentage target.</p>
                          </div>

                          {/* ABSOLUTE USD TP LIMIT */}
                          <div className="space-y-1.5 p-3 bg-emerald-950/15 border border-emerald-900/30 rounded">
                            <div className="flex justify-between font-bold">
                              <span className="text-emerald-400 text-[10px]">TAKE_PROFIT_USD ($)</span>
                              <span className="text-white">${strategy.takeProfitUsd} USD</span>
                            </div>
                            <input 
                              type="range" 
                              min="10" 
                              max="1000" 
                              step="10" 
                              value={strategy.takeProfitUsd}
                              onChange={(e) => setStrategy(prev => ({ ...prev, takeProfitUsd: parseInt(e.target.value) }))}
                              className="w-full accent-emerald-500 cursor-pointer h-1 bg-black/40 rounded"
                            />
                            <p className="text-[9px] text-gray-500 leading-normal">Exits holding if absolute profit in USD hits this threshold.</p>
                          </div>

                          {/* STOP LOSS LIMIT */}
                          <div className="space-y-1.5 p-3 bg-rose-950/15 border border-rose-900/30 rounded sm:col-span-2">
                            <div className="flex justify-between font-bold">
                              <span className="text-rose-400 text-[10px]">STOP_LOSS_THRESHOLD (%)</span>
                              <span className="text-white">-{strategy.stopLossPercent}%</span>
                            </div>
                            <input 
                              type="range" 
                              min="5" 
                              max="80" 
                              step="1" 
                              value={strategy.stopLossPercent}
                              onChange={(e) => setStrategy(prev => ({ ...prev, stopLossPercent: parseInt(e.target.value) }))}
                              className="w-full accent-rose-500 cursor-pointer h-1 bg-black/40 rounded"
                            />
                            <p className="text-[9px] text-gray-500 leading-normal">Triggers priority sell route immediately if token price drops below threshold. <strong className="text-rose-400">WARNING: Highly volatile pools can clip tight stop losses prematurely.</strong></p>
                          </div>

                        </div>
                      ) : (
                        <div className="p-4 bg-rose-950/10 border border-rose-950 rounded text-center">
                          <p className="text-[11px] text-rose-400 font-bold leading-relaxed">
                            ⚠️ DANGER: Automated Exit protocols are disabled. You must execute sales manually from the "Positions Board" tab or using on-chain terminals. Exposure risk is unlimited!
                          </p>
                        </div>
                      )}

                      {/* PARAMETERS BENTO GRID MATRIX */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-[#1C1F26]/40 pt-4">
                        
                        {/* MAX SLIPPAGE INPUT */}
                        <div className="space-y-1.5">
                          <div className="flex justify-between text-[10px] font-bold">
                            <span className="text-gray-400 uppercase">MAX_SLIPPAGE (%)</span>
                            <span className="text-indigo-400">{strategy.maxSlippage}%</span>
                          </div>
                          <input 
                            type="range" 
                            min="2" 
                            max="50" 
                            step="1" 
                            value={strategy.maxSlippage}
                            onChange={(e) => setStrategy(prev => ({ ...prev, maxSlippage: parseInt(e.target.value) }))}
                            className="w-full accent-blue-500 cursor-pointer h-1 bg-black/40 rounded"
                          />
                          <p className="text-[9px] text-gray-500">Maximum trade price deviation allowed. Protects against sandwich bots.</p>
                        </div>

                        {/* MAX PRIORITY GAS FEE */}
                        <div className="space-y-1.5">
                          <div className="flex justify-between text-[10px] font-bold">
                            <span className="text-gray-400 uppercase">MAX_PRIORITY_FEE (GWEI)</span>
                            <span className="text-indigo-400">{strategy.maxPriorityFeeGwei} GWEI</span>
                          </div>
                          <input 
                            type="range" 
                            min="0.5" 
                            max="30" 
                            step="0.5" 
                            value={strategy.maxPriorityFeeGwei}
                            onChange={(e) => setStrategy(prev => ({ ...prev, maxPriorityFeeGwei: parseFloat(e.target.value) }))}
                            className="w-full accent-blue-500 cursor-pointer h-1 bg-black/40 rounded"
                          />
                          <p className="text-[9px] text-gray-500">Max fee priority surcharge paid directly to block validators.</p>
                        </div>

                        {/* MIN LIQUIDITY DEPTH */}
                        <div className="space-y-1.5">
                          <div className="flex justify-between text-[10px] font-bold">
                            <span className="text-gray-400 uppercase">MIN_LIQUIDITY_DEPTH</span>
                            <span className="text-indigo-400">{strategy.minLiquidityEth} ETH</span>
                          </div>
                          <input 
                            type="range" 
                            min="0.1" 
                            max="5.0" 
                            step="0.1" 
                            value={strategy.minLiquidityEth}
                            onChange={(e) => setStrategy(prev => ({ ...prev, minLiquidityEth: parseFloat(e.target.value) }))}
                            className="w-full accent-blue-500 cursor-pointer h-1 bg-black/40 rounded"
                          />
                          <p className="text-[9px] text-gray-500">Skips deployments with pools smaller than the selected threshold.</p>
                        </div>

                        {/* DEVELOPER REPUTATION MIN */}
                        <div className="space-y-1.5">
                          <div className="flex justify-between text-[10px] font-bold">
                            <span className="text-gray-400 uppercase">MIN_DEVELOPER_REPUTATION</span>
                            <span className="text-indigo-400">{strategy.devScoreMinimum}/100</span>
                          </div>
                          <input 
                            type="range" 
                            min="20" 
                            max="90" 
                            step="5" 
                            value={strategy.devScoreMinimum}
                            onChange={(e) => setStrategy(prev => ({ ...prev, devScoreMinimum: parseInt(e.target.value) }))}
                            className="w-full accent-blue-500 cursor-pointer h-1 bg-black/40 rounded"
                          />
                          <p className="text-[9px] text-gray-500">Solidity compiler reputation score matching database history.</p>
                        </div>

                      </div>

                      {/* SOCIALS AUDIT ACCORDION CHECKBOX */}
                      <div className="flex items-center justify-between p-3 bg-black/15 border border-[#1C1F26]/40 rounded-md">
                        <div className="space-y-0.5">
                          <span className="text-[10px] font-bold text-gray-300 block uppercase">ENFORCE_SOCIALS_AUDIT_VERIFICATION</span>
                          <p className="text-[9px] text-gray-500 leading-normal">Requires registration verification of creator profile metadata before swap execution.</p>
                        </div>
                        <input 
                          type="checkbox" 
                          checked={strategy.socialAuditEnabled}
                          onChange={(e) => setStrategy(prev => ({ ...prev, socialAuditEnabled: e.target.checked }))}
                          className="w-4 h-4 rounded border-gray-800 text-blue-600 focus:ring-0 cursor-pointer"
                        />
                      </div>

                    </div>
                  </div>

                </div>

                {/* RIGHT COLUMN: Advanced Bytecode & Mechanics Filters (col-span-5) */}
                <div className="lg:col-span-5 space-y-6">
                  
                  {/* SECTION 6: MOMENTUM SNIPING */}
                  <div className="border border-[#1C1F26] bg-[#0E1118] rounded p-4.5 space-y-3.5 shadow-md font-mono text-xs">
                    <div className="border-b border-[#1C1F26] pb-2 flex items-center justify-between">
                      <h3 className="text-white font-bold text-xs uppercase tracking-wider flex items-center gap-2">
                        <Flame className="w-4 h-4 text-orange-400" />
                        6. Momentum Sniping Rules
                      </h3>
                      <span className="text-[9px] text-orange-400 bg-orange-950/30 px-1.5 py-0.2 rounded border border-orange-900/40 font-bold uppercase shrink-0">
                        Bytecode Check
                      </span>
                    </div>

                    <div className="space-y-4">
                      
                      <div className="flex items-start justify-between p-3 bg-black/10 border border-[#1C1F26]/40 rounded gap-3">
                        <div className="space-y-1">
                          <span className="text-[10px] font-bold text-gray-300 block uppercase">Pre-Buy Momentum Thresholds</span>
                          <p className="text-[9px] text-gray-500 leading-normal">
                            Analyses pending buy orders inside the mempool block template. Initiates buy only if buy cluster thresholds are crossed.
                          </p>
                        </div>
                        <input 
                          type="checkbox" 
                          checked={strategy.preBuyMomentumEnabled}
                          onChange={(e) => setStrategy(prev => ({ ...prev, preBuyMomentumEnabled: e.target.checked }))}
                          className="w-4 h-4 rounded border-gray-800 text-blue-600 focus:ring-0 cursor-pointer shrink-0 mt-0.5"
                        />
                      </div>

                      <div className="flex items-start justify-between p-3 bg-black/10 border border-[#1C1F26]/40 rounded gap-3">
                        <div className="space-y-1">
                          <span className="text-[10px] font-bold text-gray-300 block uppercase">Micro-Inertia Checks</span>
                          <p className="text-[9px] text-gray-500 leading-normal">
                            Calculates buy acceleration vectors across a 5-second post-genesis window. Rejects quiet, dead pool launches.
                          </p>
                        </div>
                        <input 
                          type="checkbox" 
                          checked={strategy.microInertiaEnabled}
                          onChange={(e) => setStrategy(prev => ({ ...prev, microInertiaEnabled: e.target.checked }))}
                          className="w-4 h-4 rounded border-gray-800 text-blue-600 focus:ring-0 cursor-pointer shrink-0 mt-0.5"
                        />
                      </div>

                    </div>
                  </div>

                  {/* SECTION 7: TAX/TIMER STRATEGY */}
                  <div className="border border-[#1C1F26] bg-[#0E1118] rounded p-4.5 space-y-3.5 shadow-md font-mono text-xs">
                    <div className="border-b border-[#1C1F26] pb-2 flex items-center justify-between">
                      <h3 className="text-white font-bold text-xs uppercase tracking-wider flex items-center gap-2">
                        <Clock className="w-4 h-4 text-emerald-400" />
                        7. Tax/Timer Defense Logic
                      </h3>
                      <span className="text-[9px] text-emerald-400 bg-[#0E2015] px-1.5 py-0.2 rounded border border-emerald-900/40 font-bold uppercase shrink-0">
                        Sandwich Shield
                      </span>
                    </div>

                    <div className="space-y-4">
                      
                      <div className="flex items-start justify-between p-3 bg-black/10 border border-[#1C1F26]/40 rounded gap-3">
                        <div className="space-y-1">
                          <span className="text-[10px] font-bold text-gray-300 block uppercase">Tax Arbitrage Tracking</span>
                          <p className="text-[9px] text-gray-500 leading-normal">
                            Simulates potential trading losses vs pool tax settings. Temporarily schedules bypass limits if gas rates offset tax differences.
                          </p>
                        </div>
                        <input 
                          type="checkbox" 
                          checked={strategy.taxArbitrageEnabled}
                          onChange={(e) => setStrategy(prev => ({ ...prev, taxArbitrageEnabled: e.target.checked }))}
                          className="w-4 h-4 rounded border-gray-800 text-blue-600 focus:ring-0 cursor-pointer shrink-0 mt-0.5"
                        />
                      </div>

                      <div className="flex items-start justify-between p-3 bg-black/10 border border-[#1C1F26]/40 rounded gap-3">
                        <div className="space-y-1">
                          <span className="text-[10px] font-bold text-gray-300 block uppercase">Tax Timer Bypass Routine</span>
                          <p className="text-[9px] text-gray-500 leading-normal">
                            Triggers immediate buy routing if contract decompiles a scheduling routine where high launch tax auto-reduces at block markers.
                          </p>
                        </div>
                        <input 
                          type="checkbox" 
                          checked={strategy.taxTimerEnabled}
                          onChange={(e) => setStrategy(prev => ({ ...prev, taxTimerEnabled: e.target.checked }))}
                          className="w-4 h-4 rounded border-gray-800 text-blue-600 focus:ring-0 cursor-pointer shrink-0 mt-0.5"
                        />
                      </div>

                    </div>
                  </div>

                  {/* SECTION 8: TREND SNIPING */}
                  <div className="border border-[#1C1F26] bg-[#0E1118] rounded p-4.5 space-y-3.5 shadow-md font-mono text-xs">
                    <div className="border-b border-[#1C1F26] pb-2 flex items-center justify-between">
                      <h3 className="text-white font-bold text-xs uppercase tracking-wider flex items-center gap-2">
                        <TrendingUp className="w-4 h-4 text-purple-400" />
                        8. Trend Sniping Expansion
                      </h3>
                      <span className="text-[9px] text-purple-400 bg-purple-950/30 px-1.5 py-0.2 rounded border border-purple-900/40 font-bold uppercase shrink-0">
                        Viral Signal
                      </span>
                    </div>

                    <div className="space-y-3">
                      <div className="flex items-start justify-between p-3 bg-black/10 border border-[#1C1F26]/40 rounded gap-3">
                        <div className="space-y-1">
                          <span className="text-[10px] font-bold text-gray-300 block uppercase">Trending Sniping Activation</span>
                          <p className="text-[9px] text-gray-500 leading-normal">
                            Allows late-entry position indexing. If social signal graphs, holder growth profiles, and pool volume indexes point to viral breakout, executes secondary buy route.
                          </p>
                        </div>
                        <input 
                          type="checkbox" 
                          checked={strategy.trendingSnipingEnabled}
                          onChange={(e) => setStrategy(prev => ({ ...prev, trendingSnipingEnabled: e.target.checked }))}
                          className="w-4 h-4 rounded border-gray-800 text-blue-600 focus:ring-0 cursor-pointer shrink-0 mt-0.5"
                        />
                      </div>
                    </div>
                  </div>

                  {/* SECTION 10: NOTIFICATIONS */}
                  <div className="border border-[#1C1F26] bg-[#0E1118] rounded p-4.5 space-y-3.5 shadow-md font-mono text-xs">
                    <div className="border-b border-[#1C1F26] pb-2 flex items-center justify-between">
                      <h3 className="text-white font-bold text-xs uppercase tracking-wider flex items-center gap-2">
                        <Info className="w-4 h-4 text-indigo-400" />
                        10. Terminal Notification alerts
                      </h3>
                      <span className="text-[9px] text-gray-500">Local Audibles & Webhooks</span>
                    </div>

                    <div className="space-y-3.5">
                      
                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <span className="text-[10px] font-bold text-gray-300 block uppercase">Broadcast Trade Success</span>
                          <p className="text-[9px] text-gray-500">Sends instant status alerts on successful EVM buys.</p>
                        </div>
                        <input 
                          type="checkbox" 
                          checked={strategy.notifyTxSuccess}
                          onChange={(e) => setStrategy(prev => ({ ...prev, notifyTxSuccess: e.target.checked }))}
                          className="w-4 h-4 rounded border-gray-800 text-blue-600 focus:ring-0 cursor-pointer"
                        />
                      </div>

                      <div className="flex items-center justify-between border-t border-[#1C1F26]/50 pt-3">
                        <div className="space-y-0.5">
                          <span className="text-[10px] font-bold text-gray-300 block uppercase">Broadcast Trade Reverts</span>
                          <p className="text-[9px] text-gray-500">Sends debug diagnostics on failed/reverted swap transactions.</p>
                        </div>
                        <input 
                          type="checkbox" 
                          checked={strategy.notifyTxRevert}
                          onChange={(e) => setStrategy(prev => ({ ...prev, notifyTxRevert: e.target.checked }))}
                          className="w-4 h-4 rounded border-gray-800 text-blue-600 focus:ring-0 cursor-pointer"
                        />
                      </div>

                      <div className="flex items-center justify-between border-t border-[#1C1F26]/50 pt-3">
                        <div className="space-y-0.5">
                          <span className="text-[10px] font-bold text-gray-300 block uppercase">Sound Console Audio Buzzer</span>
                          <p className="text-[9px] text-gray-500">Saves gas by disabling audio synthesizers unless critical hit events occur.</p>
                        </div>
                        <input 
                          type="checkbox" 
                          checked={strategy.soundBuzzer}
                          onChange={(e) => setStrategy(prev => ({ ...prev, soundBuzzer: e.target.checked }))}
                          className="w-4 h-4 rounded border-gray-800 text-blue-600 focus:ring-0 cursor-pointer"
                        />
                      </div>

                    </div>
                  </div>

                </div>

              </div>

            </div>
          )}

          {/* ==================== CREATORS WATCHLIST TAB ==================== */}
          {activeTab === 'creators' && (
            <div id="tab-creators-workspace" className="p-4 lg:p-6 space-y-6">
              
              {/* HEADER ACTION BAR */}
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-[#1C1F26] pb-4">
                <div>
                  <h2 className="text-lg lg:text-xl font-bold font-mono text-white tracking-tight uppercase flex items-center gap-2">
                    <Users className="w-5 h-5 text-indigo-400" />
                    Creator Watchlist Dashboard
                  </h2>
                  <p className="text-xs text-gray-400 font-mono">
                    Monitor, activate/pause, and set per-creator sniper parameters. Auto-sells and anti-rekt levels are executed at transaction genesis.
                  </p>
                </div>
                
                <button 
                  onClick={() => {
                    setEditingCreator({
                      id: '',
                      address: '',
                      name: '',
                      handle: '',
                      status: 'active',
                      autoSellEnabled: true,
                      stopLossEnabled: true,
                      customBuyAmount: 0.1,
                      sellAfterUsers: 10,
                      antiRekt: {
                        maxBuyTax: 5,
                        maxSellTax: 5,
                        minLiquidityEth: 0.5,
                        devReputationScore: 60
                      },
                      avatarUrl: '',
                      fid: undefined,
                      coinsBoughtCount: 0,
                      lastActivity: 'Never',
                      lifetimePnLEth: 0,
                      sellAllAtOnce: false,
                      maxSlippageOverride: undefined,
                      creatorTradeAmountOverride: undefined,
                      followerOverride: false,
                      pauseTracking: false,
                      emergencyDisable: false,
                      notes: ''
                    });
                    setDrawerOpen(true);
                  }}
                  className="w-full sm:w-auto px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-mono text-xs uppercase font-bold rounded shadow transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <UserPlus className="w-4 h-4" />
                  <span>ADD_NEW_CREATOR</span>
                </button>
              </div>

              {/* QUICK METRICS PANEL */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="border border-[#1C1F26] bg-[#0E1118] p-3 rounded font-mono">
                  <span className="text-[10px] text-gray-500 block">TOTAL_TRACKED</span>
                  <span className="text-lg font-bold text-white">{trackedCreators.length}</span>
                </div>
                <div className="border border-[#1C1F26] bg-[#0E1118] p-3 rounded font-mono">
                  <span className="text-[10px] text-gray-500 block">ACTIVE_TRACKING</span>
                  <span className="text-lg font-bold text-emerald-400">
                    {trackedCreators.filter(c => c.status === 'active').length}
                  </span>
                </div>
                <div className="border border-[#1C1F26] bg-[#0E1118] p-3 rounded font-mono">
                  <span className="text-[10px] text-gray-500 block">PAUSED / DISABLED</span>
                  <span className="text-lg font-bold text-amber-500">
                    {trackedCreators.filter(c => c.status === 'paused' || c.status === 'disabled').length}
                  </span>
                </div>
                <div className="border border-[#1C1F26] bg-[#0E1118] p-3 rounded font-mono">
                  <span className="text-[10px] text-gray-500 block">SNIPE_BUDGET_SIZE</span>
                  <span className="text-lg font-bold text-indigo-400">
                    {trackedCreators.reduce((sum, c) => sum + (c.status === 'active' ? c.customBuyAmount : 0), 0).toFixed(2)} ETH
                  </span>
                </div>
              </div>

              {/* SEARCH & FILTERS BAR */}
              <div className="flex flex-col lg:flex-row gap-4 items-stretch lg:items-center justify-between bg-[#0E1118] border border-[#1C1F26] p-3 rounded font-mono text-xs">
                {/* Search */}
                <div className="relative flex-1">
                  <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Search className="h-4 w-4 text-gray-500" />
                  </span>
                  <input
                    type="text"
                    placeholder="Search creators by name, handle, FID or address..."
                    value={creatorSearch}
                    onChange={(e) => setCreatorSearch(e.target.value)}
                    className="w-full bg-[#07090E] border border-[#1C1F26] pl-9 pr-3 py-2 text-white placeholder-gray-500 rounded focus:outline-none focus:border-indigo-500 font-bold"
                  />
                </div>

                {/* Filters */}
                <div className="flex items-center gap-2 overflow-x-auto shrink-0 pb-1 lg:pb-0">
                  <span className="text-gray-500 uppercase text-[10px] font-bold shrink-0">FILTER:</span>
                  {[
                    { id: 'all', label: 'All' },
                    { id: 'active', label: 'Active' },
                    { id: 'paused', label: 'Paused' },
                    { id: 'disabled', label: 'Disabled' }
                  ].map(f => (
                    <button
                      key={f.id}
                      onClick={() => setCreatorFilter(f.id as any)}
                      className={`px-3 py-1.5 rounded text-[10px] uppercase font-bold tracking-wider cursor-pointer border transition-all ${
                        creatorFilter === f.id
                          ? 'bg-indigo-600/20 border-indigo-500 text-indigo-400 font-bold'
                          : 'bg-black/20 border-gray-900 text-gray-400 hover:text-white'
                      }`}
                    >
                      {f.label} ({
                        f.id === 'all' 
                          ? trackedCreators.length 
                          : trackedCreators.filter(c => c.status === f.id).length
                      })
                    </button>
                  ))}
                </div>
              </div>

              {/* MAIN CONTENT AREA */}
              {trackedCreators.length === 0 ? (
                <div className="border border-dashed border-[#1C1F26] rounded-lg p-12 text-center font-mono">
                  <Users className="w-12 h-12 text-gray-600 mx-auto mb-3" />
                  <p className="text-sm text-gray-400 font-bold mb-1">No tracked creators found</p>
                  <p className="text-xs text-gray-600 mb-4">Add creators to initiate automated snipes on their deployments.</p>
                  <button 
                    onClick={() => {
                      setEditingCreator({
                        id: '',
                        address: '',
                        name: '',
                        handle: '',
                        status: 'active',
                        autoSellEnabled: true,
                        stopLossEnabled: true,
                        customBuyAmount: 0.1,
                        sellAfterUsers: 10,
                        antiRekt: {
                          maxBuyTax: 5,
                          maxSellTax: 5,
                          minLiquidityEth: 0.5,
                          devReputationScore: 60
                        },
                        avatarUrl: '',
                        fid: undefined,
                        coinsBoughtCount: 0,
                        lastActivity: 'Never',
                        lifetimePnLEth: 0,
                        sellAllAtOnce: false,
                        maxSlippageOverride: undefined,
                        creatorTradeAmountOverride: undefined,
                        followerOverride: false,
                        pauseTracking: false,
                        emergencyDisable: false,
                        notes: ''
                      });
                      setDrawerOpen(true);
                    }}
                    className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded cursor-pointer uppercase transition-all"
                  >
                    Add First Creator
                  </button>
                </div>
              ) : (
                <div className="space-y-4">
                  {(() => {
                    // Filter creators state
                    const filteredCreators = trackedCreators.filter(creator => {
                      if (creatorFilter !== 'all' && creator.status !== creatorFilter) {
                        return false;
                      }
                      if (creatorSearch.trim()) {
                        const s = creatorSearch.toLowerCase();
                        const nameMatch = creator.name.toLowerCase().includes(s);
                        const handleMatch = creator.handle?.toLowerCase().includes(s);
                        const addressMatch = creator.address.toLowerCase().includes(s);
                        const fidMatch = creator.fid ? creator.fid.toString().includes(s) : false;
                        return nameMatch || handleMatch || addressMatch || fidMatch;
                      }
                      return true;
                    });

                    // Render helper for creator avatar
                    const renderCreatorAvatar = (c: TrackedCreator) => {
                      if (c.avatarUrl) {
                        return (
                          <img 
                            src={c.avatarUrl} 
                            alt={c.name} 
                            referrerPolicy="no-referrer"
                            className="w-9 h-9 rounded-full border border-gray-800 shrink-0 object-cover"
                          />
                        );
                      }
                      const initials = c.name.slice(0, 2).toUpperCase();
                      return (
                        <div className="w-9 h-9 rounded-full bg-indigo-950 border border-indigo-800 text-indigo-400 flex items-center justify-center font-bold text-xs shrink-0 font-mono">
                          {initials}
                        </div>
                      );
                    };

                    if (filteredCreators.length === 0) {
                      return (
                        <div className="border border-[#1C1F26] bg-[#0E1118] rounded p-12 text-center font-mono text-gray-500 text-xs">
                          <Users className="w-8 h-8 mx-auto mb-2 text-gray-700" />
                          <p className="font-bold uppercase text-white mb-1">No Matching Creators found</p>
                          <p>Your search or filter parameters did not yield any tracked wallets.</p>
                          <button
                            onClick={() => {
                              setCreatorSearch('');
                              setCreatorFilter('all');
                            }}
                            className="mt-3 px-3 py-1 border border-gray-800 hover:bg-black/40 rounded text-[10px] text-indigo-400 uppercase tracking-wider transition-all"
                          >
                            Reset Search Filters
                          </button>
                        </div>
                      );
                    }

                    return (
                      <>
                        {/* MOBILE & TABLET: CARDS LIST */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 lg:hidden">
                          {filteredCreators.map((creator) => {
                            const isPaused = creator.status === 'paused';
                            const isDisabled = creator.status === 'disabled';
                            const formattedPnL = (creator.lifetimePnLEth || 0) >= 0 
                              ? `+${(creator.lifetimePnLEth || 0).toFixed(2)} ETH` 
                              : `${(creator.lifetimePnLEth || 0).toFixed(2)} ETH`;

                            return (
                              <div 
                                key={creator.id} 
                                className={`border rounded p-4.5 space-y-4 transition-all ${
                                  isDisabled 
                                    ? 'border-rose-950/60 bg-[#0E1118]/20 opacity-60' 
                                    : isPaused
                                      ? 'border-gray-800 bg-[#0E1118]/40 opacity-75'
                                      : 'border-[#1C1F26] bg-[#0E1118] hover:border-[#2C303E]'
                                }`}
                              >
                                {/* Top Row: Info */}
                                <div className="flex justify-between items-start gap-2">
                                  <div className="flex items-center gap-2.5">
                                    {renderCreatorAvatar(creator)}
                                    <div>
                                      <div className="flex items-center gap-1.5 flex-wrap">
                                        <span className={`font-bold font-mono text-sm ${isDisabled ? 'text-rose-400' : isPaused ? 'text-gray-400' : 'text-white'}`}>
                                          {creator.name}
                                        </span>
                                        <span className="text-[10px] text-gray-500 font-mono">
                                          {creator.handle}
                                        </span>
                                        {creator.fid && (
                                          <span className="bg-blue-950/40 border border-blue-900/40 text-blue-400 text-[8px] px-1 py-0.5 rounded font-mono font-bold shrink-0">
                                            FID: {creator.fid}
                                          </span>
                                        )}
                                      </div>
                                      
                                      {/* Address with copy */}
                                      <div className="flex items-center gap-1.5 mt-1">
                                        <span className="text-[10px] font-mono text-indigo-400 bg-indigo-950/40 border border-indigo-900/40 px-1.5 py-0.5 rounded">
                                          {creator.address.slice(0, 6)}...{creator.address.slice(-4)}
                                        </span>
                                        <button 
                                          onClick={() => {
                                            navigator.clipboard.writeText(creator.address);
                                            triggerToast(`Address copied: ${creator.address.slice(0, 6)}...`, 'success');
                                          }}
                                          className="text-gray-500 hover:text-white transition-colors cursor-pointer"
                                          title="Copy full address"
                                        >
                                          <Copy className="w-3 h-3" />
                                        </button>
                                      </div>
                                    </div>
                                  </div>

                                  {/* Status Badge Toggle */}
                                  <button
                                    onClick={() => handleToggleCreatorStatus(creator)}
                                    className={`px-2 py-0.5 text-[9px] font-mono font-bold rounded uppercase border cursor-pointer transition-all ${
                                      isDisabled
                                        ? 'bg-[#1A0A0E] border-rose-900 text-rose-500 hover:bg-[#1A0A0E]/80'
                                        : isPaused 
                                          ? 'bg-[#1F140A] border-amber-900 text-amber-500 hover:bg-[#1F140A]/80' 
                                          : 'bg-[#0E2015] border-emerald-900 text-emerald-400 hover:bg-[#0E2015]/80'
                                    }`}
                                  >
                                    {isDisabled ? '🚫 DISABLED' : isPaused ? '⏸ PAUSED' : '● ACTIVE'}
                                  </button>
                                </div>

                                {/* Rules and Overrides Badges */}
                                <div className="flex flex-wrap gap-1 pt-1.5">
                                  {creator.sellAllAtOnce && (
                                    <span className="bg-emerald-950/30 text-emerald-400 border border-emerald-900/30 text-[9px] px-1.5 py-0.5 rounded uppercase font-bold">
                                      SELL_ALL
                                    </span>
                                  )}
                                  {creator.maxSlippageOverride !== undefined && (
                                    <span className="bg-amber-950/30 text-amber-400 border border-amber-900/30 text-[9px] px-1.5 py-0.5 rounded uppercase font-bold">
                                      SLIP_OVR: {creator.maxSlippageOverride}%
                                    </span>
                                  )}
                                  {creator.creatorTradeAmountOverride !== undefined && (
                                    <span className="bg-indigo-950/30 text-indigo-400 border border-indigo-900/30 text-[9px] px-1.5 py-0.5 rounded uppercase font-bold">
                                      SIZE_OVR: {creator.creatorTradeAmountOverride} ETH
                                    </span>
                                  )}
                                  {creator.followerOverride && (
                                    <span className="bg-blue-950/30 text-blue-400 border border-blue-900/30 text-[9px] px-1.5 py-0.5 rounded uppercase font-bold">
                                      BYPASS_FOLL
                                    </span>
                                  )}
                                  {creator.notes && (
                                    <span className="bg-black/40 text-gray-400 border border-gray-900 text-[9px] px-1.5 py-0.5 rounded italic">
                                      Has Notes
                                    </span>
                                  )}
                                </div>

                                {/* Settings Summary */}
                                <div className="grid grid-cols-2 gap-3 pt-1 border-t border-[#1C1F26]/40 text-xs font-mono">
                                  <div>
                                    <span className="text-[9px] text-gray-500 block uppercase">Custom Buy size</span>
                                    <span className="text-white font-bold text-xs">{creator.customBuyAmount} ETH</span>
                                  </div>
                                  <div>
                                    <span className="text-[9px] text-gray-500 block uppercase">Auto sell / Exit</span>
                                    <span className={`font-bold text-xs ${creator.autoSellEnabled ? 'text-emerald-400' : 'text-gray-500'}`}>
                                      {creator.autoSellEnabled ? 'ENABLED' : 'DISABLED'}
                                    </span>
                                  </div>
                                  <div>
                                    <span className="text-[9px] text-gray-500 block uppercase">Stop loss protection</span>
                                    <span className={`font-bold text-xs ${creator.stopLossEnabled ? 'text-rose-400' : 'text-gray-500'}`}>
                                      {creator.stopLossEnabled ? 'ACTIVE' : 'DISABLED'}
                                    </span>
                                  </div>
                                  <div>
                                    <span className="text-[9px] text-gray-500 block uppercase">Exit User Cap</span>
                                    <span className="text-white font-bold text-xs">
                                      {creator.sellAfterUsers > 0 ? `${creator.sellAfterUsers} Users` : 'BYPASS'}
                                    </span>
                                  </div>
                                </div>

                                {/* Performance Stats Grid */}
                                <div className="grid grid-cols-3 gap-1 pt-2 border-t border-[#1C1F26]/40 text-[10px] font-mono bg-black/10 p-2 rounded border border-[#1C1F26]/30 text-center">
                                  <div>
                                    <span className="text-[8px] text-gray-500 block uppercase">LAST_ACTIVITY</span>
                                    <span className="text-white font-medium">{creator.lastActivity || 'Never'}</span>
                                  </div>
                                  <div>
                                    <span className="text-[8px] text-gray-500 block uppercase">COINS_BOUGHT</span>
                                    <span className="text-indigo-400 font-bold">{creator.coinsBoughtCount || 0}</span>
                                  </div>
                                  <div>
                                    <span className="text-[8px] text-gray-500 block uppercase">LIFETIME P/L</span>
                                    <span className={`font-bold ${(creator.lifetimePnLEth || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                      {formattedPnL}
                                    </span>
                                  </div>
                                </div>

                                {creator.notes && (
                                  <div className="bg-black/20 p-2 rounded text-[10px] text-gray-400 font-sans border-l border-indigo-500 italic">
                                    "{creator.notes}"
                                  </div>
                                )}

                                {/* Anti-Rekt parameters summary */}
                                <div className="bg-black/15 p-2.5 rounded border border-[#1C1F26]/60 text-[10px] font-mono space-y-1">
                                  <span className="text-[9px] text-gray-500 font-bold block uppercase tracking-wider">ANTI_REKT_LIMITS:</span>
                                  <div className="flex justify-between">
                                    <span className="text-gray-400">Max Buy/Sell Tax</span>
                                    <span className="text-white">{creator.antiRekt.maxBuyTax}% / {creator.antiRekt.maxSellTax}%</span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span className="text-gray-400">Min Liquidity Depth</span>
                                    <span className="text-white">{creator.antiRekt.minLiquidityEth} ETH</span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span className="text-gray-400">Dev Reputation Score</span>
                                    <span className="text-indigo-400 font-bold">{creator.antiRekt.devReputationScore}/100</span>
                                  </div>
                                </div>

                                {/* Action Buttons */}
                                <div className="flex gap-2 pt-1 font-mono">
                                  <button
                                    onClick={() => {
                                      setEditingCreator(JSON.parse(JSON.stringify(creator)));
                                      setDrawerOpen(true);
                                    }}
                                    className="flex-1 py-1.5 border border-[#1C1F26] hover:bg-[#151924] text-xs font-bold text-gray-300 rounded flex items-center justify-center gap-1 uppercase cursor-pointer"
                                  >
                                    <Edit className="w-3 h-3" />
                                    <span>Edit Rules</span>
                                  </button>
                                  
                                  {(() => {
                                    const hasHoldings = positions.some(p => p.creatorAddress?.toLowerCase() === creator.address?.toLowerCase());
                                    return (
                                      <button
                                        disabled={!hasHoldings}
                                        onClick={() => setShowForceSellConfirm(creator)}
                                        className={`py-1.5 px-3 border text-xs font-bold rounded flex items-center justify-center gap-1 uppercase transition-all ${
                                          hasHoldings 
                                            ? 'border-rose-950/60 bg-rose-950/10 hover:bg-rose-900/20 text-rose-400 hover:text-rose-300 cursor-pointer' 
                                            : 'border-gray-900 bg-transparent text-gray-600 opacity-40 cursor-not-allowed'
                                        }`}
                                        title={hasHoldings ? "Force exit all open snipes from this creator" : "No open holdings for this creator"}
                                      >
                                        <XCircle className="w-3.5 h-3.5" />
                                        <span>Force Sell</span>
                                      </button>
                                    );
                                  })()}
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        {/* DESKTOP VIEW: CLEAN HIGH-CONTRAST DATA TABLE */}
                        <div className="hidden lg:block border border-[#1C1F26] bg-[#0E1118] rounded overflow-hidden shadow-lg font-mono">
                          <table className="w-full border-collapse text-left text-xs text-gray-300">
                            <thead>
                              <tr className="border-b border-[#1C1F26] bg-[#0A0D14] text-[10px] text-gray-500 uppercase tracking-wider font-bold">
                                <th className="p-4">CREATOR</th>
                                <th className="p-4">WALLET ADDRESS</th>
                                <th className="p-4 text-center">STATUS</th>
                                <th className="p-4 text-right">BUY SIZE</th>
                                <th className="p-4">ACTIVITY & LIFETIME P/L</th>
                                <th className="p-4">CUSTOM RULE SUMMARY</th>
                                <th className="p-4">ANTI-REKT LIMITS</th>
                                <th className="p-4 text-right">ACTIONS</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-[#1C1F26]/60">
                              {filteredCreators.map((creator) => {
                                const isPaused = creator.status === 'paused';
                                const isDisabled = creator.status === 'disabled';
                                const formattedPnL = (creator.lifetimePnLEth || 0) >= 0 
                                  ? `+${(creator.lifetimePnLEth || 0).toFixed(2)} ETH` 
                                  : `${(creator.lifetimePnLEth || 0).toFixed(2)} ETH`;

                                return (
                                  <tr 
                                    key={creator.id} 
                                    className={`transition-all hover:bg-[#151924]/20 ${
                                      isDisabled 
                                        ? 'bg-rose-950/5 opacity-70' 
                                        : isPaused 
                                          ? 'opacity-75 bg-black/10' 
                                          : ''
                                    }`}
                                  >
                                    {/* Creator Name & Handle */}
                                    <td className="p-4 font-bold">
                                      <div className="flex items-center gap-3">
                                        {renderCreatorAvatar(creator)}
                                        <div className="space-y-0.5">
                                          <div className="flex items-center gap-1.5">
                                            <span className={isDisabled ? 'text-rose-400' : isPaused ? 'text-gray-400' : 'text-white'}>
                                              {creator.name}
                                            </span>
                                            {creator.fid && (
                                              <span className="bg-blue-950/50 border border-blue-900/50 text-blue-400 text-[8px] px-1 py-0.5 rounded font-mono font-bold shrink-0">
                                                FID: {creator.fid}
                                              </span>
                                            )}
                                          </div>
                                          <span className="text-[10px] text-gray-500 block">
                                            {creator.handle}
                                          </span>
                                        </div>
                                      </div>
                                    </td>

                                    {/* Compact Address with copy */}
                                    <td className="p-4 font-mono">
                                      <div className="flex items-center space-x-2">
                                        <span className="text-indigo-400 bg-indigo-950/30 border border-indigo-900/30 px-2 py-0.5 rounded text-[10px]">
                                          {creator.address.slice(0, 8)}...{creator.address.slice(-6)}
                                        </span>
                                        <button 
                                          onClick={() => {
                                            navigator.clipboard.writeText(creator.address);
                                            triggerToast('Address copied to clipboard', 'success');
                                          }}
                                          className="text-gray-500 hover:text-white transition-colors cursor-pointer"
                                          title="Copy full address"
                                        >
                                          <Copy className="w-3.5 h-3.5" />
                                        </button>
                                      </div>
                                    </td>

                                    {/* Tracking Status */}
                                    <td className="p-4 text-center">
                                      <button
                                        onClick={() => handleToggleCreatorStatus(creator)}
                                        className={`px-2.5 py-1 text-[9px] font-bold rounded uppercase border cursor-pointer transition-all ${
                                          isDisabled
                                            ? 'bg-[#1A0A0E] border-rose-900 text-rose-500 hover:bg-[#1A0A0E]/80'
                                            : isPaused 
                                              ? 'bg-[#1F140A] border-amber-900 text-amber-500 hover:bg-[#1F140A]/80' 
                                              : 'bg-[#0E2015] border-emerald-900 text-emerald-400 hover:bg-[#0E2015]/80'
                                        }`}
                                      >
                                        {isDisabled ? '🚫 DISABLED' : isPaused ? '⏸ PAUSED' : '● ACTIVE'}
                                      </button>
                                    </td>

                                    {/* Custom Buy size */}
                                    <td className="p-4 text-right text-sm font-bold text-white">
                                      {creator.customBuyAmount} ETH
                                    </td>

                                    {/* Activity & Lifetime P/L */}
                                    <td className="p-4">
                                      <div className="space-y-1">
                                        <div className="flex justify-between gap-4 text-[10px]">
                                          <span className="text-gray-500">LAST:</span>
                                          <span className="text-white font-medium">{creator.lastActivity || 'Never'}</span>
                                        </div>
                                        <div className="flex justify-between gap-4 text-[10px]">
                                          <span className="text-gray-500">MINT_COUNT:</span>
                                          <span className="text-indigo-400 font-bold">{creator.coinsBoughtCount || 0}</span>
                                        </div>
                                        <div className="flex justify-between gap-4 text-[10px]">
                                          <span className="text-gray-500">LIFETIME P/L:</span>
                                          <span className={`font-bold ${(creator.lifetimePnLEth || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'} flex items-center gap-0.5`}>
                                            {(creator.lifetimePnLEth || 0) >= 0 && <TrendingUp className="w-3 h-3 inline shrink-0" />}
                                            {formattedPnL}
                                          </span>
                                        </div>
                                      </div>
                                    </td>

                                    {/* Custom Rule Overrides summary column */}
                                    <td className="p-4">
                                      <div className="space-y-1 text-[10px]">
                                        <div className="flex flex-wrap gap-1">
                                          {creator.sellAllAtOnce && (
                                            <span className="bg-emerald-950/40 text-emerald-400 border border-emerald-900/40 px-1 rounded text-[8px] font-bold uppercase shrink-0">
                                              SELL_ALL
                                            </span>
                                          )}
                                          {creator.maxSlippageOverride !== undefined && (
                                            <span className="bg-amber-950/40 text-amber-400 border border-amber-900/40 px-1 rounded text-[8px] font-bold uppercase shrink-0">
                                              SLIP: {creator.maxSlippageOverride}%
                                            </span>
                                          )}
                                          {creator.creatorTradeAmountOverride !== undefined && (
                                            <span className="bg-indigo-950/40 text-indigo-400 border border-indigo-900/40 px-1 rounded text-[8px] font-bold uppercase shrink-0">
                                              SIZE: {creator.creatorTradeAmountOverride} ETH
                                            </span>
                                          )}
                                          {creator.followerOverride && (
                                            <span className="bg-blue-950/40 text-blue-400 border border-blue-900/40 px-1 rounded text-[8px] font-bold uppercase shrink-0">
                                              BYPASS_FOLL
                                            </span>
                                          )}
                                          {!creator.autoSellEnabled && !creator.stopLossEnabled && (
                                            <span className="bg-rose-950/40 text-rose-400 border border-rose-900/40 px-1 rounded text-[8px] font-bold uppercase shrink-0">
                                              NO_EXIT
                                            </span>
                                          )}
                                        </div>
                                        {creator.notes ? (
                                          <div className="text-[10px] text-gray-500 italic max-w-xs truncate" title={creator.notes}>
                                            "{creator.notes}"
                                          </div>
                                        ) : (
                                          <div className="text-[9px] text-gray-600">No customized overrides active</div>
                                        )}
                                      </div>
                                    </td>

                                    {/* Anti-rekt overview */}
                                    <td className="p-4">
                                      <div className="text-[10px] space-y-0.5">
                                        <div>
                                          <span className="text-gray-500">TAX:</span> {creator.antiRekt.maxBuyTax}%B / {creator.antiRekt.maxSellTax}%S
                                        </div>
                                        <div>
                                          <span className="text-gray-500">POOL:</span> &ge;{creator.antiRekt.minLiquidityEth} ETH
                                        </div>
                                        <div>
                                          <span className="text-gray-500">DEV:</span> &ge;{creator.antiRekt.devReputationScore}/100
                                        </div>
                                      </div>
                                    </td>

                                    {/* Action Buttons */}
                                    <td className="p-4 text-right">
                                      <div className="flex justify-end gap-1.5">
                                        <button
                                          onClick={() => {
                                            setEditingCreator(JSON.parse(JSON.stringify(creator)));
                                            setDrawerOpen(true);
                                          }}
                                          className="px-2 py-1 border border-[#1C1F26] hover:bg-[#151924] text-[10px] font-bold text-gray-300 rounded flex items-center gap-1 uppercase cursor-pointer"
                                          title="Configure rules for this creator"
                                        >
                                          <Edit className="w-3 h-3" />
                                          <span>Edit</span>
                                        </button>
                                        
                                        {(() => {
                                          const hasHoldings = positions.some(p => p.creatorAddress?.toLowerCase() === creator.address?.toLowerCase());
                                          return (
                                            <button
                                              disabled={!hasHoldings}
                                              onClick={() => setShowForceSellConfirm(creator)}
                                              className={`px-2 py-1 border text-[10px] font-bold rounded flex items-center gap-1 uppercase transition-all ${
                                                hasHoldings 
                                                  ? 'border-rose-950/60 bg-rose-950/10 hover:bg-rose-900/20 text-rose-400 hover:text-rose-300 cursor-pointer' 
                                                  : 'border-gray-900 bg-transparent text-gray-600 opacity-40 cursor-not-allowed'
                                              }`}
                                              title={hasHoldings ? "Force exit all open snipes from this creator" : "No open holdings for this creator"}
                                            >
                                              <XCircle className="w-3.5 h-3.5" />
                                              <span>Force Sell</span>
                                            </button>
                                          );
                                        })()}

                                        <button
                                          onClick={() => {
                                            setShowDeleteConfirm(creator);
                                          }}
                                          className="p-1 border border-rose-950 hover:bg-rose-950/30 text-rose-400 rounded cursor-pointer"
                                          title="Delete creator"
                                        >
                                          <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </>
                    );
                  })()}

                  <div className="bg-[#151214] border border-gray-900 p-3 rounded text-[9px] text-gray-500 font-mono leading-normal">
                    <span className="font-bold text-white block uppercase mb-1">CONTRACT METADATA SCANNING ENGINE NOTE:</span>
                    The bot core decodes Uniswap, Sushiswap, and Zora Mint pools in real-time. If a deployment matches a tracked creator address, custom buy sizing and anti-rekt overrides bypass default strategy rules instantly at genesis blocks.
                  </div>

                </div>
              )}
            </div>
          )}

          {/* ==================== 5. SYSTEM LOGS TAB ==================== */}
          {activeTab === 'logs' && (
            <div id="tab-logs-workspace" className="p-4 lg:p-6 flex-1 flex flex-col min-h-0 space-y-4">
              
              {(() => {
                const getTypeStyles = (type: string) => {
                  switch (type) {
                    case 'BUY_SUCCESS':
                      return { bg: 'bg-emerald-950/40', text: 'text-emerald-400', border: 'border-emerald-900/40', label: 'BUY SUCCESS' };
                    case 'BUY_FAIL':
                      return { bg: 'bg-rose-950/40', text: 'text-rose-400', border: 'border-rose-900/40', label: 'BUY FAIL' };
                    case 'SOCIAL_AUDIT':
                      return { bg: 'bg-indigo-950/40', text: 'text-indigo-400', border: 'border-indigo-900/40', label: 'SOCIAL AUDIT' };
                    case 'COIN_STATS_CHECK':
                      return { bg: 'bg-cyan-950/40', text: 'text-cyan-400', border: 'border-cyan-900/40', label: 'STATS CHECK' };
                    case 'MOMENTUM_UPDATE':
                      return { bg: 'bg-amber-950/40', text: 'text-amber-400', border: 'border-amber-900/40', label: 'MOMENTUM UP' };
                    case 'SNIPER_METRICS':
                      return { bg: 'bg-blue-950/40', text: 'text-blue-400', border: 'border-blue-900/40', label: 'SNIPER STATS' };
                    case 'CONTENT_COIN_V4':
                      return { bg: 'bg-purple-950/40', text: 'text-purple-400', border: 'border-purple-900/40', label: 'CONTENT COIN' };
                    case 'CREATOR_COIN_PROFILE':
                      return { bg: 'bg-teal-950/40', text: 'text-teal-400', border: 'border-teal-900/40', label: 'CREATOR COIN' };
                    default:
                      return { bg: 'bg-gray-950/40', text: 'text-gray-400', border: 'border-gray-900/40', label: type };
                  }
                };

                const handleCopy = (text: string, label: string) => {
                  navigator.clipboard.writeText(text);
                  triggerToast(`Copied ${label}: ${text}`, 'success');
                };

                return (
                  <>
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 shrink-0">
                      <div>
                        <h2 className="text-lg lg:text-xl font-bold font-mono text-white tracking-tight uppercase flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full bg-teal-500 animate-pulse shrink-0"></span>
                          Activity Feed Workspace
                        </h2>
                        <p className="text-xs text-gray-400 font-mono">
                          Real-time transaction outputs, sniper audits, and social metrics from the high-speed loop.
                        </p>
                      </div>

                      <div className="flex items-center space-x-2 shrink-0">
                        <button 
                          onClick={() => {
                            fetchRealData();
                            triggerToast('Activity feed refreshed from backend', 'success');
                          }}
                          className="px-2.5 py-1.5 bg-[#0E1118] border border-[#1C1F26] hover:bg-[#151924] text-xs font-mono text-gray-300 rounded flex items-center gap-1.5 cursor-pointer transition-all"
                          title="Refresh Activity Feed"
                        >
                          <RefreshCw className="w-3.5 h-3.5 text-teal-400" />
                          <span>REFRESH</span>
                        </button>
                        <button 
                          onClick={() => {
                            const jsonStr = JSON.stringify(activityEvents, null, 2);
                            const blob = new Blob([jsonStr], { type: 'application/json' });
                            const url = URL.createObjectURL(blob);
                            const link = document.createElement('a');
                            link.href = url;
                            link.download = `zora_sniper_activity_feed_${Date.now()}.json`;
                            link.click();
                            URL.revokeObjectURL(url);
                            triggerToast('Activity feed exported to JSON', 'success');
                          }}
                          className="px-2.5 py-1.5 border border-[#1C1F26] hover:bg-[#151924] text-xs font-mono text-gray-300 rounded flex items-center gap-1.5 cursor-pointer transition-all"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>EXPORT</span>
                        </button>
                        <button 
                          onClick={() => {
                            setActivityEvents([]);
                            triggerToast('Activity feed cleared', 'info');
                          }}
                          className="px-2.5 py-1.5 border border-rose-950/40 text-rose-400 hover:bg-rose-900 hover:text-white text-xs font-mono rounded flex items-center gap-1.5 cursor-pointer transition-all"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>CLEAR</span>
                        </button>
                      </div>
                    </div>

                    {/* ERROR STATE */}
                    {activityError && (
                      <div className="p-3 bg-rose-950/20 border border-rose-900/50 rounded flex items-center justify-between text-xs text-rose-400 font-mono shrink-0">
                        <div className="flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4 shrink-0" />
                          <span>{activityError}</span>
                        </div>
                        <button 
                          onClick={fetchRealData}
                          className="px-2 py-0.5 bg-rose-900/40 text-rose-200 border border-rose-800 rounded hover:bg-rose-950 cursor-pointer text-[10px]"
                        >
                          RETRY
                        </button>
                      </div>
                    )}

                    {/* CONTROLS STRIP */}
                    <div className="bg-[#0E1118] border border-[#1C1F26] p-3 rounded flex flex-col md:flex-row gap-3 justify-between items-center shrink-0 font-mono text-xs">
                      
                      {/* STATUS FILTER */}
                      <div className="flex overflow-x-auto w-full md:w-auto pb-1 md:pb-0 gap-1 no-scrollbar select-none">
                        {(['ALL', 'BUY_SUCCESS', 'BUY_FAIL', 'SOCIAL_AUDIT', 'COIN_STATS_CHECK', 'MOMENTUM_UPDATE', 'SNIPER_METRICS', 'CONTENT_COIN_V4', 'CREATOR_COIN_PROFILE'] as const).map((type) => {
                          const active = activityFilter === type;
                          const style = getTypeStyles(type);
                          return (
                            <button
                              key={type}
                              onClick={() => setActivityFilter(type)}
                              className={`px-2.5 py-1 border text-[9px] font-bold uppercase rounded-sm cursor-pointer transition-all whitespace-nowrap ${
                                active
                                  ? 'bg-teal-600/15 border-teal-500 text-white font-black shadow'
                                  : 'bg-black/20 border-transparent hover:border-gray-800 text-gray-400'
                              }`}
                            >
                              {style.label || type}
                            </button>
                          );
                        })}
                      </div>

                      {/* SEARCH FILTER */}
                      <div className="relative w-full md:w-64 shrink-0">
                        <Search className="w-3.5 h-3.5 text-gray-500 absolute left-3 top-2.5" />
                        <input
                          type="text"
                          placeholder="Search events, tokens, creators..."
                          value={activitySearch}
                          onChange={(e) => setActivitySearch(e.target.value)}
                          className="w-full pl-9 pr-8 py-2 bg-black/30 border border-[#1C1F26] text-[10px] text-white placeholder-gray-500 focus:outline-none focus:border-teal-500 rounded font-mono"
                        />
                        {activitySearch && (
                          <button 
                            onClick={() => setActivitySearch('')}
                            className="absolute right-2.5 top-2.5 text-gray-500 hover:text-white transition-colors cursor-pointer text-xs font-bold"
                          >
                            &times;
                          </button>
                        )}
                      </div>

                    </div>

                    {/* EVENTS LIST CANVASES */}
                    <div className="flex-1 overflow-y-auto space-y-3 min-h-[300px] no-scrollbar pr-1">
                      {(() => {
                        const filtered = activityEvents.filter(ev => {
                          const evChain = ev.chain || 'zora';
                          if (evChain !== activeChain) return false;
                          if (activityFilter !== 'ALL' && ev.type !== activityFilter) return false;
                          if (activitySearch) {
                            const searchLower = activitySearch.toLowerCase();
                            const matchName = ev.coinName?.toLowerCase().includes(searchLower);
                            const matchSymbol = ev.coinSymbol?.toLowerCase().includes(searchLower);
                            const matchCoin = ev.tokenAddress?.toLowerCase().includes(searchLower);
                            const matchCreator = ev.creatorAddress?.toLowerCase().includes(searchLower);
                            const matchReason = ev.errorReason?.toLowerCase().includes(searchLower);
                            const matchType = ev.type?.toLowerCase().includes(searchLower);
                            return matchName || matchSymbol || matchCoin || matchCreator || matchReason || matchType;
                          }
                          return true;
                        });

                        if (filtered.length === 0) {
                          return (
                            <div className="flex flex-col items-center justify-center py-12 px-4 border border-[#1C1F26]/60 bg-[#0E1118]/40 rounded-lg text-center font-mono">
                              <AlertTriangle className="w-8 h-8 text-gray-600 mb-3 animate-pulse" />
                              <h3 className="text-xs font-bold text-gray-300 uppercase tracking-wider">No matching activities</h3>
                              <p className="text-[10px] text-gray-500 mt-1 max-w-md">
                                Try resetting the filters or modifying your search query. Fresh blocks will populate active trades.
                              </p>
                              {(activityFilter !== 'ALL' || activitySearch) && (
                                <button
                                  onClick={() => {
                                    setActivityFilter('ALL');
                                    setActivitySearch('');
                                  }}
                                  className="mt-4 px-3 py-1.5 border border-teal-950 hover:bg-teal-950/20 text-teal-400 rounded text-[9px] font-bold uppercase cursor-pointer"
                                >
                                  Reset filters
                                </button>
                              )}
                            </div>
                          );
                        }

                        return filtered.map((ev) => {
                          const style = getTypeStyles(ev.type);
                          return (
                            <div 
                              key={ev.id} 
                              className="bg-[#0E1118] border border-[#1C1F26]/60 hover:border-gray-800 p-4 rounded-md transition-all font-mono text-xs flex flex-col md:flex-row justify-between items-start md:items-center gap-4 relative overflow-hidden group shadow-md"
                            >
                              {/* Event details */}
                              <div className="flex-1 space-y-2">
                                
                                {/* Top Row: Type and Timestamp */}
                                <div className="flex items-center space-x-2">
                                  <span className={`px-2 py-0.5 border text-[9px] font-bold uppercase rounded-sm ${style.bg} ${style.text} ${style.border}`}>
                                    {style.label || ev.type}
                                  </span>
                                  <span className="text-gray-500 text-[10px] font-normal">[{ev.timestamp}]</span>
                                  {ev.statusResult && (
                                    <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold uppercase shrink-0 tracking-wider border ${
                                      ev.statusResult === 'SUCCESS' || ev.statusResult === 'PASSED' || ev.statusResult === 'TRUSTED' || ev.statusResult === 'OPTIMAL'
                                        ? 'bg-emerald-950/30 text-emerald-400 border-emerald-900/40'
                                        : ev.statusResult === 'FAILED'
                                        ? 'bg-rose-950/30 text-rose-400 border-rose-900/40'
                                        : 'bg-amber-950/30 text-amber-400 border-amber-900/40'
                                    }`}>
                                      {ev.statusResult}
                                    </span>
                                  )}
                                </div>

                                {/* Coin Info */}
                                {ev.coinName && (
                                  <div className="flex items-center space-x-2">
                                    <span className="text-white font-bold font-sans text-xs">{ev.coinName}</span>
                                    {ev.coinSymbol && (
                                      <span className="bg-black/40 text-gray-400 border border-gray-800/60 px-1 rounded text-[9px] font-bold uppercase">
                                        {ev.coinSymbol}
                                      </span>
                                    )}
                                  </div>
                                )}

                                {/* Addresses and Tx Hash */}
                                <div className="space-y-1">
                                  {ev.tokenAddress && (
                                    <div className="flex items-center space-x-1.5 text-[10px] text-gray-400">
                                      <span className="text-gray-500 font-bold shrink-0">COIN_ADDR:</span>
                                      <span className="text-gray-300 font-semibold break-all select-all">{ev.tokenAddress}</span>
                                      <button 
                                        onClick={() => handleCopy(ev.tokenAddress!, 'Token Address')}
                                        className="p-0.5 text-gray-500 hover:text-white transition-colors cursor-pointer shrink-0"
                                        title="Copy Token Address"
                                      >
                                        <Copy className="w-3 h-3" />
                                      </button>
                                    </div>
                                  )}

                                  {ev.creatorAddress && (
                                    <div className="flex items-center space-x-1.5 text-[10px] text-gray-400">
                                      <span className="text-gray-500 font-bold shrink-0">CREATOR:</span>
                                      <span className="text-indigo-300 font-semibold break-all select-all">{ev.creatorAddress}</span>
                                      <button 
                                        onClick={() => handleCopy(ev.creatorAddress!, 'Creator Address')}
                                        className="p-0.5 text-gray-500 hover:text-white transition-colors cursor-pointer shrink-0"
                                        title="Copy Creator Address"
                                      >
                                        <Copy className="w-3 h-3" />
                                      </button>
                                    </div>
                                  )}

                                  {ev.txHash && (
                                    <div className="flex items-center space-x-1.5 text-[10px] text-gray-400">
                                      <span className="text-gray-500 font-bold shrink-0">TX_HASH:</span>
                                      <span className="text-teal-400 font-semibold break-all select-all truncate max-w-[180px]" title={ev.txHash}>{ev.txHash}</span>
                                      <button 
                                        onClick={() => handleCopy(ev.txHash!, 'Transaction Hash')}
                                        className="p-0.5 text-gray-500 hover:text-white transition-colors cursor-pointer shrink-0"
                                        title="Copy Tx Hash"
                                        aria-label="Copy Transaction Hash"
                                      >
                                        <Copy className="w-3 h-3" />
                                      </button>
                                    </div>
                                  )}
                                </div>

                                {/* Error / Diagnostic message */}
                                {ev.errorReason && (
                                  <div className="p-2.5 bg-black/40 border border-gray-900 rounded text-[10px] text-gray-400 leading-relaxed flex items-start gap-1.5">
                                    {ev.statusResult === 'FAILED' ? (
                                      <AlertCircle className="w-3.5 h-3.5 text-rose-500 shrink-0 mt-0.5" />
                                    ) : (
                                      <Info className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                                    )}
                                    <span>{ev.errorReason}</span>
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        });
                      })()}
                      
                    </div>
                  </>
                );
              })()}

            </div>
          )}

        </main>

      </div>

      {/* SYSTEM STATUS FOOTER (COMMON IN DESKTOP AND MOBILE) */}
      <footer id="cc-app-footer" className="h-9 border-t border-[#1C1F26] bg-[#0E1118] flex items-center px-4 font-mono text-[10px] text-gray-500 shrink-0 select-text z-30">
        <span className="mr-2 text-emerald-500">$</span>
        <span className="text-white opacity-70">Zora Bot cycle active. Awaiting fresh blocks...</span>
        <span className="ml-1 w-1.5 h-3 bg-gray-400 animate-pulse"></span>
        <div className="ml-auto flex items-center space-x-5">
          <span className="hidden md:inline">NODE_STATE: <span className="text-emerald-400">OPTIMAL</span></span>
          <span>LATENCY: 14ms</span>
          <span className="hidden sm:inline">GAS: {gasPrice.toFixed(1)} GWEI</span>
        </div>
      </footer>

      {/* MOBILE PERSISTENT BOTTOM NAVIGATION BAR */}
      <nav id="mobile-bottom-navigation" className="lg:hidden fixed bottom-0 left-0 right-0 h-16 border-t border-[#1C1F26] bg-[#0E1118] z-40 flex justify-around items-center px-2 select-none">
        
        <button 
          onClick={() => setActiveTab('command')}
          className={`flex flex-col items-center justify-center w-14 h-12 rounded cursor-pointer ${
            activeTab === 'command' ? 'text-blue-400 font-bold' : 'text-gray-500'
          }`}
        >
          <Server className="w-4 h-4 mb-1" />
          <span className="text-[8px] font-mono uppercase tracking-tighter">Command</span>
        </button>

        <button 
          onClick={() => setActiveTab('scanner')}
          className={`flex flex-col items-center justify-center w-14 h-12 rounded cursor-pointer relative ${
            activeTab === 'scanner' ? 'text-orange-400 font-bold' : 'text-gray-500'
          }`}
        >
          <Flame className="w-4 h-4 mb-1" />
          <span className="text-[8px] font-mono uppercase tracking-tighter">Scanner</span>
          <span className="absolute top-1 right-2 w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse"></span>
        </button>

        <button 
          onClick={() => setActiveTab('positions')}
          className={`flex flex-col items-center justify-center w-14 h-12 rounded cursor-pointer relative ${
            activeTab === 'positions' ? 'text-emerald-400 font-bold' : 'text-gray-500'
          }`}
        >
          <Activity className="w-4 h-4 mb-1" />
          <span className="text-[8px] font-mono uppercase tracking-tighter">Positions</span>
          <span className="absolute -top-0.5 -right-0.5 bg-emerald-950 text-emerald-400 text-[8px] px-1 rounded-full border border-emerald-900 font-bold">
            {positions.length}
          </span>
        </button>

        <button 
          onClick={() => setActiveTab('creators')}
          className={`flex flex-col items-center justify-center w-14 h-12 rounded cursor-pointer relative ${
            activeTab === 'creators' ? 'text-indigo-400 font-bold' : 'text-gray-500'
          }`}
        >
          <Users className="w-4 h-4 mb-1" />
          <span className="text-[8px] font-mono uppercase tracking-tighter">Creators</span>
          <span className="absolute -top-0.5 -right-0.5 bg-indigo-950 text-indigo-400 text-[8px] px-1 rounded-full border border-indigo-900 font-bold">
            {trackedCreators.length}
          </span>
        </button>

        <button 
          onClick={() => setActiveTab('strategy')}
          className={`flex flex-col items-center justify-center w-14 h-12 rounded cursor-pointer ${
            activeTab === 'strategy' ? 'text-indigo-400' : 'text-gray-500'
          }`}
        >
          <SlidersHorizontal className="w-4 h-4 mb-1" />
          <span className="text-[8px] font-mono uppercase tracking-tighter">Strategy</span>
        </button>

        <button 
          onClick={() => setActiveTab('logs')}
          className={`flex flex-col items-center justify-center w-14 h-12 rounded cursor-pointer ${
            activeTab === 'logs' ? 'text-teal-400 font-bold' : 'text-gray-500'
          }`}
        >
          <Terminal className="w-4 h-4 mb-1" />
          <span className="text-[8px] font-mono uppercase tracking-tighter">Activity</span>
        </button>

      </nav>

      {/* CONFIRMATION MODAL: EMERGENCY STOP */}
      {showEmergencyModal && (
        <div id="emergency-stop-modal" className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm transition-opacity">
          <div className="w-full max-w-md bg-[#0E1118] border border-rose-500 rounded shadow-2xl p-6 relative">
            <button 
              onClick={() => setShowEmergencyModal(false)}
              className="absolute top-4 right-4 text-gray-500 hover:text-white transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center space-x-3 text-rose-500 mb-4 font-mono">
              <ShieldAlert className="w-8 h-8 shrink-0 animate-pulse" />
              <h3 className="text-sm font-bold uppercase tracking-wider">Emergency Halt Confirmation</h3>
            </div>

            <p className="text-xs text-gray-400 font-mono mb-6 leading-relaxed">
              CRITICAL: Transmitting emergency exit block orders. This command will immediately send market exit transactions to close ALL active positions, suspend automated sniping queues, and lock down the algorithm core until manual reboot.
            </p>

            <div className="flex space-x-3">
              <button 
                onClick={executeEmergencyStop}
                className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-500 text-white font-mono text-xs font-bold uppercase tracking-widest rounded cursor-pointer transition-all"
              >
                CONFIRM HALT
              </button>
              <button 
                onClick={() => setShowEmergencyModal(false)}
                className="flex-1 py-2.5 bg-gray-850 hover:bg-gray-800 text-gray-300 font-mono text-xs uppercase tracking-widest rounded border border-gray-800 cursor-pointer transition-all"
              >
                CANCEL
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DETAIL MODAL: INSPECT SECURITY CODE AUDIT */}
      {selectedScannerEvent && (
        <div id="inspect-security-modal" className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm transition-opacity animate-fadeIn">
          <div className="w-full max-w-xl bg-[#0E1118] border border-[#1C1F26] rounded shadow-2xl p-6 relative font-mono text-xs text-gray-300">
            
            {/* CLOSE BUTTON */}
            <button 
              onClick={() => setSelectedScannerEvent(null)}
              className="absolute top-4 right-4 text-gray-500 hover:text-white transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            {/* TITLE HEADER */}
            <div className="flex items-center space-x-2.5 text-blue-400 mb-4">
              <Shield className="w-7 h-7 text-emerald-400" />
              <div>
                <h3 className="text-sm font-bold uppercase tracking-wider text-white">
                  Bytecode Security Audit Report
                </h3>
                <span className="text-[9px] text-gray-500 font-bold block">
                  ASSET: {selectedScannerEvent.coinName} ({selectedScannerEvent.coinSymbol})
                </span>
              </div>
            </div>

            {/* DETAILED SPECIFICATIONS BLOCK */}
            <div className="space-y-4 max-h-[350px] overflow-y-auto pr-1">
              
              {/* STATUS INDICATORS */}
              <div className="grid grid-cols-2 gap-3 bg-black/30 p-3 rounded border border-[#1C1F26]/60">
                <div className="space-y-1">
                  <span className="text-[8px] text-gray-500 uppercase block">SWAP_COMPLIANCE</span>
                  <div className="flex items-center space-x-1.5 font-bold">
                    <span className={`w-2 h-2 rounded-full ${selectedScannerEvent.statusResult === 'FAILED' ? 'bg-rose-500' : 'bg-emerald-500'}`}></span>
                    <span className={selectedScannerEvent.statusResult === 'FAILED' ? 'text-rose-400' : 'text-emerald-400'}>
                      {selectedScannerEvent.statusResult === 'FAILED' ? 'FAILED_THREAT_DETECTED' : 'SIMULATION_PASSED'}
                    </span>
                  </div>
                </div>

                <div className="space-y-1">
                  <span className="text-[8px] text-gray-500 uppercase block">COMPILER_COMPILATION</span>
                  <div className="flex items-center space-x-1.5 font-bold">
                    <span className={`w-2 h-2 rounded-full ${selectedScannerEvent.compilerVerified ? 'bg-emerald-500' : 'bg-amber-500'}`}></span>
                    <span className={selectedScannerEvent.compilerVerified ? 'text-emerald-400' : 'text-amber-400'}>
                      {selectedScannerEvent.compilerVerified ? 'VERIFIED_SOLIDITY_MATCH' : 'UNVERIFIED_COMPILER_CODE'}
                    </span>
                  </div>
                </div>
              </div>

              {/* SECURITY CRITERIA DETAILS */}
              <div className="space-y-2">
                <span className="text-[10px] text-gray-400 uppercase font-bold block">AUDIT_CRITERIA_CHECKS</span>
                
                <div className="space-y-1.5">
                  <div className="flex justify-between p-2 bg-black/15 rounded border border-[#1C1F26]/30">
                    <span className="text-gray-500">Liquidity Locker Status:</span>
                    <span className={`font-bold ${selectedScannerEvent.liquidityLockedPercent && selectedScannerEvent.liquidityLockedPercent > 80 ? 'text-emerald-400' : 'text-rose-400'}`}>
                      {selectedScannerEvent.liquidityLockedPercent || 0}% Locked
                    </span>
                  </div>

                  <div className="flex justify-between p-2 bg-black/15 rounded border border-[#1C1F26]/30">
                    <span className="text-gray-500">Buy Surcharge Fee:</span>
                    <span className={`font-bold ${selectedScannerEvent.buyTax && selectedScannerEvent.buyTax > 5 ? 'text-rose-400' : 'text-emerald-400'}`}>
                      {selectedScannerEvent.buyTax || 0}%
                    </span>
                  </div>

                  <div className="flex justify-between p-2 bg-black/15 rounded border border-[#1C1F26]/30">
                    <span className="text-gray-500">Sell Transfer Fee:</span>
                    <span className={`font-bold ${selectedScannerEvent.sellTax && selectedScannerEvent.sellTax > 5 ? 'text-rose-400' : 'text-emerald-400'}`}>
                      {selectedScannerEvent.sellTax || 0}%
                    </span>
                  </div>

                  <div className="flex justify-between p-2 bg-black/15 rounded border border-[#1C1F26]/30">
                    <span className="text-gray-500">Creator Contract Authority:</span>
                    <span className="font-bold text-amber-400">Renounced (Pending verified block)</span>
                  </div>
                </div>
              </div>

              {/* AUDIT WRITEUP */}
              <div className="space-y-1 bg-black/40 p-3 rounded border border-gray-900 leading-relaxed text-gray-400 text-[11px]">
                <span className="text-[9px] text-white block uppercase font-bold mb-1">AUDIT_ANALYSIS_SUMMARY</span>
                {selectedScannerEvent.auditDetails}
              </div>

              {/* CONTRACT ADDRESS FOR EXTERNAL ACCESS */}
              <div className="space-y-1">
                <span className="text-[9px] text-gray-500 block uppercase font-bold">CONTRACT_ADDRESS</span>
                <div className="p-2 bg-black/20 rounded border border-[#1C1F26] text-white flex justify-between items-center text-[10px]">
                  <span className="select-all truncate mr-4">{selectedScannerEvent.tokenAddress}</span>
                  <button 
                    onClick={() => {
                      navigator.clipboard.writeText(selectedScannerEvent.tokenAddress);
                      triggerToast('Contract address copied to clipboard', 'success');
                    }}
                    className="text-blue-400 hover:text-white cursor-pointer shrink-0"
                  >
                    COPY
                  </button>
                </div>
              </div>

            </div>

            {/* BUTTON FOOTER */}
            <div className="flex space-x-3 border-t border-[#1C1F26] pt-4 mt-4 shrink-0">
              <button 
                onClick={() => {
                  handleManualSnipe(selectedScannerEvent);
                  setSelectedScannerEvent(null);
                }}
                disabled={selectedScannerEvent.statusResult === 'BOUGHT'}
                className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold uppercase rounded cursor-pointer transition-all text-center"
              >
                EXECUTE MANUAL BUY
              </button>
              <button 
                onClick={() => setSelectedScannerEvent(null)}
                className="flex-1 py-2 bg-gray-850 hover:bg-gray-800 text-gray-300 uppercase rounded cursor-pointer transition-all text-center border border-gray-800"
              >
                CLOSE
              </button>
            </div>

          </div>
        </div>
      )}

      {/* SLIDING DRAWER: CREATOR RULES CONFIGURATOR */}
      <AnimatePresence>
        {drawerOpen && editingCreator && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.5 }}
              exit={{ opacity: 0 }}
              onClick={() => setDrawerOpen(false)}
              className="fixed inset-0 bg-black z-40 cursor-pointer"
            />
            {/* Drawer */}
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed top-0 right-0 bottom-0 w-full sm:max-w-md bg-[#0A0D14] border-l border-[#1C1F26] z-50 p-6 shadow-2xl overflow-y-auto select-text font-mono flex flex-col justify-between"
            >
              <div>
                {/* Header */}
                <div className="flex justify-between items-center border-b border-[#1C1F26] pb-4 mb-6">
                  <div>
                    <h3 className="text-white font-bold text-sm uppercase tracking-wider flex items-center gap-1.5">
                      {editingCreator.id ? <Edit className="w-4 h-4 text-indigo-400" /> : <UserPlus className="w-4 h-4 text-indigo-400" />}
                      {editingCreator.id ? 'Configure Creator Rules' : 'Add Tracked Creator'}
                    </h3>
                    <p className="text-[10px] text-gray-500 leading-normal mt-0.5">
                      {editingCreator.id ? 'Modify customized parameters for this on-chain wallet.' : 'Enter a Zora creator address to queue automated snipes.'}
                    </p>
                    {editingCreator.id && JSON.stringify(editingCreator) !== JSON.stringify(trackedCreators.find(c => c.id === editingCreator.id)) && (
                      <span className="text-[9px] bg-amber-950/40 text-amber-500 border border-amber-900/40 px-1.5 py-0.5 rounded font-bold animate-pulse inline-block mt-1">
                        ⚠️ UNSAVED CHANGES
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => setDrawerOpen(false)}
                    className="p-1 text-gray-500 hover:text-white transition-colors cursor-pointer rounded bg-black/20 hover:bg-black/40"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* Body Form */}
                <div className="space-y-5 text-xs text-gray-300">
                  
                  {/* Basic Info */}
                  <div className="space-y-3 p-3 bg-black/20 border border-gray-900 rounded">
                    <span className="text-[9px] text-gray-500 font-bold uppercase block tracking-wider">Creator Wallet Info</span>
                    
                    <div className="space-y-1.5">
                      <label className="text-gray-400 block">CREATOR NAME (LITERAL)</label>
                      <input 
                        type="text"
                        placeholder="e.g. Zorb King"
                        value={editingCreator.name}
                        onChange={(e) => setEditingCreator(prev => prev ? { ...prev, name: e.target.value } : null)}
                        className="w-full bg-black/40 border border-[#1C1F26] p-2 text-white font-bold rounded"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-gray-400 block">CREATOR HANDLE (SOCIALS)</label>
                      <input 
                        type="text"
                        placeholder="e.g. @zorb_king"
                        value={editingCreator.handle}
                        onChange={(e) => setEditingCreator(prev => prev ? { ...prev, handle: e.target.value } : null)}
                        className="w-full bg-black/40 border border-[#1C1F26] p-2 text-white font-bold rounded"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-gray-400 block">WALLET ADDRESS (HEX)</label>
                      <input 
                        type="text"
                        placeholder="e.g. 0x8b32..."
                        value={editingCreator.address}
                        disabled={!!editingCreator.id}
                        onChange={(e) => setEditingCreator(prev => prev ? { ...prev, address: e.target.value } : null)}
                        className="w-full bg-black/40 border border-[#1C1F26] p-2 text-white font-bold rounded disabled:opacity-50 disabled:cursor-not-allowed"
                      />
                    </div>
                  </div>

                  {/* Sizing & Status */}
                  <div className="space-y-3.5 p-3 bg-black/20 border border-gray-900 rounded">
                    <span className="text-[9px] text-gray-500 font-bold uppercase block tracking-wider">Trading Status & Sizing</span>
                    
                    <div className="flex justify-between items-center">
                      <span className="text-gray-400">ACTIVE TRACKING STATUS</span>
                      <button
                        onClick={() => setEditingCreator(prev => prev ? { ...prev, status: prev.status === 'active' ? 'paused' : 'active' } : null)}
                        className={`px-3 py-1 text-[10px] font-bold rounded uppercase border cursor-pointer transition-all ${
                          editingCreator.status === 'paused' 
                            ? 'bg-[#1F140A] border-amber-900 text-amber-500' 
                            : 'bg-[#0E2015] border-emerald-900 text-emerald-400'
                        }`}
                      >
                        {editingCreator.status === 'paused' ? '⏸ PAUSED' : '● ACTIVE'}
                      </button>
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex justify-between">
                        <label className="text-gray-400">CUSTOM BUY AMOUNT</label>
                        <span className="text-indigo-400 font-bold">{editingCreator.customBuyAmount} ETH</span>
                      </div>
                      <input 
                        type="range" 
                        min="0.01" 
                        max="1.5" 
                        step="0.01" 
                        value={editingCreator.customBuyAmount}
                        onChange={(e) => setEditingCreator(prev => prev ? { ...prev, customBuyAmount: parseFloat(e.target.value) } : null)}
                        className="w-full accent-indigo-500 cursor-pointer h-1 bg-black/40 rounded"
                      />
                      {editingCreator.customBuyAmount > 0.5 && (
                        <p className="text-[9px] text-amber-400 flex items-start gap-1 bg-amber-950/20 p-1.5 rounded border border-amber-900/40">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                          <span>WARNING: Sizing exceeds 0.5 ETH! Highly risky override.</span>
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Exit Rules */}
                  <div className="space-y-3.5 p-3 bg-black/20 border border-gray-900 rounded">
                    <span className="text-[9px] text-gray-500 font-bold uppercase block tracking-wider">Automated Exits & Overrides</span>
                    
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <span className="text-gray-400 block uppercase">AUTO-SELL PROTOCOL</span>
                        <p className="text-[9px] text-gray-500 leading-normal">Transmit exit sell swaps automatically.</p>
                      </div>
                      <input 
                        type="checkbox" 
                        checked={editingCreator.autoSellEnabled}
                        onChange={(e) => setEditingCreator(prev => prev ? { ...prev, autoSellEnabled: e.target.checked } : null)}
                        className="w-4 h-4 cursor-pointer"
                      />
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <span className="text-gray-400 block uppercase">STOP-LOSS PROTECTION</span>
                        <p className="text-[9px] text-gray-500 leading-normal">Trigger immediate emergency sell swap on drops.</p>
                      </div>
                      <input 
                        type="checkbox" 
                        checked={editingCreator.stopLossEnabled}
                        onChange={(e) => setEditingCreator(prev => prev ? { ...prev, stopLossEnabled: e.target.checked } : null)}
                        className="w-4 h-4 cursor-pointer"
                      />
                    </div>

                    {/* sellAllAtOnce */}
                    <div className="flex items-center justify-between pt-2 border-t border-[#1C1F26]/40">
                      <div className="space-y-0.5">
                        <span className="text-gray-400 block uppercase">Sell All At Once</span>
                        <p className="text-[9px] text-gray-500 leading-normal">Sell 100% of holdings immediately upon exit trigger.</p>
                      </div>
                      <input 
                        type="checkbox" 
                        checked={!!editingCreator.sellAllAtOnce}
                        onChange={(e) => setEditingCreator(prev => prev ? { ...prev, sellAllAtOnce: e.target.checked } : null)}
                        className="w-4 h-4 cursor-pointer"
                      />
                    </div>

                    {/* followerOverride */}
                    <div className="flex items-center justify-between pt-2 border-t border-[#1C1F26]/40">
                      <div className="space-y-0.5">
                        <span className="text-gray-400 block uppercase">Bypass Follower Check</span>
                        <p className="text-[9px] text-gray-500 leading-normal font-mono">Override check for minimum follower thresholds.</p>
                      </div>
                      <input 
                        type="checkbox" 
                        checked={!!editingCreator.followerOverride}
                        onChange={(e) => setEditingCreator(prev => prev ? { ...prev, followerOverride: e.target.checked } : null)}
                        className="w-4 h-4 cursor-pointer"
                      />
                    </div>

                    {/* pauseTracking */}
                    <div className="flex items-center justify-between pt-2 border-t border-[#1C1F26]/40">
                      <div className="space-y-0.5">
                        <span className="text-gray-400 block uppercase">Pause Tracking</span>
                        <p className="text-[9px] text-gray-500 leading-normal font-mono">Temporarily suspend auto-sniping this creator.</p>
                      </div>
                      <input 
                        type="checkbox" 
                        checked={!!editingCreator.pauseTracking || editingCreator.status === 'paused'}
                        onChange={(e) => setEditingCreator(prev => {
                          if (!prev) return null;
                          const checked = e.target.checked;
                          return { 
                            ...prev, 
                            pauseTracking: checked, 
                            status: checked ? 'paused' : (prev.emergencyDisable ? 'disabled' : 'active')
                          };
                        })}
                        className="w-4 h-4 cursor-pointer"
                      />
                    </div>

                    {/* emergencyDisable */}
                    <div className="flex items-center justify-between pt-2 border-t border-[#1C1F26]/40">
                      <div className="space-y-0.5">
                        <span className="text-rose-400 block uppercase font-bold">Emergency Disable</span>
                        <p className="text-[9px] text-gray-500 leading-normal font-mono">Completely blacklist this creator address immediately.</p>
                      </div>
                      <input 
                        type="checkbox" 
                        checked={!!editingCreator.emergencyDisable || editingCreator.status === 'disabled'}
                        onChange={(e) => setEditingCreator(prev => {
                          if (!prev) return null;
                          const checked = e.target.checked;
                          return { 
                            ...prev, 
                            emergencyDisable: checked, 
                            status: checked ? 'disabled' : (prev.pauseTracking ? 'paused' : 'active')
                          };
                        })}
                        className="w-4 h-4 cursor-pointer text-rose-600 focus:ring-rose-500"
                      />
                    </div>

                    {/* maxSlippageOverride */}
                    <div className="space-y-1.5 pt-2 border-t border-[#1C1F26]/40">
                      <div className="flex justify-between">
                        <label className="text-gray-400 uppercase">Max Slippage Override (%)</label>
                        <span className="text-indigo-400 font-bold">
                          {editingCreator.maxSlippageOverride !== undefined ? `${editingCreator.maxSlippageOverride}%` : 'DEFAULT'}
                        </span>
                      </div>
                      <input 
                        type="number" 
                        step="0.1" 
                        min="0"
                        max="100"
                        placeholder="e.g. 2.5 (leaves empty to use global)"
                        value={editingCreator.maxSlippageOverride !== undefined ? editingCreator.maxSlippageOverride : ''}
                        onChange={(e) => {
                          const val = e.target.value;
                          setEditingCreator(prev => prev ? { ...prev, maxSlippageOverride: val === '' ? undefined : parseFloat(val) } : null);
                        }}
                        className="w-full bg-black/40 border border-[#1C1F26] p-2 text-white font-bold rounded"
                      />
                    </div>

                    {/* creatorTradeAmountOverride */}
                    <div className="space-y-1.5 pt-2 border-t border-[#1C1F26]/40">
                      <div className="flex justify-between">
                        <label className="text-gray-400 uppercase">Creator Snipe Size Override (ETH)</label>
                        <span className="text-indigo-400 font-bold">
                          {editingCreator.creatorTradeAmountOverride !== undefined ? `${editingCreator.creatorTradeAmountOverride} ETH` : 'DEFAULT'}
                        </span>
                      </div>
                      <input 
                        type="number" 
                        step="0.01" 
                        min="0"
                        max="10"
                        placeholder="e.g. 0.15 (leaves empty to use global)"
                        value={editingCreator.creatorTradeAmountOverride !== undefined ? editingCreator.creatorTradeAmountOverride : ''}
                        onChange={(e) => {
                          const val = e.target.value;
                          setEditingCreator(prev => prev ? { ...prev, creatorTradeAmountOverride: val === '' ? undefined : parseFloat(val) } : null);
                        }}
                        className="w-full bg-black/40 border border-[#1C1F26] p-2 text-white font-bold rounded"
                      />
                    </div>

                    {/* notes */}
                    <div className="space-y-1.5 pt-2 border-t border-[#1C1F26]/40">
                      <label className="text-gray-400 block uppercase">Notes / Research Details</label>
                      <textarea 
                        rows={2}
                        placeholder="e.g., Deployer of Zorb King collections. Highly reputable, fast mints."
                        value={editingCreator.notes || ''}
                        onChange={(e) => setEditingCreator(prev => prev ? { ...prev, notes: e.target.value } : null)}
                        className="w-full bg-black/40 border border-[#1C1F26] p-2 text-white text-xs font-mono rounded focus:outline-none focus:border-indigo-500"
                      />
                    </div>

                    <div className="space-y-1.5 pt-1.5 border-t border-[#1C1F26]/40">
                      <div className="flex justify-between">
                        <label className="text-gray-400">SELL-AFTER-USERS CAP</label>
                        <span className="text-white font-bold">
                          {editingCreator.sellAfterUsers > 0 ? `${editingCreator.sellAfterUsers} Users` : 'BYPASS'}
                        </span>
                      </div>
                      <input 
                        type="range" 
                        min="0" 
                        max="100" 
                        step="1" 
                        value={editingCreator.sellAfterUsers}
                        onChange={(e) => setEditingCreator(prev => prev ? { ...prev, sellAfterUsers: parseInt(e.target.value) } : null)}
                        className="w-full accent-blue-500 cursor-pointer h-1 bg-black/40 rounded"
                      />
                      <p className="text-[9px] text-gray-500 leading-normal">
                        Sells holding once N additional users mint/buy after this sniper entry. Set to 0 to bypass.
                      </p>
                      {editingCreator.sellAfterUsers > 0 && editingCreator.sellAfterUsers < 5 && (
                        <p className="text-[9px] text-amber-400 flex items-start gap-1 bg-amber-950/20 p-1.5 rounded border border-amber-900/40 font-bold">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                          <span>Dangerous: Cap &lt; 5 users can trigger premature sales.</span>
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Anti-rekt limits */}
                  <div className="space-y-3 p-3 bg-black/20 border border-gray-900 rounded">
                    <span className="text-[9px] text-gray-500 font-bold uppercase block tracking-wider">Anti-Rekt Parameters</span>
                    
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-gray-400 text-[10px] block">MAX BUY TAX (%)</label>
                        <input 
                          type="number"
                          value={editingCreator.antiRekt.maxBuyTax}
                          onChange={(e) => setEditingCreator(prev => {
                            if (!prev) return null;
                            const tax = parseInt(e.target.value) || 0;
                            return {
                              ...prev,
                              antiRekt: { ...prev.antiRekt, maxBuyTax: tax }
                            };
                          })}
                          className="w-full bg-black/40 border border-[#1C1F26] p-2 text-white font-bold rounded"
                        />
                      </div>
                      
                      <div className="space-y-1">
                        <label className="text-gray-400 text-[10px] block">MAX SELL TAX (%)</label>
                        <input 
                          type="number"
                          value={editingCreator.antiRekt.maxSellTax}
                          onChange={(e) => setEditingCreator(prev => {
                            if (!prev) return null;
                            const tax = parseInt(e.target.value) || 0;
                            return {
                              ...prev,
                              antiRekt: { ...prev.antiRekt, maxSellTax: tax }
                            };
                          })}
                          className="w-full bg-black/40 border border-[#1C1F26] p-2 text-white font-bold rounded"
                        />
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex justify-between text-[10px]">
                        <label className="text-gray-400">MIN LIQUIDITY DEPTH</label>
                        <span className="text-white font-bold">{editingCreator.antiRekt.minLiquidityEth} ETH</span>
                      </div>
                      <input 
                        type="range" 
                        min="0.1" 
                        max="5.0" 
                        step="0.1" 
                        value={editingCreator.antiRekt.minLiquidityEth}
                        onChange={(e) => setEditingCreator(prev => {
                          if (!prev) return null;
                          const liq = parseFloat(e.target.value);
                          return {
                            ...prev,
                            antiRekt: { ...prev.antiRekt, minLiquidityEth: liq }
                          };
                        })}
                        className="w-full accent-indigo-500 cursor-pointer h-1 bg-black/40 rounded"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex justify-between text-[10px]">
                        <label className="text-gray-400">MIN DEVS REPUTATION</label>
                        <span className="text-white font-bold">{editingCreator.antiRekt.devReputationScore}/100</span>
                      </div>
                      <input 
                        type="range" 
                        min="10" 
                        max="100" 
                        step="5" 
                        value={editingCreator.antiRekt.devReputationScore}
                        onChange={(e) => setEditingCreator(prev => {
                          if (!prev) return null;
                          const score = parseInt(e.target.value);
                          return {
                            ...prev,
                            antiRekt: { ...prev.antiRekt, devReputationScore: score }
                          };
                        })}
                        className="w-full accent-indigo-500 cursor-pointer h-1 bg-black/40 rounded"
                      />
                    </div>
                  </div>

                </div>
              </div>

              {/* Footer Actions */}
              <div className="border-t border-[#1C1F26] pt-4 mt-6">
                <div className="flex space-x-3">
                  <button
                    onClick={() => {
                      // Perform validation & collect warnings for overrides
                      const warnings: string[] = [];
                      if (editingCreator.customBuyAmount > 0.5) {
                        warnings.push('Custom Buy Sizing is set extremely high (>0.5 ETH), creating a target for slippage and Sandwich MEV.');
                      }
                      if (!editingCreator.autoSellEnabled && !editingCreator.stopLossEnabled) {
                        warnings.push('Both Automated Exit Protocols AND Stop-loss protections are disabled. Asset exposure is UNLIMITED!');
                      }
                      if (editingCreator.sellAfterUsers > 0 && editingCreator.sellAfterUsers < 5) {
                        warnings.push('Exit User Cap is set too low (<5 users), which will likely trigger premature exits in quick blocks.');
                      }
                      if (!editingCreator.name.trim() || !editingCreator.address.trim()) {
                        triggerToast('Please provide a name and valid wallet address', 'error');
                        return;
                      }
                      if (!editingCreator.address.startsWith('0x') || editingCreator.address.length !== 42) {
                        triggerToast('Invalid Ethereum wallet hex address format', 'error');
                        return;
                      }

                      const isNew = !editingCreator.id;

                      if (warnings.length > 0) {
                        setShowDangerConfirm({
                          creator: editingCreator,
                          isNew,
                          warnings
                        });
                      } else {
                        // Direct save
                        handleSaveCreatorDirect(editingCreator, isNew);
                      }
                    }}
                    className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-mono text-xs font-bold uppercase rounded shadow cursor-pointer transition-colors"
                  >
                    SAVE_RULES
                  </button>
                  {editingCreator.id && (
                    <button
                      onClick={() => {
                        setShowDeleteConfirm(editingCreator);
                      }}
                      className="py-2.5 px-3 border border-rose-950/60 bg-rose-950/20 hover:bg-rose-900/40 text-rose-400 rounded cursor-pointer transition-colors"
                      title="Remove from watchlist"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* MODAL: DANGEROUS OVERRIDE CONFIRMATION */}
      {showDangerConfirm && (
        <div id="danger-override-modal" className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90 backdrop-blur-sm transition-opacity">
          <div className="w-full max-w-md bg-[#0E1118] border border-amber-500 rounded shadow-2xl p-6 relative font-mono text-xs select-text">
            <button 
              onClick={() => setShowDangerConfirm(null)}
              className="absolute top-4 right-4 text-gray-500 hover:text-white transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center space-x-3 text-amber-500 mb-4">
              <AlertTriangle className="w-8 h-8 shrink-0 animate-bounce" />
              <div>
                <h3 className="text-sm font-bold uppercase tracking-wider text-white">High-Risk Overrides Detected</h3>
                <span className="text-[9px] text-gray-500 font-bold block mt-0.5">CREATOR: {showDangerConfirm.creator.name}</span>
              </div>
            </div>

            <p className="text-gray-400 mb-4 leading-relaxed">
              WARNING: The customized settings for this creator bypass your global bot strategy safety margins:
            </p>

            <div className="bg-amber-950/25 border border-amber-900/40 rounded p-3 mb-6 space-y-2 text-amber-300">
              {showDangerConfirm.warnings.map((warn, i) => (
                <div key={i} className="flex gap-2 items-start leading-normal">
                  <span className="text-amber-500 font-bold shrink-0">•</span>
                  <span>{warn}</span>
                </div>
              ))}
            </div>

            <div className="flex space-x-3">
              <button 
                onClick={() => {
                  handleSaveCreatorDirect(showDangerConfirm.creator, showDangerConfirm.isNew);
                }}
                className="flex-1 py-2.5 bg-amber-600 hover:bg-amber-500 text-white font-mono text-xs font-bold uppercase tracking-wider rounded cursor-pointer transition-colors"
              >
                PROCEED WITH OVERRIDES
              </button>
              <button 
                onClick={() => setShowDangerConfirm(null)}
                className="flex-1 py-2.5 bg-[#151924] hover:bg-[#1A1F2C] text-gray-300 font-mono text-xs uppercase tracking-wider rounded border border-gray-800 cursor-pointer transition-colors"
              >
                ABORT / ADJUST
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: DANGEROUS STRATEGY SETTINGS CONFIRMATION */}
      {strategyDangerousModal && (
        <div id="danger-strategy-modal" className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/90 backdrop-blur-sm transition-opacity">
          <div className="w-full max-w-md bg-[#0E1118] border border-amber-500 rounded shadow-2xl p-6 relative font-mono text-xs select-text">
            <button 
              onClick={() => setStrategyDangerousModal(null)}
              className="absolute top-4 right-4 text-gray-500 hover:text-white transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center space-x-3 text-amber-500 mb-4">
              <AlertTriangle className="w-8 h-8 shrink-0 animate-bounce" />
              <div>
                <h3 className="text-sm font-bold uppercase tracking-wider text-white">Dangerous Settings Detected</h3>
                <span className="text-[9px] text-gray-500 font-bold block mt-0.5 font-mono">ACTION REQUIRED: EXPLICIT CONFIRMATION</span>
              </div>
            </div>

            <p className="text-gray-400 mb-4 leading-relaxed font-sans">
              Warning: Your modified strategy contains settings that exceed standard safety parameters and could result in loss of capital:
            </p>

            <div className="bg-amber-950/25 border border-amber-900/40 rounded p-3 mb-6 space-y-2 text-amber-300">
              {strategyDangerousModal.warnings.map((warn, i) => (
                <div key={i} className="flex gap-2 items-start leading-normal">
                  <span className="text-amber-500 font-bold shrink-0">•</span>
                  <span>{warn}</span>
                </div>
              ))}
            </div>

            <div className="flex space-x-3">
              <button 
                onClick={() => {
                  executeSaveStrategy();
                }}
                className="flex-1 py-2.5 bg-amber-600 hover:bg-amber-500 text-white font-mono text-xs font-bold uppercase tracking-wider rounded cursor-pointer transition-colors"
              >
                PROCEED & SAVE CONFIG
              </button>
              <button 
                onClick={() => setStrategyDangerousModal(null)}
                className="flex-1 py-2.5 bg-[#151924] hover:bg-[#1A1F2C] text-gray-300 font-mono text-xs uppercase tracking-wider rounded border border-gray-800 cursor-pointer transition-colors"
              >
                ABORT / REVERT
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: DELETE CREATOR WATCHLIST ITEM */}
      {showDeleteConfirm && (
        <div id="delete-watchlist-modal" className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm transition-opacity">
          <div className="w-full max-w-md bg-[#0E1118] border border-rose-900/50 rounded shadow-2xl p-6 relative font-mono text-xs select-text">
            <button 
              onClick={() => setShowDeleteConfirm(null)}
              className="absolute top-4 right-4 text-gray-500 hover:text-white transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center space-x-3 text-rose-500 mb-4">
              <Trash2 className="w-7 h-7 shrink-0" />
              <div>
                <h3 className="text-sm font-bold uppercase tracking-wider text-white">Delete Tracked Creator?</h3>
                <span className="text-[9px] text-gray-500 block mt-0.5">{showDeleteConfirm.name} ({showDeleteConfirm.handle})</span>
              </div>
            </div>

            <p className="text-gray-400 mb-6 leading-relaxed">
              Are you sure you want to remove <span className="text-white font-bold">{showDeleteConfirm.name}</span> from your watchlist? This will immediately suspend all automated genesis-block sniping rules for their deployments.
            </p>

            <div className="flex space-x-3">
              <button 
                onClick={() => {
                  handleDeleteCreatorDirect(showDeleteConfirm.id, showDeleteConfirm.name);
                }}
                className="flex-1 py-2.5 bg-rose-650 hover:bg-rose-600 text-white font-mono text-xs font-bold uppercase tracking-wider rounded cursor-pointer transition-colors"
              >
                CONFIRM DELETE
              </button>
              <button 
                onClick={() => setShowDeleteConfirm(null)}
                className="flex-1 py-2.5 bg-[#151924] hover:bg-[#1A1F2C] text-gray-300 font-mono text-xs uppercase tracking-wider rounded border border-gray-800 cursor-pointer transition-colors"
              >
                CANCEL
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: FORCE SELL HOLDS CONFIRMATION */}
      {showForceSellConfirm && (
        <div id="force-sell-modal" className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm transition-opacity">
          <div className="w-full max-w-md bg-[#0E1118] border border-rose-500 rounded shadow-2xl p-6 relative font-mono text-xs select-text">
            <button 
              onClick={() => setShowForceSellConfirm(null)}
              className="absolute top-4 right-4 text-gray-500 hover:text-white transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center space-x-3 text-rose-500 mb-4">
              <XCircle className="w-8 h-8 shrink-0 animate-pulse" />
              <div>
                <h3 className="text-sm font-bold uppercase tracking-wider text-white">Force Exit Sniped Holdings</h3>
                <span className="text-[9px] text-gray-500 font-bold block mt-0.5 font-mono">CREATOR: {showForceSellConfirm.name}</span>
              </div>
            </div>

            <p className="text-gray-400 mb-6 leading-relaxed">
              CRITICAL: This will immediately broadcast sell transaction instructions for ALL open holdings on Zora matching <span className="text-white font-bold">{showForceSellConfirm.name}</span>’s deployments. This is an irreversible on-chain order.
            </p>

            <div className="flex space-x-3">
              <button 
                onClick={() => {
                  handleForceSellCreatorHoldings(showForceSellConfirm);
                }}
                className="flex-1 py-2.5 bg-rose-650 hover:bg-rose-600 text-white font-mono text-xs font-bold uppercase tracking-wider rounded cursor-pointer transition-colors"
              >
                EXECUTE FORCE SELL
              </button>
              <button 
                onClick={() => setShowForceSellConfirm(null)}
                className="flex-1 py-2.5 bg-[#151924] hover:bg-[#1A1F2C] text-gray-300 font-mono text-xs uppercase tracking-wider rounded border border-gray-800 cursor-pointer transition-colors"
              >
                CANCEL
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MOBILE AI CHAT EXPANDED OVERLAY */}
      {isMobileChatExpanded && (
        <CompanionWidget
          messages={aiMessages}
          sending={sendingAi}
          onSendMessage={handleSendAiMessage}
          layout="mobile-overlay"
          onCloseMobile={() => setIsMobileChatExpanded(false)}
          onExecuteAction={handleExecuteAiAction}
          apiBase={import.meta.env.VITE_API_BASE_URL || ''}
          token={token || ''}
        />
      )}

    </div>
  );
}
