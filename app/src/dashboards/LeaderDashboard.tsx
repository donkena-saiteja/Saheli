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
} from 'lucide-react';
import { useEffect, useRef, useState, useCallback } from 'react';
import { gsap } from 'gsap';
import { useApiFetch, useApiPolling, useApiMutation } from '../hooks/useApi';
import { statsApi, multisigApi, aiAgentApi, agentApi, transactionsApi, membersApi, loansApi, qrApi } from '../lib/api';
import { toast } from 'sonner';
import AgentTerminal from '../components/AgentTerminal';
import IdleFundPanel from '../components/IdleFundPanel';
import QRCodeDisplay from '../components/QRCodeDisplay';

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

  const { data: treasury, loading: loadingTreasury } = useApiFetch(() => statsApi.getTreasury());
  const { data: pendingActions, loading: loadingActions, refetch: refetchActions } = useApiPolling(() => multisigApi.getPending(), 4000);
  const { data: aiLog, loading: loadingLog } = useApiPolling(() => aiAgentApi.getLog(), 8000);
  const { data: aiInsights } = useApiFetch(() => aiAgentApi.getInsights());
  const { data: agentLog, refetch: refetchAgentLog } = useApiPolling(() => agentApi.getLog(), 6000);
  const { data: vaultData, loading: loadingVaults, refetch: refetchVaults } = useApiFetch(() => agentApi.getVaults());
  const { data: members } = useApiFetch(() => membersApi.getAll());
  const { data: loans, loading: loadingLoans, refetch: refetchLoans } = useApiFetch(() => loansApi.getAll());

  const { mutate: signAction, loading: signing } = useApiMutation((id: string) => multisigApi.sign(id, 'leader_current'));
  const { mutate: rejectAction } = useApiMutation((id: string) => multisigApi.reject(id));
  const { mutate: createTransaction, loading: creatingTx } = useApiMutation((body: any) => transactionsApi.create(body));
  const { mutate: approveLoan, loading: approvingLoan } = useApiMutation((id: string) => loansApi.approve(id));

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

  const handleApprove = async (id: string) => {
    try {
      const res = await signAction(id);
      setActionMessages(prev => ({ ...prev, [id]: res.message }));
      toast.success(res.message);
      refetchActions();
    } catch {
      toast.error('Could not sign — is the API running?');
    }
  };

  const handleReject = async (id: string) => {
    try {
      const res = await rejectAction(id);
      setActionMessages(prev => ({ ...prev, [id]: res.message }));
      toast.error(res.message);
      refetchActions();
    } catch {
      toast.error('Could not reject action');
    }
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

  const handleExportReport = () => {
    const rows = [
      ['Section', 'Metric', 'Value'],
      ['Treasury', 'Total Liquidity', String(treasury?.totalLiquidity || 0)],
      ['Treasury', 'Yield This Month', String(treasury?.yieldThisMonth || 0)],
      ['Approvals', 'Pending Leader Approvals', String((pendingActions || []).length)],
      ['Loans', 'Pending Loan Requests', String((loans || []).filter((l: any) => l.status === 'pending').length)],
      ['Loans', 'Approved Loans', String((loans || []).filter((l: any) => l.status === 'approved').length)],
    ];
    const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `saheli-leader-report-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Report exported successfully');
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
    } catch {
      toast.error('Transaction failed. Check backend connection.');
    }
  };

  const handleApproveLoan = async (loanId: string) => {
    try {
      const res = await approveLoan(loanId);
      toast.success(res.message || 'Loan approval recorded');
      refetchLoans();
    } catch {
      toast.error('Unable to approve loan');
    }
  };

  const handleGenerateLoanQR = async (loan: any) => {
    if (loan.status !== 'approved' || !loan.transactionId) {
      toast.error('Loan must be approved before generating QR');
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
      <div className="p-6 lg:p-10 max-w-5xl mx-auto space-y-6">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-shg-primary mb-2">AI Insights</p>
          <h2 className="text-2xl font-black font-headline text-on-surface">Agentic Recommendations</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {(aiInsights?.insights || []).map((insight: any, idx: number) => (
            <div key={idx} className="bg-white border border-border/50 rounded-2xl p-5">
              <p className="text-xs font-bold uppercase text-muted-foreground">{insight.type?.replace(/_/g, ' ')}</p>
              <h3 className="font-bold text-on-surface mt-2">{insight.title}</h3>
              <p className="text-sm text-muted-foreground mt-2">{insight.body}</p>
              <span className={`inline-flex mt-3 px-2.5 py-1 rounded-full text-[10px] font-bold ${
                insight.priority === 'high' ? 'bg-red-50 text-red-700' : insight.priority === 'medium' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'
              }`}>
                {insight.priority} priority
              </span>
            </div>
          ))}
        </div>
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
              <button onClick={handleExportReport} className="px-5 py-2.5 bg-surface text-on-surface rounded-full font-semibold text-sm hover:bg-surface-container transition-colors flex items-center gap-2">
                <FileText className="w-4 h-4" />
                Export Report
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
          {loadingTreasury ? <Skeleton className="h-9 w-36 mb-2" /> : (
            <div className="text-3xl font-black font-headline text-on-surface">
              ₹{treasury?.totalLiquidity?.toLocaleString('en-IN')}
            </div>
          )}
          <div className="flex items-center gap-1 text-shg-secondary text-sm font-semibold mt-2">
            <ArrowUpRight className="w-4 h-4" />
            +{loadingTreasury ? '...' : treasury?.yieldThisMonth}% yield this month
          </div>
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

      {/* Loan approvals (leader gating before QR) */}
      <section className="bg-white border border-border/50 rounded-2xl p-6">
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-lg font-bold font-headline text-on-surface">Loan Requests</h3>
          <span className="text-xs font-bold text-muted-foreground">
            {(loans || []).filter((l: any) => l.status === 'pending').length} pending approvals
          </span>
        </div>

        {loadingLoans ? (
          <Skeleton className="h-24 w-full" />
        ) : (loans || []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No loan requests found.</p>
        ) : (
          <div className="space-y-4">
            {(loans || []).slice(0, 6).map((loan: any) => (
              <div key={loan.id} className="p-4 bg-surface rounded-xl border border-border/40">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div>
                    <p className="font-bold text-on-surface">{loan.memberName} · ₹{loan.amount?.toLocaleString('en-IN')}</p>
                    <p className="text-xs text-muted-foreground mt-1">Purpose: {loan.purpose}</p>
                    <p className="text-xs text-muted-foreground">Status: <span className="font-semibold uppercase">{loan.status}</span> ({loan.approvals}/{loan.approvalsRequired})</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {loan.status === 'pending' && !isReadOnly && (
                      <button
                        onClick={() => handleApproveLoan(loan.id)}
                        disabled={approvingLoan}
                        className="px-4 py-2 bg-shg-primary text-white rounded-lg text-sm font-bold disabled:opacity-60"
                      >
                        Approve Loan
                      </button>
                    )}
                    <button
                      onClick={() => handleGenerateLoanQR(loan)}
                      disabled={loan.status !== 'approved'}
                      className="px-4 py-2 border border-border rounded-lg text-sm font-bold hover:bg-white disabled:opacity-50"
                    >
                      Generate QR
                    </button>
                  </div>
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

      {/* Main Content Grid — Multi-Sig + Classic AI Log */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Multi-Sig Pending Actions */}
        <div className="lg:col-span-8 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold font-headline text-on-surface flex items-center gap-2">
              <Shield className="w-5 h-5 text-shg-primary" />
              Multi-Leader Pending Actions
            </h3>
            {!loadingActions && (
              <span className="px-3 py-1 bg-shg-tertiary/10 text-shg-tertiary rounded-full text-xs font-bold">
                {pendingActions?.length || 0} REQUIRES APPROVAL
              </span>
            )}
          </div>

          {loadingActions ? (
            <div className="space-y-4">
              {[1, 2].map(i => <Skeleton key={i} className="h-32 w-full rounded-2xl" />)}
            </div>
          ) : (pendingActions || []).length === 0 ? (
            <div className="bg-white rounded-2xl border border-border/50 p-10 text-center">
              <CheckCircle2 className="w-10 h-10 text-shg-secondary mx-auto mb-3" />
              <p className="font-bold text-on-surface">All clear! No pending approvals.</p>
            </div>
          ) : (
            (pendingActions || []).map((action: any) => (
              <div key={action.id} className={`dashboard-card bg-white p-6 rounded-2xl border-l-4 border border-border/50 ${action.isEmergency ? 'border-l-red-500' : 'border-l-shg-primary'}`}>
                {action.isEmergency && (
                  <div className="flex items-center gap-2 mb-3 px-3 py-1.5 bg-red-50 border border-red-100 rounded-lg w-fit">
                    <ShieldAlert className="w-3.5 h-3.5 text-red-500" />
                    <span className="text-[10px] font-bold text-red-600 uppercase tracking-wider">Emergency Override · 1-of-3 Threshold</span>
                  </div>
                )}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-on-surface font-headline">{action.description}</span>
                      <span className="text-xs px-2 py-0.5 bg-surface rounded text-muted-foreground">
                        ID: #{action.id.slice(0, 4).toUpperCase()}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Requested by <span className="font-semibold">{action.requestedBy}</span>
                    </p>
                    <div className="text-xl font-black font-headline text-shg-primary mt-2">
                      ₹{action.amount?.toLocaleString('en-IN')}
                    </div>
                    {actionMessages[action.id] && (
                      <p className="text-xs font-semibold text-shg-secondary bg-shg-secondary/10 px-3 py-1 rounded-lg mt-2">
                        {actionMessages[action.id]}
                      </p>
                    )}
                    <div className="w-full md:w-64 space-y-3">
                      <div className="flex justify-between text-xs font-bold text-muted-foreground">
                        <span>APPROVAL PROGRESS</span>
                        <span>{action.signatures.length}/{action.signaturesRequired} APPROVED</span>
                      </div>
                      <div className="h-2 bg-surface rounded-full overflow-hidden">
                        <div
                          className="h-full bg-shg-primary rounded-full transition-all duration-500"
                          style={{ width: `${(action.signatures.length / action.signaturesRequired) * 100}%` }}
                        />
                      </div>
                      {isReadOnly ? (
                        <p className="text-xs text-muted-foreground italic text-center py-1">Approval requires Leader role</p>
                      ) : (
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleApprove(action.id)}
                            disabled={signing}
                            className="flex-1 py-2 bg-shg-primary text-white rounded-lg text-sm font-bold active:scale-95 transition-transform hover:opacity-90 disabled:opacity-60"
                          >
                            {signing ? '...' : 'Approve'}
                          </button>
                          <button
                            onClick={() => handleReject(action.id)}
                            className="px-3 py-2 border border-border text-shg-error rounded-lg text-sm font-bold hover:bg-shg-error/10 transition-colors"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
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
