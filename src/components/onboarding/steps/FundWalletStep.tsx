import React, { useState, useEffect, useCallback } from 'react';
import { Copy, Check, RefreshCw, Zap, ArrowRight } from 'lucide-react';
import { onboardingApi } from '../../../services/api';

interface FundWalletStepProps {
  stepLabel: string;
  walletAddress: string;
  onContinue: () => void;
}

export const FundWalletStep: React.FC<FundWalletStepProps> = ({ stepLabel, walletAddress, onContinue }) => {
  const [balance, setBalance] = useState<{ eth: number; usd: number; funded: boolean } | null>(null);
  const [polling, setPolling] = useState(false);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchBalance = useCallback(async () => {
    if (!walletAddress) return;
    try {
      const data = await onboardingApi.getWalletBalance();
      setBalance({ eth: data.balanceEth, usd: data.balanceUsd, funded: data.funded });
      setLoading(false);
      if (data.funded && polling) {
        // Auto-advance when funded
        setPolling(false);
        setTimeout(onContinue, 1500);
      }
    } catch (err: any) {
      setError(err?.message || 'Could not check balance.');
      setLoading(false);
    }
  }, [walletAddress, polling, onContinue]);

  // Initial load
  useEffect(() => {
    fetchBalance();
  }, [walletAddress]);

  // Start polling when user clicks "Check"
  useEffect(() => {
    if (!polling) return;
    const interval = setInterval(fetchBalance, 6000);
    return () => clearInterval(interval);
  }, [polling, fetchBalance]);

  const handleCopy = () => {
    navigator.clipboard.writeText(walletAddress).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const shortAddr = walletAddress
    ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`
    : '—';

  return (
    <div className="bg-[#0E1118] border border-[#1C1F26] rounded-lg shadow-2xl p-6 space-y-5">
      {/* Header */}
      <div className="flex flex-col items-center text-center space-y-3">
        <div className={`p-3 rounded-full border transition-all ${
          balance?.funded
            ? 'bg-emerald-500/10 border-emerald-500/25'
            : 'bg-indigo-500/10 border-indigo-500/20'
        }`}>
          <Zap className={`w-6 h-6 ${balance?.funded ? 'text-emerald-400' : 'text-indigo-400'}`} />
        </div>
        <div>
          <h2 className="text-white font-mono font-bold text-sm uppercase tracking-wider">Fund Trading Wallet</h2>
          <p className="text-gray-600 text-[8px] font-mono mt-0.5">Step {stepLabel} — Optional (can skip)</p>
        </div>
      </div>

      {/* Wallet address */}
      <div className="space-y-1.5">
        <p className="text-[8px] font-mono text-gray-600 uppercase">YOUR TRADING WALLET ADDRESS</p>
        <div className="flex items-center gap-2 p-3 bg-[#07080A] border border-[#1C1F26] rounded">
          <span className="flex-1 text-[9px] font-mono text-white break-all">{walletAddress}</span>
          <button
            onClick={handleCopy}
            className="shrink-0 p-1.5 hover:bg-[#1C1F26] rounded transition-colors cursor-pointer"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-gray-400" />}
          </button>
        </div>
      </div>

      {/* Balance display */}
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-4">
          <RefreshCw className="w-4 h-4 text-gray-600 animate-spin" />
          <span className="text-[9px] font-mono text-gray-600">Checking balance...</span>
        </div>
      ) : (
        <div className={`p-3 rounded border transition-all ${
          balance?.funded
            ? 'bg-emerald-500/8 border-emerald-500/25'
            : 'bg-[#07080A] border-[#1C1F26]'
        }`}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[7px] font-mono text-gray-600 uppercase mb-0.5">BALANCE</p>
              <p className={`text-base font-mono font-black ${balance?.funded ? 'text-emerald-400' : 'text-white'}`}>
                {balance?.eth?.toFixed(6) ?? '0.000000'} ETH
              </p>
              {balance && balance.usd > 0 && (
                <p className="text-[7px] font-mono text-gray-500">${balance.usd.toFixed(2)} USD</p>
              )}
            </div>
            {balance?.funded && (
              <div className="flex items-center gap-1.5 px-2 py-1 bg-emerald-500/15 border border-emerald-500/30 rounded">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-[8px] font-mono font-bold text-emerald-400 uppercase">FUNDED</span>
              </div>
            )}
          </div>
          {balance?.funded && (
            <p className="text-[8px] font-mono text-emerald-400/70 mt-2">✓ Wallet funded — proceeding automatically...</p>
          )}
        </div>
      )}

      {/* Instructions */}
      {!balance?.funded && (
        <div className="p-3 bg-[#07080A] border border-[#1C1F26] rounded text-[8px] font-mono text-gray-500 leading-relaxed space-y-1.5">
          <p className="text-gray-400 font-bold text-[9px]">How to fund:</p>
          <p>1. Copy the address above</p>
          <p>2. Send ETH from any exchange or wallet (Base network recommended)</p>
          <p>3. Minimum recommended: <span className="text-white">0.005 ETH</span> (~$15) for gas + trading</p>
          <p className="text-gray-600">You can also fund later from the dashboard.</p>
        </div>
      )}

      {error && (
        <p className="text-[8px] font-mono text-rose-400 text-center">{error}</p>
      )}

      {/* Actions */}
      <div className="space-y-2">
        {!balance?.funded && (
          <button
            onClick={() => { setPolling(true); fetchBalance(); }}
            disabled={polling}
            className="w-full py-2 flex items-center justify-center gap-2 bg-[#07080A] hover:bg-[#1C1F26] border border-[#1C1F26] text-gray-400 text-[9px] font-mono uppercase tracking-wider rounded cursor-pointer transition-all disabled:opacity-60"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${polling ? 'animate-spin' : ''}`} />
            {polling ? 'WATCHING FOR DEPOSIT...' : 'CHECK BALANCE'}
          </button>
        )}

        <button
          onClick={onContinue}
          className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-mono font-bold uppercase tracking-wider rounded border border-indigo-500 cursor-pointer transition-all flex items-center justify-center gap-2"
        >
          {balance?.funded ? 'SELECT PLAN' : 'SKIP FOR NOW'}
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>

      <p className="text-center text-[7px] font-mono text-gray-700 leading-relaxed">
        Funds are non-custodial. FOMOCLIX uses your trading wallet balance for trades and fees only.
      </p>
    </div>
  );
};
