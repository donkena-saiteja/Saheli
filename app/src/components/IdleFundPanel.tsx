import { useState } from 'react';
import {
  TrendingUp, Zap, Wallet, ArrowUpRight, RefreshCw,
  BarChart3, Sparkles, CheckCircle2, Loader2,
} from 'lucide-react';

interface VaultPosition {
  id: string;
  protocol: string;
  asset: string;
  deployed: number;
  apy: number;
  yieldAccrued: number;
  stakedAt: string;
  txHash: string;
  status: 'active' | 'withdrawing' | 'completed';
}

interface VaultData {
  positions: VaultPosition[];
  totalAUM: number;
  pendingYield: number;
  averageAPY: number;
  idleFunds: number;
  totalYieldHarvested: number;
}

interface IdleFundPanelProps {
  vaultData: VaultData | null;
  loading: boolean;
  onInvest: () => Promise<void>;
  onHarvest: () => Promise<void>;
  investing: boolean;
  harvesting: boolean;
}

const PROTOCOL_COLORS: Record<string, { gradient: string; dot: string }> = {
  'Folks Finance': { gradient: 'from-blue-500 to-blue-600', dot: '#60a5fa' },
  'Tinyman': { gradient: 'from-purple-500 to-purple-600', dot: '#a78bfa' },
  'Algofi': { gradient: 'from-emerald-500 to-emerald-600', dot: '#34d399' },
  'Pact': { gradient: 'from-orange-500 to-orange-600', dot: '#fb923c' },
};

function ApyBar({ apy, max = 10 }: { apy: number; max?: number }) {
  return (
    <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
      <div
        className="h-full rounded-full bg-gradient-to-r from-green-400 to-emerald-500 transition-all duration-1000"
        style={{ width: `${(apy / max) * 100}%` }}
      />
    </div>
  );
}

