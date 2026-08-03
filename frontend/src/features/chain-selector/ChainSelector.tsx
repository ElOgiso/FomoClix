import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';

export type ChainId = 'zora' | 'solana' | 'base';

export interface ChainInfo {
  id: ChainId;
  name: string;
  network: string;
  currency: string;
  accent: string;
  accentRGB: string;
  accentDim: string;
  scannerLabel: string;
  description: string;
}

export const CHAIN_CONFIG: Record<ChainId, ChainInfo> = {
  zora: {
    id: 'zora',
    name: 'ZORA',
    network: 'ZORA_MAINNET',
    currency: 'ETH',
    accent: '#00FF90',
    accentRGB: '0,255,144',
    accentDim: 'rgba(0,255,144,0.15)',
    scannerLabel: 'ZORA_CONTENT_SCANNER',
    description: 'Content coins & NFT mints',
  },
  solana: {
    id: 'solana',
    name: 'SOLANA',
    network: 'SOLANA_MAINNET',
    currency: 'SOL',
    accent: '#9945FF',
    accentRGB: '153,69,255',
    accentDim: 'rgba(153,69,255,0.15)',
    scannerLabel: 'SOL_TOKEN_SCANNER',
    description: 'Pump.fun & PumpSwap launches',
  },
  base: {
    id: 'base',
    name: 'BASE',
    network: 'BASE_L2',
    currency: 'ETH',
    accent: '#0052FF',
    accentRGB: '0,82,255',
    accentDim: 'rgba(0,82,255,0.15)',
    scannerLabel: 'BASE_DEX_SCANNER',
    description: 'Uniswap V3 & Aerodrome DEX',
  },
};

const CHAIN_ORDER: ChainId[] = ['zora', 'solana', 'base'];

interface ChainSelectorProps {
  activeChain: ChainId;
  onChainChange: (chain: ChainId) => void;
}

export const ChainSelector: React.FC<ChainSelectorProps> = ({ activeChain, onChainChange }) => {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const chain = CHAIN_CONFIG[activeChain];

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const cycleChain = () => {
    const idx = CHAIN_ORDER.indexOf(activeChain);
    const next = CHAIN_ORDER[(idx + 1) % CHAIN_ORDER.length];
    onChainChange(next);
  };

  return (
    <div ref={dropdownRef} className="relative flex items-center">
      {/* Main chain pill — tap to cycle */}
      <button
        onClick={cycleChain}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-l border text-[9px] font-mono font-bold uppercase tracking-wider transition-all duration-300 cursor-pointer"
        style={{
          backgroundColor: chain.accentDim,
          borderColor: `rgba(${chain.accentRGB}, 0.5)`,
          color: chain.accent,
        }}
      >
        {/* Pulsing scanner dot */}
        <span
          className="w-2 h-2 rounded-full animate-pulse"
          style={{ backgroundColor: chain.accent }}
        />
        {chain.name}
      </button>

      {/* Dropdown arrow — opens list */}
      <button
        onClick={() => setDropdownOpen(!dropdownOpen)}
        className="px-1.5 py-1.5 rounded-r border border-l-0 transition-all duration-300 cursor-pointer"
        style={{
          backgroundColor: chain.accentDim,
          borderColor: `rgba(${chain.accentRGB}, 0.5)`,
          color: chain.accent,
        }}
      >
        <ChevronDown className={`w-3 h-3 transition-transform duration-200 ${dropdownOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown panel */}
      {dropdownOpen && (
        <div className="absolute top-full right-0 mt-1.5 w-48 bg-[#0E1118] border border-[#1C1F26] rounded shadow-2xl z-50 overflow-hidden font-mono">
          {CHAIN_ORDER.map((cId) => {
            const c = CHAIN_CONFIG[cId];
            const isActive = cId === activeChain;
            return (
              <button
                key={cId}
                onClick={() => {
                  onChainChange(cId);
                  setDropdownOpen(false);
                }}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left text-[10px] uppercase tracking-wider transition-all cursor-pointer ${
                  isActive ? 'font-bold' : 'hover:bg-[#151924]'
                }`}
                style={{
                  backgroundColor: isActive ? c.accentDim : undefined,
                  color: isActive ? c.accent : '#9CA3AF',
                }}
              >
                <span
                  className={`w-2.5 h-2.5 rounded-full shrink-0 ${isActive ? 'animate-pulse' : ''}`}
                  style={{ backgroundColor: c.accent }}
                />
                <div className="flex flex-col">
                  <span className="font-bold">{c.name}</span>
                  <span className="text-[8px] text-gray-500 normal-case">{c.description}</span>
                </div>
                {isActive && (
                  <span className="ml-auto text-[7px] px-1 py-0.5 rounded border font-bold"
                    style={{ borderColor: `rgba(${c.accentRGB}, 0.4)`, color: c.accent }}>
                    LIVE
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
