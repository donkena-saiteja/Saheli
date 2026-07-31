import { useState } from 'react';
import {
  ShieldAlert,
  Landmark,
  Loader2,
  RefreshCw,
  Send,
  Sparkles,
  CheckCircle2,
  ArrowUpRight,
  Bot,
  Radar,
  TrendingUp,
} from 'lucide-react';
import { toast } from 'sonner';
import { aiMonitorApi } from '../lib/api';
import { useApiFetch, useApiPolling } from '../hooks/useApi';

const SEVERITY_STYLES: Record<string, string> = {
  critical: 'bg-red-50 text-red-700 border-red-200',
  high: 'bg-orange-50 text-orange-700 border-orange-200',
  medium: 'bg-amber-50 text-amber-700 border-amber-200',
  low: 'bg-slate-50 text-slate-600 border-slate-200',
};

const LIQUIDITY_LABELS: Record<string, string> = {
  instant: 'Instant access',
  short: 'Short term',
  medium: 'Medium term',
  long: 'Long term',
};

function inr(value: number | undefined): string {
  return `₹${Math.round(value || 0).toLocaleString('en-IN')}`;
}

/** One finding from the compliance agent. */
interface ComplianceAlert {
  id: string;
  category: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  riskScore: number;
  title: string;
  summary: string;
  recommendedAction: string;
  regulatoryBasis?: string;
  subjectName?: string;
  amount: number;
  transactionIds: string[];
  source: 'openai' | 'rules';
}

/** One line of the government-scheme allocation. */
interface SchemeAllocation {
  schemeId: string;
  scheme: string;
  issuer: string;
  amount: number;
  rate: number;
  tenure: string;
  liquidity: keyof typeof LIQUIDITY_LABELS | string;
  projectedAnnualReturn: number;
  rationale: string;
}

interface AIAgentPanelProps {
  /** Banks get the triage controls; members see a read-only view. */
  canReview?: boolean;
  /** The threat simulator is a demo affordance, not something a member needs. */
  showSimulator?: boolean;
}