export default function IdleFundPanel({
  vaultData,
  loading,
  onInvest,
  onHarvest,
  investing,
  harvesting,
}: IdleFundPanelProps) {
  const [lastAction, setLastAction] = useState<string | null>(null);

  const handleInvest = async () => {
    await onInvest();
    setLastAction('Deployed idle funds to vault ✓');
    setTimeout(() => setLastAction(null), 4000);
  };

  const handleHarvest = async () => {
    await onHarvest();
    setLastAction('Yield harvested to treasury ✓');
    setTimeout(() => setLastAction(null), 4000);
  };

  const Sk = ({ w = 'w-24', h = 'h-4' }: { w?: string; h?: string }) => (
    <div className={`${w} ${h} bg-gray-100 animate-pulse rounded`} />
  );

  return (
    <div className="space-y-4">
      {/* Summary Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          {
            label: 'Total AUM',
            value: loading ? null : `₹${(vaultData?.totalAUM || 0).toLocaleString('en-IN')}`,
            icon: <BarChart3 className="w-4 h-4 text-blue-500" />,
            sub: 'Deployed in vaults',
          },
          {
            label: 'Pending Yield',
            value: loading ? null : `₹${(vaultData?.pendingYield || 0).toLocaleString('en-IN')}`,
            icon: <Sparkles className="w-4 h-4 text-yellow-500" />,
            sub: 'Ready to harvest',
          },
          {
            label: 'Avg APY',
            value: loading ? null : `${vaultData?.averageAPY || 0}%`,
            icon: <TrendingUp className="w-4 h-4 text-emerald-500" />,
            sub: 'Across all vaults',
          },
          {
            label: 'Idle Funds',
            value: loading ? null : `₹${(vaultData?.idleFunds || 0).toLocaleString('en-IN')}`,
            icon: <Wallet className="w-4 h-4 text-orange-500" />,
            sub: 'Awaiting deployment',
          },
        ].map(({ label, value, icon, sub }) => (
          <div key={label} className="bg-white rounded-2xl p-4 border border-gray-100">
            <div className="flex justify-between items-start mb-2">
              <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">{label}</span>
              {icon}
            </div>
            {value ? (
              <p className="text-xl font-black font-headline text-gray-900">{value}</p>
            ) : (
              <Sk w="w-20" h="h-7" />
            )}
            <p className="text-[10px] text-gray-400 mt-1">{sub}</p>
          </div>
        ))}
      </div>

      {/* Vault Positions */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-50">
          <h4 className="font-bold text-sm text-gray-800 flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-blue-500" />
            Active Vault Positions
          </h4>
          <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full">
            {loading ? '...' : `${(vaultData?.positions || []).filter(p => p.status === 'active').length} ACTIVE`}
          </span>
        </div>

        <div className="p-4 space-y-3">
          {loading ? (
            [1, 2, 3].map(i => (
              <div key={i} className="flex items-center gap-4 p-3 rounded-xl bg-gray-50">
                <Sk w="w-8" h="h-8" />
                <div className="flex-1 space-y-2">
                  <Sk w="w-32" h="h-3" />
                  <Sk w="w-48" h="h-2" />
                </div>
                <Sk w="w-16" h="h-4" />
              </div>
            ))
          ) : (
            (vaultData?.positions || []).map(pos => {
              const colorConfig = PROTOCOL_COLORS[pos.protocol] || PROTOCOL_COLORS['Pact'];
              return (
                <div
                  key={pos.id}
                  className="flex items-center gap-4 p-3 rounded-xl hover:bg-gray-50 transition-colors group"
                >
                  {/* Protocol dot */}
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: `${colorConfig.dot}20` }}>
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: colorConfig.dot }} />
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-bold text-gray-800">{pos.protocol}</span>
                      <span className="text-[9px] font-bold text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
                        {pos.asset}
                      </span>
                      {pos.status === 'active' && (
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse flex-shrink-0" />
                      )}
                    </div>
                    <ApyBar apy={pos.apy} />
                  </div>

                  {/* Values */}
                  <div className="text-right flex-shrink-0">
                    <p className="text-xs font-black text-gray-900">
                      ₹{pos.deployed.toLocaleString('en-IN')}
                    </p>
                    <p className="text-[10px] font-bold text-emerald-500 flex items-center justify-end gap-0.5">
                      <ArrowUpRight className="w-3 h-3" />
                      {pos.apy}% APY
                    </p>
                    {pos.yieldAccrued > 0 && (
                      <p className="text-[9px] text-yellow-600 font-bold">
                        +₹{pos.yieldAccrued.toLocaleString('en-IN')} accrued
                      </p>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-3">
        <button
          onClick={handleInvest}
          disabled={investing || loading || (vaultData?.idleFunds || 0) < 1000}
          className="flex-1 py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 text-white transition-all active:scale-95 disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg, #3b82f6, #2563eb)' }}
        >
          {investing ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> Deploying...</>
          ) : (
            <><Zap className="w-4 h-4" /> Deploy Idle Funds</>
          )}
        </button>

        <button
          onClick={handleHarvest}
          disabled={harvesting || loading || (vaultData?.pendingYield || 0) < 1}
          className="flex-1 py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 text-white transition-all active:scale-95 disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg, #10b981, #059669)' }}
        >
          {harvesting ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> Harvesting...</>
          ) : (
            <><Sparkles className="w-4 h-4" /> Harvest Yield</>
          )}
        </button>
      </div>

      {/* Status message */}
      {lastAction && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-emerald-700 bg-emerald-50 border border-emerald-100 animate-in fade-in slide-in-from-bottom-2 duration-300">
          <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
          {lastAction}
        </div>
      )}

      {/* Idle funds alert */}
      {!loading && (vaultData?.idleFunds || 0) > 50000 && (
        <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-orange-50 border border-orange-100">
          <RefreshCw className="w-4 h-4 text-orange-500 mt-0.5 flex-shrink-0 animate-spin" style={{ animationDuration: '3s' }} />
          <div>
            <p className="text-xs font-bold text-orange-700">
              AI Agent detected idle capital
            </p>
            <p className="text-[11px] text-orange-600 mt-0.5">
              ₹{(vaultData?.idleFunds || 0).toLocaleString('en-IN')} uninvested. Deploy to earn yield automatically.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
