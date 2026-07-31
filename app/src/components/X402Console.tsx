import { useState } from 'react';
import {
  Zap,
  Lock,
  Unlock,
  CheckCircle2,
  Loader2,
  ExternalLink,
  Coins,
  ArrowRight,
  ShieldCheck,
  AlertCircle,
} from 'lucide-react';
import { x402Api } from '../lib/api';
import { useApiFetch } from '../hooks/useApi';

/**
 * x402 Pay-per-Use console.
 *
 * Walks a judge through the entire protocol handshake against the real gated
 * endpoints: the 402 challenge, the signed Algorand atomic group, facilitator
 * verify and settle, and finally the unlocked resource.
 */

interface Step {
  step: number;
  name: string;
  detail: string;
  requirements?: any;
  header?: string;
  result?: any;
  treasuryCredit?: string;
}

const RESOURCE_META: Record<string, { icon: string; label: string; payer: string }> = {
  'credit-report': { icon: '🏦', label: 'SHG Credit Report', payer: 'Bank underwriting' },
  'member-passport': { icon: '🎖️', label: 'Member d-SBT Passport', payer: 'Bank / MFI' },
  'verify-proof': { icon: '🔍', label: 'Proof Verification', payer: 'Fintech at scale' },
  'grant-eligibility': { icon: '📜', label: 'Grant Milestone Attestation', payer: 'NGO / Government' },
  'ai-underwriting': { icon: '🤖', label: 'Agentic Underwriting Opinion', payer: 'AI agent' },
};

