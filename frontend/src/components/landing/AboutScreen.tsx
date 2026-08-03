import React, { useState, useEffect } from 'react';
import { ArrowLeft, ArrowRight, User, Globe, BarChart2, ShieldAlert, Cpu, HelpCircle, RefreshCw } from 'lucide-react';
import { botApi } from '../../services/api';

interface AboutScreenProps {
  onNext: () => void;
  onBack: () => void;
}

interface BetaStats {
  totalProfit: string;
  winRate: number;
  totalTrades24h: number;
}

export const AboutScreen: React.FC<AboutScreenProps> = ({ onNext, onBack }) => {
  const [stats, setStats] = useState<BetaStats | null>(null);
  const [loadingStats, setLoadingStats] = useState(true);
  const [statsError, setStatsError] = useState(false);

  useEffect(() => {
    let active = true;
    botApi.getPerformanceSummary()
      .then(res => {
        if (active) {
          setStats(res);
          setLoadingStats(false);
        }
      })
      .catch(() => {
        if (active) {
          setStatsError(true);
          setLoadingStats(false);
        }
      });
    return () => { active = false; };
  }, []);

  return (
    <div className="w-full min-h-screen bg-[#07080A] text-[#D1D5DB] font-mono flex flex-col items-center relative overflow-y-auto px-4 py-8 select-none">
      {/* Background ambient glow */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden z-0">
        <div className="absolute top-1/4 left-10 w-[500px] h-[500px] rounded-full bg-indigo-500/3 blur-3xl" />
        <div className="absolute bottom-10 right-10 w-[450px] h-[450px] rounded-full bg-violet-600/3 blur-3xl" />
      </div>

      <div className="w-full max-w-4xl z-10 flex flex-col items-center space-y-12">
        {/* Header */}
        <header className="w-full flex items-center justify-between border-b border-[#1C1F26] pb-4 shrink-0">
          <button 
            onClick={onBack}
            className="flex items-center gap-1.5 text-[10px] text-gray-500 hover:text-white cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>[BACK_TO_PLANS]</span>
          </button>
          <span className="font-bold text-sm tracking-tight text-white font-mono uppercase">FOMOCLIX_DOCS</span>
        </header>

        {/* Title */}
        <section className="text-center space-y-3 max-w-xl">
          <h1 className="text-xl md:text-2xl text-white font-sans font-black uppercase tracking-wider">
            Origins &amp; Beta Audit
          </h1>
          <p className="text-xs text-gray-400 leading-relaxed font-mono">
            Verified founder details, platform performance audit, and risk boundaries.
          </p>
        </section>

        {/* 2-Column Main Info */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full max-w-3xl">
          {/* Column 1: Founder and Mission */}
          <div className="border border-[#1C1F26] bg-[#0E1118]/80 p-5 rounded-lg space-y-4 shadow-xl">
            <h2 className="text-white text-xs uppercase tracking-wider font-bold flex items-center gap-2 border-b border-[#1C1F26] pb-2">
              <User className="w-4 h-4 text-indigo-400" />
              Founder &amp; Labs
            </h2>
            <div className="space-y-3 font-mono text-[9px] text-gray-400 leading-relaxed">
              <p>
                FOMOCLIX AI was built and provisioned by <span className="text-white font-bold">ElOgiso Labs</span>.
              </p>
              <p>
                The founder is <span className="text-white font-bold">Maurice Otabor</span>, a veteran Nigerian creator, developer, and builder with over 10 years of hands-on experience across the art, tech, and cryptographic sectors.
              </p>
              <p>
                You can explore attributions, developer documentation, and core projects directly on the official portfolio site.
              </p>
              <div className="pt-2">
                <a
                  href="https://www.elogiso.art"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-black/40 border border-gray-900 hover:border-indigo-500 rounded text-indigo-400 hover:text-indigo-300 font-bold transition-all text-[8px]"
                >
                  <Globe className="w-3.5 h-3.5" />
                  <span>ELOGISO.ART ↗</span>
                </a>
              </div>
            </div>
          </div>

          {/* Column 2: Beta Audit Metrics */}
          <div className="border border-[#1C1F26] bg-[#0E1118]/80 p-5 rounded-lg space-y-4 shadow-xl flex flex-col justify-between">
            <div>
              <h2 className="text-white text-xs uppercase tracking-wider font-bold flex items-center gap-2 border-b border-[#1C1F26] pb-2">
                <BarChart2 className="w-4 h-4 text-emerald-400" />
                Live Beta Metrics
              </h2>
              
              {loadingStats ? (
                <div className="flex flex-col items-center justify-center py-8 space-y-2">
                  <RefreshCw className="w-5 h-5 text-gray-600 animate-spin" />
                  <span className="text-[8px] text-gray-600 font-mono uppercase">Querying firestore logs...</span>
                </div>
              ) : statsError || !stats ? (
                <div className="py-8 text-center text-[9px] text-rose-400 font-bold uppercase tracking-wider">
                  Beta metrics unavailable
                </div>
              ) : (
                <div className="space-y-3.5 pt-2">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-2.5 bg-black/20 border border-gray-950 rounded">
                      <span className="text-[7.5px] text-gray-600 block uppercase">WIN_RATE_STREAK</span>
                      <span className="text-base font-bold text-white block font-mono">{stats.winRate}%</span>
                    </div>
                    <div className="p-2.5 bg-black/20 border border-gray-950 rounded">
                      <span className="text-[7.5px] text-gray-600 block uppercase">TOTAL_TRADES</span>
                      <span className="text-base font-bold text-white block font-mono">{stats.totalTrades24h}</span>
                    </div>
                  </div>
                  <div className="p-2.5 bg-black/20 border border-gray-950 rounded">
                    <span className="text-[7.5px] text-gray-600 block uppercase">ACCUMULATED_PROFIT_24H</span>
                    <span className="text-sm font-bold text-emerald-400 block font-mono">+{Number(stats.totalProfit).toFixed(4)} ETH</span>
                  </div>
                </div>
              )}
            </div>
            <p className="text-[7.5px] text-gray-600 leading-normal uppercase tracking-wide mt-2">
              Metrics sync dynamically from closed SQLite/Firestore documents.
            </p>
          </div>
        </div>

        {/* Investment boundaries disclosure */}
        <section className="border border-amber-500/20 bg-amber-500/5 rounded-lg p-5 w-full max-w-3xl space-y-3">
          <h2 className="text-amber-400 text-xs font-bold uppercase tracking-wider flex items-center gap-1.5">
            <ShieldAlert className="w-4 h-4" />
            Configurable Investment Limits &amp; Disclosures
          </h2>
          <div className="text-[8.5px] font-mono text-gray-400 leading-relaxed space-y-2">
            <p>
              Automated smart contracts and liquidity parameters contain high volatility risks. To support traders of all sizes, the platform allows you to operate with very small balances. You can configure bot snipes starting from as little as <span className="text-white font-bold">$0.50</span>, <span className="text-white font-bold">$1.00</span>, or <span className="text-white font-bold">$5.00</span>, up to larger portfolios.
            </p>
            <p>
              This flexibility is made possible by the highly configurable slippage limits, gas multipliers, and stop-loss boundaries you define inside your strategy profile. Performance depends entirely on market liquidity and user configuration.
            </p>
            <p className="text-amber-500/80 font-bold uppercase">
              ⚠ WARNING: PAST BETA PERFORMANCE IS NOT AN INDICATOR OF FUTURE OUTCOMES. DIGITAL ASSETS MAY LOSE VALUE PERMANENTLY.
            </p>
          </div>
        </section>

        {/* CTA */}
        <div className="flex flex-col items-center gap-3 w-full">
          <button
            onClick={onNext}
            className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 border border-indigo-500 text-white text-xs font-bold uppercase tracking-widest rounded transition-all cursor-pointer flex items-center gap-2 group shadow-lg shadow-indigo-900/30"
          >
            <span>PROCEED TO AUTHENTICATION</span>
            <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
          </button>
          <span className="text-[7.5px] text-gray-600 uppercase tracking-widest">
            Ownership connection verifies via cryptographically signed challenge
          </span>
        </div>

        {/* Footer */}
        <footer className="w-full border-t border-[#1C1F26] pt-4 text-center text-[7px] text-gray-700 font-mono tracking-widest uppercase">
          OPERATED BY ELOGISO LABS. ATTRIBUTIONS AND GENERAL DOCUMENTATION REGISTERED AT ELOGISO.ART.
        </footer>
      </div>
    </div>
  );
};
