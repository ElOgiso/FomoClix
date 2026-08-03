import React, { useState, useEffect } from 'react';
import { Flame, ArrowUpRight, ArrowDownRight, Shield, ShieldAlert, Clock, TrendingUp, Zap, ExternalLink } from 'lucide-react';

interface SolanaToken {
  id: string;
  chain: string;
  protocol: string;
  name: string;
  symbol: string;
  mintAddress: string;
  bondingCurvePercent: number;
  graduated: boolean;
  marketCap: number;
  liquiditySol: number;
  holders: number;
  devHoldPercent: number;
  volume24h: number;
  priceChangePct: string;
  rugScore: number;
  mintAuthority: string;
  freezeAuthority: string;
  createdAt: number;
  detectedAt: string;
}

interface SolanaScannerProps {
  apiBase: string;
  token: string;
  onManualBuy?: (token: SolanaToken) => void;
}

export const SolanaScanner: React.FC<SolanaScannerProps> = ({ apiBase, token, onManualBuy }) => {
  const [feed, setFeed] = useState<SolanaToken[]>([]);
  const [scannerActive, setScannerActive] = useState(false);
  const [filter, setFilter] = useState<'all' | 'graduating' | 'new'>('all');
  const [loading, setLoading] = useState(false);
  const [selectedToken, setSelectedToken] = useState<SolanaToken | null>(null);

  const fetchFeed = async () => {
    try {
      setLoading(true);
      const res = await fetch(`${apiBase}/solana/scanner/feed?limit=50&filter=${filter}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setFeed(data);
      }
    } catch (err) {
      console.error('[SolanaScanner] Feed fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  const toggleScanner = async () => {
    try {
      const res = await fetch(`${apiBase}/solana/scanner/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setScannerActive(data.enabled);
      }
    } catch (err) {
      console.error('[SolanaScanner] Toggle error:', err);
    }
  };

  useEffect(() => {
    fetchFeed();
    const interval = setInterval(fetchFeed, 6000);
    return () => clearInterval(interval);
  }, [filter]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${apiBase}/solana/status`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
          const data = await res.json();
          setScannerActive(data.status === 'SCANNING');
        }
      } catch {}
    })();
  }, []);

  const getRugColor = (score: number) => {
    if (score >= 80) return 'text-emerald-400';
    if (score >= 50) return 'text-amber-400';
    return 'text-rose-400';
  };

  const getRugLabel = (score: number) => {
    if (score >= 80) return 'SAFE';
    if (score >= 50) return 'MEDIUM';
    return 'RISKY';
  };

  return (
    <div className="space-y-4 font-mono text-xs">
      {/* SCANNER CONTROLS */}
      <div className="flex items-center justify-between bg-[#11151B] border border-[#1C1F26] rounded p-3">
        <div className="flex items-center gap-3">
          <button
            onClick={toggleScanner}
            className={`px-3 py-1.5 rounded text-[9px] font-bold uppercase tracking-wider border transition-all cursor-pointer ${
              scannerActive
                ? 'bg-violet-950/40 border-violet-500/60 text-violet-400 hover:bg-violet-600 hover:text-white'
                : 'bg-gray-900 border-gray-700 text-gray-400 hover:bg-gray-800 hover:text-white'
            }`}
          >
            {scannerActive ? '⚡ SCANNER ACTIVE' : '○ START SCANNER'}
          </button>
          <span className="text-gray-500 text-[9px]">
            {feed.length} tokens discovered
          </span>
        </div>

        {/* FILTER TABS */}
        <div className="flex gap-1">
          {(['all', 'graduating', 'new'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-2 py-1 rounded text-[8px] font-bold uppercase tracking-wider border transition-all cursor-pointer ${
                filter === f
                  ? 'bg-violet-950/30 border-violet-500/40 text-violet-400'
                  : 'border-transparent text-gray-500 hover:text-gray-300'
              }`}
            >
              {f === 'graduating' ? '🎓 GRADUATING' : f === 'new' ? '🆕 NEW' : '📋 ALL'}
            </button>
          ))}
        </div>
      </div>

      {/* TOKEN FEED TABLE */}
      <div className="bg-[#11151B] border border-[#1C1F26] rounded overflow-hidden">
        {/* TABLE HEADER */}
        <div className="grid grid-cols-12 gap-2 px-3 py-2 text-[8px] text-gray-500 uppercase tracking-wider border-b border-[#1C1F26] bg-black/30">
          <span className="col-span-3">TOKEN</span>
          <span className="col-span-2">BONDING CURVE</span>
          <span className="col-span-1">MCAP</span>
          <span className="col-span-1">LIQ (SOL)</span>
          <span className="col-span-1">HOLDERS</span>
          <span className="col-span-1">DEV %</span>
          <span className="col-span-1">RUG_CHK</span>
          <span className="col-span-2 text-right">ACTIONS</span>
        </div>

        {/* TOKEN ROWS */}
        <div className="max-h-[420px] overflow-y-auto">
          {feed.length === 0 && (
            <div className="text-center py-8 text-gray-600">
              {scannerActive ? 'Scanning Solana mempool for Pump.fun launches...' : 'Scanner paused. Click START SCANNER to begin.'}
            </div>
          )}
          {feed.map((t) => {
            const pctChange = parseFloat(t.priceChangePct);
            const isUp = pctChange > 0;
            return (
              <div key={t.id} className="grid grid-cols-12 gap-2 px-3 py-2.5 border-b border-[#1C1F26]/50 hover:bg-[#151924]/60 transition-colors items-center">
                {/* TOKEN INFO */}
                <div className="col-span-3 flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full shrink-0 ${t.graduated ? 'bg-emerald-400' : 'bg-violet-400 animate-pulse'}`} />
                  <div>
                    <span className="text-white font-bold block text-[10px]">{t.symbol}</span>
                    <span className="text-[8px] text-gray-500">{t.protocol}</span>
                  </div>
                  {t.graduated && (
                    <span className="text-[7px] bg-emerald-950 text-emerald-400 px-1 rounded border border-emerald-900 font-bold">GRADUATED</span>
                  )}
                </div>

                {/* BONDING CURVE PROGRESS */}
                <div className="col-span-2">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${Math.min(t.bondingCurvePercent, 100)}%`,
                          backgroundColor: t.bondingCurvePercent >= 90 ? '#10B981' : t.bondingCurvePercent >= 60 ? '#F59E0B' : '#9945FF',
                        }}
                      />
                    </div>
                    <span className="text-[9px] text-gray-400 font-bold w-8 text-right">{t.bondingCurvePercent}%</span>
                  </div>
                </div>

                {/* MCAP */}
                <span className="col-span-1 text-gray-300">
                  ${t.marketCap >= 1000 ? `${(t.marketCap / 1000).toFixed(1)}k` : t.marketCap}
                </span>

                {/* LIQUIDITY */}
                <span className="col-span-1 text-gray-300">{t.liquiditySol} SOL</span>

                {/* HOLDERS */}
                <span className="col-span-1 text-gray-300">{t.holders}</span>

                {/* DEV HOLD */}
                <span className={`col-span-1 font-bold ${t.devHoldPercent > 10 ? 'text-amber-400' : 'text-gray-400'}`}>
                  {t.devHoldPercent}%
                </span>

                {/* RUG CHECK */}
                <span className={`col-span-1 font-bold ${getRugColor(t.rugScore)}`}>
                  {getRugLabel(t.rugScore)}
                </span>

                {/* ACTIONS */}
                <div className="col-span-2 flex justify-end gap-1.5">
                  <button
                    onClick={() => setSelectedToken(t)}
                    className="px-2 py-1 rounded border border-violet-900/40 bg-violet-950/20 text-violet-400 text-[8px] font-bold hover:bg-violet-600 hover:text-white transition-all cursor-pointer"
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
            );
          })}
        </div>
      </div>

      {/* INSPECTION MODAL */}
      {selectedToken && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-sm">
          <div className="w-full max-w-lg bg-[#0E1118] border border-violet-500/30 rounded shadow-2xl p-5 font-mono text-xs">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Shield className="w-5 h-5 text-violet-400" />
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">{selectedToken.symbol} — Security Audit</h3>
              </div>
              <button onClick={() => setSelectedToken(null)} className="text-gray-500 hover:text-white cursor-pointer">✕</button>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-black/40 p-2.5 rounded border border-gray-900">
                  <span className="text-[8px] text-gray-500 block uppercase">Mint Authority</span>
                  <span className={`font-bold ${selectedToken.mintAuthority === 'REVOKED' ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {selectedToken.mintAuthority}
                  </span>
                </div>
                <div className="bg-black/40 p-2.5 rounded border border-gray-900">
                  <span className="text-[8px] text-gray-500 block uppercase">Freeze Authority</span>
                  <span className={`font-bold ${selectedToken.freezeAuthority === 'REVOKED' ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {selectedToken.freezeAuthority}
                  </span>
                </div>
                <div className="bg-black/40 p-2.5 rounded border border-gray-900">
                  <span className="text-[8px] text-gray-500 block uppercase">Rug Score</span>
                  <span className={`font-bold ${getRugColor(selectedToken.rugScore)}`}>{selectedToken.rugScore}/100 — {getRugLabel(selectedToken.rugScore)}</span>
                </div>
                <div className="bg-black/40 p-2.5 rounded border border-gray-900">
                  <span className="text-[8px] text-gray-500 block uppercase">Dev Holdings</span>
                  <span className={`font-bold ${selectedToken.devHoldPercent > 10 ? 'text-amber-400' : 'text-emerald-400'}`}>{selectedToken.devHoldPercent}%</span>
                </div>
              </div>

              <div className="bg-black/40 p-2.5 rounded border border-gray-900">
                <span className="text-[8px] text-gray-500 block uppercase mb-1">Mint Address</span>
                <span className="text-white text-[9px] select-all break-all">{selectedToken.mintAddress}</span>
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
