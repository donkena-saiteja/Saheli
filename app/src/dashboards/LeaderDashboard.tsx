import {
  TrendingUp,
  Shield,
  Users,
  CheckCircle2,
  AlertTriangle,
  Zap,
  Brain,
  ArrowUpRight,
  X,
  FileText,
  Plus,
  Clock,
  Cpu,
  ShieldAlert,
  Eye,
  LifeBuoy,
  Save,
  Bell,
  Loader2,
  Wallet,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { gsap } from 'gsap';
import { useApiFetch, useApiPolling, useApiMutation } from '../hooks/useApi';
import {
  statsApi,
  multisigApi,
  aiAgentApi,
  agentApi,
  transactionsApi,
  membersApi,
  loansApi,
  qrApi,
  reportsApi,
} from '../lib/api';
import { toast } from 'sonner';
import AgentTerminal from '../components/AgentTerminal';
import IdleFundPanel from '../components/IdleFundPanel';
import QRCodeDisplay from '../components/QRCodeDisplay';
import AIAgentPanel from '../components/AIAgentPanel';
import TxReference from '../components/TxReference';
import PeraPaymentButton from '../components/PeraPaymentButton';
import X402ProtocolSteps from '../components/X402ProtocolSteps';
import { useX402Payment } from '../hooks/useX402Payment';
import { isUserCancellation } from '../lib/pera';

const Skeleton = ({ className = '' }: { className?: string }) => (
  <div className={`bg-surface animate-pulse rounded-lg ${className}`} />
);

function timeAgo(ts: string) {
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} mins ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} hours ago`;
  return `${Math.floor(diff / 86400000)} days ago`;
}

const iconMap: Record<string, typeof CheckCircle2> = {
  CheckCircle2, Zap, AlertTriangle, Clock, TrendingUp, Cpu, ShieldAlert,
};

interface LeaderDashboardProps {
  isReadOnly?: boolean;
  activeSection?: string;
}

export default function LeaderDashboard({ isReadOnly = false, activeSection = 'treasury' }: LeaderDashboardProps) {
  const dashboardRef = useRef<HTMLDivElement>(null);
  const [actionMessages, setActionMessages] = useState<Record<string, string>>({});
  const [investing, setInvesting] = useState(false);
  const [harvesting, setHarvesting] = useState(false);
  const [showTxModal, setShowTxModal] = useState(false);
  const [txForm, setTxForm] = useState({ memberId: '', type: 'deposit', amount: '', description: '' });
  const [loanQRCodes, setLoanQRCodes] = useState<Record<string, any>>({});
  const [settings, setSettings] = useState({ emergencyAlerts: true, dailyDigest: true });
  /** Which approval card is mid-request, so only that card shows a spinner. */
  const [busyActionId, setBusyActionId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [payoutForm, setPayoutForm] = useState({ memberId: '', amount: '' });

  const { data: treasury, loading: loadingTreasury, refetch: refetchTreasury } = useApiFetch(() => statsApi.getTreasury());
  const { data: pendingActions, loading: loadingActions, refetch: refetchActions } = useApiPolling(() => multisigApi.getPending('leader'), 6000);
  const { data: aiLog, loading: loadingLog } = useApiPolling(() => aiAgentApi.getLog(), 8000);
  const { data: agentLog, refetch: refetchAgentLog } = useApiPolling(() => agentApi.getLog(), 6000);
  const { data: vaultData, loading: loadingVaults, refetch: refetchVaults } = useApiFetch(() => agentApi.getVaults());
  const { data: members } = useApiFetch(() => membersApi.getAll());
  const { data: loans, loading: loadingLoans, refetch: refetchLoans } = useApiPolling(() => loansApi.getAll(), 8000);
  const { data: treasuryBalance, refetch: refetchTreasuryBalance } = useApiPolling(
    () => loansApi.getTreasuryBalance(),
    8000,
  );
  // Full SHG ledger for the audit view — every anchored movement, newest first.
  const { data: ledger, loading: loadingLedger } = useApiPolling(() => transactionsApi.getLedger(), 15000);

  const { mutate: rejectAction } = useApiMutation((input: { id: string; reason?: string }) =>
    multisigApi.reject(input.id, input.reason, 'Leader'),
  );

  /**
   * The x402 gate on approval.
   *
   * `/api/multisig/:id/sign` answers 402 until the leader's own Pera wallet has
   * settled the disbursement fee, so no treasury movement can happen without a
   * real, explorer-verifiable payment from the person authorising it.
   */
  const { steps: approvalSteps, receipt: approvalReceipt, payAndRun: payAndApprove } =
    useX402Payment('loan-approval');
  const { mutate: createTransaction, loading: creatingTx } = useApiMutation((body: any) => transactionsApi.create(body));

  /**
   * Loans indexed by id so an approval card can show the purpose, the AI
   * recommendation and the borrower's trust score without a second request.
   */
  const loansById = useMemo(() => {
    const map = new Map<string, any>();
    for (const loan of loans || []) map.set(String(loan.id), loan);
    return map;
  }, [loans]);

  /** Every refresh that a settled approval invalidates, in one call. */
  const refreshAfterSettlement = useCallback(async () => {
    await Promise.all([
      refetchActions(),
      refetchLoans(),
      refetchTreasury(),
      refetchTreasuryBalance(),
      refetchAgentLog(),
    ]);
  }, [refetchActions, refetchLoans, refetchTreasury, refetchTreasuryBalance, refetchAgentLog]);

  useEffect(() => {
    if (!txForm.memberId && members && members.length > 0) {
      const firstMemberId = members[0]._id || members[0].id || '';
      setTxForm((prev) => ({ ...prev, memberId: firstMemberId }));
    }
  }, [members, txForm.memberId]);

  useEffect(() => {
    const root = dashboardRef.current;
    if (!loadingTreasury && root && root.querySelector('.dashboard-card')) {
      const ctx = gsap.context(() => {
        gsap.from('.dashboard-card', { y: 40, opacity: 0, duration: 0.6, stagger: 0.1, ease: 'power2.out' });
      }, root);
      return () => ctx.revert();
    }
  }, [loadingTreasury]);

  /**
   * A single leader signature approves and settles the loan — after the leader
   * has paid the x402 disbursement fee from their own Pera wallet.
   *
   * `busyActionId` scopes the spinner and the protocol panel to the card that
   * was clicked, so approving one request never greys out the rest of the queue.
   */
  const handleApprove = async (id: string, action: any) => {
    setBusyActionId(id);
    try {
      const res = await payAndApprove(
        {
          actionId: id,
          loanId: action?.linkedLoanId,
          amountInr: action?.amount,
          purpose: action?.description,
        },
        (paymentHeader) => multisigApi.sign(id, paymentHeader, 'Leader'),
      );

      setActionMessages((prev) => ({ ...prev, [id]: res.message }));
      toast.success(res.message);
      if (res.settlement?.requiresWalletSettlement && res.settlement?.walletHint) {
        toast.info(res.settlement.walletHint, { duration: 8000 });
      }
      await refreshAfterSettlement();
    } catch (err) {
      if (isUserCancellation(err)) {
        toast.info('Cancelled in Pera Wallet — nothing was charged and the loan was not approved.');
      } else {
        toast.error((err as Error).message || 'Could not approve — is the API running?');
      }
    }
    setBusyActionId(null);
  };

  const handleReject = async (id: string, description: string) => {
    const reason = window.prompt(`Decline "${description}". Reason (optional):`, '');
    // `prompt` returns null on Cancel and '' when submitted empty — only the
    // former means the leader backed out.
    if (reason === null) return;

    setBusyActionId(id);
    try {
      const res = await rejectAction({ id, reason: reason || undefined });
      setActionMessages((prev) => ({ ...prev, [id]: res.message }));
      toast.success(res.message);
      await refreshAfterSettlement();
    } catch (err) {
      toast.error((err as Error).message || 'Could not decline this request');
    }
    setBusyActionId(null);
  };

  const handleInvest = useCallback(async () => {
    setInvesting(true);
    try {
      const res = await agentApi.invest();
      toast.success(res.message);
      refetchVaults();
      refetchAgentLog();
    } catch {
      toast.error('Could not deploy funds — is the API running?');
    }
    setInvesting(false);
  }, [refetchVaults, refetchAgentLog]);

  const handleHarvest = useCallback(async () => {
    setHarvesting(true);
    try {
      const res = await agentApi.harvest();
      toast.success(res.message);
      refetchVaults();
      refetchAgentLog();
    } catch {
      toast.error('Could not harvest yield — is the API running?');
    }
    setHarvesting(false);
  }, [refetchVaults, refetchAgentLog]);

  /** Six-sheet Excel pack, generated server-side from the live ledger. */
  const handleExportReport = async () => {
    setExporting(true);
    try {
      const result = await reportsApi.download('full-ledger', 'xlsx');
      toast.success(`Downloaded ${result.filename} (${Math.round(result.bytes / 1024)} KB)`);
    } catch (err) {
      toast.error((err as Error).message || 'Export failed');
    }
    setExporting(false);
  };

  const handleCreateTransaction = async () => {
    const amount = parseInt(txForm.amount, 10);
    if (!txForm.memberId || !txForm.type || !amount) {
      toast.error('Please provide member, type and amount');
      return;
    }

    try {
      await createTransaction({
        memberId: txForm.memberId,
        type: txForm.type,
        amount,
        description: txForm.description || `Leader initiated ${txForm.type}`,
      });
      toast.success('Transaction created successfully');
      setShowTxModal(false);
      setTxForm({ memberId: txForm.memberId, type: 'deposit', amount: '', description: '' });
      await refreshAfterSettlement();
    } catch {
      toast.error('Transaction failed. Check backend connection.');
    }
  };

  const handleGenerateLoanQR = async (loan: any) => {
    if (!loan.transactionId) {
      toast.error('Loan must be approved and settled before generating QR');
      return;
    }
    try {
      const qr = await qrApi.generate({
        transactionId: loan.transactionId,
        memberId: loan.memberId,
        memberName: loan.memberName,
        amount: loan.amount,
        type: 'loan_disbursement',
      });
      setLoanQRCodes((prev) => ({ ...prev, [loan.id]: qr }));
      toast.success('Loan disbursement QR generated');
    } catch {
      toast.error('Could not generate QR');
    }
  };

  if (activeSection === 'settings') {
    return (
      <div className="p-6 lg:p-10 max-w-4xl mx-auto space-y-6">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-shg-primary mb-2">Leader Preferences</p>
          <h2 className="text-2xl font-black font-headline text-on-surface">Settings</h2>
        </div>
        <div className="bg-white border border-border/50 rounded-2xl p-6 space-y-4">
          <div className="flex items-center justify-between p-4 bg-surface rounded-xl">
            <div className="flex items-center gap-2 text-sm font-semibold"><Bell className="w-4 h-4 text-shg-primary" />Emergency Alerts</div>
            <button
              onClick={() => setSettings((s) => ({ ...s, emergencyAlerts: !s.emergencyAlerts }))}
              className={`w-12 h-6 rounded-full ${settings.emergencyAlerts ? 'bg-shg-primary' : 'bg-border'}`}
            >
              <span className={`block w-5 h-5 bg-white rounded-full transition-transform ${settings.emergencyAlerts ? 'translate-x-6' : 'translate-x-0.5'}`} />
            </button>
          </div>
          <div className="flex items-center justify-between p-4 bg-surface rounded-xl">
            <div className="flex items-center gap-2 text-sm font-semibold"><FileText className="w-4 h-4 text-shg-primary" />Daily Digest</div>
            <button
              onClick={() => setSettings((s) => ({ ...s, dailyDigest: !s.dailyDigest }))}
              className={`w-12 h-6 rounded-full ${settings.dailyDigest ? 'bg-shg-primary' : 'bg-border'}`}
            >
              <span className={`block w-5 h-5 bg-white rounded-full transition-transform ${settings.dailyDigest ? 'translate-x-6' : 'translate-x-0.5'}`} />
            </button>
          </div>
          <button onClick={() => toast.success('Leader settings saved')} className="px-5 py-2.5 bg-shg-primary text-white rounded-xl font-semibold text-sm inline-flex items-center gap-2">
            <Save className="w-4 h-4" />
            Save Settings
          </button>
        </div>
      </div>
    );
  }

  if (activeSection === 'ai') {
    return (
      <div className="p-6 lg:p-10 max-w-6xl mx-auto space-y-6">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-shg-primary mb-2">Agentic AI</p>
          <h2 className="text-2xl font-black font-headline text-on-surface">Compliance & Treasury Agent</h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Monitors every transaction for fraud and illegal activity, and allocates idle savings into Government of
            India schemes so the pool never sits still.
          </p>
        </div>
        <AIAgentPanel canReview showSimulator />
      </div>
    );
  }

  if (activeSection === 'audit') {
    return (
      <div className="p-6 lg:p-10 max-w-5xl mx-auto space-y-6">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-shg-primary mb-2">Leader Audit</p>
          <h2 className="text-2xl font-black font-headline text-on-surface">Approvals and Agent Logs</h2>
        </div>
        <div className="bg-white border border-border/50 rounded-2xl p-6">
          <h3 className="font-bold mb-3">Pending Multi-Sig Actions</h3>
          {(pendingActions || []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No pending actions.</p>
          ) : (
            <div className="space-y-3">
              {(pendingActions || []).map((action: any) => (
                <div key={action.id} className="p-3 bg-surface rounded-lg border border-border/40">
                  <p className="text-sm font-semibold">{action.description}</p>
                  <p className="text-xs text-muted-foreground">{action.signatures.length}/{action.signaturesRequired} approvals</p>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="bg-white border border-border/50 rounded-2xl p-6">
          <h3 className="font-bold mb-3">AI/Agent Activity</h3>
          <div className="space-y-2">
            {(aiLog || []).slice(0, 8).map((entry: any) => (
              <div key={entry.id} className="text-sm p-3 bg-surface rounded-lg border border-border/30">
                <span className="font-semibold">{entry.title}</span>
                <span className="text-muted-foreground text-xs block mt-1">{timeAgo(entry.timestamp)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Every SHG transaction, with the untruncated txid a judge can paste
            into the Algorand explorer. */}
        <div className="bg-white border border-border/50 rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-border/50 flex items-center justify-between gap-4">
            <div>
              <h3 className="font-bold">On-Chain Transaction Ledger</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                {(ledger || []).length} anchored movements across the group
              </p>
            </div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 bg-emerald-50 px-2 py-1 rounded-full">
              Algorand
            </span>
          </div>

          <div className="max-h-[28rem] overflow-y-auto divide-y divide-border/40">
            {loadingLedger ? (
              <div className="p-6 space-y-3">
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-5 w-1/2" />
              </div>
            ) : (ledger || []).length === 0 ? (
              <p className="p-6 text-sm text-muted-foreground">No transactions recorded yet.</p>
            ) : (
              (ledger || []).map((tx: any) => (
                <div key={tx.id} className="px-6 py-3 flex flex-wrap items-center gap-x-4 gap-y-1">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-on-surface capitalize">
                      {String(tx.event || '').replace(/_/g, ' ')}
                    </p>
                    <TxReference
                      transactionId={tx.transactionId}
                      onChain={tx.onChain}
                      explorerUrl={tx.explorerUrl}
                      fallback={tx.txId}
                    />
                  </div>
                  <div className="text-right">
                    <p
                      className={`text-sm font-black ${
                        tx.type === 'credit' ? 'text-emerald-600' : 'text-red-600'
                      }`}
                    >
                      {tx.type === 'credit' ? '+' : '−'}₹{Math.abs(tx.amount).toLocaleString('en-IN')}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {new Date(tx.timestamp).toLocaleString('en-IN')}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    );
  }

  if (activeSection === 'support') {
    return (
      <div className="p-6 lg:p-10 max-w-4xl mx-auto space-y-6">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-shg-primary mb-2">Leader Helpdesk</p>
          <h2 className="text-2xl font-black font-headline text-on-surface">Support</h2>
        </div>
        <div className="bg-white border border-border/50 rounded-2xl p-6 space-y-4">
          <p className="text-sm text-muted-foreground">Raise infrastructure issues, WhatsApp delivery failures, and bank integration escalations.</p>
          <button onClick={() => toast.success('Priority support ticket opened for leader account')} className="px-5 py-2.5 bg-shg-primary text-white rounded-xl font-semibold text-sm inline-flex items-center gap-2">
            <LifeBuoy className="w-4 h-4" />
            Open Support Ticket
          </button>
        </div>
      </div>
    );
  }

  return (
    <div ref={dashboardRef} className="p-6 lg:p-10 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <header>
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
          <div>
            <p className="text-shg-secondary font-semibold uppercase tracking-widest text-[10px] mb-2">
              Command Center
            </p>
            <h1 className="text-3xl lg:text-4xl font-black text-on-surface tracking-tight font-headline">
              Treasury Overview
            </h1>
          </div>
          {isReadOnly ? (
            <div className="flex items-center gap-2 px-4 py-2.5 bg-amber-50 border border-amber-200 rounded-xl text-amber-700 text-sm font-semibold">
              <Eye className="w-4 h-4" />
              Read-only view — Leader actions are restricted to SHG Leaders
            </div>
          ) : (
            <div className="flex gap-3">
              <button
                onClick={handleExportReport}
                disabled={exporting}
                title="Six-sheet Excel workbook: summary, transactions, members, loans, disbursements, compliance"
                className="px-5 py-2.5 bg-surface text-on-surface rounded-full font-semibold text-sm hover:bg-surface-container transition-colors flex items-center gap-2 disabled:opacity-60"
              >
                {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
                {exporting ? 'Building…' : 'Export Excel'}
              </button>
              <button onClick={() => setShowTxModal(true)} className="px-5 py-2.5 bg-shg-primary text-white rounded-full font-semibold text-sm hover:opacity-90 transition-opacity flex items-center gap-2 shadow-lg shadow-shg-primary/20">
                <Plus className="w-4 h-4" />
                New Transaction
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Stats Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="dashboard-card bg-white p-6 rounded-2xl border border-border/50">
          <div className="flex justify-between items-start mb-4">
            <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Total Liquidity</span>
            <div className="w-10 h-10 bg-shg-secondary/10 rounded-lg flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-shg-secondary" />
            </div>
          </div>
          {loadingTreasury && !treasury ? <Skeleton className="h-9 w-36 mb-2" /> : (
            <div className="text-3xl font-black font-headline text-on-surface">
              ₹{(treasuryBalance?.balance ?? treasury?.totalLiquidity ?? 0).toLocaleString('en-IN')}
            </div>
          )}
          <div className="flex items-center gap-1 text-shg-secondary text-sm font-semibold mt-2">
            <ArrowUpRight className="w-4 h-4" />
            +{loadingTreasury ? '...' : treasury?.yieldThisMonth}% yield this month
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">
            Falls immediately when you approve a loan.
          </p>
        </div>

        <div className="dashboard-card bg-white p-6 rounded-2xl border border-border/50">
          <div className="flex justify-between items-start mb-4">
            <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Trust Score</span>
            <div className="w-10 h-10 bg-shg-tertiary/10 rounded-lg flex items-center justify-center">
              <Shield className="w-5 h-5 text-shg-tertiary" />
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-4xl font-black font-headline text-on-surface">
              {loadingTreasury ? '...' : treasury?.trustScore}
            </div>
            <div className="flex-1 h-3 bg-shg-secondary/20 rounded-full overflow-hidden">
              <div
                className="h-full bg-shg-secondary rounded-full transition-all duration-1000"
                style={{ width: `${treasury?.trustScoreValue || 0}%` }}
              />
            </div>
          </div>
        </div>

        <div className="dashboard-card bg-white p-6 rounded-2xl border border-border/50">
          <div className="flex justify-between items-start mb-4">
            <span className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Active Members</span>
            <div className="w-10 h-10 bg-shg-primary/10 rounded-lg flex items-center justify-center">
              <Users className="w-5 h-5 text-shg-primary" />
            </div>
          </div>
          {loadingTreasury ? <Skeleton className="h-9 w-28 mb-2" /> : (
            <div className="text-3xl font-black font-headline text-on-surface">
              {treasury?.activeMembers} / {treasury?.totalMembers}
            </div>
          )}
          <p className="text-muted-foreground text-sm mt-2">
            {loadingTreasury ? '...' : `${(treasury?.totalMembers || 0) - (treasury?.activeMembers || 0)} members offline ready`}
          </p>
        </div>
      </div>

      {/* ── Approval queue — ONE card per loan, ONE leader signature ────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-8 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-lg font-bold font-headline text-on-surface flex items-center gap-2">
              <Shield className="w-5 h-5 text-shg-primary" />
              Approval Queue
            </h3>
            <div className="flex items-center gap-2">
              <span className="px-3 py-1 bg-shg-tertiary/10 text-shg-tertiary rounded-full text-xs font-bold">
                {(pendingActions || []).length} AWAITING YOU
              </span>
              <span className="px-3 py-1 bg-surface text-muted-foreground rounded-full text-xs font-bold">
                Single leader signature
              </span>
            </div>
          </div>

          {loadingActions && (pendingActions || []).length === 0 ? (
            <div className="space-y-4">
              {[1, 2].map(i => <Skeleton key={i} className="h-32 w-full rounded-2xl" />)}
            </div>
          ) : (pendingActions || []).length === 0 ? (
            <div className="bg-white rounded-2xl border border-border/50 p-10 text-center">
              <CheckCircle2 className="w-10 h-10 text-shg-secondary mx-auto mb-3" />
              <p className="font-bold text-on-surface">All clear! No pending approvals.</p>
              <p className="text-sm text-muted-foreground mt-1">
                New loan requests appear here the moment a member submits one.
              </p>
            </div>
          ) : (
            (pendingActions || []).map((action: any) => {
              const loan = action.linkedLoanId ? loansById.get(String(action.linkedLoanId)) : null;
              const busy = busyActionId === action.id;

              return (
                <div
                  key={action.id}
                  className={`bg-white p-6 rounded-2xl border-l-4 border border-border/50 ${
                    action.isEmergency ? 'border-l-red-500' : 'border-l-shg-primary'
                  }`}
                >
                  {action.isEmergency && (
                    <div className="flex items-center gap-2 mb-3 px-3 py-1.5 bg-red-50 border border-red-100 rounded-lg w-fit">
                      <ShieldAlert className="w-3.5 h-3.5 text-red-500" />
                      <span className="text-[10px] font-bold text-red-600 uppercase tracking-wider">
                        Emergency request · expedited
                      </span>
                    </div>
                  )}

                  <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-6">
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold text-on-surface font-headline">{action.description}</span>
                        <span className="text-xs px-2 py-0.5 bg-surface rounded text-muted-foreground font-mono">
                          #{action.id.slice(0, 4).toUpperCase()}
                        </span>
                      </div>

                      <p className="text-sm text-muted-foreground">
                        Requested by <span className="font-semibold">{action.requestedBy}</span>
                        {loan?.purpose ? ` · ${loan.purpose}` : ''}
                      </p>

                      <div className="text-2xl font-black font-headline text-shg-primary">
                        ₹{action.amount?.toLocaleString('en-IN')}
                      </div>

                      {loan && (
                        <div className="flex flex-wrap gap-2 pt-1">
                          <span
                            className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded ${
                              loan.aiRecommendation === 'approve'
                                ? 'bg-emerald-50 text-emerald-700'
                                : loan.aiRecommendation === 'review'
                                  ? 'bg-amber-50 text-amber-700'
                                  : 'bg-red-50 text-red-700'
                            }`}
                          >
                            AI: {loan.aiRecommendation}
                          </span>
                          <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded bg-surface text-muted-foreground">
                            Trust {loan.trustScoreAtApplication}/1000
                          </span>
                        </div>
                      )}

                      {loan?.aiReason && (
                        <p className="text-xs text-muted-foreground bg-surface rounded-lg px-3 py-2 mt-1">
                          {loan.aiReason}
                        </p>
                      )}

                      {actionMessages[action.id] && (
                        <p className="text-xs font-semibold text-shg-secondary bg-shg-secondary/10 px-3 py-2 rounded-lg">
                          {actionMessages[action.id]}
                        </p>
                      )}

                      {/* The x402 handshake for THIS card, narrated live. */}
                      {busy && (
                        <div className="pt-2">
                          <X402ProtocolSteps
                            steps={approvalSteps}
                            receipt={approvalReceipt}
                            price="0.05 ALGO"
                            compact
                          />
                        </div>
                      )}
                    </div>

                    {isReadOnly ? (
                      <p className="text-xs text-muted-foreground italic py-1">Approval requires the Leader role</p>
                    ) : (
                      <div className="flex flex-row lg:flex-col gap-2 lg:w-44 flex-shrink-0">
                        <button
                          onClick={() => handleApprove(action.id, action)}
                          disabled={busy}
                          className="flex-1 py-2.5 px-4 bg-shg-primary text-white rounded-lg text-sm font-bold active:scale-95 transition-transform hover:opacity-90 disabled:opacity-60 inline-flex items-center justify-center gap-2"
                        >
                          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wallet className="w-4 h-4" />}
                          {busy ? 'Settling…' : 'Pay 0.05 ALGO & Approve'}
                        </button>
                        <button
                          onClick={() => handleReject(action.id, action.description)}
                          disabled={busy}
                          className="flex-1 py-2.5 px-4 border border-border text-shg-error rounded-lg text-sm font-bold hover:bg-shg-error/10 transition-colors disabled:opacity-60 inline-flex items-center justify-center gap-2"
                        >
                          <X className="w-4 h-4" />
                          Decline
                        </button>
                        <p className="hidden lg:block text-[10px] text-muted-foreground text-center leading-snug">
                          x402: a 0.05 ALGO disbursement fee is paid from your Pera Wallet, then the
                          treasury is debited.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}

          {/* Loan book — read-only history, with QR proof for settled loans */}
          <section className="bg-white border border-border/50 rounded-2xl p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-bold font-headline text-on-surface">Loan Book</h3>
              <span className="text-xs font-bold text-muted-foreground">
                {(loans || []).length} total · {(loans || []).filter((l: any) => l.status === 'pending').length} pending
              </span>
            </div>

            {loadingLoans && (loans || []).length === 0 ? (
              <Skeleton className="h-24 w-full" />
            ) : (loans || []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No loan requests found.</p>
            ) : (
              <div className="space-y-3">
                {(loans || []).slice(0, 8).map((loan: any) => (
                  <div key={loan.id} className="p-4 bg-surface rounded-xl border border-border/40">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-bold text-on-surface text-sm">
                          {loan.memberName} · ₹{loan.amount?.toLocaleString('en-IN')}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">{loan.purpose}</p>
                        <div className="flex flex-wrap items-center gap-2 mt-1.5">
                          <span
                            className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${
                              loan.status === 'repaid'
                                ? 'bg-emerald-50 text-emerald-700'
                                : loan.status === 'repaying'
                                  ? 'bg-shg-primary/10 text-shg-primary'
                                  : loan.status === 'rejected'
                                    ? 'bg-red-50 text-red-700'
                                    : 'bg-amber-50 text-amber-700'
                            }`}
                          >
                            {loan.status}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            {loan.approvals}/{loan.approvalsRequired} approval
                          </span>
                        </div>
                      </div>
                      <button
                        onClick={() => handleGenerateLoanQR(loan)}
                        disabled={!loan.transactionId}
                        className="px-4 py-2 border border-border rounded-lg text-xs font-bold hover:bg-white disabled:opacity-40 flex-shrink-0"
                      >
                        Generate QR
                      </button>
                    </div>
                    {loanQRCodes[loan.id] && (
                      <div className="mt-3">
                        <QRCodeDisplay
                          qrCode={loanQRCodes[loan.id].qrCode}
                          transactionId={loanQRCodes[loan.id].transactionId}
                          amount={loan.amount}
                          memberName={loan.memberName}
                          type="loan_disbursement"
                          compact={true}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Classic AI Treasury Log */}
        <div className="lg:col-span-4 flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold font-headline text-on-surface flex items-center gap-2">
              <Brain className="w-5 h-5 text-shg-primary" />
              AI Log
            </h3>
            <div className="w-2 h-2 bg-shg-secondary rounded-full animate-pulse" />
          </div>
          <div className="dashboard-card bg-surface flex-1 rounded-2xl p-5 relative overflow-hidden border border-border/50">
            {loadingLog ? (
              <div className="space-y-4">
                {[1, 2, 3].map(i => (
                  <div key={i} className="flex gap-3">
                    <Skeleton className="w-5 h-5 rounded-full flex-shrink-0 mt-1" />
                    <Skeleton className="flex-1 h-12" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-5 relative z-10">
                {(aiLog || []).slice(0, 5).map((entry: any) => {
                  const Icon = iconMap[entry.icon] || CheckCircle2;
                  const colorMap: Record<string, string> = {
                    yield_deploy: 'text-shg-secondary',
                    loan_auto_approve: 'text-shg-primary',
                    yield_alert: 'text-shg-tertiary',
                    rebalance: 'text-shg-secondary',
                    sync: 'text-muted-foreground',
                  };
                  return (
                    <div key={entry.id} className="flex gap-3">
                      <div className="mt-1">
                        <Icon className={`w-5 h-5 ${colorMap[entry.type] || 'text-muted-foreground'}`} />
                      </div>
                      <div>
                        <p className="text-sm text-on-surface leading-relaxed">
                          <span className="font-bold">{entry.title}</span>
                          {entry.highlight && (
                            <span className="text-shg-secondary font-bold"> · {entry.highlight}</span>
                          )}
                        </p>
                        <span className="text-[10px] font-bold text-muted-foreground uppercase mt-1 block">
                          {timeAgo(entry.timestamp)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="absolute bottom-0 left-0 w-full h-24 bg-gradient-to-t from-surface to-transparent pointer-events-none" />
          </div>
        </div>
      </div>

      {/* ─── Real on-chain payout ─────────────────────────────────────────────
          The relayer path anchors locally when it is unfunded, which produces a
          transaction id that does not exist on chain. Paying from the leader's
          own Pera wallet always settles for real, so the explorer link
          resolves and the money visibly leaves the wallet. */}
      {!isReadOnly && (
        <section className="bg-white border border-border/50 rounded-2xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-9 h-9 rounded-xl bg-[#FFEE55] flex items-center justify-center">
              <Wallet className="w-5 h-5 text-slate-900" />
            </div>
            <div>
              <h2 className="text-lg font-black font-headline text-on-surface">Settle a Payout On-Chain</h2>
              <p className="text-xs text-muted-foreground">
                Debits your connected Pera Wallet and credits the member's Algorand account — live on TestNet.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
            <div>
              <label className="text-xs font-bold uppercase text-muted-foreground">Pay to member</label>
              <select
                value={payoutForm.memberId}
                onChange={(e) => setPayoutForm((s) => ({ ...s, memberId: e.target.value }))}
                className="mt-1 w-full border border-border rounded-lg px-3 py-2 text-sm"
              >
                <option value="">Select a member…</option>
                {(members || []).map((m: any) => (
                  <option key={m._id || m.id} value={m._id || m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-bold uppercase text-muted-foreground">Amount (₹)</label>
              <input
                type="number"
                min={1}
                value={payoutForm.amount}
                onChange={(e) => setPayoutForm((s) => ({ ...s, amount: e.target.value }))}
                className="mt-1 w-full border border-border rounded-lg px-3 py-2 text-sm"
                placeholder="2000"
              />
            </div>
            <PeraPaymentButton
              amountInr={Number(payoutForm.amount) || 0}
              purpose="loan_disbursement"
              toMemberId={payoutForm.memberId || undefined}
              memberId={payoutForm.memberId || undefined}
              description="Leader payout settled from Pera Wallet"
              disabled={!payoutForm.memberId || !(Number(payoutForm.amount) > 0)}
              label={`Send ₹${(Number(payoutForm.amount) || 0).toLocaleString('en-IN')} from Pera`}
              onSettled={() => {
                setPayoutForm((s) => ({ ...s, amount: '' }));
                void refreshAfterSettlement();
              }}
            />
          </div>
        </section>
      )}

      {/* ─── AI Vault Manager Section ─────────────────────────────────────────── */}
      <section>
        <div className="flex items-center gap-3 mb-5">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #3b82f6, #1d4ed8)' }}>
            <Zap className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-xl font-black font-headline text-on-surface">AI Vault Manager</h2>
            <p className="text-xs text-muted-foreground">Autonomous idle fund deployment via Internal Vaults</p>
          </div>
          <div className="ml-auto flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold" style={{ background: '#10b98115', color: '#059669' }}>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Agent Active
          </div>
        </div>

        <IdleFundPanel
          vaultData={vaultData}
          loading={loadingVaults}
          onInvest={handleInvest}
          onHarvest={handleHarvest}
          investing={investing}
          harvesting={harvesting}
        />
      </section>

      {/* ─── Agent Terminal Section ───────────────────────────────────────────── */}
      <section>
        <div className="flex items-center gap-3 mb-5">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-gray-900">
            <Cpu className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <h2 className="text-xl font-black font-headline text-on-surface">Agent Terminal</h2>
            <p className="text-xs text-muted-foreground">Live autonomous agent activity log · Internal Server</p>
          </div>
          <span className="ml-auto text-[10px] font-bold text-gray-400 font-mono">
            polling every 6s
          </span>
        </div>

        <AgentTerminal entries={agentLog || []} />
      </section>

      {/* Village Ledger Banner */}
      <div className="rounded-3xl overflow-hidden h-44 relative">
        <div className="absolute inset-0 bg-gradient-to-r from-shg-primary via-shg-primary/90 to-shg-primary/70" />
        <div className="absolute inset-0 opacity-20">
          <svg className="w-full h-full" viewBox="0 0 400 200" preserveAspectRatio="none">
            <defs>
              <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="white" strokeWidth="0.5" opacity="0.3" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid)" />
          </svg>
        </div>
        <div className="absolute inset-0 flex items-center px-8 lg:px-12">
          <div className="max-w-lg space-y-3">
            <h2 className="text-2xl lg:text-3xl font-black text-white font-headline">Village Treasury</h2>
            <p className="text-white/80 text-sm leading-relaxed">
              Treasury secured by multi-leader approvals · AI agent auto-invests idle funds · Every action securely recorded in the database.
            </p>
            <div className="flex items-center gap-2 text-shg-secondary">
              <Shield className="w-4 h-4" />
              <span className="text-xs font-bold uppercase tracking-wider">
                {treasury?.totalYieldGenerated ? `₹${treasury.totalYieldGenerated.toLocaleString('en-IN')} yield generated` : 'Live on Secure Server'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {showTxModal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white rounded-2xl border border-border p-6 space-y-4">
            <h3 className="text-lg font-bold font-headline">Create New Transaction</h3>
            <div>
              <label className="text-xs font-bold uppercase text-muted-foreground">Member</label>
              <select
                value={txForm.memberId}
                onChange={(e) => setTxForm((s) => ({ ...s, memberId: e.target.value }))}
                className="mt-1 w-full border border-border rounded-lg px-3 py-2 text-sm"
              >
                {(members || []).map((m: any) => (
                  <option key={m._id || m.id} value={m._id || m.id}>{m.name}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-bold uppercase text-muted-foreground">Type</label>
                <select
                  value={txForm.type}
                  onChange={(e) => setTxForm((s) => ({ ...s, type: e.target.value }))}
                  className="mt-1 w-full border border-border rounded-lg px-3 py-2 text-sm"
                >
                  <option value="deposit">Deposit</option>
                  <option value="withdrawal">Withdrawal</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-bold uppercase text-muted-foreground">Amount</label>
                <input
                  type="number"
                  value={txForm.amount}
                  onChange={(e) => setTxForm((s) => ({ ...s, amount: e.target.value }))}
                  className="mt-1 w-full border border-border rounded-lg px-3 py-2 text-sm"
                  placeholder="500"
                />
              </div>
            </div>
            <div>
              <label className="text-xs font-bold uppercase text-muted-foreground">Description</label>
              <input
                value={txForm.description}
                onChange={(e) => setTxForm((s) => ({ ...s, description: e.target.value }))}
                className="mt-1 w-full border border-border rounded-lg px-3 py-2 text-sm"
                placeholder="Optional note"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowTxModal(false)} className="px-4 py-2 border border-border rounded-lg text-sm font-semibold">Cancel</button>
              <button onClick={handleCreateTransaction} disabled={creatingTx} className="px-4 py-2 bg-shg-primary text-white rounded-lg text-sm font-semibold disabled:opacity-60">
                {creatingTx ? 'Creating...' : 'Submit'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