export default function X402Console() {
  const [selected, setSelected] = useState<string>('credit-report');
  const [steps, setSteps] = useState<Step[]>([]);
  const [unlocked, setUnlocked] = useState<any>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [challenge, setChallenge] = useState<any>(null);

  const { data: catalogue } = useApiFetch(() => x402Api.getCatalogue(), []);
  const { data: revenue, refetch: refetchRevenue } = useApiFetch(() => x402Api.getRevenue(), []);

  const resources = catalogue?.resources || [];
  const active = resources.find((r: any) => r.id === selected);

  /** Step 0: hit the endpoint with no payment and show the raw 402. */
  const probe = async () => {
    setError(null);
    setSteps([]);
    setUnlocked(null);
    setRunning(true);
    try {
      const res = await x402Api.probe(selected);
      setChallenge(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Probe failed');
    }
    setRunning(false);
  };

  /** Steps 1-5: build the atomic group, verify, settle, unlock. */
  const pay = async () => {
    setError(null);
    setRunning(true);
    setUnlocked(null);
    try {
      const res = await x402Api.demoPay(selected, 'bank:demo-institution');
      setSteps(res.steps || []);

      if (res.paymentHeader) {
        const resource = await x402Api.fetchPaid(selected, res.paymentHeader);
        setUnlocked(resource);
      }
      refetchRevenue();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Payment failed');
    }
    setRunning(false);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-2xl bg-gradient-to-br from-indigo-600 via-violet-600 to-fuchsia-600 p-6 text-white">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Zap className="w-6 h-6" />
              <h2 className="text-2xl font-black">x402 Pay-per-Use</h2>
              <span className="text-[10px] font-bold bg-white/20 px-2 py-1 rounded-full tracking-wide">
                HTTP 402 · ALGORAND
              </span>
            </div>
            <p className="text-white/80 text-sm max-w-2xl leading-relaxed">
              Institutions and their AI agents pay per API call for SHG creditworthiness data.
              The revenue flows back into the group treasury — the women monetise their own
              financial reputation instead of having it harvested for free.
            </p>
          </div>

          {revenue && (
            <div className="bg-white/10 backdrop-blur rounded-xl p-4 min-w-[190px]">
              <p className="text-[10px] uppercase tracking-wider text-white/60 font-bold">
                Earned by SHGs
              </p>
              <p className="text-3xl font-black mt-1">${revenue.totals.treasuryDisplay || '0'}</p>
              <p className="text-xs text-white/70 mt-1">
                {revenue.totals.calls} paid API call{revenue.totals.calls === 1 ? '' : 's'}
              </p>
            </div>
          )}
        </div>

        {catalogue && (
          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-[11px] font-mono text-white/70">
            <span>scheme: {catalogue.scheme}</span>
            <span>network: {catalogue.network}</span>
            <span>asset: {catalogue.asset} (USDC)</span>
            <span>facilitator: {catalogue.facilitator}</span>
            <span>settlement: {catalogue.chainMode}</span>
          </div>
        )}
      </div>

      {/* Resource picker */}
      <div>
        <h3 className="font-bold text-on-surface mb-3">Priced resources</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {resources.map((r: any) => {
            const meta = RESOURCE_META[r.id] || { icon: '📦', label: r.id, payer: '' };
            const isActive = r.id === selected;
            return (
              <button
                key={r.id}
                onClick={() => {
                  setSelected(r.id);
                  setSteps([]);
                  setUnlocked(null);
                  setChallenge(null);
                }}
                className={`text-left p-4 rounded-xl border-2 transition-all ${
                  isActive
                    ? 'border-indigo-500 bg-indigo-50 shadow-sm'
                    : 'border-border/60 bg-white hover:border-indigo-300'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-2xl">{meta.icon}</span>
                  <span className="font-black text-indigo-600 text-lg">{r.displayPrice}</span>
                </div>
                <p className="font-bold text-sm mt-2 text-on-surface">{meta.label}</p>
                <p className="text-[11px] text-muted-foreground mt-1 leading-snug line-clamp-2">
                  {r.description}
                </p>
                <div className="flex items-center gap-1 mt-2 text-[10px] font-semibold text-emerald-600">
                  <Coins className="w-3 h-3" />
                  {r.treasuryShareBps / 100}% to SHG treasury
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-3">
        <button
          onClick={probe}
          disabled={running}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl border-2 border-amber-400 bg-amber-50 text-amber-700 font-bold text-sm hover:bg-amber-100 disabled:opacity-50 transition-colors"
        >
          <Lock className="w-4 h-4" />
          1. Request without paying
        </button>
        <button
          onClick={pay}
          disabled={running}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 text-white font-bold text-sm hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Unlock className="w-4 h-4" />}
          2. Pay {active?.displayPrice} and unlock
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-2 p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* The 402 challenge */}
      {challenge && (
        <div className="rounded-xl border-2 border-amber-300 bg-amber-50 overflow-hidden">
          <div className="px-4 py-2.5 bg-amber-100 flex items-center gap-2">
            <Lock className="w-4 h-4 text-amber-700" />
            <span className="font-black text-amber-800 text-sm">HTTP 402 Payment Required</span>
            <span className="text-[10px] text-amber-700 ml-auto font-mono">
              server refused — no X-PAYMENT header
            </span>
          </div>
          <pre className="p-4 text-[11px] font-mono overflow-x-auto text-amber-900 leading-relaxed">
            {JSON.stringify(challenge, null, 2)}
          </pre>
        </div>
      )}

      {/* Protocol steps */}
      {steps.length > 0 && (
        <div className="space-y-2">
          <h3 className="font-bold text-on-surface">Protocol handshake</h3>
          {steps.map((s) => (
            <div
              key={s.step}
              className="flex gap-3 p-4 rounded-xl bg-white border border-border/60"
            >
              <div className="w-7 h-7 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center font-black text-xs flex-shrink-0">
                {s.step}
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-bold text-sm text-on-surface">{s.name}</p>
                <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{s.detail}</p>

                {s.header && (
                  <code className="block mt-2 text-[10px] bg-slate-900 text-emerald-300 p-2 rounded-lg overflow-x-auto font-mono">
                    {s.header}
                  </code>
                )}

                {s.result?.transaction && (
                  <a
                    href={`https://lora.algokit.io/testnet/transaction/${s.result.transaction}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 mt-2 text-[11px] font-mono text-indigo-600 hover:underline"
                  >
                    {s.result.transaction.slice(0, 28)}…
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}

                {s.treasuryCredit && (
                  <div className="inline-flex items-center gap-1 mt-2 text-[11px] font-bold text-emerald-600">
                    <Coins className="w-3 h-3" />+${s.treasuryCredit} credited to SHG treasury
                  </div>
                )}
              </div>
              <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
            </div>
          ))}
        </div>
      )}

      {/* Unlocked resource */}
      {unlocked && (
        <div className="rounded-xl border-2 border-emerald-300 bg-emerald-50 overflow-hidden">
          <div className="px-4 py-2.5 bg-emerald-100 flex items-center gap-2">
            <Unlock className="w-4 h-4 text-emerald-700" />
            <span className="font-black text-emerald-800 text-sm">HTTP 200 — Resource unlocked</span>
            <ShieldCheck className="w-4 h-4 text-emerald-700 ml-auto" />
          </div>

          {unlocked.recommendation && (
            <div className="p-4 bg-white border-b border-emerald-200">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-bold text-muted-foreground">LENDING DECISION</span>
                <span
                  className={`text-xs font-black px-2 py-1 rounded-full ${
                    unlocked.recommendation.decision === 'APPROVE'
                      ? 'bg-emerald-500 text-white'
                      : unlocked.recommendation.decision === 'APPROVE_WITH_CONDITIONS'
                        ? 'bg-amber-500 text-white'
                        : 'bg-red-500 text-white'
                  }`}
                >
                  {unlocked.recommendation.decision.replace(/_/g, ' ')}
                </span>
                <ArrowRight className="w-3 h-3 text-muted-foreground" />
                <span className="font-black text-lg text-on-surface">
                  ₹{unlocked.recommendation.suggestedCreditLine?.toLocaleString('en-IN')}
                </span>
                <span className="text-xs text-muted-foreground">suggested credit line</span>
              </div>
              <p className="text-xs text-muted-foreground mt-2">{unlocked.recommendation.rationale}</p>
            </div>
          )}

          <pre className="p-4 text-[11px] font-mono overflow-x-auto max-h-96 text-emerald-900 leading-relaxed">
            {JSON.stringify(unlocked, null, 2)}
          </pre>
        </div>
      )}

      {/* Revenue breakdown */}
      {revenue && revenue.byResource?.length > 0 && (
        <div className="rounded-xl bg-white border border-border/60 overflow-hidden">
          <div className="px-4 py-3 border-b border-border/60">
            <h3 className="font-bold text-on-surface text-sm">Revenue routed to SHG treasuries</h3>
          </div>
          <div className="divide-y divide-border/50">
            {revenue.byResource.map((r: any) => (
              <div key={r.resourceId} className="px-4 py-3 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-semibold text-sm text-on-surface">
                    {RESOURCE_META[r.resourceId]?.label || r.resourceId}
                  </p>
                  <p className="text-xs text-muted-foreground">{r.calls} calls</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="font-black text-emerald-600">${r.treasuryDisplay}</p>
                  <p className="text-[10px] text-muted-foreground">of ${r.grossDisplay} gross</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
