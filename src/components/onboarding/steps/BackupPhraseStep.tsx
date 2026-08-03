import React, { useState } from 'react';
import { Download, CheckSquare, AlertCircle, ShieldCheck, Copy, Check } from 'lucide-react';
import { onboardingApi } from '../../../services/api';

interface BackupPhraseStepProps {
  stepLabel: string;
  mnemonic: string;
  walletAddress: string;
  onConfirmed: () => void;
}

export const BackupPhraseStep: React.FC<BackupPhraseStepProps> = ({
  stepLabel, mnemonic, walletAddress, onConfirmed
}) => {
  const [downloaded, setDownloaded] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const words = mnemonic.split(' ');

  const handleDownload = () => {
    const content = [
      '===========================================',
      '   FOMOCLIX TRADING WALLET — BACKUP PHRASE',
      '===========================================',
      '',
      'WALLET ADDRESS:',
      walletAddress,
      '',
      'RECOVERY PHRASE (12 WORDS):',
      mnemonic,
      '',
      '===========================================',
      'WARNING: Keep this file OFFLINE and SECURE.',
      'Anyone with this phrase can access your wallet.',
      'FOMOCLIX cannot recover this phrase for you.',
      `Generated: ${new Date().toISOString()}`,
      '===========================================',
    ].join('\n');

    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fomoclix-wallet-backup-${walletAddress.slice(2, 8)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    setDownloaded(true);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(mnemonic).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleConfirm = async () => {
    if (!downloaded || !confirmed) return;
    setLoading(true);
    setError(null);
    try {
      await onboardingApi.confirmBackup();
      onConfirmed();
    } catch (err: any) {
      setError(err?.message || 'Failed to confirm backup. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-[#0E1118] border border-[#1C1F26] rounded-lg shadow-2xl p-6 space-y-5">
      {/* Header */}
      <div className="flex flex-col items-center text-center space-y-2">
        <div className="p-3 bg-amber-500/10 rounded-full border border-amber-500/20">
          <ShieldCheck className="w-6 h-6 text-amber-400" />
        </div>
        <div>
          <h2 className="text-white font-mono font-bold text-sm uppercase tracking-wider">Backup Recovery Phrase</h2>
          <p className="text-gray-600 text-[8px] font-mono mt-0.5">Step {stepLabel} — Store this securely</p>
        </div>
      </div>

      {/* Warning */}
      <div className="p-3 bg-amber-500/5 border border-amber-500/25 rounded">
        <p className="text-[8px] font-mono text-amber-400 leading-relaxed">
          ⚠ This phrase is shown <strong>once only</strong> and is never stored by FOMOCLIX.
          If you lose it, you lose access to this wallet permanently.
        </p>
      </div>

      {/* Mnemonic grid */}
      <div className="relative">
        <div className="grid grid-cols-3 gap-1.5">
          {words.map((word, i) => (
            <div key={i} className="flex items-center gap-1.5 p-1.5 bg-[#07080A] border border-[#1C1F26] rounded">
              <span className="text-[7px] font-mono text-gray-600 w-4 shrink-0 text-right">{i + 1}.</span>
              <span className="text-[9px] font-mono text-white font-bold">{word}</span>
            </div>
          ))}
        </div>
        {/* Copy button */}
        <button
          onClick={handleCopy}
          className="absolute -top-1 -right-1 flex items-center gap-1 px-2 py-1 bg-[#1C1F26] hover:bg-[#252A35] border border-[#2A2F3E] rounded text-[8px] font-mono text-gray-400 hover:text-white transition-all cursor-pointer"
        >
          {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
          {copied ? 'COPIED' : 'COPY'}
        </button>
      </div>

      {/* Wallet address */}
      <div className="p-2 bg-[#07080A] border border-[#1C1F26] rounded">
        <p className="text-[7px] font-mono text-gray-600 mb-0.5">TRADING WALLET ADDRESS</p>
        <p className="text-[8px] font-mono text-gray-300 break-all">{walletAddress}</p>
      </div>

      {/* Download button */}
      <button
        onClick={handleDownload}
        className={`w-full py-2.5 flex items-center justify-center gap-2 text-[10px] font-mono font-bold uppercase tracking-wider rounded border cursor-pointer transition-all ${
          downloaded
            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
            : 'bg-amber-600/80 hover:bg-amber-500 border-amber-500 text-white'
        }`}
      >
        {downloaded ? <Check className="w-4 h-4" /> : <Download className="w-4 h-4" />}
        {downloaded ? 'DOWNLOADED — STORE SAFELY' : 'DOWNLOAD BACKUP FILE'}
      </button>

      {/* Confirmation checkbox */}
      <label className={`flex items-start gap-2.5 cursor-pointer ${!downloaded ? 'opacity-40 pointer-events-none' : ''}`}>
        <div
          onClick={() => downloaded && setConfirmed(c => !c)}
          className={`w-4 h-4 rounded border shrink-0 mt-0.5 flex items-center justify-center transition-all ${
            confirmed ? 'bg-indigo-600 border-indigo-500' : 'bg-transparent border-gray-600 hover:border-indigo-500'
          }`}
        >
          {confirmed && <CheckSquare className="w-3 h-3 text-white" />}
        </div>
        <span className="text-[8px] font-mono text-gray-400 leading-relaxed">
          I have safely stored my recovery phrase offline. I understand it cannot be recovered if lost.
        </span>
      </label>

      {error && (
        <div className="flex items-center gap-2 p-2 bg-rose-500/8 border border-rose-500/20 rounded">
          <AlertCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
          <p className="text-[8px] font-mono text-rose-400">{error}</p>
        </div>
      )}

      <button
        onClick={handleConfirm}
        disabled={!downloaded || !confirmed || loading}
        className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-900 disabled:opacity-50 text-white text-[10px] font-mono font-bold uppercase tracking-wider rounded border border-indigo-500 cursor-pointer disabled:cursor-not-allowed transition-all"
      >
        {loading ? 'CONFIRMING...' : 'I\'VE SAVED MY PHRASE — CONTINUE'}
      </button>
    </div>
  );
};
