import React, { useRef, useEffect, useState } from 'react';
import { Send, ArrowLeft, Sparkles, Shield, UserPlus, Settings, Save, Key, TrendingUp, AlertTriangle, Mic, MicOff, Volume2, VolumeX } from 'lucide-react';

interface CompanionWidgetProps {
  messages: Array<{ sender: 'user' | 'ai'; text: string }>;
  sending: boolean;
  onSendMessage: (msg: string) => void;
  layout: 'desktop' | 'mobile-overlay';
  onCloseMobile?: () => void;
  onExecuteAction?: (type: string, data: any) => Promise<void>;
  apiBase: string;
  token: string;
}

interface ActionBlock {
  type: 'PROPOSE_BUY' | 'PROPOSE_SELL' | 'PROPOSE_TRACK_CREATOR' | 'PROPOSE_DELETE_CREATOR' | 'PROPOSE_CONFIG';
  title: string;
  description: string;
  data: any;
}

export const CompanionWidget: React.FC<CompanionWidgetProps> = ({
  messages,
  sending,
  onSendMessage,
  layout,
  onCloseMobile,
  onExecuteAction,
  apiBase,
  token
}) => {
  const [inputVal, setInputVal] = useState('');
  const [showConfig, setShowConfig] = useState(false);
  const [geminiKey, setGeminiKey] = useState('');
  const [savingKey, setSavingKey] = useState(false);
  const [keySavedMessage, setKeySavedMessage] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const [isListening, setIsListening] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const recognitionRef = useRef<any>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const autoRepeatRef = useRef(false);

  // Mute immediately when speaker button is toggled off
  const stopAiSpeaking = () => {
    window.speechSynthesis.cancel();
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
  };

  useEffect(() => {
    if (!voiceEnabled) {
      stopAiSpeaking();
      autoRepeatRef.current = false;
    }
  }, [voiceEnabled]);

  // Setup Web Speech API Speech Recognition
  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      const rec = new SpeechRecognition();
      rec.continuous = false;
      rec.interimResults = false;
      rec.lang = 'en-US';

      rec.onstart = () => {
        setIsListening(true);
      };

      rec.onresult = (e: any) => {
        const transcript = e.results[0][0].transcript;
        if (transcript && transcript.trim()) {
          onSendMessage(transcript);
          setInputVal('');
        }
      };

      rec.onerror = (e: any) => {
        console.error('Speech Recognition Error:', e.error);
        setIsListening(false);
      };

      rec.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = rec;
    }
  }, [onSendMessage]);

  const toggleListening = () => {
    if (!recognitionRef.current) {
      alert('Speech Recognition is not supported in this browser. Please use Chrome/Safari/Edge.');
      return;
    }

    // Interruption logic: if AI is speaking (either speechSynthesis or native Audio), stop it immediately!
    const wasSpeaking = window.speechSynthesis.speaking || (audioRef.current && !audioRef.current.paused);
    if (wasSpeaking) {
      stopAiSpeaking();
    }

    if (isListening) {
      autoRepeatRef.current = false;
      recognitionRef.current.stop();
    } else {
      autoRepeatRef.current = true; // Enable automatic follow-up listening mode
      try {
        recognitionRef.current.start();
      } catch (e) {
        console.warn("Failed to start SpeechRecognition:", e);
      }
    }
  };

  const toggleVoice = () => {
    const nextVoice = !voiceEnabled;
    setVoiceEnabled(nextVoice);
    if (!nextVoice) {
      // User turned off speaker -> immediately stop speaking
      stopAiSpeaking();
      autoRepeatRef.current = true; // Auto-trigger mic on mute
      if (recognitionRef.current && !isListening) {
        try {
          recognitionRef.current.start();
        } catch (e) {
          console.warn("Failed to start SpeechRecognition on speaker mute:", e);
        }
      }
    } else {
      autoRepeatRef.current = false;
    }
  };

  // Text-To-Speech (TTS) response trigger
  useEffect(() => {
    if (!voiceEnabled || messages.length === 0) return;
    const lastMsg = messages[messages.length - 1];
    if (lastMsg.sender === 'ai') {
      const handleSpeakingFinished = () => {
        if (autoRepeatRef.current && recognitionRef.current && !isListening) {
          try {
            recognitionRef.current.start();
          } catch (e) {
            console.warn("Failed to auto-restart voice recording:", e);
          }
        }
      };

      // 1. If we have native Gemini human voice audio:
      if ((lastMsg as any).audio) {
        stopAiSpeaking();
        const audioSrc = `data:audio/wav;base64,${(lastMsg as any).audio}`;
        const audio = new Audio(audioSrc);
        audioRef.current = audio;
        audio.onended = handleSpeakingFinished;
        audio.play().catch(err => {
          console.warn("[TTS] Native human audio playback failed:", err.message);
        });
      } else {
        // 2. Fall back to standard browser Speech Synthesis
        const { cleanText } = parseMessage(lastMsg.text);
        const spokenText = cleanText
          .replace(/\*\*([\s\S]*?)\*\*/g, '$1')
          .replace(/\*([\s\S]*?)\*/g, '$1')
          .replace(/`/g, '');
          
        window.speechSynthesis.cancel(); // Stop any current speaking
        const utterance = new SpeechSynthesisUtterance(spokenText);

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

        // Voice attributes matching ChatGPT/Gemini Live expressiveness
        utterance.pitch = 1.08; // Slightly higher pitch for female voice
        utterance.rate = 0.98;  // Conversational tempo
        
        utterance.onend = handleSpeakingFinished;
        window.speechSynthesis.speak(utterance);
      }
    }
  }, [messages, voiceEnabled]);

  // Load obfuscated key on mount
  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const res = await fetch(`${apiBase}/config/ai`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
          const data = await res.json();
          if (data.geminiApiKey) {
            setGeminiKey(data.geminiApiKey);
          }
        }
      } catch (err) {
        console.error('Failed to load AI config:', err);
      }
    })();
  }, [apiBase, token]);

  const handleSaveApiKey = async () => {
    if (!token) return;
    try {
      setSavingKey(true);
      const res = await fetch(`${apiBase}/config/ai`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ geminiApiKey: geminiKey })
      });
      if (res.ok) {
        setKeySavedMessage('API Key updated!');
        setTimeout(() => setKeySavedMessage(''), 3000);
      } else {
        setKeySavedMessage('Failed to save key.');
      }
    } catch {
      setKeySavedMessage('Error saving key.');
    } finally {
      setSavingKey(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputVal.trim() || sending) return;
    onSendMessage(inputVal);
    setInputVal('');
  };

  const handleSuggest = (text: string) => {
    if (sending) return;
    onSendMessage(text);
  };

  const suggestions = [
    { label: '[⚡ OPTIMIZE BUDGET]', query: 'Optimize my bot configuration budget.' },
    { label: '[🎯 FIND CREATORS]', query: 'Suggest a smart money creator to track.' },
    { label: '[📈 TRADE ALERTS]', query: 'Suggest a trending coin to trade right now.' }
  ];

  // Parse response message to extract action block
  const parseMessage = (text: string) => {
    const actionRegex = /```fomoclix-action\s*([\s\S]*?)\s*```/;
    const match = text.match(actionRegex);
    let cleanText = text;
    let actionBlock: ActionBlock | null = null;

    if (match) {
      cleanText = text.replace(actionRegex, '').trim();
      try {
        actionBlock = JSON.parse(match[1]);
      } catch (err) {
        console.error('Failed to parse action JSON:', err);
      }
    }

    return { cleanText, actionBlock };
  };

  const handleActionConfirm = async (action: ActionBlock) => {
    if (onExecuteAction) {
      await onExecuteAction(action.type, action.data);
    }
  };

  const renderActionCard = (action: ActionBlock) => {
    // Determine button styles based on action type
    let btnBg = 'bg-indigo-600 hover:bg-indigo-500 border-indigo-500';
    let btnText = 'EXECUTE';
    let icon = <Settings className="w-3.5 h-3.5" />;

    if (action.type === 'PROPOSE_BUY') {
      btnBg = 'bg-rose-600 hover:bg-rose-500 border-rose-500';
      btnText = `BUY ${action.data.symbol || 'TOKEN'}`;
      icon = <TrendingUp className="w-3.5 h-3.5" />;
    } else if (action.type === 'PROPOSE_SELL') {
      btnBg = 'bg-emerald-600 hover:bg-emerald-500 border-emerald-500';
      btnText = `SELL ${action.data.symbol || 'TOKEN'}`;
      icon = <TrendingUp className="w-3.5 h-3.5" />;
    } else if (action.type === 'PROPOSE_TRACK_CREATOR') {
      btnBg = 'bg-indigo-600 hover:bg-indigo-500 border-indigo-500';
      btnText = 'ADD Creator';
      icon = <UserPlus className="w-3.5 h-3.5" />;
    } else if (action.type === 'PROPOSE_DELETE_CREATOR') {
      btnBg = 'bg-rose-700 hover:bg-rose-600 border-rose-600';
      btnText = 'DELETE Creator';
      icon = <AlertTriangle className="w-3.5 h-3.5" />;
    } else if (action.type === 'PROPOSE_CONFIG') {
      btnBg = 'bg-indigo-600 hover:bg-indigo-500 border-indigo-500';
      btnText = 'APPLY SETTINGS';
      icon = <Settings className="w-3.5 h-3.5" />;
    }

    return (
      <div className="mt-3 p-3 bg-[#11151B] border border-[#1C1F26] rounded-none space-y-2.5 font-mono text-[10px]">
        <div className="flex items-center justify-between border-b border-[#1C1F26] pb-1.5">
          <span className="font-bold text-gray-300 flex items-center gap-1">
            <Sparkles className="w-3.5 h-3.5 text-indigo-400 animate-pulse" />
            {action.title}
          </span>
          <span className="text-[7px] text-gray-500 border border-gray-800 px-1 rounded-none uppercase">PROPOSED</span>
        </div>
        <p className="text-gray-400 leading-normal text-[9px]">{action.description}</p>

        {/* Dynamic metadata display */}
        {action.type === 'PROPOSE_BUY' && (
          <div className="bg-black/30 p-2 rounded-none border border-gray-900 grid grid-cols-2 gap-1.5">
            <div><span className="text-gray-500 block text-[7px]">TOKEN</span><span className="text-white font-bold">{action.data.symbol}</span></div>
            <div><span className="text-gray-500 block text-[7px]">AMOUNT</span><span className="text-white font-bold">{action.data.amount} {action.data.chain === 'solana' ? 'SOL' : 'ETH'}</span></div>
            <div className="col-span-2"><span className="text-gray-500 block text-[7px]">CONTRACT</span><span className="text-gray-400 select-all truncate block">{action.data.tokenAddress}</span></div>
          </div>
        )}

        {action.type === 'PROPOSE_SELL' && (
          <div className="bg-black/30 p-2 rounded-none border border-gray-900 grid grid-cols-2 gap-1.5">
            <div><span className="text-gray-500 block text-[7px]">TOKEN</span><span className="text-white font-bold">{action.data.symbol}</span></div>
            <div><span className="text-gray-500 block text-[7px]">PORTION</span><span className="text-white font-bold">{action.data.amount}</span></div>
            <div className="col-span-2"><span className="text-gray-500 block text-[7px]">CONTRACT</span><span className="text-gray-400 select-all truncate block">{action.data.tokenAddress}</span></div>
          </div>
        )}

        {action.type === 'PROPOSE_TRACK_CREATOR' && (
          <div className="bg-black/30 p-2 rounded-none border border-gray-900">
            <span className="text-gray-500 block text-[7px]">CREATOR ADDRESS</span>
            <span className="text-white font-bold select-all truncate block">{action.data.creatorAddress}</span>
            <span className="text-gray-500 block text-[7px] mt-1">CHAIN</span>
            <span className="text-violet-400 uppercase font-bold">{action.data.chain || 'zora'}</span>
          </div>
        )}

        {action.type === 'PROPOSE_DELETE_CREATOR' && (
          <div className="bg-black/30 p-2 rounded-none border border-gray-900">
            <span className="text-gray-500 block text-[7px]">CREATOR ADDRESS</span>
            <span className="text-white font-bold select-all truncate block">{action.data.creatorAddress}</span>
            {action.data.name && (
              <>
                <span className="text-gray-500 block text-[7px] mt-1 font-bold">NAME</span>
                <span className="text-white block">{action.data.name}</span>
              </>
            )}
          </div>
        )}

        {action.type === 'PROPOSE_CONFIG' && (
          <div className="bg-black/30 p-2 rounded-none border border-gray-900 space-y-1">
            <span className="text-gray-500 block text-[7px] border-b border-gray-900 pb-0.5 mb-1">PROPOSED UPDATES</span>
            {Object.entries(action.data.configUpdates).map(([key, val]) => (
              <div key={key} className="flex justify-between text-[9px]">
                <span className="text-gray-400">{key}:</span>
                <span className="text-emerald-400 font-bold">{String(val)}</span>
              </div>
            ))}
          </div>
        )}

        {/* Clean, square, normal-sized action button */}
        <div className="pt-1 flex">
          <button
            onClick={() => handleActionConfirm(action)}
            className={`w-auto px-4 py-2 font-mono font-bold uppercase tracking-wider rounded-none cursor-pointer transition-all border-2 flex items-center justify-center gap-1.5 shadow-md ${btnBg}`}
          >
            {icon}
            {btnText}
          </button>
        </div>
      </div>
    );
  };

  const renderMessageContent = (m: { sender: 'user' | 'ai'; text: string }) => {
    const { cleanText, actionBlock } = parseMessage(m.text);
    return (
      <div className="space-y-1">
        {cleanText.split('\n').map((line, lIdx) => (
          <p key={lIdx} className="mb-1 last:mb-0">
            {line}
          </p>
        ))}
        {actionBlock && renderActionCard(actionBlock)}
      </div>
    );
  };

  if (layout === 'mobile-overlay') {
    return (
      <div className="fixed inset-0 bg-[#0A0D10] z-50 flex flex-col font-mono select-text">
        {/* Mobile Overlay Header */}
        <div className="h-14 border-b border-[#1C1F26] bg-[#0E1118] flex items-center justify-between px-4 shrink-0">
          <div className="flex items-center">
            <button
              onClick={onCloseMobile}
              className="mr-3 p-1 rounded hover:bg-gray-800 text-gray-400 hover:text-white cursor-pointer"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <span className="font-bold text-xs text-white uppercase tracking-wider flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-indigo-400 animate-pulse" />
              FOMOCLIX_AI_ASSISTANT_V1
            </span>
          </div>

          <button
            onClick={() => setShowConfig(!showConfig)}
            className={`p-1.5 rounded border transition-all cursor-pointer ${
              showConfig ? 'bg-indigo-950 border-indigo-500/40 text-indigo-400' : 'border-gray-800 text-gray-500 hover:text-white'
            }`}
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>

        {/* API Config Drawer */}
        {showConfig && (
          <div className="bg-[#11151B] border-b border-[#1C1F26] p-3 space-y-2.5 font-mono">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-white font-bold flex items-center gap-1">
                <Key className="w-3.5 h-3.5 text-indigo-400" />
                GEMINI API CONFIG
              </span>
              <span className="text-[8px] text-gray-500">Free tier Developer key</span>
            </div>
            <div className="flex gap-2">
              <input
                type="password"
                placeholder="AIzaSy..."
                value={geminiKey}
                onChange={(e) => setGeminiKey(e.target.value)}
                className="flex-1 bg-black/40 border border-gray-900 focus:border-indigo-500 rounded px-2.5 py-1.5 text-[10px] text-white"
              />
              <button
                onClick={handleSaveApiKey}
                disabled={savingKey}
                className="px-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded font-bold text-[9px] uppercase border border-indigo-400 cursor-pointer flex items-center gap-1"
              >
                <Save className="w-3.5 h-3.5" />
                SAVE
              </button>
            </div>
            {keySavedMessage && (
              <span className="text-[8px] text-emerald-400 block font-bold">{keySavedMessage}</span>
            )}
          </div>
        )}

        {/* Message Stream */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-[#07080A]/60">
          {messages.map((m, idx) => (
            <div
              key={idx}
              className={`flex flex-col max-w-[85%] ${
                m.sender === 'user' ? 'ml-auto items-end' : 'mr-auto items-start'
              }`}
            >
              <span className="text-[8px] text-gray-500 uppercase tracking-widest mb-0.5">
                {m.sender === 'user' ? 'ADMIN_OPERATOR' : 'AI_COMPANION'}
              </span>
              <div
                className={`p-3 rounded text-[11px] leading-relaxed border ${
                  m.sender === 'user'
                    ? 'bg-indigo-950/20 border-indigo-900/40 text-indigo-200'
                    : 'bg-[#11151B] border-[#1C1F26] text-gray-300'
                }`}
              >
                {renderMessageContent(m)}
              </div>
            </div>
          ))}
          {sending && (
            <div className="flex flex-col items-start max-w-[85%] animate-pulse">
              <span className="text-[8px] text-gray-500 uppercase tracking-widest mb-0.5">AI_COMPANION</span>
              <div className="p-3 rounded text-[11px] bg-[#11151B] border border-[#1C1F26] text-indigo-400 font-bold">
                Thinking...
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Suggested Actions Panel */}
        <div className="p-3 bg-[#0A0C12] border-t border-[#1C1F26] space-y-2 shrink-0">
          <span className="text-[8px] text-gray-500 uppercase block tracking-wider font-bold">SUGGESTED OPERATIONS:</span>
          <div className="flex flex-wrap gap-2">
            {suggestions.map((s, idx) => (
              <button
                key={idx}
                onClick={() => handleSuggest(s.query)}
                className="px-2 py-1.5 rounded border border-[#1C1F26] bg-black/40 hover:bg-[#1C1F26] hover:text-white text-[9px] text-gray-400 font-bold transition-all cursor-pointer"
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Input Bar */}
        <form onSubmit={handleSubmit} className="p-3 bg-[#0E1118] border-t border-[#1C1F26] flex gap-1.5 shrink-0 items-center">
          <div className="flex-1 relative flex items-center">
            {isListening ? (
              <div className="w-full bg-[#1A111E] border border-rose-500/30 rounded py-2.5 px-3 flex items-center justify-between text-rose-400 font-mono text-[10px] uppercase font-black tracking-wider animate-[pulse_1.5s_infinite]">
                <span className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 bg-rose-500 rounded-full animate-ping" />
                  <span>[RECORDING VOICE NOTE...]</span>
                </span>
                <div className="flex items-center gap-2">
                  {/* Waveform animation */}
                  <div className="flex gap-0.5 items-end h-3">
                    <div className="w-[2px] bg-rose-400 animate-[bounce_0.6s_infinite_100ms]" style={{ height: '60%' }}></div>
                    <div className="w-[2px] bg-rose-400 animate-[bounce_0.6s_infinite_200ms]" style={{ height: '100%' }}></div>
                    <div className="w-[2px] bg-rose-400 animate-[bounce_0.6s_infinite_300ms]" style={{ height: '40%' }}></div>
                    <div className="w-[2px] bg-rose-400 animate-[bounce_0.6s_infinite_150ms]" style={{ height: '80%' }}></div>
                  </div>
                  <button
                    type="button"
                    onClick={toggleListening}
                    className="text-rose-400 hover:text-white px-2 py-0.5 border border-rose-500/20 rounded bg-rose-500/10 font-bold cursor-pointer"
                  >
                    STOP
                  </button>
                </div>
              </div>
            ) : (
              <>
                <input
                  type="text"
                  value={inputVal}
                  onChange={(e) => setInputVal(e.target.value)}
                  placeholder="Instruct AI Agent..."
                  className="w-full bg-black/40 border border-gray-900 focus:border-indigo-500 rounded pl-3 pr-16 py-2 text-[16px] md:text-xs text-white placeholder-gray-600 focus:outline-none"
                />
                {/* Speech controls inside input */}
                <div className="absolute right-2 flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={toggleListening}
                    className="p-1 rounded cursor-pointer transition-colors text-gray-500 hover:text-white"
                  >
                    <Mic className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={toggleVoice}
                    className={`p-1 rounded cursor-pointer transition-colors ${
                      voiceEnabled ? 'text-indigo-400 font-bold' : 'text-gray-500 hover:text-white'
                    }`}
                  >
                    {voiceEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </>
            )}
          </div>
          {!isListening && (
            <button
              type="submit"
              disabled={sending}
              className="p-2 rounded bg-indigo-600 hover:bg-indigo-500 text-white border border-indigo-500 flex items-center justify-center cursor-pointer disabled:opacity-50"
            >
              <Send className="w-4 h-4" />
            </button>
          )}
        </form>
      </div>
    );
  }

  // Desktop sidebar layout
  return (
    <div className="border-t border-[#1C1F26] bg-[#0E1118]/80 p-3 space-y-3 flex flex-col min-h-0 font-mono">
      <div className="flex items-center justify-between border-b border-[#1C1F26] pb-1.5 shrink-0">
        <span className="font-bold text-xs text-white uppercase tracking-wider flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
          AI_COMPANION_V1
        </span>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setShowConfig(!showConfig)}
            className="text-gray-500 hover:text-white cursor-pointer"
          >
            <Settings className="w-3.5 h-3.5" />
          </button>
          <span className="text-[8px] bg-indigo-950/40 text-indigo-400 px-1 py-0.2 rounded border border-indigo-900/40 uppercase">
            Orchestrator
          </span>
        </div>
      </div>

      {/* API Config Drawer (Desktop) */}
      {showConfig && (
        <div className="bg-[#11151B] border border-[#1C1F26] rounded p-2.5 space-y-2 shrink-0">
          <div className="flex justify-between items-center text-[8px] text-gray-500">
            <span>GEMINI API KEY</span>
            <a href="https://aistudio.google.com/" target="_blank" rel="noreferrer" className="text-indigo-400 hover:underline">Get Key ↗</a>
          </div>
          <div className="flex gap-1.5">
            <input
              type="password"
              placeholder="API Key"
              value={geminiKey}
              onChange={(e) => setGeminiKey(e.target.value)}
              className="flex-1 bg-black/40 border border-gray-900 rounded px-2 py-1 text-[9px] text-white focus:outline-none"
            />
            <button
              onClick={handleSaveApiKey}
              className="px-2 py-1 bg-indigo-600 hover:bg-indigo-500 rounded text-white text-[8px] font-bold cursor-pointer"
            >
              SAVE
            </button>
          </div>
          {keySavedMessage && <span className="text-[8px] text-emerald-400 block font-bold">{keySavedMessage}</span>}
        </div>
      )}

      {/* Message View (Desktop) */}
      <div className="flex-1 overflow-y-auto max-h-[160px] space-y-3 p-1.5 border border-gray-950/20 bg-black/20 rounded min-h-[90px]">
        {messages.map((m, idx) => (
          <div key={idx} className="text-[10px] leading-relaxed">
            <span className={m.sender === 'user' ? 'text-indigo-400 font-bold' : 'text-emerald-400 font-bold'}>
              {m.sender === 'user' ? 'OP > ' : 'AI > '}
            </span>
            <div className="inline-block text-gray-300">
              {renderMessageContent(m)}
            </div>
          </div>
        ))}
        {sending && (
          <div className="text-[10px] text-indigo-400 font-bold animate-pulse">
            AI &gt; Thinking...
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      {/* Suggested quick actions (Desktop) */}
      <div className="flex flex-wrap gap-1 shrink-0">
        {suggestions.map((s, idx) => (
          <button
            key={idx}
            onClick={() => handleSuggest(s.query)}
            className="px-1.5 py-0.5 rounded border border-[#1C1F26] bg-black/40 hover:bg-[#1C1F26] hover:text-white text-[8px] text-gray-400 font-bold transition-all cursor-pointer"
          >
            {s.label}
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="flex gap-1.5 shrink-0 items-center">
        <div className="flex-1 relative flex items-center">
          {isListening ? (
            <div className="w-full bg-[#1A111E] border border-rose-500/30 rounded py-1.5 px-2 flex items-center justify-between text-rose-400 font-mono text-[9px] uppercase font-black tracking-wider animate-[pulse_1.5s_infinite] select-none">
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 bg-rose-500 rounded-full animate-ping" />
                <span>[RECORDING VOICE...]</span>
              </span>
              <div className="flex items-center gap-1.5">
                {/* Waveform animation */}
                <div className="flex gap-0.5 items-end h-2.5">
                  <div className="w-[1.5px] bg-rose-400 animate-[bounce_0.6s_infinite_100ms]" style={{ height: '60%' }}></div>
                  <div className="w-[1.5px] bg-rose-400 animate-[bounce_0.6s_infinite_200ms]" style={{ height: '100%' }}></div>
                  <div className="w-[1.5px] bg-rose-400 animate-[bounce_0.6s_infinite_300ms]" style={{ height: '40%' }}></div>
                </div>
                <button
                  type="button"
                  onClick={toggleListening}
                  className="text-rose-400 hover:text-white px-1.5 py-0.2 border border-rose-500/20 rounded bg-rose-500/10 font-mono font-bold uppercase tracking-wider text-[8px] cursor-pointer"
                >
                  STOP
                </button>
              </div>
            </div>
          ) : (
            <>
              <input
                type="text"
                value={inputVal}
                onChange={(e) => setInputVal(e.target.value)}
                placeholder="Instruct AI..."
                className="w-full bg-black/40 border border-gray-900 focus:border-indigo-500 rounded pl-2.5 pr-14 py-1.5 text-[16px] md:text-[10px] text-white placeholder-gray-600 focus:outline-none"
              />
              {/* Speech controls inside input (desktop) */}
              <div className="absolute right-1.5 flex items-center gap-1">
                <button
                  type="button"
                  onClick={toggleListening}
                  className="p-0.5 rounded cursor-pointer transition-colors text-gray-600 hover:text-white"
                >
                  <Mic className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  onClick={toggleVoice}
                  className={`p-0.5 rounded cursor-pointer transition-colors ${
                    voiceEnabled ? 'text-indigo-400 font-bold' : 'text-gray-600 hover:text-white'
                  }`}
                >
                  {voiceEnabled ? <Volume2 className="w-3 h-3" /> : <VolumeX className="w-3 h-3" />}
                </button>
              </div>
            </>
          )}
        </div>
        {!isListening && (
          <button
            type="submit"
            disabled={sending}
            className="px-2.5 py-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white border border-indigo-500 flex items-center justify-center cursor-pointer disabled:opacity-50"
          >
            <Send className="w-3 h-3" />
          </button>
        )}
      </form>
    </div>
  );
};
