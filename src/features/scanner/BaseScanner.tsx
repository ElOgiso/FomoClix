import React, { useState, useEffect } from 'react';
import { Shield, Lock, Unlock, CheckCircle, XCircle } from 'lucide-react';

interface BaseToken {
  id: string;
  chain: string;
  protocol: string;
  name: string;
  symbol: string;
  contractAddress: string;
  marketCap: number;
  liquidityEth: number;
  liquidityUsd: number;
  holders: number;
  volume24h: number;
  priceChangePct: string;
  verified: boolean;
  lpLocked: boolean;
  lpLockDays: number;
  taxBuy: string;
  taxSell: string;
  gasEstimateGwei: string;
  deployerReputation: number;
  createdAt: number;
  detectedAt: string;
}

interface BaseScannerProps {
  apiBase: string;
  token: string;
  onManualBuy?: (token: BaseToken) => void;
}

export const BaseScanner: React.FC<BaseScannerProps> = ({ apiBase, token, onManualBuy }) => {
  const [feed, setFeed] = useState<BaseToken[]>([]);
  const [scannerActive, setScannerActive] = useState(false);
  const [filter, setFilter] = useState<'all' | 'verified' | 'locked' | 'high_liq'>('all');
  const [loading, setLoading] = useState(false);
  const [selectedToken, setSelectedToken] = useState<BaseToken | null>(null);

  const fetchFeed = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${apiBase}/base/scanner/feed?limit=50&filter=${filter}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setFeed(data);
      }
    } catch (err) {
      console.error('[BaseScanner] Feed fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  const toggleScanner = async () => {
    try {
      const res = await fetch(`${apiBase}/base/scanner/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setScannerActive(data.enabled);
      }
    } catch (err) {
      console.error('[BaseScanner] Toggle error:', err);
    }
  };

  useEffect(() => {
    fetchFeed();
    const interval = setInterval(fetchFeed, 8000);
    return () => clearInterval(interval);
  }, [filter]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${apiBase}/base/status`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
          const data = await res.json();
          setScannerActive(data.status === 'SCANNING');
        }
      } catch {}
    })();
  }, []);

  return (
    <div className="space-y-4 font-mono text-xs">
      {/* SCANNER CONTROLS */}
      <div className="flex items-center justify-between bg-[#11151B] border border-[#1C1F26] rounded p-3">
        <div className="flex items-center gap-3">
          <button
            onClick={toggleScanner}
            className={`px-3 py-1.5 rounded text-[9px] font-bold uppercase tracking-wider border transition-all cursor-pointer ${
              scannerActive
                ? 'bg-blue-950/40 border-blue-500/60 text-blue-400 hover:bg-blue-600 hover:text-white'
                : 'bg-gray-900 border-gray-700 text-gray-400 hover:bg-gray-800 hover:text-white'
            }`}
          >
            {scannerActive ? '⚡ SCANNER ACTIVE' : '○ START SCANNER'}
          </button>
          <span className="text-gray-500 text-[9px]">
            {feed.length} pairs tracked
          </span>
        </div>

        <div className="flex gap-1">
          {(['all', 'verified', 'locked', 'high_liq'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-2 py-1 rounded text-[8px] font-bold uppercase tracking-wider border transition-all cursor-pointer ${
                filter === f
                  ? 'bg-blue-950/30 border-blue-500/40 text-blue-400'
                  : 'border-transparent text-gray-500 hover:text-gray-300'
              }`}
            >
              {f === 'verified' ? '✓ VERIFIED' : f === 'locked' ? '🔒 LP LOCKED' : f === 'high_liq' ? '💧 HIGH LIQ' : '📋 ALL'}
            </button>
          ))}
        </div>
      </div>

      {/* TOKEN FEED TABLE */}
      <div className="bg-[#11151B] border border-[#1C1F26] rounded overflow-hidden">
        <div className="grid grid-cols-12 gap-2 px-3 py-2 text-[8px] text-gray-500 uppercase tracking-wider border-b border-[#1C1F26] bg-black/30">
          <span className="col-span-3">TOKEN</span>
          <span className="col-span-1">DEX</span>
          <span className="col-span-1">MCAP</span>
          <span className="col-span-1">LIQ (ETH)</span>
          <span className="col-span-1">LP_LOCK</span>
          <span className="col-span-1">TAX</span>
          <span className="col-span-1">GAS</span>
          <span className="col-span-1">VERIFIED</span>
          <span className="col-span-2 text-right">ACTIONS</span>
        </div>

        <div className="max-h-[420px] overflow-y-auto">
          {feed.length === 0 && (
            <div className="text-center py-8 text-gray-600">
              {scannerActive ? 'Scanning Base L2 DEX pools for new listings...' : 'Scanner paused. Click START SCANNER to begin.'}
            </div>
          )}
          {feed.map((t) => (
            <div key={t.id} className="grid grid-cols-12 gap-2 px-3 py-2.5 border-b border-[#1C1F26]/50 hover:bg-[#151924]/60 transition-colors items-center">
              <div className="col-span-3 flex items-center gap-2">
                <div className={`w-2 h-2 rounded-full shrink-0 ${t.verified ? 'bg-blue-400' : 'bg-gray-600'}`} />
                <div>
                  <span className="text-white font-bold block text-[10px]">{t.symbol}</span>
                  <span className="text-[8px] text-gray-500 truncate">{t.contractAddress.slice(0, 10)}...</span>
                </div>
              </div>

              <span className="col-span-1 text-gray-400 text-[9px]">{t.protocol.split(' ')[0]}</span>

              <span className="col-span-1 text-gray-300">
                ${t.marketCap >= 1000 ? `${(t.marketCap / 1000).toFixed(1)}k` : t.marketCap}
              </span>

              <span className="col-span-1 text-gray-300">{t.liquidityEth}</span>

              <span className="col-span-1">
                {t.lpLocked ? (
                  <span className="text-emerald-400 font-bold flex items-center gap-0.5">
                    <Lock className="w-3 h-3" /> {t.lpLockDays}d
                  </span>
                ) : (
                  <span className="text-rose-400 font-bold flex items-center gap-0.5">
                    <Unlock className="w-3 h-3" /> NO
                  </span>
                )}
              </span>

              <span className={`col-span-1 font-bold ${parseFloat(t.taxBuy) > 3 ? 'text-amber-400' : 'text-gray-400'}`}>
                {t.taxBuy}%
              </span>

              <span className="col-span-1 text-gray-400">{t.gasEstimateGwei}G</span>

              <span className="col-span-1">
                {t.verified ? (
                  <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <XCircle className="w-3.5 h-3.5 text-gray-600" />
                )}
              </span>

              <div className="col-span-2 flex justify-end gap-1.5">
                <button
                  onClick={() => setSelectedToken(t)}
                  className="px-2 py-1 rounded border border-blue-900/40 bg-blue-950/20 text-blue-400 text-[8px] font-bold hover:bg-blue-600 hover:text-white transition-all cursor-pointer"
                >
                  INSPECT
                </button>
                <button
                  onClick={() => onManualBuy?.(t)}
                  className="px-2 py-1 rounded border border-emerald-900/40 bg-emerald-950/20 text-emerald-400 text-[8px] font-bold hover:bg-emerald-600 hover:text-white transition-all cursor-pointer"
                >
                  BUY
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* INSPECTION MODAL */}
      {selectedToken && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm">
          <div className="w-full max-w-lg bg-[#0E1118] border border-blue-500/30 rounded shadow-2xl p-5 font-mono text-xs">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Shield className="w-5 h-5 text-blue-400" />
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">{selectedToken.symbol} — Contract Audit</h3>
              </div>
              <button onClick={() => setSelectedToken(null)} className="text-gray-500 hover:text-white cursor-pointer">✕</button>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-black/40 p-2.5 rounded border border-gray-900">
                  <span className="text-[8px] text-gray-500 block uppercase">Verified Contract</span>
                  <span className={`font-bold ${selectedToken.verified ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {selectedToken.verified ? 'YES' : 'NO'}
                  </span>
                </div>
                <div className="bg-black/40 p-2.5 rounded border border-gray-900">
                  <span className="text-[8px] text-gray-500 block uppercase">LP Lock Status</span>
                  <span className={`font-bold ${selectedToken.lpLocked ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {selectedToken.lpLocked ? `LOCKED (${selectedToken.lpLockDays} days)` : 'UNLOCKED'}
                  </span>
                </div>
                <div className="bg-black/40 p-2.5 rounded border border-gray-900">
                  <span className="text-[8px] text-gray-500 block uppercase">Buy / Sell Tax</span>
                  <span className="text-white font-bold">{selectedToken.taxBuy}% / {selectedToken.taxSell}%</span>
                </div>
                <div className="bg-black/40 p-2.5 rounded border border-gray-900">
                  <span className="text-[8px] text-gray-500 block uppercase">Deployer Reputation</span>
                  <span className={`font-bold ${selectedToken.deployerReputation >= 70 ? 'text-emerald-400' : selectedToken.deployerReputation >= 40 ? 'text-amber-400' : 'text-rose-400'}`}>
                    {selectedToken.deployerReputation}/100
                  </span>
                </div>
              </div>

              <div className="bg-black/40 p-2.5 rounded border border-gray-900">
                <span className="text-[8px] text-gray-500 block uppercase mb-1">Contract Address</span>
                <span className="text-white text-[9px] select-all break-all">{selectedToken.contractAddress}</span>
              </div>
            </div>

            <div className="flex gap-2 mt-4">
              <button
                onClick={() => {
                  onManualBuy?.(selectedToken);
                  setSelectedToken(null);
                }}
                className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold uppercase rounded cursor-pointer transition-all"
              >
                EXECUTE BUY
              </button>
              <button
                onClick={() => setSelectedToken(null)}
                className="flex-1 py-2 bg-[#151924] hover:bg-[#1A1F2C] text-gray-300 uppercase rounded cursor-pointer transition-all border border-gray-800"
              >
                CLOSE
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