export default function AIAgentPanel({ canReview = true, showSimulator = true }: AIAgentPanelProps) {
  const [tab, setTab] = useState<'monitor' | 'invest' | 'ask'>('monitor');
  const [scanning, setScanning] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [conversation, setConversation] = useState<Array<{ q: string; a: string; provider: string }>>([]);

  const { data: status, refetch: refetchStatus } = useApiPolling(() => aiMonitorApi.getStatus(), 15000);
  const { data: alerts, loading: loadingAlerts, refetch: refetchAlerts } = useApiPolling(
    () => aiMonitorApi.getAlerts('open'),
    12000,
  );
  const { data: advisory, loading: loadingAdvisory, refetch: refetchAdvisory } = useApiFetch(() =>
    aiMonitorApi.getInvestments(),
  );

  const handleScan = async () => {
    setScanning(true);
    try {
      const result = await aiMonitorApi.scan();
      toast.success(result.message);
      await Promise.all([refetchAlerts(), refetchStatus()]);
    } catch (err) {
      toast.error((err as Error).message || 'Scan failed');
    }
    setScanning(false);
  };

  const handleSimulate = async () => {
    setSimulating(true);
    try {
      const result = await aiMonitorApi.simulateThreat('structuring');
      toast.warning(result.message);
      await Promise.all([refetchAlerts(), refetchStatus()]);
    } catch (err) {
      toast.error((err as Error).message || 'Simulation failed');
    }
    setSimulating(false);
  };

  const handleReview = async (id: string, next: 'cleared' | 'escalated') => {
    try {
      const result = await aiMonitorApi.reviewAlert(id, next);
      toast.success(result.message);
      await Promise.all([refetchAlerts(), refetchStatus()]);
    } catch (err) {
      toast.error((err as Error).message || 'Could not update the alert');
    }
  };

  const handleAsk = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = question.trim();
    if (!q) return;

    setAsking(true);
    try {
      const result = await aiMonitorApi.ask(q);
      setConversation((prev) => [{ q, a: result.answer, provider: result.provider }, ...prev].slice(0, 8));
      setQuestion('');
    } catch (err) {
      toast.error((err as Error).message || 'The agent could not answer');
    }
    setAsking(false);
  };

  const openAlerts = alerts || [];
  const counts = status?.severityCounts || {};

  return (
    <div className="space-y-6">
      {/* Agent header */}
      <div className="rounded-2xl bg-gradient-to-br from-navy to-navy-light text-white p-6 border border-border/50">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-11 h-11 rounded-xl bg-white/10 flex items-center justify-center flex-shrink-0">
              <Bot className="w-6 h-6 text-shg-secondary" />
            </div>
            <div>
              <h3 className="font-headline font-black text-xl leading-tight">Saheli Autonomous Agent</h3>
              <p className="text-sm text-white/70 mt-1 max-w-xl">
                Watches every transaction for fraud and illegal activity, and keeps idle savings working in
                Government of India schemes.
              </p>
              <div className="flex flex-wrap items-center gap-2 mt-3">
                <span className="inline-flex items-center gap-1.5 bg-white/10 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  {status?.online ? 'Online' : 'Starting'}
                </span>
                <span className="bg-white/10 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider">
                  {status?.provider === 'openai' ? `OpenAI · ${status?.model}` : 'Rule engine'}
                </span>
                <span className="bg-white/10 px-2.5 py-1 rounded-full text-[10px] font-bold">
                  {status?.alertsOpen ?? 0} open alerts
                </span>
              </div>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleScan}
              disabled={scanning}
              className="px-4 py-2 bg-white text-navy rounded-xl font-bold text-xs inline-flex items-center gap-2 hover:opacity-90 disabled:opacity-60"
            >
              {scanning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Radar className="w-3.5 h-3.5" />}
              {scanning ? 'Scanning…' : 'Run Scan'}
            </button>
            {showSimulator && (
              <button
                onClick={handleSimulate}
                disabled={simulating}
                title="Injects a textbook laundering pattern and re-scans, so detection can be seen live"
                className="px-4 py-2 bg-white/10 border border-white/20 text-white rounded-xl font-bold text-xs inline-flex items-center gap-2 hover:bg-white/20 disabled:opacity-60"
              >
                {simulating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldAlert className="w-3.5 h-3.5" />}
                Simulate Threat
              </button>
            )}
          </div>
        </div>

        {status?.note && <p className="text-[11px] text-white/50 mt-4">{status.note}</p>}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-surface rounded-xl p-1 w-full sm:w-fit">
        {([
          ['monitor', 'Fraud Monitor', ShieldAlert],
          ['invest', 'Idle Fund Advisor', Landmark],
          ['ask', 'Ask the Agent', Sparkles],
        ] as const).map(([id, label, Icon]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex-1 sm:flex-none px-4 py-2 rounded-lg text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors ${
              tab === id ? 'bg-white text-shg-primary shadow-sm' : 'text-muted-foreground hover:text-on-surface'
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {/* ── Fraud monitor ── */}
      {tab === 'monitor' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {(['critical', 'high', 'medium', 'low'] as const).map((sev) => (
              <div key={sev} className={`rounded-xl border p-4 ${SEVERITY_STYLES[sev]}`}>
                <p className="text-[10px] font-bold uppercase tracking-wider opacity-80">{sev}</p>
                <p className="text-2xl font-black font-headline mt-1">{counts[sev] ?? 0}</p>
              </div>
            ))}
          </div>

          {loadingAlerts && openAlerts.length === 0 ? (
            <div className="bg-white border border-border/50 rounded-2xl p-10 text-center">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground mx-auto" />
            </div>
          ) : openAlerts.length === 0 ? (
            <div className="bg-white border border-border/50 rounded-2xl p-10 text-center">
              <CheckCircle2 className="w-10 h-10 text-shg-secondary mx-auto mb-3" />
              <p className="font-bold text-on-surface">No suspicious activity outstanding.</p>
              <p className="text-sm text-muted-foreground mt-1">
                The agent swept {status?.alertsTotal ?? 0} historical finding
                {status?.alertsTotal === 1 ? '' : 's'} and everything is triaged.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {openAlerts.map((alert: ComplianceAlert) => (
                <div
                  key={alert.id}
                  className={`bg-white rounded-2xl border border-border/50 border-l-4 p-5 ${
                    alert.severity === 'critical'
                      ? 'border-l-red-500'
                      : alert.severity === 'high'
                        ? 'border-l-orange-500'
                        : alert.severity === 'medium'
                          ? 'border-l-amber-500'
                          : 'border-l-slate-400'
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        <span
                          className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider border ${
                            SEVERITY_STYLES[alert.severity] || SEVERITY_STYLES.low
                          }`}
                        >
                          {alert.severity}
                        </span>
                        <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                          {String(alert.category).replace(/_/g, ' ')}
                        </span>
                        <span className="text-[10px] font-bold text-muted-foreground">
                          risk {alert.riskScore}/100
                        </span>
                        <span className="text-[10px] font-bold text-shg-primary bg-shg-primary/10 px-2 py-0.5 rounded">
                          {alert.source === 'openai' ? 'AI reasoned' : 'Rule engine'}
                        </span>
                      </div>

                      <h4 className="font-bold text-on-surface">{alert.title}</h4>
                      <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">{alert.summary}</p>

                      <div className="mt-3 p-3 bg-surface rounded-lg space-y-1.5">
                        <p className="text-xs text-on-surface">
                          <span className="font-bold">Recommended action: </span>
                          {alert.recommendedAction}
                        </p>
                        {alert.regulatoryBasis && (
                          <p className="text-[11px] text-muted-foreground">
                            <span className="font-bold">Basis: </span>
                            {alert.regulatoryBasis}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="text-right flex-shrink-0">
                      <p className="text-lg font-black font-headline text-on-surface">{inr(alert.amount)}</p>
                      <p className="text-[10px] text-muted-foreground">{alert.subjectName || 'Group level'}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {alert.transactionIds?.length || 0} entries
                      </p>
                    </div>
                  </div>

                  {canReview && (
                    <div className="flex gap-2 mt-4 pt-3 border-t border-border/40">
                      <button
                        onClick={() => handleReview(alert.id, 'escalated')}
                        className="px-4 py-2 bg-red-600 text-white rounded-lg text-xs font-bold hover:opacity-90"
                      >
                        Escalate to Bank
                      </button>
                      <button
                        onClick={() => handleReview(alert.id, 'cleared')}
                        className="px-4 py-2 border border-border rounded-lg text-xs font-bold hover:bg-surface"
                      >
                        Mark Reviewed
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Idle fund advisor ── */}
      {tab === 'invest' && (
        <div className="space-y-4">
          {loadingAdvisory && !advisory ? (
            <div className="bg-white border border-border/50 rounded-2xl p-10 text-center">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground mx-auto" />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                {[
                  ['Idle right now', inr(advisory?.idleFunds), 'text-red-600'],
                  ['Emergency buffer held', inr(advisory?.liquidityBuffer), 'text-shg-primary'],
                  ['Investable', inr(advisory?.investableAmount), 'text-shg-secondary'],
                  ['Forgone per day', inr(advisory?.opportunityCostPerDay), 'text-shg-tertiary'],
                ].map(([label, value, tone]) => (
                  <div key={label} className="bg-white border border-border/50 rounded-xl p-4">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
                    <p className={`text-xl font-black font-headline mt-1 ${tone}`}>{value}</p>
                  </div>
                ))}
              </div>

              <div className="bg-gradient-to-br from-shg-primary to-blue-700 text-white rounded-2xl p-6">
                <div className="flex items-center gap-2 mb-3">
                  <TrendingUp className="w-4 h-4" />
                  <h4 className="font-bold text-sm">Agent briefing</h4>
                  <span className="ml-auto text-[10px] font-bold bg-white/15 px-2 py-0.5 rounded-full uppercase tracking-wider">
                    {advisory?.provider === 'openai' ? 'OpenAI' : 'Deterministic'}
                  </span>
                </div>
                <p className="text-sm leading-relaxed text-white/90">{advisory?.narrative}</p>
                <div className="flex flex-wrap gap-4 mt-4 pt-4 border-t border-white/20">
                  <div>
                    <p className="text-[10px] uppercase font-bold text-white/60">Blended yield</p>
                    <p className="text-lg font-black font-headline">{advisory?.blendedYield ?? 0}%</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase font-bold text-white/60">Projected per year</p>
                    <p className="text-lg font-black font-headline">{inr(advisory?.projectedAnnualReturn)}</p>
                  </div>
                  <button
                    onClick={() => refetchAdvisory()}
                    className="ml-auto self-end inline-flex items-center gap-1.5 text-xs font-bold bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-lg"
                  >
                    <RefreshCw className="w-3 h-3" />
                    Recalculate
                  </button>
                </div>
              </div>

              <div className="bg-white border border-border/50 rounded-2xl overflow-hidden">
                <div className="px-6 py-4 border-b border-border/50">
                  <h4 className="font-bold">Recommended allocation — Government of India instruments</h4>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Sovereign and quasi-sovereign only. The emergency buffer never leaves instant access.
                  </p>
                </div>

                {(advisory?.allocations || []).length === 0 ? (
                  <p className="p-6 text-sm text-muted-foreground">
                    Nothing to deploy — the idle balance is at or below the emergency buffer this group must keep
                    liquid.
                  </p>
                ) : (
                  <div className="divide-y divide-border/40">
                    {(advisory?.allocations || []).map((a: SchemeAllocation) => (
                      <div key={a.schemeId} className="px-6 py-4 flex flex-wrap items-start gap-4">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-bold text-on-surface text-sm">{a.scheme}</p>
                            <span className="text-[10px] font-bold text-shg-secondary bg-shg-secondary/10 px-2 py-0.5 rounded">
                              {a.rate}% p.a.
                            </span>
                            <span className="text-[10px] font-bold text-muted-foreground bg-surface px-2 py-0.5 rounded">
                              {LIQUIDITY_LABELS[a.liquidity] || a.liquidity} · {a.tenure}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">{a.issuer}</p>
                          <p className="text-xs text-on-surface/80 mt-1.5">{a.rationale}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-black font-headline text-on-surface">{inr(a.amount)}</p>
                          <p className="text-[11px] text-shg-secondary font-bold inline-flex items-center gap-0.5">
                            <ArrowUpRight className="w-3 h-3" />
                            {inr(a.projectedAnnualReturn)}/yr
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <p className="px-6 py-3 bg-surface text-[11px] text-muted-foreground border-t border-border/40">
                  {advisory?.disclaimer}
                </p>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Ask the agent ── */}
      {tab === 'ask' && (
        <div className="space-y-4">
          <form onSubmit={handleAsk} className="bg-white border border-border/50 rounded-2xl p-4">
            <div className="flex gap-2">
              <input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Ask about risk, idle funds, or a member's activity…"
                className="flex-1 border border-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-shg-primary/30"
              />
              <button
                type="submit"
                disabled={asking || !question.trim()}
                className="px-5 bg-shg-primary text-white rounded-xl font-bold text-sm inline-flex items-center gap-2 disabled:opacity-60"
              >
                {asking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                Ask
              </button>
            </div>
            <div className="flex flex-wrap gap-2 mt-3">
              {[
                'What is our biggest compliance risk right now?',
                'How much are we losing by keeping funds idle?',
                'Which government scheme suits us best?',
              ].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setQuestion(preset)}
                  className="text-[11px] font-semibold text-shg-primary bg-shg-primary/10 hover:bg-shg-primary/20 px-3 py-1.5 rounded-full"
                >
                  {preset}
                </button>
              ))}
            </div>
          </form>

          {conversation.map((entry, i) => (
            <div key={i} className="bg-white border border-border/50 rounded-2xl p-5">
              <p className="text-sm font-bold text-on-surface">{entry.q}</p>
              <p className="text-sm text-muted-foreground mt-2 leading-relaxed whitespace-pre-line">{entry.a}</p>
              <span className="inline-block mt-3 text-[10px] font-bold uppercase tracking-wider text-shg-primary bg-shg-primary/10 px-2 py-0.5 rounded">
                {entry.provider === 'openai' ? 'OpenAI' : 'Deterministic fallback'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
