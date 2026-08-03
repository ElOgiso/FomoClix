import React, { useState } from 'react';
import { Wallet, Shield, AlertCircle, RefreshCw } from 'lucide-react';
import { authApi } from '../../../services/api';
import { auth, googleProvider } from '../../../services/firebase';
import { signInWithPopup } from 'firebase/auth';

interface ConnectWalletStepProps {
  onConnected: (token: string, address: string, role: string) => void;
}

export const ConnectWalletStep: React.FC<ConnectWalletStepProps> = ({ onConnected }) => {
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConnect = async () => {
    setConnecting(true);
    setError(null);
    try {
      const ethereum = (window as any).ethereum;
      if (!ethereum) {
        throw new Error('No Web3 wallet detected. Please install MetaMask or another EVM wallet.');
      }

      // 1. Request accounts
      const accounts: string[] = await ethereum.request({ method: 'eth_requestAccounts' });
      if (!accounts || accounts.length === 0) throw new Error('No accounts returned from wallet.');
      const address = accounts[0];

      // 2. Fetch nonce + pre-formatted message from backend
      const { message } = await authApi.getChallenge(address);

      // 3. Sign the message
      const hexMessage = '0x' + Array.from(new TextEncoder().encode(message))
        .map(b => b.toString(16).padStart(2, '0')).join('');
      const signature: string = await ethereum.request({
        method: 'personal_sign',
        params: [hexMessage, address],
      });

      // 4. Exchange signature for JWT
      const result = await authApi.login(address, message, signature);
      if (!result.jwt_token) throw new Error('No token returned from server.');

      onConnected(result.jwt_token, address, result.profile.role || 'user');
    } catch (err: any) {
      const msg = err?.message || String(err);
      if (msg.includes('4001') || msg.toLowerCase().includes('rejected') || msg.toLowerCase().includes('denied')) {
        setError('Signature rejected. Please approve the sign request in your wallet to continue.');
      } else if (msg.includes('No Web3')) {
        setError(msg);
      } else {
        setError(msg || 'Connection failed. Please try again.');
      }
    } finally {
      setConnecting(false);
    }
  };

  const handleGoogleSignup = async () => {
    setConnecting(true);
    setError(null);
    try {
      const userCredential = await signInWithPopup(auth, googleProvider);
      const idToken = await userCredential.user.getIdToken();
      const result = await authApi.googleLogin(idToken);
      if (!result.jwt_token) throw new Error('No custom authentication token returned.');
      onConnected(result.jwt_token, result.profile.uid, result.profile.role || 'user');
    } catch (err: any) {
      console.error('[Google Onboarding Sign Up Error]', err);
      setError(err?.message || 'Google authentication failed.');
    } finally {
      setConnecting(false);
    }
  };

  return (
    <div className="bg-[#0E1118] border border-[#1C1F26] rounded-lg shadow-2xl p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col items-center text-center space-y-3">
        <div className="p-3 bg-indigo-500/10 rounded-full border border-indigo-500/20">
          <Wallet className="w-6 h-6 text-indigo-400" />
        </div>
        <div>
          <h2 className="text-white font-mono font-bold text-sm uppercase tracking-wider">Connect Identity</h2>
          <p className="text-gray-500 text-[9px] font-mono mt-0.5">Step 2 / 9 — Wallet or Google Account</p>
        </div>
      </div>

      {/* Info card */}
      <div className="p-3 bg-[#07080A] border border-[#1C1F26] rounded space-y-2">
        <p className="text-[9px] font-mono text-gray-400 leading-relaxed">
          Your connected identity is your <span className="text-white">ownership identity</span> — used only for authentication.
          FOMOCLIX will provision a separate <span className="text-indigo-400">trading wallet</span> for all bot operations.
        </p>
        <div className="flex items-center gap-1.5">
          <Shield className="w-3 h-3 text-emerald-400 shrink-0" />
          <span className="text-[8px] font-mono text-emerald-400">Your keys never leave your custody</span>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="p-3 bg-rose-500/8 border border-rose-500/20 rounded flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
          <p className="text-[9px] font-mono text-rose-400 leading-relaxed">{error}</p>
        </div>
      )}

      {/* Connect buttons */}
      <div className="space-y-3">
        <button
          onClick={handleConnect}
          disabled={connecting}
          className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-800 disabled:opacity-60 text-white text-xs font-mono font-bold uppercase tracking-wider rounded border border-indigo-500 cursor-pointer transition-all flex items-center justify-center gap-2"
        >
          {connecting ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin" />
              <span>SIGNING CHALLENGE...</span>
            </>
          ) : (
            <>
              <Wallet className="w-4 h-4" />
              <span>CONNECT &amp; SIGN WALLET</span>
            </>
          )}
        </button>

        <div className="relative flex py-1 items-center">
          <div className="flex-grow border-t border-gray-800/85"></div>
          <span className="flex-shrink mx-3 text-[8.5px] text-gray-500 uppercase tracking-widest">OR</span>
          <div className="flex-grow border-t border-gray-800/85"></div>
        </div>

        <button
          onClick={handleGoogleSignup}
          disabled={connecting}
          className="w-full py-3 bg-white hover:bg-gray-100 disabled:opacity-50 text-[#07080A] text-xs font-mono font-bold uppercase tracking-wider rounded cursor-pointer transition-all flex items-center justify-center gap-2.5"
        >
          {connecting ? (
            <RefreshCw className="w-4 h-4 animate-spin text-gray-600" />
          ) : (
            <>
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
      </div>

      {/* Supported networks */}
      <div className="text-center">
        <p className="text-[8px] text-gray-600 font-mono">MetaMask · Coinbase Wallet · Rainbow · Any Google Account</p>
      </div>
    </div>
  );
};
