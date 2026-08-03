/**
 * FOMOCLIX Onboarding Flow
 * Multi-step onboarding state machine.
 * Renders in place of the login card. Dashboard is entered only on completion.
 * Matches existing FOMOCLIX design system exactly.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import type { OnboardingStatus } from '../../types';
import { onboardingApi, authApi } from '../../services/api';
import { RefreshCw } from 'lucide-react';

// Step components
import { LegalStep } from './steps/LegalStep';
import { CreateTradingWalletStep } from './steps/CreateTradingWalletStep';
import { BackupPhraseStep } from './steps/BackupPhraseStep';
import { FundWalletStep } from './steps/FundWalletStep';
import { ChoosePlanStep } from './steps/ChoosePlanStep';
import { OnboardingCompleteStep } from './steps/OnboardingCompleteStep';

export type OnboardingStep =
  | 'landing'
  | 'plans'
  | 'about'
  | 'splash'
  | 'connect'
  | 'terms'
  | 'privacy'
  | 'risk'
  | 'create-wallet'
  | 'backup-phrase'
  | 'fund-wallet'
  | 'choose-plan'
  | 'complete';

interface OnboardingFlowProps {
  token: string;
  onComplete: (token: string, role: string) => void;
  onLogout: () => void;
}

export const OnboardingFlow: React.FC<OnboardingFlowProps> = ({ token, onComplete, onLogout }) => {
  const [step, setStep] = useState<OnboardingStep>('terms');
  const [role, setRole] = useState<string>('user');
  const [walletAddress, setWalletAddress] = useState<string>('');
  const [mnemonic, setMnemonic] = useState<string | null>(null);
  const [tradingWalletAddress, setTradingWalletAddress] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // On mount, check if there's an existing token and resume onboarding
  useEffect(() => {
    if (token) {
      resumeOnboardingState(token);
    }
  }, [token]);

  const resumeOnboardingState = async (jwt: string) => {
    setLoading(true);
    try {
      const status: OnboardingStatus = await onboardingApi.getStatus();
      const storedWallet = localStorage.getItem('fomoclix_wallet_address') || '';
      setWalletAddress(storedWallet);
      setRole(status.role || 'user');

      if (status.role === 'admin' || status.onboardingComplete) {
        // Admin or already completed → go straight to dashboard
        onComplete(jwt, status.role);
        return;
      }

      if (status.tradingWalletAddress) {
        setTradingWalletAddress(status.tradingWalletAddress);
      }

      // Resume at correct step
      if (!status.termsAccepted) { setStep('terms'); return; }
      if (!status.hasTradingWallet) { setStep('create-wallet'); return; }
      if (!status.backupConfirmed) { setStep('backup-phrase'); return; }
      if (!status.plan) { setStep('fund-wallet'); return; }
      if (!status.subscriptionActive) { setStep('choose-plan'); return; }
      setStep('complete');
    } catch (err) {
      console.error('[OnboardingFlow Session Error]', err);
      onLogout();
    } finally {
      setLoading(false);
    }
  };

  const handleTermsAccepted = useCallback(() => setStep('privacy'), []);
  const handlePrivacyAccepted = useCallback(() => setStep('risk'), []);
  const handleRiskAccepted = useCallback(() => setStep('create-wallet'), []);

  const handleWalletCreated = useCallback((address: string, phrase: string | null) => {
    setTradingWalletAddress(address);
    setMnemonic(phrase);
    setStep('backup-phrase');
  }, []);

  const handleBackupConfirmed = useCallback(() => {
    setMnemonic(null); // Clear from memory
    setStep('fund-wallet');
  }, []);

  const handleFundingSkippedOrComplete = useCallback(() => setStep('choose-plan'), []);

  const handlePlanChosen = useCallback((plan: string) => {
    if (plan === 'complete') {
      setStep('complete');
    }
  }, []);

  const handleEnterDashboard = useCallback(() => {
    if (token) onComplete(token, role);
  }, [token, role, onComplete]);

  const stepVariants = {
    initial: { opacity: 0, y: 16 },
    animate: { opacity: 1, y: 0, transition: { duration: 0.3, ease: 'easeOut' } },
    exit: { opacity: 0, y: -12, transition: { duration: 0.2 } },
  };

  const isLandingScreen = step === 'landing' || step === 'plans' || step === 'about';

  if (loading) {
    return (
      <div className="fixed inset-0 bg-[#07080A] flex flex-col items-center justify-center font-mono text-xs text-gray-500 z-50">
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[300px] h-[300px] rounded-full bg-indigo-600/5 blur-3xl animate-pulse" />
        </div>
        <RefreshCw className="w-4 h-4 text-indigo-500 animate-spin mb-3" />
        <span className="tracking-widest uppercase text-gray-400">Resuming Onboarding</span>
        <span className="text-[10px] text-gray-600 mt-1">FOMOCLIX AI OS</span>
      </div>
    );
  }

  return (
    <div className={`fixed inset-0 bg-[#07080A] z-50 font-mono select-none ${
      isLandingScreen ? 'overflow-y-auto' : 'flex flex-col items-center justify-center p-4 overflow-hidden'
    }`}>
      {!isLandingScreen && (
        /* Ambient glow */
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[600px] rounded-full bg-indigo-600/5 blur-3xl" />
          <div className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] rounded-full bg-violet-600/4 blur-3xl" />
        </div>
      )}

      <AnimatePresence mode="wait">
        {step === 'terms' && (
          <motion.div key="terms" variants={stepVariants} initial="initial" animate="animate" exit="exit" className="w-full max-w-lg">
            <LegalStep
              type="terms"
              title="Terms of Service"
              stepLabel="3 / 9"
              onAccept={handleTermsAccepted}
            />
          </motion.div>
        )}

        {step === 'privacy' && (
          <motion.div key="privacy" variants={stepVariants} initial="initial" animate="animate" exit="exit" className="w-full max-w-lg">
            <LegalStep
              type="privacy"
              title="Privacy Policy"
              stepLabel="4 / 9"
              onAccept={handlePrivacyAccepted}
            />
          </motion.div>
        )}

        {step === 'risk' && (
          <motion.div key="risk" variants={stepVariants} initial="initial" animate="animate" exit="exit" className="w-full max-w-lg">
            <LegalStep
              type="risk"
              title="Risk Disclosure & AML Notice"
              stepLabel="5 / 9"
              onAccept={handleRiskAccepted}
            />
          </motion.div>
        )}

        {step === 'create-wallet' && (
          <motion.div key="create-wallet" variants={stepVariants} initial="initial" animate="animate" exit="exit" className="w-full max-w-sm">
            <CreateTradingWalletStep stepLabel="6 / 9" onCreated={handleWalletCreated} />
          </motion.div>
        )}

        {step === 'backup-phrase' && mnemonic && (
          <motion.div key="backup-phrase" variants={stepVariants} initial="initial" animate="animate" exit="exit" className="w-full max-w-sm">
            <BackupPhraseStep
              stepLabel="7 / 9"
              mnemonic={mnemonic}
              walletAddress={tradingWalletAddress}
              onConfirmed={handleBackupConfirmed}
            />
          </motion.div>
        )}

        {step === 'fund-wallet' && (
          <motion.div key="fund-wallet" variants={stepVariants} initial="initial" animate="animate" exit="exit" className="w-full max-w-sm">
            <FundWalletStep
              stepLabel="8 / 9"
              walletAddress={tradingWalletAddress}
              onContinue={handleFundingSkippedOrComplete}
            />
          </motion.div>
        )}

        {step === 'choose-plan' && (
          <motion.div key="choose-plan" variants={stepVariants} initial="initial" animate="animate" exit="exit" className="w-full max-w-md">
            <ChoosePlanStep stepLabel="9 / 9" onPlanChosen={handlePlanChosen} />
          </motion.div>
        )}

        {step === 'complete' && (
          <motion.div key="complete" variants={stepVariants} initial="initial" animate="animate" exit="exit" className="w-full max-w-sm">
            <OnboardingCompleteStep walletAddress={tradingWalletAddress} onEnterDashboard={handleEnterDashboard} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
