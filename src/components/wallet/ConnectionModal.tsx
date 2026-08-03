import React, { useState } from 'react';
import { useAuth } from '../../providers/AuthProvider';
import { authApi } from '../../services/api';
import { X, Wallet, Shield } from 'lucide-react';

interface ConnectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export const ConnectionModal: React.FC<ConnectionModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const { login, authenticating, authError } = useAuth();
  const [selectedChain, setSelectedChain] = useState<'ethereum' | 'solana'>('ethereum');
  const [connecting, setConnecting] = useState(false);

  if (!isOpen) return null;

  const handleConnectAndSign = async () => {
    setConnecting(true);
    try {
      const ethereum = (window as any).ethereum;
      let targetAddress = selectedChain === 'ethereum'
        ? '0xFA887A39E22555e1a3f815A9aC730366ec0e05E4'
        : 'SolanaWalletAddressExample1111111111111111';
      let signature = '0x_simulated_sig_' + Math.random().toString(36).substring(7);

      if (ethereum && selectedChain === 'ethereum') {
        try {
          const accounts: string[] = await ethereum.request({ method: 'eth_requestAccounts' });
          if (accounts && accounts.length > 0) {
            targetAddress = accounts[0];
            const challengeResult = await authApi.getChallenge(targetAddress);
            const hexMessage = '0x' + Array.from(new TextEncoder().encode(challengeResult.message))
              .map(b => b.toString(16).padStart(2, '0')).join('');
            signature = await ethereum.request({
              method: 'personal_sign',
              params: [hexMessage, targetAddress],
            });
          }
        } catch (web3Err) {
          console.warn('[ConnectionModal Web3 Fallback]', web3Err);
        }
      }

      // 1. Fetch Auth Challenge from backend API
      const challengeResult = await authApi.getChallenge(targetAddress);
      const challengeMsg = challengeResult.message;

      // 2. Verify signature via AuthProvider to get JWT token
      const success = await login(targetAddress, challengeMsg, signature);
      if (success) {
        onSuccess();
        onClose();
      }
    } catch (err) {
      console.error('[ConnectionModal Error]', err);
    } finally {
      setConnecting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
      <div className="border border-[#1C1F26] bg-[#0E1118] rounded max-w-md w-full p-6 space-y-6 shadow-2xl relative">
        <button onClick={onClose} className="absolute right-4 top-4 text-gray-500 hover:text-white cursor-pointer">
          <X className="w-5 h-5" />
        </button>

        <div className="space-y-1">
          <h2 className="text-white font-mono font-bold text-sm uppercase tracking-wider flex items-center gap-2">
            <Wallet className="w-4 h-4 text-indigo-400" />
            Connect Web3 Wallet
          </h2>
          <p className="text-xs text-gray-500 font-mono">
            Sign cryptographic message to verify whitelist identity.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 font-mono">
          <button 
            onClick={() => setSelectedChain('ethereum')}
            className={`p-3 rounded border text-left transition-all ${
              selectedChain === 'ethereum' ? 'bg-indigo-950/30 border-indigo-500 text-white' : 'bg-transparent border-[#1C1F26] text-gray-500 hover:text-gray-300'
            }`}
          >
            <div className="text-[11px] font-bold">EVM CHAIN</div>
            <div className="text-[9px] text-gray-600 mt-1">Ethereum / Base / Zora</div>
          </button>
          <button 
            onClick={() => setSelectedChain('solana')}
            className={`p-3 rounded border text-left transition-all ${
              selectedChain === 'solana' ? 'bg-indigo-950/30 border-indigo-500 text-white' : 'bg-transparent border-[#1C1F26] text-gray-500 hover:text-gray-300'
            }`}
          >
            <div className="text-[11px] font-bold">SOLANA</div>
            <div className="text-[9px] text-gray-600 mt-1">Phantom / Backpack</div>
          </button>
        </div>

        {authError && (
          <div className="p-3 border border-rose-950/40 bg-rose-950/10 text-rose-400 text-xs font-mono rounded">
            Error: {authError}
          </div>
        )}

        <button
          onClick={handleConnectAndSign}
          disabled={authenticating || connecting}
          className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-mono font-bold uppercase rounded border border-indigo-500 tracking-wider flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
        >
          <Shield className="w-4 h-4" />
          {authenticating || connecting ? 'SIGNING CHALLENGE...' : 'CONNECT & SIGN CHALLENGE'}
        </button>
      </div>
    </div>
  );
};
