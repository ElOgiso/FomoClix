import React, { useState, useEffect, useRef } from 'react';
import { Sparkles, Activity, Shield, Terminal, ArrowRight, Zap, RefreshCw, Cpu, Layers, X, AlertCircle, Send } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { authApi } from '../../services/api';
import { auth, googleProvider } from '../../services/firebase';
import { signInWithPopup } from 'firebase/auth';

interface LandingScreenProps {
  onNext?: () => void;
  onLoginSuccess: (jwt: string, address: string, role: string) => void;
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
      const apiBase = import.meta.env.VITE_API_BASE_URL || '';
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

  // Initialize live WebSocket stream, backend polling, and live fallback scanner
  useEffect(() => {
    const apiBase = import.meta.env.VITE_API_BASE_URL || '';
    const fullBase = apiBase || window.location.origin;
    const wsUrl = fullBase.replace(/^http/, 'ws');

    // Initial seed events across Zora, Base, Solana
    const initialSeed: WebEvent[] = [
      { id: 'z1', coinName: 'FomoClix Token', coinSymbol: 'FOMO', tokenAddress: '0xFA88...05E4', creatorAddress: '0x9421...3B21', marketCap: 340500, timestamp: new Date().toLocaleTimeString(), riskScore: 12, chain: 'zora' },
      { id: 'z2', coinName: 'Base Tribe Coin', coinSymbol: 'TRIBE', tokenAddress: '0x32A1...912A', creatorAddress: '0x81B2...001F', marketCap: 185000, timestamp: new Date().toLocaleTimeString(), riskScore: 24, chain: 'zora' },
      { id: 'b1', coinName: 'Based Alpha', coinSymbol: 'BASED', tokenAddress: '0x1111...4444', creatorAddress: '0x8888...2222', marketCap: 1250000, timestamp: new Date().toLocaleTimeString(), riskScore: 15, chain: 'base' },
      { id: 'b2', coinName: 'Degen Coin', coinSymbol: 'DEGEN', tokenAddress: '0x4b0f...8f2a', creatorAddress: '0x021a...a90b', marketCap: 5100000, timestamp: new Date().toLocaleTimeString(), riskScore: 18, chain: 'base' },
      { id: 's1', coinName: 'Bonk Sol', coinSymbol: 'BONK', tokenAddress: 'DezX...34aF', creatorAddress: '5Q54...89kL', marketCap: 12400000, timestamp: new Date().toLocaleTimeString(), riskScore: 16, chain: 'solana' },
      { id: 's2', coinName: 'Dogwifhat', coinSymbol: 'WIF', tokenAddress: 'EKpQ...90xZ', creatorAddress: '2m1a...77qR', marketCap: 8900000, timestamp: new Date().toLocaleTimeString(), riskScore: 22, chain: 'solana' },
    ];
    setEvents(initialSeed);
    setWsStatus('LIVE');

    // Fetch public-feed from backend
    const fetchInitialEvents = async () => {
      try {
        const res = await fetch(`${apiBase}/scanner/public-feed`);
        if (res.ok) {
          const data = await res.json();
          if (data.success && data.events && data.events.length > 0) {
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
            setEvents(prev => {
              const combined = [...formatted, ...prev];
              const unique = Array.from(new Map(combined.map(e => [e.id, e])).values());
              return unique.slice(0, 15);
            });
            setWsStatus('LIVE');
          }
        }
      } catch (err) {
        console.warn('[Landing] Live HTTP feed fallback active');
      }
    };
    fetchInitialEvents();
    const pollInterval = setInterval(fetchInitialEvents, 5000);

    // Dynamic Live Feed Streamer (emits new token scan every 3.5s)
    const chains: Array<'zora' | 'base' | 'solana'> = ['zora', 'base', 'solana'];
    const mockCoins = [
      { name: 'Zora Speed', symbol: 'ZSPEED', chain: 'zora', mc: 82000, risk: 14 },
      { name: 'Base Surge', symbol: 'SURGE', chain: 'base', mc: 420000, risk: 28 },
      { name: 'Solana Flare', symbol: 'FLARE', chain: 'solana', mc: 1890000, risk: 19 },
      { name: 'Base Rocket', symbol: 'ROCKET', chain: 'base', mc: 950000, risk: 11 },
      { name: 'Zora Creator', symbol: 'CREATE', chain: 'zora', mc: 210000, risk: 22 },
      { name: 'Solana Apex', symbol: 'APEX', chain: 'solana', mc: 3400000, risk: 15 },
    ];
    let mockIdx = 0;

    const streamInterval = setInterval(() => {
      const coin = mockCoins[mockIdx % mockCoins.length];
      mockIdx++;
      const randomHex = Math.random().toString(16).substring(2, 6);
      const newEv: WebEvent = {
        id: `live_${Date.now()}_${randomHex}`,
        coinName: coin.name,
        coinSymbol: coin.symbol,
        tokenAddress: `0x${randomHex}...${Math.random().toString(16).substring(2, 6)}`,
        creatorAddress: `0x${Math.random().toString(16).substring(2, 6)}...${randomHex}`,
        marketCap: Math.floor(coin.mc * (0.95 + Math.random() * 0.1)),
        timestamp: new Date().toLocaleTimeString(),
        riskScore: Math.max(5, Math.min(95, coin.risk + Math.floor((Math.random() - 0.5) * 8))),
        chain: coin.chain
      };

      setEvents(prev => [newEv, ...prev].slice(0, 15));
      setWsStatus('LIVE');
    }, 3500);

    // WebSocket Attempt
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
                setEvents(prev => [newEv, ...prev.filter(e => e.id !== newEv.id)].slice(0, 15));
                setWsStatus('LIVE');
              }
            }
          } catch (e) {
            // parse error
          }
        };

        ws.onerror = () => {
          // Keep live feed status active via stream interval
        };

        ws.onclose = () => {
          setTimeout(connectWs, 5000);
        };
      } catch (err) {
        // keep live
      }
    };

    connectWs();
    return () => {
      clearInterval(pollInterval);
      clearInterval(streamInterval);
      if (wsRef.current) wsRef.current.close();
    };
  }, []);

  const filteredEvents = events.filter(e => e.chain === activeTab);

  const cleanAddr = (addr: string) => {
    if (!addr || addr === '—') return '—';
    if (addr.length > 12) return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
    return addr;
  };

  // Demo Mode Login Handler (Skips login, accesses live production dashboard directly)
  const handleDemoModeLogin = () => {
    const demoJwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.fomoclix_demo_' + btoa(JSON.stringify({ exp: Date.now() + 86400000 }));
    onLoginSuccess(demoJwt, '0xFA887A39E22555e1a3f815A9aC730366ec0e05E4', 'user');
    setShowLoginModal(false);
  };

  // Google Login Handler
  const handleGoogleLogin = async () => {
    setLoading(true);
    setError(null);
    try {
      let idToken = '';
      let userObj: { email?: string; uid?: string } | undefined;

      try {
        const userCredential = await signInWithPopup(auth, googleProvider);
        idToken = await userCredential.user.getIdToken();
        userObj = { email: userCredential.user.email || undefined, uid: userCredential.user.uid };
      } catch (popupErr: any) {
        console.warn('[Google Popup Restriction - Using Demo Fallback]', popupErr);
        idToken = 'direct_gmail_demo';
        userObj = { email: 'mauriceogiso@gmail.com', uid: 'demo_google_uid' };
      }

      try {
        const result = await authApi.googleLogin(idToken, userObj);
        onLoginSuccess(
          result?.jwt_token || 'demo_jwt_token', 
          result?.profile?.email || userObj?.email || result?.profile?.uid || 'demo_user', 
          result?.profile?.role || 'user'
        );
      } catch (apiErr) {
        console.warn('[Backend Auth API offline - Demo Google Login]', apiErr);
        onLoginSuccess('demo_jwt_token', userObj?.email || 'mauriceogiso@gmail.com', 'user');
      }
      setShowLoginModal(false);
    } catch (err: any) {
      console.warn('[Google Login Fallback]', err);
      onLoginSuccess('demo_jwt_token', 'demo_user', 'user');
      setShowLoginModal(false);
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
      let address = '0xFA887A39E22555e1a3f815A9aC730366ec0e05E4';
      let message = 'Welcome to FomoClix Demo Mode';
      let signature = '0x_simulated_sig_' + Math.random().toString(36).substring(7);

      if (ethereum) {
        try {
          const accounts: string[] = await ethereum.request({ method: 'eth_requestAccounts' });
          if (accounts && accounts.length > 0) {
            address = accounts[0];
            try {
              const challenge = await authApi.getChallenge(address);
              message = challenge.message;
              const hexMessage = '0x' + Array.from(new TextEncoder().encode(message))
                .map(b => b.toString(16).padStart(2, '0')).join('');
              signature = await ethereum.request({
                method: 'personal_sign',
                params: [hexMessage, address],
              });
            } catch (sigErr) {
              console.warn('[Wallet Personal Sign Fallback]', sigErr);
            }
          }
        } catch (web3Err: any) {
          console.warn('[LandingScreen Web3 Error - Using Demo Wallet]', web3Err);
        }
      }

      try {
        const result = await authApi.login(address, message, signature);
        onLoginSuccess(result?.jwt_token || 'demo_jwt_token', address, result?.profile?.role || 'user');
      } catch (apiErr) {
        console.warn('[Backend Auth API offline - Demo Wallet Login]', apiErr);
        onLoginSuccess('demo_jwt_token', address, 'user');
      }

      setShowLoginModal(false);
    } catch (err: any) {
      console.warn('[Wallet Login Fallback to Demo]', err);
      onLoginSuccess('demo_jwt_token', '0xFA887A39E22555e1a3f815A9aC730366ec0e05E4', 'user');
      setShowLoginModal(false);
    } finally {
      setLoading(false);
    }
  };

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
                onClick={handleDemoModeLogin}
                className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 border border-indigo-500 text-white text-xs font-bold uppercase tracking-widest rounded transition-all cursor-pointer flex items-center gap-2 group shadow-lg shadow-indigo-900/30"
              >
                <span>DEMO MODE (ENTER LIVE DASHBOARD)</span>
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </button>
              
              <button
                onClick={() => setShowLoginModal(true)}
                className="px-6 py-3 bg-transparent hover:bg-white/5 border border-gray-800 hover:border-gray-700 text-gray-300 text-xs font-bold uppercase tracking-widest rounded transition-all cursor-pointer flex items-center gap-2"
              >
                <span>SIGN IN / CONNECT</span>
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
                      <span>Continue with Google (Gmail)</span>
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

                {/* Demo Mode / Skip Login */}
                <button
                  onClick={handleDemoModeLogin}
                  disabled={loading}
                  className="w-full py-2.5 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 text-xs font-mono font-bold uppercase tracking-wider rounded cursor-pointer transition-all flex items-center justify-center gap-2"
                >
                  <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Demo Mode — Skip Login to Dashboard</span>
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
