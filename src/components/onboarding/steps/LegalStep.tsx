import React, { useState, useRef } from 'react';
import { FileText, CheckSquare, ChevronDown, AlertCircle } from 'lucide-react';
import { onboardingApi } from '../../../services/api';
import { TermsContent } from '../legal/TermsContent';
import { PrivacyContent } from '../legal/PrivacyContent';
import { RiskContent } from '../legal/RiskContent';

type LegalType = 'terms' | 'privacy' | 'risk';

interface LegalStepProps {
  type: LegalType;
  title: string;
  stepLabel: string;
  onAccept: () => void;
}

export const LegalStep: React.FC<LegalStepProps> = ({ type, title, stepLabel, onAccept }) => {
  const [checked, setChecked] = useState(false);
  const [scrolledToBottom, setScrolledToBottom] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    if (atBottom) setScrolledToBottom(true);
  };

  const scrollToBottom = () => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  };

  const handleAccept = async () => {
    if (!checked) return;
    setAccepting(true);
    setError(null);
    try {
      // On the risk (last) step, record all three acceptances
      if (type === 'risk') {
        await onboardingApi.acceptTerms(true, true, true);
      }
      onAccept();
    } catch (err: any) {
      setError(err?.message || 'Failed to record acceptance. Please try again.');
    } finally {
      setAccepting(false);
    }
  };

  const isAcceptable = checked && scrolledToBottom;

  const checkboxLabel = {
    terms: 'I have read and agree to the Terms of Service',
    privacy: 'I have read and agree to the Privacy Policy',
    risk: 'I have read and understand the Risk Disclosure and AML Notice',
  }[type];

  return (
    <div className="bg-[#0E1118] border border-[#1C1F26] rounded-lg shadow-2xl flex flex-col" style={{ maxHeight: '85vh' }}>
      {/* Header */}
      <div className="flex items-center gap-3 p-4 border-b border-[#1C1F26] shrink-0">
        <div className="p-2 bg-indigo-500/10 rounded border border-indigo-500/20">
          <FileText className="w-4 h-4 text-indigo-400" />
        </div>
        <div>
          <h2 className="text-white font-mono font-bold text-xs uppercase tracking-wider">{title}</h2>
          <p className="text-gray-600 text-[8px] font-mono mt-0.5">Step {stepLabel} — Scroll to bottom to accept</p>
        </div>
      </div>

      {/* Scroll area */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-4 text-[9px] text-gray-400 font-mono leading-relaxed space-y-3 min-h-0"
        style={{ maxHeight: '50vh' }}
      >
        {type === 'terms' && <TermsContent />}
        {type === 'privacy' && <PrivacyContent />}
        {type === 'risk' && <RiskContent />}
      </div>

      {/* Scroll hint */}
      {!scrolledToBottom && (
        <button
          onClick={scrollToBottom}
          className="mx-4 mb-2 flex items-center justify-center gap-1.5 text-[8px] font-mono text-indigo-400 hover:text-indigo-300 transition-colors cursor-pointer py-1"
        >
          <ChevronDown className="w-3 h-3 animate-bounce" />
          SCROLL TO CONTINUE
        </button>
      )}

      {/* Acceptance area */}
      <div className="p-4 border-t border-[#1C1F26] space-y-3 shrink-0">
        {error && (
          <div className="flex items-center gap-2 p-2 bg-rose-500/8 border border-rose-500/20 rounded">
            <AlertCircle className="w-3 h-3 text-rose-400 shrink-0" />
            <p className="text-[8px] font-mono text-rose-400">{error}</p>
          </div>
        )}

        <label className={`flex items-start gap-2.5 cursor-pointer ${!scrolledToBottom ? 'opacity-40 pointer-events-none' : ''}`}>
          <div
            onClick={() => scrolledToBottom && setChecked(c => !c)}
            className={`w-4 h-4 rounded border shrink-0 mt-0.5 flex items-center justify-center transition-all ${
              checked ? 'bg-indigo-600 border-indigo-500' : 'bg-transparent border-gray-600 hover:border-indigo-500'
            }`}
          >
            {checked && <CheckSquare className="w-3 h-3 text-white" />}
          </div>
          <span className="text-[9px] font-mono text-gray-400 leading-relaxed">{checkboxLabel}</span>
        </label>

        <button
          onClick={handleAccept}
          disabled={!isAcceptable || accepting}
          className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-900 disabled:opacity-50 text-white text-[10px] font-mono font-bold uppercase tracking-wider rounded border border-indigo-500 cursor-pointer disabled:cursor-not-allowed transition-all"
        >
          {accepting ? 'RECORDING...' : 'I ACCEPT — CONTINUE'}
        </button>
      </div>
    </div>
  );
};
