import React from 'react';
import { Zap, Shield, TrendingUp } from 'lucide-react';
import { motion } from 'motion/react';

interface SplashScreenProps {
  onContinue: () => void;
}

export const SplashScreen: React.FC<SplashScreenProps> = ({ onContinue }) => {
  return (
    <div className="bg-[#0E1118] border border-[#1C1F26] rounded-lg shadow-2xl p-8 space-y-8">
      {/* Logo area */}
      <div className="flex flex-col items-center text-center space-y-4">
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
          className="relative"
        >
          <div className="w-16 h-16 rounded-full bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center">
            <Zap className="w-8 h-8 text-indigo-400" />
          </div>
          <motion.div
            animate={{ scale: [1, 1.2, 1] }}
            transition={{ repeat: Infinity, duration: 2.5, ease: 'easeInOut' }}
            className="absolute inset-0 rounded-full border border-indigo-500/20"
          />
        </motion.div>

        <div className="space-y-1">
          <h1 className="text-white font-mono font-black text-lg uppercase tracking-widest">
            FOMOCLIX
          </h1>
          <p className="text-indigo-400 text-[10px] font-mono uppercase tracking-wider">
            Multi-Chain AI Trading OS
          </p>
        </div>

        <p className="text-gray-500 text-[10px] font-mono leading-relaxed max-w-[240px] text-center">
          Automated sniping on Zora, Base & Solana.<br />
          AI-driven. Non-custodial. Production-grade.
        </p>
      </div>

      {/* Feature pills */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { icon: Shield, label: 'Non-Custodial', color: 'text-emerald-400', bg: 'bg-emerald-500/8 border-emerald-500/20' },
          { icon: Zap, label: 'AI-Powered', color: 'text-indigo-400', bg: 'bg-indigo-500/8 border-indigo-500/20' },
          { icon: TrendingUp, label: 'Live Sniping', color: 'text-amber-400', bg: 'bg-amber-500/8 border-amber-500/20' },
        ].map(({ icon: Icon, label, color, bg }) => (
          <div key={label} className={`flex flex-col items-center gap-1.5 p-2.5 rounded border ${bg}`}>
            <Icon className={`w-3.5 h-3.5 ${color}`} />
            <span className={`text-[8px] font-mono uppercase font-bold ${color}`}>{label}</span>
          </div>
        ))}
      </div>

      <button
        onClick={onContinue}
        className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-mono font-black uppercase tracking-wider rounded border border-indigo-500 transition-all duration-150 cursor-pointer flex items-center justify-center gap-2"
      >
        <Zap className="w-4 h-4" />
        GET STARTED
      </button>

      <p className="text-center text-[8px] text-gray-600 font-mono leading-relaxed">
        By continuing you agree to our Terms of Service<br />and acknowledge the risks of automated trading.
      </p>
    </div>
  );
};
