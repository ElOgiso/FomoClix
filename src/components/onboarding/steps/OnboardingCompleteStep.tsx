import React from 'react';
import { CheckCircle, Zap, ArrowRight } from 'lucide-react';
import { motion } from 'motion/react';

interface OnboardingCompleteStepProps {
  walletAddress: string;
  onEnterDashboard: () => void;
}

export const OnboardingCompleteStep: React.FC<OnboardingCompleteStepProps> = ({
  walletAddress, onEnterDashboard
}) => {
  const shortAddr = walletAddress
    ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`
    : '—';

  return (
    <div className="bg-[#0E1118] border border-[#1C1F26] rounded-lg shadow-2xl p-8 space-y-6">
      {/* Success icon */}
      <div className="flex flex-col items-center text-center space-y-4">
        <motion.div
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 200, damping: 15 }}
          className="relative"
        >
          <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
            <CheckCircle className="w-8 h-8 text-emerald-400" />
          </div>
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1.3, opacity: 0 }}
            transition={{ repeat: Infinity, duration: 1.8, ease: 'easeOut' }}
            className="absolute inset-0 rounded-full border border-emerald-500/30"
          />
        </motion.div>

        <div>
          <h2 className="text-white font-mono font-black text-base uppercase tracking-widest">Setup Complete</h2>
          <p className="text-emerald-400 text-[9px] font-mono mt-1">FOMOCLIX is ready to trade</p>
        </div>
      </div>

      {/* Summary */}
      <div className="space-y-2">
        {[
          { label: 'Owner Wallet', value: 'Connected ✓', color: 'text-emerald-400' },
          { label: 'Trading Wallet', value: shortAddr, color: 'text-indigo-400' },
          { label: 'Legal Agreements', value: 'Accepted ✓', color: 'text-emerald-400' },
          { label: 'Backup Phrase', value: 'Secured ✓', color: 'text-emerald-400' },
          { label: 'Plan', value: 'Active ✓', color: 'text-amber-400' },
        ].map(({ label, value, color }) => (
          <div key={label} className="flex items-center justify-between py-2 border-b border-[#1C1F26] last:border-0">
            <span className="text-[9px] font-mono text-gray-500 uppercase">{label}</span>
            <span className={`text-[9px] font-mono font-bold ${color}`}>{value}</span>
          </div>
        ))}
      </div>

      {/* Quick tips */}
      <div className="p-3 bg-indigo-500/5 border border-indigo-500/20 rounded space-y-1.5">
        <p className="text-[8px] font-mono text-indigo-400 font-bold uppercase mb-2">Quick Start Tips</p>
        {[
          'Fund your trading wallet to enable the bot',
          'Set strategy parameters in the Strategy tab',
          'Add target creators to track in the Creators tab',
          'Start the bot from the Command Center tab',
          'Ask the AI anything — it can trade on your behalf',
        ].map(tip => (
          <div key={tip} className="flex items-center gap-1.5">
            <Zap className="w-2.5 h-2.5 text-indigo-400 shrink-0" />
            <span className="text-[8px] font-mono text-gray-500">{tip}</span>
          </div>
        ))}
      </div>

      <button
        onClick={onEnterDashboard}
        className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-mono font-black uppercase tracking-wider rounded border border-indigo-500 cursor-pointer transition-all flex items-center justify-center gap-2 group"
      >
        <span>ENTER DASHBOARD</span>
        <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
      </button>
    </div>
  );
};
