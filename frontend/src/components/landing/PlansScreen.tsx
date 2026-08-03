import React, { useState } from 'react';
import { Shield, Zap, DollarSign, ArrowRight, ArrowLeft } from 'lucide-react';
import { motion } from 'motion/react';

interface PlansScreenProps {
  onNext: () => void;
  onBack: () => void;
}

export const PlansScreen: React.FC<PlansScreenProps> = ({ onNext, onBack }) => {
  const [selectedPlan, setSelectedPlan] = useState<'payg' | 'weekly' | null>(null);

  const plans = [
    {
      id: 'payg' as const,
      name: 'Pay As You Go',
      desc: 'Ideal for beginners and small portfolios testing automated strategy parameters.',
      tag: 'FREE TO START',
      tagColor: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
      price: '20%',
      priceSub: 'of net profitable trades',
      color: 'indigo',
      selectedBg: 'bg-indigo-950/30 border-indigo-500',
      defaultBg: 'bg-[#0E1118]/60 border-[#1C1F26] hover:border-indigo-700/50',
      accentColor: 'text-indigo-400',
      features: [
        'No weekly or registration fees',
        '20% commission on profitable trades',
        'Losses cost you nothing',
        'AI Assistant fully enabled',
        'Zora, Base, and Solana active scanner',
        'Configurable anti-rekt protection limits',
      ],
    },
    {
      id: 'weekly' as const,
      name: 'Weekly Flat Plan',
      desc: 'Built for high volume traders executing multiple daily creator snipes.',
      tag: 'BEST FOR VOLUME',
      tagColor: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
      price: '$29',
      priceSub: 'per week (billed in ETH)',
      color: 'amber',
      selectedBg: 'bg-amber-950/20 border-amber-500',
      defaultBg: 'bg-[#0E1118]/60 border-[#1C1F26] hover:border-amber-700/50',
      accentColor: 'text-amber-400',
      features: [
        'Flat weekly rate',
        'Keep 100% of generated trading profits',
        'Billed in ETH from local trading wallet',
        'Auto-downgrades to PAYG if balance is low',
        'Unlimited AI Orchestrator operations',
        'Priority execution queue support',
      ],
    },
  ];

  return (
    <div className="w-full min-h-screen bg-[#07080A] text-[#D1D5DB] font-mono flex flex-col items-center relative overflow-y-auto px-4 py-8 select-none">
      {/* Background glow */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden z-0">
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[700px] h-[700px] rounded-full bg-indigo-500/4 blur-3xl" />
        <div className="absolute bottom-10 left-10 w-[400px] h-[400px] rounded-full bg-violet-600/3 blur-3xl" />
      </div>

      <div className="w-full max-w-4xl z-10 flex flex-col items-center space-y-12">
        {/* Header */}
        <header className="w-full flex items-center justify-between border-b border-[#1C1F26] pb-4 shrink-0">
          <button 
            onClick={onBack}
            className="flex items-center gap-1.5 text-[10px] text-gray-500 hover:text-white cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>[BACK_TO_HOME]</span>
          </button>
          <span className="font-bold text-sm tracking-tight text-white font-mono uppercase">FOMOCLIX_PLANS</span>
        </header>

        {/* Title */}
        <section className="text-center space-y-3 max-w-xl">
          <h1 className="text-xl md:text-2xl text-white font-sans font-black uppercase tracking-wider">
            Operational Plan Structure
          </h1>
          <p className="text-xs text-gray-400 leading-relaxed font-mono">
            FomoClix pricing models align directly with your trading metrics. Select a configuration model below to proceed to origin documentation.
          </p>
        </section>

        {/* Plan Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full max-w-3xl">
          {plans.map(plan => (
            <button
              key={plan.id}
              onClick={() => setSelectedPlan(plan.id)}
              className={`w-full p-5 rounded border text-left transition-all cursor-pointer flex flex-col justify-between min-h-[360px] ${
                selectedPlan === plan.id ? plan.selectedBg : plan.defaultBg
              }`}
            >
              <div className="space-y-4 w-full">
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="text-white font-mono font-bold text-xs uppercase mb-1">{plan.name}</h2>
                    <span className={`text-[7px] font-mono font-bold uppercase px-1.5 py-0.5 rounded border ${plan.tagColor}`}>
                      {plan.tag}
                    </span>
                  </div>
                  <div className="text-right">
                    <p className={`text-xl font-mono font-black ${plan.accentColor}`}>{plan.price}</p>
                    <span className="text-[7px] text-gray-600 block">{plan.priceSub}</span>
                  </div>
                </div>

                <p className="text-[8.5px] text-gray-500 leading-relaxed font-mono">{plan.desc}</p>
                <div className="border-t border-[#1C1F26]/60 pt-3 space-y-2">
                  <span className="text-[7.5px] text-gray-600 uppercase font-bold tracking-wider">FEATURES UNLOCKED:</span>
                  <ul className="space-y-1.5">
                    {plan.features.map((feature, i) => (
                      <li key={i} className="flex items-start gap-1.5 text-[8px] font-mono text-gray-400 leading-relaxed">
                        <Zap className={`w-2.5 h-2.5 shrink-0 mt-0.5 ${plan.accentColor}`} />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {selectedPlan === plan.id && (
                <div className="w-full pt-4 mt-auto border-t border-indigo-500/10 flex items-center justify-between text-indigo-400 text-[8px] font-bold uppercase tracking-wider animate-pulse">
                  <span>Selected Model</span>
                  <Shield className="w-3.5 h-3.5" />
                </div>
              )}
            </button>
          ))}
        </div>

        {/* CTA */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex flex-col items-center gap-3 w-full"
        >
          <button
            onClick={onNext}
            className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 border border-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-bold uppercase tracking-widest rounded transition-all cursor-pointer flex items-center gap-2 group shadow-lg"
          >
            <span>CONTINUE TO ABOUT</span>
            <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
          </button>
          <span className="text-[7px] text-gray-600 uppercase tracking-widest">
            You will confirm plan settings inside the secure dashboard environment
          </span>
        </motion.div>

        {/* Footer info */}
        <p className="text-center text-[7.5px] text-gray-600 leading-relaxed uppercase tracking-wider max-w-xl">
          Weekly subscription fees are billed in ETH from your locally generated trading wallet. PAYG fees are processed automatically at position closure. Active balances remain non-custodial.
        </p>
      </div>
    </div>
  );
};
