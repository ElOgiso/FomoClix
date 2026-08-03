import React, { useState } from 'react';
import { DollarSign, Zap, AlertCircle, RefreshCw, Check } from 'lucide-react';
import { onboardingApi, subscriptionApi } from '../../../services/api';

interface ChoosePlanStepProps {
  stepLabel: string;
  onPlanChosen: (plan: string) => void;
}

export const ChoosePlanStep: React.FC<ChoosePlanStepProps> = ({ stepLabel, onPlanChosen }) => {
  const [selected, setSelected] = useState<'payg' | 'weekly' | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleActivate = async () => {
    if (!selected) return;
    setLoading(true);
    setError(null);
    try {
      if (selected === 'payg') {
        await onboardingApi.choosePlan('payg');
        await onboardingApi.complete();
        onPlanChosen('complete');
      } else {
        // Weekly — tell backend plan is chosen, then activate (charges wallet)
        await onboardingApi.choosePlan('weekly');
        const result = await subscriptionApi.activateWeekly();
        if (!result.success) throw new Error('Weekly activation failed. Check your trading wallet balance.');
        await onboardingApi.complete();
        onPlanChosen('complete');
      }
    } catch (err: any) {
      setError(err?.message || 'Plan activation failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const plans = [
    {
      id: 'payg' as const,
      name: 'Pay As You Go',
      tag: 'FREE TO START',
      tagColor: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
      price: '20%',
      priceSub: 'of net profit only',
      color: 'indigo',
      selectedBg: 'bg-indigo-950/30 border-indigo-500',
      defaultBg: 'bg-[#07080A] border-[#1C1F26] hover:border-indigo-700/50',
      accentColor: 'text-indigo-400',
      features: [
        'No weekly fees',
        '20% commission on profitable trades',
        'Losses cost you nothing',
        'Bot active immediately',
        'All AI features included',
      ],
    },
    {
      id: 'weekly' as const,
      name: 'Weekly Plan',
      tag: 'BEST FOR HIGH VOLUME',
      tagColor: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
      price: '$29',
      priceSub: 'per week',
      color: 'amber',
      selectedBg: 'bg-amber-950/20 border-amber-500',
      defaultBg: 'bg-[#07080A] border-[#1C1F26] hover:border-amber-700/50',
      accentColor: 'text-amber-400',
      features: [
        'Flat weekly rate',
        'Keep 100% of profits',
        'Auto-renews from trading wallet',
        'Downgrades to PAYG if balance low',
        'All AI features included',
      ],
    },
  ];

  return (
    <div className="bg-[#0E1118] border border-[#1C1F26] rounded-lg shadow-2xl p-6 space-y-5">
      {/* Header */}
      <div className="flex flex-col items-center text-center space-y-2">
        <div className="p-3 bg-indigo-500/10 rounded-full border border-indigo-500/20">
          <DollarSign className="w-6 h-6 text-indigo-400" />
        </div>
        <div>
          <h2 className="text-white font-mono font-bold text-sm uppercase tracking-wider">Choose Your Plan</h2>
          <p className="text-gray-600 text-[8px] font-mono mt-0.5">Step {stepLabel} — Select how you pay for trading</p>
        </div>
      </div>

      {/* Plan cards */}
      <div className="space-y-3">
        {plans.map(plan => (
          <button
            key={plan.id}
            onClick={() => setSelected(plan.id)}
            className={`w-full p-4 rounded border text-left transition-all cursor-pointer ${
              selected === plan.id ? plan.selectedBg : plan.defaultBg
            }`}
          >
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-white font-mono font-bold text-xs uppercase">{plan.name}</span>
                  {selected === plan.id && (
                    <div className="w-4 h-4 rounded-full bg-indigo-600 flex items-center justify-center shrink-0">
                      <Check className="w-2.5 h-2.5 text-white" />
                    </div>
                  )}
                </div>
                <span className={`text-[7px] font-mono font-bold uppercase px-1.5 py-0.5 rounded border ${plan.tagColor}`}>
                  {plan.tag}
                </span>
              </div>
              <div className="text-right">
                <p className={`text-xl font-mono font-black ${plan.accentColor}`}>{plan.price}</p>
                <p className="text-[7px] font-mono text-gray-600">{plan.priceSub}</p>
              </div>
            </div>

            <ul className="space-y-1">
              {plan.features.map(feature => (
                <li key={feature} className="flex items-center gap-1.5 text-[8px] font-mono text-gray-400">
                  <Zap className={`w-2.5 h-2.5 shrink-0 ${plan.accentColor}`} />
                  {feature}
                </li>
              ))}
            </ul>
          </button>
        ))}
      </div>

      {/* Weekly note */}
      {selected === 'weekly' && (
        <div className="p-3 bg-amber-500/5 border border-amber-500/20 rounded text-[8px] font-mono text-amber-400/80 leading-relaxed">
          ⚡ $29 will be deducted from your trading wallet immediately. Auto-renews every 7 days. 
          If balance is insufficient, account is downgraded to Pay As You Go automatically.
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 p-3 bg-rose-500/8 border border-rose-500/20 rounded">
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
          <p className="text-[9px] font-mono text-rose-400 leading-relaxed">{error}</p>
        </div>
      )}

      <button
        onClick={handleActivate}
        disabled={!selected || loading}
        className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-900 disabled:opacity-50 text-white text-xs font-mono font-bold uppercase tracking-wider rounded border border-indigo-500 cursor-pointer disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
      >
        {loading ? (
          <>
            <RefreshCw className="w-4 h-4 animate-spin" />
            <span>ACTIVATING PLAN...</span>
          </>
        ) : (
          <>
            <DollarSign className="w-4 h-4" />
            <span>{selected ? `ACTIVATE ${selected === 'payg' ? 'PAY AS YOU GO' : 'WEEKLY PLAN'}` : 'SELECT A PLAN'}</span>
          </>
        )}
      </button>

      <p className="text-center text-[7px] font-mono text-gray-700">
        You can switch plans anytime from the dashboard settings.
      </p>
    </div>
  );
};
