import React, { useState, useEffect, useRef } from 'react';
import { Sparkles, Activity, Shield, Terminal, ArrowRight, Zap, RefreshCw, Cpu, Layers, X, AlertCircle, Send } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { authApi } from '../../services/api';
import { auth, googleProvider } from '../../services/firebase';
import { signInWithPopup } from 'firebase/auth';
import { PlansScreen } from './PlansScreen';
import { AboutScreen } from './AboutScreen';
import { API_BASE_URL } from '../../config';

interface LandingScreenProps {
  onNext: () => void;
  onLoginSuccess: (
    jwt: string,
    address: string,
    role: string,
    loginPayload?: {
      profile?: { uid: string; email: string; role: string; primaryAddress: string };
      subscription?: { active: boolean; plan: string | null };
      onboardingComplete?: boolean;
      tradingWallet?: string | null;
      plan?: string | null;
    }
  ) => void;
}

interface WebEvent {
  id: string;
  coinName: string;
  coinSymbol: string;
  tokenAddress: string;
  creatorAddress: string;
  marketCap: number;
  timestamp: string;
  riskScore: number;
  chain: string;
}

export const LandingScreen: React.FC<LandingScreenProps> = ({ onNext, onLoginSuccess }) => {
  const [view, setView] = useState<'home' | 'plans' | 'about'>('home');
  const [activeTab, setActiveTab] = useState<'zora' | 'base' | 'solana'>('zora');
  const [events, setEvents] = useState<WebEvent[]>([]);
  const [wsStatus, setWsStatus] = useState<'CONNECTING' | 'LIVE' | 'OFFLINE'>('CONNECTING');
  const wsRef = useRef<WebSocket | null>(null);
  // AI Preview Chat States
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Stop playback when component unmounts
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
      }
      window.speechSynthesis.cancel();
    };
  }, []);

  const playVoice = (text: string, audioBase64?: string) => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    window.speechSynthesis.cancel();

    if (audioBase64) {
      try {
        const audioSrc = `data:audio/wav;base64,${audioBase64}`;
        const audio = new Audio(audioSrc);
        audioRef.current = audio;
        audio.play().catch(err => {
          console.warn("[TTS] Native human audio playback failed on landing page:", err.message);
        });
      } catch (err) {
        console.warn("[TTS] Native audio init failed:", err);
      }
    } else {
      const cleanText = text
        .replace(/\*\*([\s\S]*?)\*\*/g, '$1')
        .replace(/\*([\s\S]*?)\*/g, '$1')
        .replace(/`/g, '')
        .trim();

      const utterance = new SpeechSynthesisUtterance(cleanText);

      // Select natural sounding female voice if available, excluding robotic Microsoft Zira/Hazel
      const voices = window.speechSynthesis.getVoices();
      const femaleVoice = voices.find(v => {
        const nameLower = v.name.toLowerCase();
        const matchesPattern = (
          nameLower.includes('google us english') ||
          nameLower.includes('google uk english female') ||
          nameLower.includes('samantha') ||
          nameLower.includes('female') ||
          nameLower.includes('natural')
        );
        const isRobotic = nameLower.includes('zira') || nameLower.includes('hazel') || nameLower.includes('david');
        return matchesPattern && !isRobotic && v.lang.startsWith('en');
      }) || voices.find(v => {
        const nameLower = v.name.toLowerCase();
        return v.lang.startsWith('en') && !nameLower.includes('zira') && !nameLower.includes('hazel') && !nameLower.includes('david');
      }) || voices.find(v => v.lang.startsWith('en'));

      if (femaleVoice) {
        utterance.voice = femaleVoice;
      }
      utterance.pitch = 1.08;
      utterance.rate = 0.98;

      window.speechSynthesis.speak(utterance);
    }
  };

  const [aiChatMessages, setAiChatMessages] = useState<Array<{ sender: 'user' | 'ai'; text: string }>>([
    { sender: 'ai', text: 'Welcome to FOMOCLIX AI preview. How can I assist you with sniping today?' }
  ]);
  const [aiChatInput, setAiChatInput] = useState('');
  const [sendingAiChat, setSendingAiChat] = useState(false);
  const [aiChatCount, setAiChatCount] = useState(0);

  const handleSendAiChatMessage = async () => {
    if (!aiChatInput.trim() || sendingAiChat || aiChatCount >= 4) return;
    const msg = aiChatInput.trim();
    setAiChatInput('');
    setAiChatMessages(prev => [...prev, { sender: 'user', text: msg }]);
    setSendingAiChat(true);
    try {
      const apiBase = API_BASE_URL;
      const historyToSend = aiChatMessages.map(m => ({
        role: m.sender === 'user' ? 'user' : 'assistant',
        text: m.text
      }));
      const res = await fetch(`${apiBase}/ai/chat-preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg, history: historyToSend })
      });
      if (res.ok) {
        const data = await res.json();
        setAiChatMessages(prev => [...prev, { sender: 'ai', text: data.reply || '' }]);
        setAiChatCount(prev => prev + 1);
        playVoice(data.reply || '', data.audio);
      } else {
        throw new Error('Chat failed');
      }
    } catch (e) {
      setAiChatMessages(prev => [...prev, { sender: 'ai', text: 'Error connecting to AI. Please try again.' }]);
    } finally {
      setSendingAiChat(false);
    }
  };

  // Login Modal States
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initialize live WebSocket stream and fetch initial public-feed from backend
  useEffect(() => {
    const apiBase = API_BASE_URL;
    const wsUrl = apiBase.replace('https://', 'wss://').replace('http://', 'ws://');

    // Fetch initial events
    const fetchInitialEvents = async () => {
      try {
        const res = await fetch(`${apiBase}/scanner/public-feed`);
        if (res.ok) {
          const data = await res.json();
          if (data.success && data.events) {
            const formatted = data.events.map((item: any) => ({
              id: item.id || String(Math.random()),
              coinName: item.name || 'Unknown',
              coinSymbol: item.symbol || 'UNK',
              tokenAddress: item.coin || item.tokenAddress || '—',
              creatorAddress: item.creator || item.creatorAddress || '—',
              marketCap: item.marketCap || 0,
              timestamp: item.timestamp ? new Date(item.timestamp).toLocaleTimeString() : new Date().toLocaleTimeString(),
              riskScore: item.riskScore || 20,
              chain: item.chain || 'zora'
            }));
            setEvents(formatted);
          }
        }
      } catch (err) {
        console.warn('[Landing] Failed to fetch initial events:', err);
      }
    };
    fetchInitialEvents();
    
    const connectWs = () => {
      try {
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          setWsStatus('LIVE');
        };

        ws.onmessage = (event) => {
          try {
            const payload = JSON.parse(event.data);
            if (payload.collection === 'activityFeed' && payload.data) {
              const item = payload.data;
              if (item.type === 'SCANNING_COIN' || item.type === 'CREATOR_COIN_PROFILE') {
                const newEv: WebEvent = {
                  id: payload.id || String(Date.now()),
                  coinName: item.name || 'Unknown',
                  coinSymbol: item.symbol || 'UNK',
                  tokenAddress: item.coin || item.tokenAddress || '—',
                  creatorAddress: item.creator || item.creatorAddress || '—',
                  marketCap: item.marketCap || 0,
                  timestamp: item.timestamp ? new Date(item.timestamp).toLocaleTimeString() : new Date().toLocaleTimeString(),
                  riskScore: item.riskScore || 20,
                  chain: item.chain || 'zora'
                };
                setEvents(prev => {
                  const filtered = prev.filter(e => e.id !== newEv.id);
                  return [newEv, ...filtered].slice(0, 10);
                });
              }
            }
          } catch (e) {
            // parse error
          }
        };

        ws.onerror = () => {
          setWsStatus('OFFLINE');
        };

        ws.onclose = () => {
          setWsStatus('OFFLINE');
          setTimeout(connectWs, 5000);
        };
      } catch (err) {
        setWsStatus('OFFLINE');
      }
    };

    connectWs();
    return () => {
      if (wsRef.current) wsRef.current.close();
    };
  }, []);

  const filteredEvents = events.filter(e => e.chain === activeTab);

  const cleanAddr = (addr: string) => {
    if (!addr || addr === '—') return '—';
    if (addr.length > 12) return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
    return addr;
  };

  // Google Login Handler
  const handleGoogleLogin = async () => {
    setLoading(true);
    setError(null);
    try {
      const userCredential = await signInWithPopup(auth, googleProvider);
      const idToken = await userCredential.user.getIdToken();
      const result = await authApi.googleLogin(idToken);
      if (!result.jwt_token) throw new Error('No custom authentication token returned.');
      onLoginSuccess(result.jwt_token, result.profile.uid, result.profile.role, result);
      setShowLoginModal(false);
    } catch (err: any) {
      console.error('[Google Login Failure]', err);
      const msg = err?.message || 'Google Sign-In failed.';
      if (msg.includes('auth/unauthorized-domain') || msg.includes('unauthorized-domain')) {
        setError('This domain is not authorized in Firebase. Add zora-trader-run-v1.web.app under Firebase Auth → Settings → Authorized domains.');
      } else if (msg.includes('auth/popup-blocked')) {
        setError('Popup was blocked. Allow popups for this site and try again.');
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  // Wallet Login Handler
  const handleWalletLogin = async () => {
    setLoading(true);
    setError(null);
    try {
      const ethereum = (window as any).ethereum;
      if (!ethereum) {
        throw new Error('No EVM wallet detected. Please install MetaMask or another EVM wallet.');
      }
      const accounts: string[] = await ethereum.request({ method: 'eth_requestAccounts' });
      if (!accounts || accounts.length === 0) throw new Error('No accounts returned from wallet.');
      const address = accounts[0];

      const { message } = await authApi.getChallenge(address);
      // personal_sign: pass UTF-8 hex (EIP-1193). Backend verifies with ethers.verifyMessage(message, sig).
      const hexMessage = '0x' + Array.from(new TextEncoder().encode(message))
        .map(b => b.toString(16).padStart(2, '0')).join('');
      let signature: string;
      try {
        signature = await ethereum.request({
          method: 'personal_sign',
          params: [hexMessage, address],
        });
      } catch (signErr: any) {
        // Some wallets prefer the raw string message
        signature = await ethereum.request({
          method: 'personal_sign',
          params: [message, address],
        });
      }

      const result = await authApi.login(address, message, signature);
      if (!result.jwt_token) throw new Error('No token returned from server.');

      onLoginSuccess(result.jwt_token, address, result.profile.role || 'user', result);
      setShowLoginModal(false);
    } catch (err: any) {
      console.error('[Wallet Login Failure]', err);
      setError(err?.message || 'Wallet connection/signature rejected.');
    } finally {
      setLoading(false);
    }
  };

  if (view === 'plans') {
    return <PlansScreen onNext={() => setView('about')} onBack={() => setView('home')} />;
  }

  if (view === 'about') {
    return <AboutScreen onNext={() => { setView('home'); setShowLoginModal(true); }} onBack={() => setView('plans')} />;
  }

  return (
    <div className="w-full min-h-screen bg-[#07080A] text-[#D1D5DB] font-mono flex flex-col items-center relative overflow-y-auto px-4 py-8 select-none">
      {/* Animated background */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden z-0">
        <div className="absolute inset-0 opacity-[0.03] text-[9px] leading-none overflow-hidden select-none font-mono">
          {Array.from({ length: 40 }).map((_, idx) => (
            <div key={idx} className="whitespace-nowrap animate-[pulse_3s_infinite]" style={{ animationDelay: `${idx * 0.15}s` }}>
              {Array.from({ length: 120 }).map(() => (Math.random() > 0.5 ? '1 ' : '0 ')).join('')}
            </div>
          ))}
        </div>
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[800px] h-[800px] rounded-full bg-indigo-500/5 blur-3xl" />
        <div className="absolute bottom-10 right-10 w-[500px] h-[500px] rounded-full bg-violet-600/4 blur-3xl" />
        <div className="absolute top-10 left-10 w-[450px] h-[450px] rounded-full bg-emerald-500/3 blur-3xl" />
      </div>

      <div className="w-full max-w-4xl z-10 flex flex-col items-center space-y-16">
        {/* Navigation Header */}
        <header className="w-full flex items-center justify-between border-b border-[#1C1F26] pb-4 shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-indigo-500 animate-pulse" />
            <span className="font-bold text-sm tracking-tight text-white font-mono uppercase">FOMOCLIX_OS</span>
          </div>
          <div className="flex items-center gap-4 text-[10px] text-gray-500 font-mono">
            <span>[SYS_OK]</span>
            <div className="flex items-center gap-1">
              <span className={`w-1.5 h-1.5 rounded-full ${wsStatus === 'LIVE' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
              <span className={wsStatus === 'LIVE' ? 'text-emerald-400 font-bold' : 'text-amber-500'}>
                STREAM_{wsStatus}
              </span>
            </div>
            <button
              onClick={() => setShowLoginModal(true)}
              className="px-2 py-0.5 bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/20 text-indigo-400 text-[9px] font-bold rounded cursor-pointer transition-all uppercase tracking-wider"
            >
              [LOGIN]
            </button>
          </div>
        </header>

        {/* HERO SECTION */}
        <section className="text-center space-y-6 max-w-2xl py-8">
          <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="space-y-4"
          >
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-indigo-500/10 border border-indigo-500/20 rounded-full text-indigo-400 text-[9px] font-bold uppercase tracking-wider">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Agentic Multi-Chain AI OS</span>
            </div>
            
            <h1 className="text-2xl md:text-4xl text-white font-sans font-black uppercase tracking-wider leading-tight">
              AI Trading Operating System<br />
              <span className="text-indigo-400">for Onchain Markets</span>
            </h1>
            
            <p className="text-xs text-gray-400 leading-relaxed max-w-xl mx-auto font-mono">
              FomoClix is a non-custodial intelligence environment. You provision a dedicated, locally-encrypted trading wallet, load your strategy rules, and collaborate with our conversational AI. The AI scans contract code, queries social signals, and executes orders—always awaiting your cryptographic validation.
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3 }}
            className="flex flex-col items-center gap-3"
          >
            <div className="flex flex-col sm:flex-row items-center gap-3 w-full justify-center">
              <button
                onClick={() => setView('plans')}
                className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 border border-indigo-500 text-white text-xs font-bold uppercase tracking-widest rounded transition-all cursor-pointer flex items-center gap-2 group shadow-lg shadow-indigo-900/30"
              >
                <span>ACCESS PLATFORM PLANS</span>
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </button>
              
              <button
                onClick={() => setShowLoginModal(true)}
                className="px-6 py-3 bg-transparent hover:bg-white/5 border border-gray-800 hover:border-gray-700 text-gray-300 text-xs font-bold uppercase tracking-widest rounded transition-all cursor-pointer flex items-center gap-2"
              >
                <span>SIGN IN</span>
              </button>
            </div>
            <span className="text-[7.5px] text-gray-600 uppercase tracking-widest mt-1">
              No deposit required to configure · Starting balance from $0.50
            </span>
          </motion.div>
        </section>

        {/* LIVE MARKET DETECTIONS SCANNER */}
        <section className="w-full border border-[#1C1F26] bg-[#0E1118]/80 rounded-lg p-5 space-y-4 relative shadow-2xl backdrop-blur-md">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-[#1C1F26] pb-3 gap-2">
            <div>
              <h2 className="text-white text-xs uppercase tracking-wider font-bold flex items-center gap-2">
                <Activity className="w-4 h-4 text-emerald-400 animate-pulse" />
                Live Multichain Detector Feed
              </h2>
              <p className="text-[8px] text-gray-500 mt-0.5 uppercase tracking-wider">Read-only connection streaming directly from base nodes</p>
            </div>
            <div className="flex gap-1.5">
              {(['zora', 'base', 'solana'] as const).map(ch => (
                <button
                  key={ch}
                  onClick={() => setActiveTab(ch)}
                  className={`px-3 py-1 rounded text-[9px] font-bold uppercase border transition-all cursor-pointer ${
                    activeTab === ch
                      ? 'bg-indigo-600/10 border-indigo-500 text-indigo-400'
                      : 'bg-black/20 border-gray-900 text-gray-500 hover:text-gray-300'
                  }`}
                >
                  {ch}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto min-h-[140px] max-h-[220px]">
            <table className="w-full text-left font-mono text-[9px] text-gray-400">
              <thead>
                <tr className="border-b border-[#1C1F26] text-gray-600">
                  <th className="py-2 uppercase">Token</th>
                  <th className="py-2 uppercase">Creator</th>
                  <th className="py-2 uppercase">MCAP</th>
                  <th className="py-2 uppercase">Risk Score</th>
                  <th className="py-2 uppercase text-right">Detected</th>
                </tr>
              </thead>
              <tbody>
                {filteredEvents.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-gray-600">
                      No recent detections
                    </td>
                  </tr>
                ) : (
                  filteredEvents.map((ev) => (
                    <tr key={ev.id} className="border-b border-[#1C1F26]/40 last:border-0 hover:bg-[#151924]/20 transition-all">
                      <td className="py-2 text-white font-bold uppercase flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                        <span>{ev.coinSymbol}</span>
                        <span className="text-[8px] text-gray-600">({ev.coinName})</span>
                      </td>
                      <td className="py-2 font-mono text-gray-500">{cleanAddr(ev.creatorAddress)}</td>
                      <td className="py-2 text-emerald-400 font-bold">${ev.marketCap ? ev.marketCap.toLocaleString() : '—'}</td>
                      <td className="py-2">
                        <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold ${
                          ev.riskScore >= 70 ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20' :
                          ev.riskScore >= 40 ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' :
                          'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                        }`}>
                          {ev.riskScore}%
                        </span>
                      </td>
                      <td className="py-2 text-right text-gray-600">{ev.timestamp}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* AI OS REASONING METHODOLOGY */}
        <section className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center w-full">
          <div className="space-y-4">
            <div className="p-2 bg-indigo-500/10 border border-indigo-500/20 rounded-full w-fit">
              <Cpu className="w-4 h-4 text-indigo-400" />
            </div>
            <h2 className="text-white font-sans font-black text-xl uppercase tracking-wider">
              Reasoning-Before-Execution
            </h2>
            <p className="text-[10px] text-gray-400 leading-relaxed font-mono">
              FomoClix AI operates via strict permissioned gateways. When listening to contract state changes or social trends, it does not execute orders blindly. Instead, the AI parses target data, queries the strategy parameters you configure, and generates a structured rationale. 
            </p>
            <div className="flex items-center gap-1.5 text-[9px] font-mono text-amber-400 font-bold">
              <Shield className="w-3.5 h-3.5 shrink-0" />
              <span>THE BOT NEVER TRADES WITHOUT YOUR PERMISSION UNLESS SPECIFIC AUTOMATION IS ENABLED</span>
            </div>
          </div>
          
          <div className="p-4 bg-[#0A0C12] border border-[#1C1F26] rounded-lg font-mono text-[9px] space-y-2.5 shadow-xl flex flex-col h-[220px]">
            <div className="flex items-center justify-between border-b border-[#1C1F26] pb-2 text-white shrink-0">
              <span className="flex items-center gap-1">
                <Sparkles className="w-3 h-3 text-indigo-400" />
                <span>[FOMOCLIX_AI_PREVIEW]</span>
              </span>
              <span className="text-indigo-400 font-bold uppercase tracking-wider">
                {sendingAiChat ? 'REASONING...' : `PREVIEW: ${aiChatCount}/4`}
              </span>
            </div>
            
            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto space-y-2 pr-1 scrollbar-thin scrollbar-thumb-indigo-950">
              {aiChatMessages.map((m, idx) => (
                <div key={idx} className={`p-2 rounded ${
                  m.sender === 'user'
                    ? 'bg-indigo-950/20 border border-indigo-900/30 text-gray-200 ml-6 text-right'
                    : 'bg-[#0E1118] border border-[#1C1F26] text-gray-300 mr-6'
                }`}>
                  <p className="leading-relaxed whitespace-pre-wrap">{m.text}</p>
                </div>
              ))}
            </div>

            {/* Input / CTA Area */}
            <div className="pt-2 border-t border-[#1C1F26] shrink-0">
              {aiChatCount >= 4 ? (
                <div className="p-2 bg-indigo-500/10 border border-indigo-500/20 rounded flex flex-col items-center gap-1.5 text-center">
                  <span className="text-indigo-400 font-bold uppercase text-[8px] tracking-wider">Login to continue using AI.</span>
                  <button
                    onClick={() => setShowLoginModal(true)}
                    className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded text-[8px] uppercase tracking-wider cursor-pointer"
                  >
                    [Sign In]
                  </button>
                </div>
              ) : (
                <div className="flex gap-1.5 items-center">
                  <input
                    type="text"
                    value={aiChatInput}
                    onChange={(e) => setAiChatInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSendAiChatMessage()}
                    disabled={sendingAiChat}
                    placeholder="Ask about meme coins, strategy, or audit parameters..."
                    className="flex-1 px-2.5 py-1.5 bg-[#07080A] border border-[#1C1F26] rounded text-gray-300 focus:outline-none focus:border-indigo-500/50 text-[16px] md:text-[9px]"
                  />
                  <button
                    onClick={handleSendAiChatMessage}
                    disabled={sendingAiChat}
                    className="p-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded cursor-pointer transition-colors"
                  >
                    <Send className="w-3 h-3" />
                  </button>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* FEATURES GRID */}
        <section className="w-full space-y-6">
          <div className="text-center">
            <h2 className="text-white text-sm uppercase tracking-wider font-bold">Engine Features &amp; Modules</h2>
            <p className="text-[8px] text-gray-500 uppercase mt-0.5">Core capabilities integrated into the FomoClix Operating System</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            {[
              { title: 'Multi Chain', desc: 'Active execution layers running simultaneously across Zora, Base, and Solana.', icon: Layers },
              { title: 'AI Trading', desc: 'Conversational agent that reasons through risk metrics before proposing orders.', icon: Sparkles },
              { title: 'Live Scanner', desc: 'Sniffs new creator contract deployments and token launch events in real-time.', icon: Activity },
              { title: 'Copy Trading', desc: 'Instantly mirror targeted smart money wallets with configurable parameters.', icon: Zap },
              { title: 'Creator Tracking', desc: 'Scan creator handles, Farcaster social graphs, and launchpad profiles.', icon: Terminal },
              { title: 'Strategy Engine', desc: 'Define slippage ceilings, maximum taxes, and automatic stop-loss rules.', icon: Cpu },
            ].map((f, idx) => (
              <div key={idx} className="p-4 bg-[#0E1118]/60 border border-[#1C1F26] rounded hover:border-indigo-500/40 hover:bg-[#0E1118] transition-all duration-200 text-left">
                <f.icon className="w-4 h-4 text-indigo-400 mb-2.5" />
                <h3 className="text-white text-[10px] uppercase font-bold tracking-wider mb-1">{f.title}</h3>
                <p className="text-[8px] text-gray-500 leading-relaxed font-mono">{f.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Footer */}
        <footer className="w-full border-t border-[#1C1F26] pt-4 text-center text-[7px] text-gray-700 font-mono tracking-widest uppercase leading-loose">
          FOMOCLIX IS AN AUTOMATED SYSTEM. OUTCOMES DEPEND ENTIRELY ON VOLATILE MARKET CONDITIONS AND USER STRATEGY PARAMETERS. NO PLATFORM EARNINGS ARE PROMISED OR GUARANTEED.
        </footer>
      </div>

      {/* Premium Sign-In Modal */}
      <AnimatePresence>
        {showLoginModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Overlay */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.6 }}
              exit={{ opacity: 0 }}
              onClick={() => !loading && setShowLoginModal(false)}
              className="absolute inset-0 bg-[#07080A]"
            />

            {/* Modal Body */}
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-sm bg-[#0E1118] border border-[#1C1F26] rounded-lg shadow-2xl p-6 relative z-10 space-y-6"
            >
              {/* Close Button */}
              <button
                onClick={() => !loading && setShowLoginModal(false)}
                disabled={loading}
                className="absolute top-4 right-4 text-gray-500 hover:text-white transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>

              {/* Header */}
              <div className="flex flex-col items-center text-center space-y-3">
                <div className="p-3 bg-indigo-500/10 rounded-full border border-indigo-500/20">
                  <Terminal className="w-6 h-6 text-indigo-400" />
                </div>
                <div>
                  <h2 className="text-white font-mono font-bold text-sm uppercase tracking-wider">[SIGN_IN_GATEWAY]</h2>
                  <p className="text-gray-500 text-[9px] font-mono mt-0.5">Select authentication layer to load session</p>
                </div>
              </div>

              {/* Error display */}
              {error && (
                <div className="p-3 bg-rose-500/8 border border-rose-500/20 rounded flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <p className="text-[9px] font-mono text-rose-400 leading-relaxed">{error}</p>
                </div>
              )}

              {/* Action Buttons */}
              <div className="space-y-3">
                {/* Google Sign In */}
                <button
                  onClick={handleGoogleLogin}
                  disabled={loading}
                  className="w-full py-3 bg-white hover:bg-gray-100 disabled:opacity-50 text-[#07080A] text-xs font-mono font-bold uppercase tracking-wider rounded cursor-pointer transition-all flex items-center justify-center gap-2.5"
                >
                  {loading ? (
                    <RefreshCw className="w-4 h-4 animate-spin text-gray-600" />
                  ) : (
                    <>
                      {/* Simple SVG Google Logo */}
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24">
                        <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v3.92h6.69a5.74 5.74 0 0 1-2.49 3.77v3.12h4.02c2.34-2.16 3.69-5.35 3.69-8.74Z"/>
                        <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-4.02-3.12c-1.12.75-2.55 1.19-3.91 1.19-3.02 0-5.58-2.04-6.5-4.78H1.31v3.23A12 12 0 0 0 12 24Z"/>
                        <path fill="#FBBC05" d="M5.5 14.38a7.16 7.16 0 0 1 0-2.76V8.39H1.31a12 12 0 0 0 0 7.22l4.19-3.23Z"/>
                        <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.43-3.43A11.96 11.96 0 0 0 12 0 12 12 0 0 0 1.31 7.22l4.19 3.23c.92-2.74 3.48-4.75 6.5-4.75Z"/>
                      </svg>
                      <span>Continue with Google</span>
                    </>
                  )}
                </button>

                {/* EVM Wallet Sign In */}
                <button
                  onClick={handleWalletLogin}
                  disabled={loading}
                  className="w-full py-3 bg-[#07080A] hover:bg-[#151821] disabled:opacity-50 text-white text-xs font-mono font-bold uppercase tracking-wider rounded border border-[#1C1F26] cursor-pointer transition-all flex items-center justify-center gap-2.5"
                >
                  {loading ? (
                    <RefreshCw className="w-4 h-4 animate-spin text-gray-400" />
                  ) : (
                    <>
                      <Zap className="w-3.5 h-3.5 text-indigo-400" />
                      <span>Connect EVM Wallet</span>
                    </>
                  )}
                </button>

                {/* Demo Mode Sign In */}
                <button
                  onClick={() => {
                    onLoginSuccess('demo_token', 'demo_user', 'admin');
                    setShowLoginModal(false);
                  }}
                  disabled={loading}
                  className="w-full py-3 bg-amber-500/10 hover:bg-amber-500/20 disabled:opacity-50 text-amber-400 text-xs font-mono font-bold uppercase tracking-wider rounded border border-amber-500/30 cursor-pointer transition-all flex items-center justify-center gap-2.5"
                >
                  <Sparkles className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
                  <span>Proceed in Demo Mode</span>
                </button>
              </div>

              {/* Supported networks info */}
              <div className="text-center">
                <p className="text-[8px] text-gray-600 font-mono">
                  Wallet signatures require zero gas fee · Standard Google OIDC verification
                </p>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
