import {
  Fingerprint,
  Download,
  Share2,
  TrendingUp,
  Mic,
  CheckCircle2,
  History,
  Brain,
  Leaf,
  Users,
  BookOpen,
  PiggyBank,
  Banknote,
  Sparkles,
  Zap,
  QrCode,
  CalendarClock,
  ArrowRight,
  LifeBuoy,
  Bell,
  MessageSquare,
  Save,
} from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { useApiFetch } from '../hooks/useApi';
import { membersApi, qrApi, agentApi } from '../lib/api';
import QRCodeDisplay from '../components/QRCodeDisplay';
import LoanRequestModal from '../components/LoanRequestModal';
import { toast } from 'sonner';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';

// Skeleton loader
const Skeleton = ({ className = '' }: { className?: string }) => (
  <div className={`bg-surface animate-pulse rounded-lg ${className}`} />
);

interface MemberDashboardProps {
  activeSection?: string;
  onOpenAIAssistant?: () => void;
}

type MemberSettings = {
  language: string;
  whatsappAlerts: boolean;
  weeklyDigest: boolean;
};

function getMemberSettingsStorageKey(memberId?: string) {
  return `saheli-member-settings:${memberId || 'anonymous'}`;
}

function loadMemberSettings(memberId?: string): MemberSettings | null {
  try {
    const raw = localStorage.getItem(getMemberSettingsStorageKey(memberId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<MemberSettings>;
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      language: typeof parsed.language === 'string' ? parsed.language : 'English',
      whatsappAlerts: typeof parsed.whatsappAlerts === 'boolean' ? parsed.whatsappAlerts : true,
      weeklyDigest: typeof parsed.weeklyDigest === 'boolean' ? parsed.weeklyDigest : true,
    };
  } catch {
    return null;
  }
}

function saveMemberSettings(memberId: string | undefined, settings: MemberSettings) {
  try {
    localStorage.setItem(getMemberSettingsStorageKey(memberId), JSON.stringify(settings));
  } catch {
    // Ignore storage write failures.
  }
}

export default function MemberDashboard({ activeSection = 'passport', onOpenAIAssistant }: MemberDashboardProps) {
  const dashboardRef = useRef<HTMLDivElement>(null);
  const [showLoanModal, setShowLoanModal] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [qrData, setQrData] = useState<{ qrCode: string; transactionId: string; explorerUrl: string; whatsapp?: { sent: boolean; attempted?: boolean; error?: string } } | null>(null);
  const [generatingQR, setGeneratingQR] = useState(false);
  const [settings, setSettings] = useState<MemberSettings>({
    language: 'English',
    whatsappAlerts: true,
    weeklyDigest: true,
  });
  const [auditQuery, setAuditQuery] = useState('');

  const { user } = useAuth();
  const { language, setLanguage, t, languages, getLanguageLabel } = useLanguage();
  const memberId = user?._id || 'm1'; // fallback to m1 only if no user (shouldn't happen)

  useEffect(() => {
    const saved = loadMemberSettings(memberId);
    if (saved) {
      setSettings(saved);
      if (saved.language !== language) {
        setLanguage(saved.language as any);
      }
      return;
    }

    setSettings((s) => ({ ...s, language }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberId]);

  const { data: rawMember, loading, error } = useApiFetch(() => membersApi.getById(memberId));
  const { data: repayments } = useApiFetch(() => agentApi.getRepayments());

  // If it's a real MongoDB user newly registered, they might lack these fields from mockData
  const member = React.useMemo(() => {
    if (!rawMember) return null;
    return {
      ...rawMember,
      did: rawMember.did || `ID-${rawMember._id?.slice(0, 8) || 'new'}`,
      repaymentRate: rawMember.repaymentRate ?? 100,
      trustScore: rawMember.trustScore ?? 500,
      trustGrade: rawMember.trustGrade || 'New Member',
      totalSavings: rawMember.totalSavings ?? 0,
      activeLoans: rawMember.activeLoans ?? 0,
      activeLoansAmount: rawMember.activeLoansAmount ?? 0,
      yieldEarned: rawMember.yieldEarned ?? 0,
      transactions: rawMember.transactions || [],
      badges: rawMember.badges || ['New Member'],
    };
  }, [rawMember]);

  useEffect(() => {
    setSettings((s) => ({ ...s, language }));
  }, [language]);


  useEffect(() => {
    const root = dashboardRef.current;
    if (!loading && member && root && root.querySelector('.dashboard-card')) {
      const ctx = gsap.context(() => {
        gsap.from('.dashboard-card', {
          y: 40, opacity: 0, duration: 0.6, stagger: 0.1, ease: 'power2.out'
        });
      }, root);
      return () => ctx.revert();
    }
  }, [loading, member]);

  const handleGenerateQR = async () => {
    setGeneratingQR(true);
    try {
      const qr = await qrApi.generate({
        memberId: memberId,
        memberName: member?.name,
        memberPhone: user?.phone,
        type: 'identity',
        autoSendWhatsApp: true,
      });
      setQrData(qr);
      setShowQR(true);
      if (qr?.whatsapp?.sent) {
        toast.success('QR generated and sent to your WhatsApp');
      } else if (qr?.whatsapp?.attempted && !qr?.whatsapp?.sent) {
        toast.warning(`QR generated, but WhatsApp send failed: ${qr?.whatsapp?.error || 'check Twilio/Cloudinary config'}`);
      } else {
        toast.success('QR Proof generated!');
      }
    } catch {
      toast.error('Could not generate QR — is the API running?');
    }
    setGeneratingQR(false);
  };

  if (error) {
    return (
      <div className="p-10 flex flex-col items-center justify-center min-h-96 text-center">
        <Brain className="w-12 h-12 text-muted-foreground mb-4" />
        <h3 className="font-bold text-lg mb-2">Backend Not Connected</h3>
        <p className="text-muted-foreground text-sm max-w-xs">
          Start the Saheli API server: <code className="bg-surface px-2 py-1 rounded text-xs">cd backend && npm run dev</code>
        </p>
        <p className="text-xs text-muted-foreground mt-4 bg-surface px-4 py-2 rounded-lg font-mono">{error}</p>
      </div>
    );
  }

  if (activeSection === 'ai') {
    return (
      <div className="p-6 lg:p-10 max-w-5xl mx-auto space-y-6">
        <div className="bg-white border border-border/50 rounded-2xl p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-shg-primary mb-2">AI Assistant</p>
              <h2 className="text-2xl font-black font-headline text-on-surface">WhatsApp + Voice Agent</h2>
              <p className="text-sm text-muted-foreground mt-2 max-w-xl">
                Use the live assistant to request loans, check balances, and generate secure proof in natural language.
              </p>
            </div>
            <button
              onClick={onOpenAIAssistant}
              className="px-5 py-2.5 bg-shg-primary text-white rounded-xl font-semibold text-sm flex items-center gap-2 hover:opacity-90"
            >
              <MessageSquare className="w-4 h-4" />
              Open Assistant
            </button>
          </div>
        </div>

        <div className="bg-gradient-to-br from-navy to-navy-light text-white rounded-2xl p-6 border border-border/50">
          <h3 className="font-bold mb-3">Agent Status</h3>
          <p className="text-sm text-white/75">
            AI loan evaluator and repayment scheduler are active. Notifications are synced from database events and WhatsApp commands.
          </p>
        </div>
      </div>
    );
  }

  if (activeSection === 'auto-repayment') {
    return (
      <div className="p-6 lg:p-10 max-w-5xl mx-auto space-y-6">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-shg-primary mb-2">Repayment Center</p>
          <h2 className="text-2xl font-black font-headline text-on-surface">Auto-Repayment Schedule</h2>
        </div>

        <div className="bg-white border border-border/50 rounded-2xl p-6">
          {!repayments || repayments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No active repayment schedules yet.</p>
          ) : (
            <div className="space-y-4">
              {repayments.map((r: { loanId: string; memberName: string; paidInstallments: number; totalInstallments: number; installmentAmount: number; nextDueDate: string; deductionSource: string }) => (
                <div key={r.loanId} className="p-4 bg-surface rounded-xl border border-border/40">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-bold text-on-surface">{r.memberName}</p>
                      <p className="text-xs text-muted-foreground">{r.paidInstallments}/{r.totalInstallments} installments paid</p>
                    </div>
                    <p className="text-sm font-black text-shg-primary">₹{r.installmentAmount?.toLocaleString('en-IN')}/mo</p>
                  </div>
                  <div className="w-full bg-border/30 h-2 rounded-full overflow-hidden mt-3">
                    <div
                      className="h-full bg-shg-primary rounded-full"
                      style={{ width: `${(r.paidInstallments / r.totalInstallments) * 100}%` }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    Next deduction on {new Date(r.nextDueDate).toLocaleDateString('en-IN')} from {r.deductionSource === 'future_deposit' ? 'future deposit' : 'yield share'}.
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (activeSection === 'settings') {
    return (
      <div className="p-6 lg:p-10 max-w-4xl mx-auto space-y-6">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-shg-primary mb-2">{t('preferences', 'Preferences')}</p>
          <h2 className="text-2xl font-black font-headline text-on-surface">{t('settings', 'Settings')}</h2>
        </div>
        <div className="bg-white border border-border/50 rounded-2xl p-6 space-y-5">
          <div>
            <label className="text-xs font-bold uppercase text-muted-foreground">{t('preferredLanguage', 'Preferred Language')}</label>
            <select
              value={settings.language}
              onChange={(e) => {
                const next = e.target.value as typeof language;
                setLanguage(next);
                toast.success(`${t('languageUpdated', 'Language updated')}: ${getLanguageLabel(next)}`);
              }}
              className="mt-2 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm font-medium text-on-surface focus:outline-none focus:ring-2 focus:ring-shg-primary/30"
            >
              {languages.map((lang) => (
                <option key={lang} value={lang}>
                  {getLanguageLabel(lang)}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center justify-between p-4 bg-surface rounded-xl">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Bell className="w-4 h-4 text-shg-primary" />
              {t('whatsappAlerts', 'WhatsApp Alerts')}
            </div>
            <button
              onClick={() => setSettings((s) => ({ ...s, whatsappAlerts: !s.whatsappAlerts }))}
              className={`w-12 h-6 rounded-full transition-colors ${settings.whatsappAlerts ? 'bg-shg-primary' : 'bg-border'}`}
            >
              <span className={`block w-5 h-5 bg-white rounded-full transition-transform ${settings.whatsappAlerts ? 'translate-x-6' : 'translate-x-0.5'}`} />
            </button>
          </div>

          <div className="flex items-center justify-between p-4 bg-surface rounded-xl">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <CalendarClock className="w-4 h-4 text-shg-primary" />
              {t('weeklyDigest', 'Weekly Financial Digest')}
            </div>
            <button
              onClick={() => setSettings((s) => ({ ...s, weeklyDigest: !s.weeklyDigest }))}
              className={`w-12 h-6 rounded-full transition-colors ${settings.weeklyDigest ? 'bg-shg-primary' : 'bg-border'}`}
            >
              <span className={`block w-5 h-5 bg-white rounded-full transition-transform ${settings.weeklyDigest ? 'translate-x-6' : 'translate-x-0.5'}`} />
            </button>
          </div>

          <button
            onClick={() => {
              saveMemberSettings(memberId, settings);
              toast.success(`${t('savePreferences', 'Save Preferences')} (${settings.language})`);
            }}
            className="px-5 py-2.5 bg-shg-primary text-white rounded-xl font-semibold text-sm inline-flex items-center gap-2"
          >
            <Save className="w-4 h-4" />
            {t('savePreferences', 'Save Preferences')}
          </button>
        </div>
      </div>
    );
  }

  if (activeSection === 'treasury') {
    return (
      <div className="p-6 lg:p-10 max-w-5xl mx-auto space-y-6">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-shg-primary mb-2">Member Treasury View</p>
          <h2 className="text-2xl font-black font-headline text-on-surface">Savings and Loan Snapshot</h2>
        </div>
        <div className="bg-white border border-border/50 rounded-2xl p-6 grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-4 bg-surface rounded-xl border border-border/40">
            <p className="text-xs font-bold uppercase text-muted-foreground">Total Savings</p>
            <p className="text-xl font-black mt-2">₹{member?.totalSavings?.toLocaleString('en-IN') || 0}</p>
          </div>
          <div className="p-4 bg-surface rounded-xl border border-border/40">
            <p className="text-xs font-bold uppercase text-muted-foreground">Active Loans</p>
            <p className="text-xl font-black mt-2">₹{member?.activeLoansAmount?.toLocaleString('en-IN') || 0}</p>
          </div>
          <div className="p-4 bg-surface rounded-xl border border-border/40">
            <p className="text-xs font-bold uppercase text-muted-foreground">Yield Earned</p>
            <p className="text-xl font-black mt-2">₹{member?.yieldEarned?.toLocaleString('en-IN') || 0}</p>
          </div>
        </div>
      </div>
    );
  }

  if (activeSection === 'audit') {
    const rows = (member?.transactions || []).filter((tx: any) => {
      const q = auditQuery.trim().toLowerCase();
      if (!q) return true;
      return (
        String(tx.description || '').toLowerCase().includes(q) ||
        String(tx.txHash || '').toLowerCase().includes(q) ||
        String(tx.type || '').toLowerCase().includes(q)
      );
    });

    return (
      <div className="p-6 lg:p-10 max-w-5xl mx-auto space-y-6">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-shg-primary mb-2">Immutable Audit Trail</p>
            <h2 className="text-2xl font-black font-headline text-on-surface">On-Chain Activity Logs</h2>
          </div>
          <input
            value={auditQuery}
            onChange={(e) => setAuditQuery(e.target.value)}
            placeholder="Search by tx hash, type, or description"
            className="w-full max-w-sm border border-border rounded-xl px-3 py-2 text-sm"
          />
        </div>
        <div className="bg-white border border-border/50 rounded-2xl divide-y divide-border/40">
          {rows.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">No matching logs found.</p>
          ) : rows.map((tx: any) => (
            <div key={tx.id} className="p-4">
              <p className="text-sm font-semibold text-on-surface">{tx.description}</p>
              <p className="text-xs text-muted-foreground mt-1">{tx.type} · TX {String(tx.txHash || '').slice(0, 20)}...</p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (activeSection === 'support') {
    return (
      <div className="p-6 lg:p-10 max-w-4xl mx-auto space-y-6">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-shg-primary mb-2">Help Center</p>
          <h2 className="text-2xl font-black font-headline text-on-surface">Support</h2>
        </div>
        <div className="bg-white border border-border/50 rounded-2xl p-6 space-y-4">
          <div className="p-4 rounded-xl bg-surface border border-border/50">
            <p className="text-sm font-semibold text-on-surface">WhatsApp Support</p>
            <p className="text-xs text-muted-foreground mt-1">Message "HELP" to your Saheli WhatsApp bot for guided support in your language.</p>
          </div>
          <div className="p-4 rounded-xl bg-surface border border-border/50">
            <p className="text-sm font-semibold text-on-surface">SHG Leader Escalation</p>
            <p className="text-xs text-muted-foreground mt-1">Loan and payment disputes are escalated to your SHG leader with internal references.</p>
          </div>
          <button
            onClick={() => toast.success('Support ticket created. We will contact you on WhatsApp shortly.')}
            className="px-5 py-2.5 bg-shg-primary text-white rounded-xl font-semibold text-sm inline-flex items-center gap-2"
          >
            <LifeBuoy className="w-4 h-4" />
            Raise Support Ticket
          </button>
        </div>
      </div>
    );
  }

  return (
    <div ref={dashboardRef} className="p-6 lg:p-10 max-w-7xl mx-auto">
      {/* Header */}
      <header className="mb-10">
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
          <div>
            <p className="text-shg-secondary font-semibold uppercase tracking-widest text-[10px] mb-2">
              Empowering Rural Finance
            </p>
            <h1 className="text-3xl lg:text-4xl font-black text-on-surface tracking-tight font-headline">
              Financial Passport
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowLoanModal(true)}
              className="px-5 py-2.5 bg-shg-primary text-white rounded-full font-semibold text-sm flex items-center gap-2 hover:opacity-90 transition-opacity shadow-lg shadow-shg-primary/20"
            >
              <Zap className="w-4 h-4" />
              Request Loan
            </button>
            <span className="bg-shg-secondary/10 text-shg-secondary px-4 py-1.5 rounded-full text-xs font-bold inline-flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 bg-shg-secondary rounded-full animate-pulse" />
              System Verified
            </span>
          </div>
        </div>
      </header>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column */}
        <div className="lg:col-span-8 space-y-6">
          {/* Digital ID Card */}
          <div className="dashboard-card relative overflow-hidden rounded-2xl bg-gradient-to-br from-shg-primary to-blue-700 p-8 text-white shadow-xl">
            <div className="absolute top-0 right-0 -mr-20 -mt-20 w-80 h-80 bg-white/10 rounded-full blur-3xl" />
            <div className="absolute bottom-0 left-0 -ml-10 -mb-10 w-60 h-60 bg-shg-secondary/20 rounded-full blur-2xl" />

            <div className="relative z-10 flex flex-col md:flex-row justify-between items-center gap-8">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-12 h-12 bg-white/20 backdrop-blur-md rounded-xl flex items-center justify-center">
                    <Fingerprint className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    {loading ? (
                      <Skeleton className="h-6 w-36 mb-1" />
                    ) : (
                      <h3 className="font-headline font-bold text-xl leading-none">{member?.name}</h3>
                    )}
                    <p className="text-white/70 text-sm">{loading ? '...' : `Profile ID: ${member?.did}`}</p>
                  </div>
                </div>
                <div className="space-y-4">
                  <div className="inline-flex items-center gap-2 bg-white/10 px-3 py-1 rounded-full text-xs">
                    <span className="w-2 h-2 bg-shg-secondary rounded-full animate-pulse" />
                    Repayment consistency: {loading ? '...' : `${member?.repaymentRate}%`}
                  </div>
                  <p className="text-white/80 max-w-sm text-sm">
                    Your Digital Profile represents your creditworthiness in the global SHG ecosystem.
                  </p>
                </div>
              </div>

              {/* Score Gauge */}
              <div className="relative w-48 h-48 flex flex-col items-center justify-center bg-white/10 backdrop-blur-xl rounded-full border border-white/20 shadow-inner">
                <svg className="absolute inset-0 w-full h-full transform -rotate-90">
                  <circle className="text-white/10" cx="96" cy="96" fill="transparent" r="80" stroke="currentColor" strokeWidth="8" />
                  <circle
                    className="text-shg-secondary"
                    cx="96" cy="96" fill="transparent" r="80"
                    stroke="currentColor" strokeWidth="12" strokeLinecap="round"
                    strokeDasharray="502"
                    strokeDashoffset={loading ? 502 : 502 - (502 * (member?.trustScore || 0) / 1000)}
                    style={{ transition: 'stroke-dashoffset 1s ease-out' }}
                  />
                </svg>
                <div className="text-center">
                  <span className="block text-5xl font-extrabold font-headline tracking-tighter">
                    {loading ? '—' : member?.trustScore}
                  </span>
                  <span className="text-[10px] uppercase tracking-widest font-bold text-white/70">Trust Score</span>
                </div>
                <div className="absolute -bottom-2 bg-shg-secondary px-3 py-1 rounded-lg text-[10px] font-bold shadow-lg">
                  {loading ? '...' : member?.trustGrade}
                </div>
              </div>
            </div>
          </div>

          {/* Wallet Overview */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Total Savings */}
            <div className="dashboard-card bg-white p-6 rounded-2xl border border-border/50 hover:shadow-card-hover transition-shadow">
              <div className="flex justify-between items-start mb-4">
                <PiggyBank className="w-6 h-6 text-shg-primary" />
                <span className="text-[10px] font-bold text-shg-primary bg-shg-primary/10 px-2 py-0.5 rounded">VITAL</span>
              </div>
              <h4 className="text-muted-foreground text-xs font-bold uppercase tracking-wider mb-1">Total Savings</h4>
              {loading ? <Skeleton className="h-8 w-32 mt-2" /> : (
                <p className="text-2xl font-extrabold font-headline">₹{member?.totalSavings?.toLocaleString('en-IN')}</p>
              )}
              <div className="mt-4 pt-4 border-t border-border/50 flex justify-between items-center">
                <span className="text-[10px] text-muted-foreground">Platform Fees</span>
                <span className="text-[10px] font-bold text-shg-secondary">₹0 (Subsidized)</span>
              </div>
            </div>

            {/* Active Loans */}
            <div className="dashboard-card bg-white p-6 rounded-2xl border border-border/50 hover:shadow-card-hover transition-shadow">
              <div className="flex justify-between items-start mb-4">
                <Banknote className="w-6 h-6 text-shg-tertiary" />
                <span className="text-[10px] font-bold text-shg-tertiary bg-shg-tertiary/10 px-2 py-0.5 rounded">
                  {loading ? '...' : `${member?.activeLoans} ACTIVE`}
                </span>
              </div>
              <h4 className="text-muted-foreground text-xs font-bold uppercase tracking-wider mb-1">Active Loans</h4>
              {loading ? <Skeleton className="h-8 w-32 mt-2" /> : (
                <p className="text-2xl font-extrabold font-headline">₹{member?.activeLoansAmount?.toLocaleString('en-IN')}</p>
              )}
              <div className="mt-4 pt-4 border-t border-border/50">
                <div className="w-full bg-surface h-1.5 rounded-full overflow-hidden">
                  <div className="bg-shg-tertiary h-full w-[65%] rounded-full" />
                </div>
                <span className="text-[10px] text-muted-foreground mt-1 block">65% Repaid</span>
              </div>
            </div>

            {/* Yield Earned */}
            <div className="dashboard-card bg-white p-6 rounded-2xl border border-border/50 hover:shadow-card-hover transition-shadow">
              <div className="flex justify-between items-start mb-4">
                <Sparkles className="w-6 h-6 text-shg-secondary" />
                <span className="text-[10px] font-bold text-shg-secondary bg-shg-secondary/10 px-2 py-0.5 rounded">AI MANAGED</span>
              </div>
              <h4 className="text-muted-foreground text-xs font-bold uppercase tracking-wider mb-1">Yield Earned</h4>
              {loading ? <Skeleton className="h-8 w-32 mt-2" /> : (
                <p className="text-2xl font-extrabold font-headline">₹{member?.yieldEarned?.toLocaleString('en-IN')}</p>
              )}
              <p className="text-[10px] text-shg-secondary font-bold mt-4 flex items-center">
                <TrendingUp className="w-3 h-3 mr-1" />
                +12% APY this month
              </p>
            </div>
          </div>

          {/* Recent Activity */}
          <div className="dashboard-card bg-white p-6 rounded-2xl border border-border/50">
            <div className="flex justify-between items-center mb-6">
              <h3 className="font-headline font-bold text-lg">Recent Activity</h3>
              <button className="text-shg-primary font-semibold text-sm hover:underline">View All</button>
            </div>
            {loading ? (
              <div className="space-y-4">
                {[1, 2, 3].map(i => (
                  <div key={i} className="flex items-center gap-4">
                    <Skeleton className="w-10 h-10 rounded-full" />
                    <Skeleton className="flex-1 h-10" />
                    <Skeleton className="w-20 h-8" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-4">
                {(member?.transactions || []).slice(0, 4).map((tx: { id: string; type: string; agentProcessed?: boolean; description: string; transactionId?: string; amount: number; timestamp: string }) => (
                  <div key={tx.id} className="flex items-center gap-4 group">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform ${
                      tx.type === 'deposit' ? 'bg-shg-secondary/10 text-shg-secondary' :
                      tx.type === 'loan_disbursement' ? 'bg-shg-primary/10 text-shg-primary' :
                      'bg-surface text-muted-foreground'
                    }`}>
                      {tx.agentProcessed ? <Mic className="w-5 h-5" /> :
                       tx.type === 'deposit' ? <CheckCircle2 className="w-5 h-5" /> :
                       <History className="w-5 h-5" />}
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-semibold">{tx.description}</p>
                      <p className="text-xs text-muted-foreground">
                        {tx.agentProcessed ? 'AI Agent processed' : 'Manual transaction'} · ID: {tx.transactionId?.slice(0, 12)}...
                      </p>
                    </div>
                    <div className="text-right">
                      <p className={`text-sm font-bold ${tx.amount > 0 ? 'text-shg-secondary' : 'text-shg-error'}`}>
                        {tx.amount > 0 ? '+' : ''}₹{Math.abs(tx.amount).toLocaleString('en-IN')}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        {new Date(tx.timestamp).toLocaleDateString('en-IN')}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Column */}
        <div className="lg:col-span-4 space-y-6">
          {/* QR Code Hub */}
          <div className="dashboard-card bg-white p-6 rounded-2xl border border-border/50 text-center">
            <h3 className="font-headline font-bold text-lg mb-2">Offline Proof</h3>
            <p className="text-xs text-muted-foreground mb-6">
              Share this QR with bank officials to verify your identity without internet.
            </p>
            {showQR && qrData ? (
              <QRCodeDisplay
                qrCode={qrData.qrCode}
                transactionId={qrData.transactionId}
                memberName={member?.name}
                compact={true}
              />
            ) : (
              <div className="relative inline-block p-4 bg-white rounded-2xl shadow-xl border-4 border-surface mb-6">
                <div className="w-40 h-40 bg-gradient-to-br from-shg-primary/5 to-shg-secondary/5 rounded-lg flex items-center justify-center">
                  <QrCode className="w-16 h-16 text-shg-primary/30" />
                </div>
              </div>
            )}
            <div className="space-y-3 mt-4">
              <button
                onClick={handleGenerateQR}
                disabled={generatingQR}
                className="w-full bg-shg-secondary text-white py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 shadow-lg active:scale-95 transition-transform disabled:opacity-70"
              >
                {generatingQR ? (
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <Share2 className="w-4 h-4" />
                )}
                {generatingQR ? 'Generating...' : (showQR ? 'Regenerate QR' : 'Generate QR Proof')}
              </button>
              {showQR && qrData && (
                <button
                  className="w-full bg-white border border-border text-on-surface py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2 hover:bg-surface transition-colors"
                  onClick={() => {
                    const a = document.createElement('a');
                    a.href = qrData.qrCode;
                    a.download = 'saheli-proof.png';
                    a.click();
                  }}
                >
                  <Download className="w-4 h-4" />
                  Download Card
                </button>
              )}
            </div>
          </div>

          {/* AI Agent Insight */}
          <div className="dashboard-card bg-gradient-to-br from-navy to-navy-light p-6 rounded-2xl text-white">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-8 h-8 bg-shg-primary/20 rounded-lg flex items-center justify-center">
                <Brain className="w-4 h-4 text-shg-primary" />
              </div>
              <h4 className="font-bold text-sm">AI Agent Advice</h4>
            </div>
            <p className="text-sm text-white/70 mb-6 italic">
              "Based on your grain harvest cycle, I've reserved ₹4,000 for your loan repayment next week to maintain your {loading ? '...' : member?.trustScore} score."
            </p>
            <div className="bg-white/10 p-4 rounded-xl">
              <div className="flex justify-between text-[10px] uppercase font-bold text-white/50 mb-1">
                <span>Optimization</span>
                <span>88% Complete</span>
              </div>
              <div className="w-full bg-white/5 h-1.5 rounded-full overflow-hidden">
                <div className="bg-shg-primary h-full w-[88%] rounded-full" />
              </div>
            </div>
          </div>

          {/* Auto-Repayment Schedule */}
          {repayments && repayments.length > 0 && (
            <div className="dashboard-card bg-white p-6 rounded-2xl border border-border/50">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-7 h-7 bg-shg-primary/10 rounded-lg flex items-center justify-center">
                  <CalendarClock className="w-4 h-4 text-shg-primary" />
                </div>
                <h4 className="font-headline font-bold text-sm">Auto-Repayment</h4>
                <span className="ml-auto text-[9px] font-bold text-shg-primary bg-shg-primary/10 px-2 py-0.5 rounded">AI MANAGED</span>
              </div>
              <div className="space-y-3">
                {repayments.slice(0, 2).map((r: { loanId: string; memberName: string; paidInstallments: number; totalInstallments: number; installmentAmount: number; nextDueDate: string; deductionSource: string }) => (
                  <div key={r.loanId} className="p-3 bg-surface rounded-xl">
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <p className="text-xs font-bold text-on-surface">{r.memberName}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {r.paidInstallments}/{r.totalInstallments} paid
                        </p>
                      </div>
                      <span className="text-xs font-black text-shg-primary">₹{r.installmentAmount?.toLocaleString('en-IN')}/mo</span>
                    </div>
                    <div className="w-full bg-border/30 h-1.5 rounded-full overflow-hidden mb-2">
                      <div
                        className="h-full bg-shg-primary rounded-full transition-all duration-700"
                        style={{ width: `${(r.paidInstallments / r.totalInstallments) * 100}%` }}
                      />
                    </div>
                    <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                      <ArrowRight className="w-3 h-3" />
                      Next: {new Date(r.nextDueDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                      · From {r.deductionSource === 'future_deposit' ? 'next deposit' : 'yield share'}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Impact Badges */}
          {!loading && member?.badges && (
            <div className="dashboard-card bg-white p-6 rounded-2xl border border-border/50">
              <h4 className="font-headline font-bold text-xs uppercase text-muted-foreground mb-4">Community Impact</h4>
              <div className="flex flex-wrap gap-2">
                {member.badges.map((badge: string) => (
                  <div key={badge} className="bg-shg-secondary/10 text-shg-secondary px-3 py-1.5 rounded-lg text-[10px] font-bold border border-shg-secondary/20 flex items-center gap-1">
                    <Leaf className="w-3 h-3" />
                    {badge}
                  </div>
                ))}
                <div className="bg-shg-primary/10 text-shg-primary px-3 py-1.5 rounded-lg text-[10px] font-bold border border-shg-primary/20 flex items-center gap-1">
                  <Users className="w-3 h-3" />
                  Leader Mentor
                </div>
                <div className="bg-shg-tertiary/10 text-shg-tertiary px-3 py-1.5 rounded-lg text-[10px] font-bold border border-shg-tertiary/20 flex items-center gap-1">
                  <BookOpen className="w-3 h-3" />
                  Early Adopter
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Loan Modal */}
      {showLoanModal && (
        <LoanRequestModal
          onClose={() => setShowLoanModal(false)}
          memberId={memberId}
          memberName={member?.name}
          trustScore={member?.trustScore}
        />
      )}
    </div>
  );
}
