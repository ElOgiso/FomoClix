import React from 'react';
import { ActivityLog, ActivityFeedEvent } from '../../types';
import { Terminal, Copy, ExternalLink } from 'lucide-react';

interface TerminalOutputProps {
  logs: ActivityLog[];
  activityEvents: ActivityFeedEvent[];
  onClearLogs: () => void;
  onExportLogs: () => void;
  triggerToast: (msg: string, type: 'success' | 'info' | 'error' | 'warning') => void;
}

export const TerminalOutput: React.FC<TerminalOutputProps> = ({
  activityEvents,
  onClearLogs,
  onExportLogs,
  triggerToast
}) => {
  const getTypeStyles = (type: string) => {
    switch (type) {
      case 'BUY_SUCCESS':
        return { bg: 'bg-emerald-950/40', text: 'text-emerald-400', border: 'border-emerald-900/40', label: 'BUY SUCCESS' };
      case 'BUY_FAIL':
        return { bg: 'bg-rose-950/40', text: 'text-rose-400', border: 'border-rose-900/40', label: 'BUY FAIL' };
      case 'SOCIAL_AUDIT':
        return { bg: 'bg-indigo-950/40', text: 'text-indigo-400', border: 'border-indigo-900/40', label: 'SOCIAL AUDIT' };
      case 'COIN_STATS_CHECK':
        return { bg: 'bg-cyan-950/40', text: 'text-cyan-400', border: 'border-cyan-900/40', label: 'STATS CHECK' };
      case 'MOMENTUM_UPDATE':
        return { bg: 'bg-amber-950/40', text: 'text-amber-400', border: 'border-amber-900/40', label: 'MOMENTUM UP' };
      case 'SNIPER_METRICS':
        return { bg: 'bg-blue-950/40', text: 'text-blue-400', border: 'border-blue-900/40', label: 'SNIPER STATS' };
      case 'CONTENT_COIN_V4':
        return { bg: 'bg-purple-950/40', text: 'text-purple-400', border: 'border-purple-900/40', label: 'CONTENT COIN' };
      case 'CREATOR_COIN_PROFILE':
        return { bg: 'bg-teal-950/40', text: 'text-teal-400', border: 'border-teal-900/40', label: 'CREATOR COIN' };
      default:
        return { bg: 'bg-gray-950/40', text: 'text-gray-400', border: 'border-gray-900/40', label: type };
    }
  };

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    triggerToast(`Copied ${label}: ${text}`, 'success');
  };

  return (
    <div id="tab-logs-workspace" className="p-4 lg:p-6 flex-1 flex flex-col min-h-0 space-y-4">
      {/* HEADER SECTION */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b border-[#1C1F26] pb-4">
        <div>
          <h2 className="text-lg lg:text-xl font-bold font-mono text-white tracking-tight uppercase flex items-center gap-2">
            <Terminal className="w-5 h-5 text-teal-400" />
            System Audit & Execution Logs
          </h2>
          <p className="text-xs text-gray-400 font-mono">
            Track real-time blockchain scans, filters, and transaction execution logs.
          </p>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <button
            onClick={onClearLogs}
            className="flex-1 sm:flex-none px-3 py-2 text-xs font-mono font-bold uppercase rounded border bg-transparent border-gray-900 text-gray-600 hover:text-gray-400 hover:border-gray-700 transition-all cursor-pointer"
          >
            CLEAR_BUFFER
          </button>
          <button
            onClick={onExportLogs}
            className="flex-1 sm:flex-none px-4 py-2 text-xs font-mono font-bold uppercase rounded bg-teal-600 hover:bg-teal-500 text-white shadow transition-all flex items-center justify-center gap-1.5 cursor-pointer"
          >
            EXPORT_LOGS
          </button>
        </div>
      </div>

      {/* RICH ACTIVITY EVENTS FEED */}
      <div className="flex-1 overflow-y-auto space-y-2 border border-[#1C1F26] bg-black/40 rounded p-4.5 font-mono text-[11px] leading-relaxed">
        {activityEvents.length === 0 ? (
          <div className="text-gray-600 italic py-10 text-center uppercase tracking-wider">
            No events registered in buffer. Awaiting incoming transactions...
          </div>
        ) : (
          activityEvents.map((ev) => {
            const styles = getTypeStyles(ev.type);
            return (
              <div
                key={ev.id}
                className={`p-3 rounded border ${styles.bg} ${styles.border} flex flex-col md:flex-row md:items-center justify-between gap-3`}
              >
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-gray-500 text-[10px]">
                      {new Date(ev.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border border-current ${styles.text}`}>
                      {styles.label}
                    </span>
                    {ev.coinSymbol && (
                      <span className="text-white font-bold">
                        {ev.coinName} ({ev.coinSymbol})
                      </span>
                    )}
                  </div>

                  <div className="text-gray-400 leading-normal">
                    {ev.errorReason ? (
                      <span className="text-rose-400">{ev.errorReason}</span>
                    ) : ev.statusResult ? (
                      <span>{ev.statusResult}</span>
                    ) : (
                      <span className="text-gray-500">Event successfully logged to database.</span>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-3 text-[10px] text-gray-500">
                    {ev.tokenAddress && (
                      <div className="flex items-center gap-1">
                        <span>TOKEN:</span>
                        <code className="text-gray-400 bg-black/40 px-1 py-0.2 rounded select-all font-mono">
                          {ev.tokenAddress.substring(0, 6)}...{ev.tokenAddress.substring(ev.tokenAddress.length - 4)}
                        </code>
                        <button
                          onClick={() => handleCopy(ev.tokenAddress || '', 'Token Address')}
                          className="hover:text-white cursor-pointer"
                        >
                          <Copy className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                    {ev.creatorAddress && (
                      <div className="flex items-center gap-1">
                        <span>CREATOR:</span>
                        <code className="text-gray-400 bg-black/40 px-1 py-0.2 rounded select-all font-mono">
                          {ev.creatorAddress.substring(0, 6)}...{ev.creatorAddress.substring(ev.creatorAddress.length - 4)}
                        </code>
                        <button
                          onClick={() => handleCopy(ev.creatorAddress || '', 'Creator Address')}
                          className="hover:text-white cursor-pointer"
                        >
                          <Copy className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                    {ev.txHash && (
                      <a
                        href={`https://basescan.org/tx/${ev.txHash}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-400 hover:text-blue-300 flex items-center gap-0.5"
                      >
                        VIEW TX
                        <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-4 shrink-0 font-mono">
                  {ev.marketCap !== undefined && ev.marketCap > 0 && (
                    <div className="text-right">
                      <span className="text-[9px] text-gray-500 block uppercase">MARKET_CAP</span>
                      <span className="text-white font-bold text-xs">${ev.marketCap.toLocaleString()}</span>
                    </div>
                  )}
                  {ev.riskScore !== undefined && ev.riskScore > 0 && (
                    <div className="text-right">
                      <span className="text-[9px] text-gray-500 block uppercase">RISK_SCORE</span>
                      <span
                        className={`font-bold text-xs ${
                          ev.riskScore > 50 ? 'text-rose-400' : ev.riskScore > 20 ? 'text-amber-400' : 'text-emerald-400'
                        }`}
                      >
                        {ev.riskScore}/100
                      </span>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
