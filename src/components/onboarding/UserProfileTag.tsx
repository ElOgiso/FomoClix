import React from 'react';
import { Shield, Zap, Clock, DollarSign } from 'lucide-react';
import type { UserProfile } from '../../types';

interface UserProfileTagProps {
  profile: UserProfile | null;
}

export const UserProfileTag: React.FC<UserProfileTagProps> = ({ profile }) => {
  if (!profile) return null;

  const { role, profileTag, plan, subscriptionActive, weeklyRenewalDue } = profile;

  let daysLeft: number | null = null;
  if (weeklyRenewalDue) {
    daysLeft = Math.max(0, Math.ceil((weeklyRenewalDue - Date.now()) / (1000 * 60 * 60 * 24)));
  }

  const config: Record<string, { label: string; bg: string; border: string; text: string; icon: typeof Shield; dot: string }> = {
    admin: {
      label: 'Gold User',
      bg: 'bg-amber-500/8',
      border: 'border-amber-500/25',
      text: 'text-amber-400',
      icon: Shield,
      dot: 'bg-amber-500',
    },
    subscribed: {
      label: 'Subscribed',
      bg: 'bg-indigo-500/8',
      border: 'border-indigo-500/25',
      text: 'text-indigo-400',
      icon: Zap,
      dot: 'bg-emerald-500',
    },
    payg: {
      label: 'Pay As You Go',
      bg: 'bg-emerald-500/5',
      border: 'border-emerald-500/20',
      text: 'text-emerald-400',
      icon: DollarSign,
      dot: 'bg-emerald-500',
    },
    inactive: {
      label: 'No Plan',
      bg: 'bg-rose-500/5',
      border: 'border-rose-500/20',
      text: 'text-rose-400',
      icon: Shield,
      dot: 'bg-rose-500',
    },
  };

  const variant =
    role === 'admin' ? 'admin' :
    plan === 'weekly' && subscriptionActive ? 'subscribed' :
    plan === 'payg' && subscriptionActive ? 'payg' :
    'inactive';

  const { label, bg, border, text, icon: Icon, dot } = config[variant];
  const displayLabel = profileTag || label;

  return (
    <div className={`p-3 rounded border ${bg} ${border} space-y-2`}>
      {/* Title */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="text-[8px] font-mono text-gray-600 uppercase tracking-wider">Subscription</span>
        </div>
        <div className={`w-1.5 h-1.5 rounded-full ${dot} ${subscriptionActive || role === 'admin' ? 'animate-pulse' : ''}`} />
      </div>

      {/* Plan badge */}
      <div className="flex items-center gap-2">
        <div className={`p-1 rounded ${bg}`}>
          <Icon className={`w-3 h-3 ${text}`} />
        </div>
        <div>
          <p className={`text-[10px] font-mono font-bold uppercase ${text}`}>{displayLabel}</p>
          {plan === 'weekly' && daysLeft !== null && (
            <div className="flex items-center gap-1 mt-0.5">
              <Clock className="w-2.5 h-2.5 text-gray-600" />
              <span className="text-[7px] font-mono text-gray-600">
                {daysLeft === 0 ? 'Renews today' : `${daysLeft}d left`}
              </span>
            </div>
          )}
          {plan === 'payg' && (
            <p className="text-[7px] font-mono text-gray-600 mt-0.5">20% on profit</p>
          )}
          {role === 'admin' && (
            <p className="text-[7px] font-mono text-amber-500/60 mt-0.5">Admin access</p>
          )}
        </div>
      </div>
    </div>
  );
};
