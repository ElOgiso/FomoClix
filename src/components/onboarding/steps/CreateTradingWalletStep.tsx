import React, { useState } from 'react';
import { Key, AlertCircle, RefreshCw, Cpu } from 'lucide-react';
import { onboardingApi } from '../../../services/api';

interface CreateTradingWalletStepProps {
  stepLabel: string;
  onCreated: (address: string, mnemonic: string | null) => void;
}

export const CreateTradingWalletStep: React.FC<CreateTradingWalletStepProps> = ({ stepLabel, onCreated }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await onboardingApi.createWallet();
      if (!result.success) throw new Error('Wallet creation failed.');
      onCreated(result.address, result.mnemonic);
    } catch (err: any) {
      setError(err?.message || 'Failed to create trading wallet. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-[#0E1118] border border-[#1C1F26] rounded-lg shadow-2xl p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col items-center text-center space-y-3">
        <div className="p-3 bg-violet-500/10 rounded-full border border-violet-500/20">
          <Key className="w-6 h-6 text-violet-400" />
        </div>
        <div>
          <h2 className="text-white font-mono font-bold text-sm uppercase tracking-wider">Create Trading Wallet</h2>
          <p className="text-gray-600 text-[8px] font-mono mt-0.5">Step {stepLabel}</p>
        </div>
      </div>

      {/* Explanation */}
      <div className="space-y-3">
        <div className="p-3 bg-[#07080A] border border-[#1C1F26] rounded space-y-2.5">
          <p className="text-[9px] font-mono text-gray-400 leading-relaxed">
            FOMOCLIX will generate a dedicated <span className="text-white">EVM trading wallet</span> for all bot operations.
          </p>
          <div className="grid grid-cols-2 gap-2 mt-2">
            {[
              { label: 'Owner Wallet', desc: 'Your MetaMask', color: 'text-gray-400', border: 'border-gray-700' },
              { label: 'Trading Wallet', desc: 'Bot execution', color: 'text-violet-400', border: 'border-violet-700/50' },
            ].map(item => (
              <div key={item.label} className={`p-2 rounded border ${item.border} bg-[#07080A]`}>
                <p className={`text-[8px] font-mono font-bold uppercase ${item.color}`}>{item.label}</p>
                <p className="text-[7px] font-mono text-gray-600 mt-0.5">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-start gap-2 p-3 bg-amber-500/5 border border-amber-500/20 rounded">
          <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
          <p className="text-[8px] font-mono text-amber-400/80 leading-relaxed">
            Your recovery phrase will be shown <span className="font-bold text-amber-400">once only</span>. 
            You must save it before continuing. It cannot be retrieved later.
          </p>
        </div>
      </div>

      {/* Security features */}
      <div className="grid grid-cols-3 gap-2 text-center">
        {[
          { label: 'AES-256', sub: 'Encrypted' },
          { label: 'GCM Auth', sub: 'Integrity' },
          { label: 'Server-Side', sub: 'Signing' },
        ].map(item => (
          <div key={item.label} className="p-2 bg-[#07080A] border border-[#1C1F26] rounded">
            <Cpu className="w-3 h-3 text-violet-400 mx-auto mb-1" />
            <p className="text-[8px] font-mono font-bold text-violet-400">{item.label}</p>
            <p className="text-[7px] font-mono text-gray-600">{item.sub}</p>
          </div>
        ))}
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-rose-500/8 border border-rose-500/20 rounded">
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
          <p className="text-[9px] font-mono text-rose-400">{error}</p>
        </div>
      )}

      <button
        onClick={handleCreate}
        disabled={loading}
        className="w-full py-3 bg-violet-600 hover:bg-violet-500 disabled:bg-violet-900 disabled:opacity-60 text-white text-xs font-mono font-bold uppercase tracking-wider rounded border border-violet-500 cursor-pointer transition-all flex items-center justify-center gap-2"
      >
        {loading ? (
          <>
            <RefreshCw className="w-4 h-4 animate-spin" />
            <span>GENERATING WALLET...</span>
          </>
        ) : (
          <>
            <Key className="w-4 h-4" />
            <span>GENERATE TRADING WALLET</span>
          </>
        )}
      </button>
    </div>
  );
};
