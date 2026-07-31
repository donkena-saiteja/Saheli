import {
  QrCode,
  CheckCircle2,
  Filter,
  Download,
  Search,
  Landmark,
  Activity,
  LifeBuoy,
  Save,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { useApiFetch, useApiMutation, useApiPolling } from '../hooks/useApi';
import { qrApi, statsApi } from '../lib/api';
import { toast } from 'sonner';
import { useLanguage } from '../contexts/LanguageContext';

const Skeleton = ({ className = '' }: { className?: string }) => (
  <div className={`bg-surface animate-pulse rounded-lg ${className}`} />
);

function timeAgo(ts: string) {
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} mins ago`;
  return `${Math.floor(diff / 3600000)}+ hours ago`;
}

interface BankDashboardProps {
  activeSection?: string;
}

type BankSettings = {
  preferredLanguage: string;
  autoAuditAlerts: boolean;
  grantApproval2FA: boolean;
};

const BANK_SETTINGS_STORAGE_KEY = 'saheli-bank-settings';

function loadBankSettings(): BankSettings | null {
  try {
    const raw = localStorage.getItem(BANK_SETTINGS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<BankSettings>;
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      preferredLanguage: typeof parsed.preferredLanguage === 'string' ? parsed.preferredLanguage : 'English',
      autoAuditAlerts: typeof parsed.autoAuditAlerts === 'boolean' ? parsed.autoAuditAlerts : true,
      grantApproval2FA: typeof parsed.grantApproval2FA === 'boolean' ? parsed.grantApproval2FA : true,
    };
  } catch {
    return null;
  }
}

function saveBankSettings(settings: BankSettings) {
  try {
    localStorage.setItem(BANK_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage write failures.
  }
}

export default function BankDashboard({ activeSection = 'scanner' }: BankDashboardProps) {
  const dashboardRef = useRef<HTMLDivElement>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanInput, setScanInput] = useState('');
  const [scanResult, setScanResult] = useState<any>(null);
  const [directoryQuery, setDirectoryQuery] = useState('');
  const [auditFilter, setAuditFilter] = useState<'all' | 'IMMUTABLE_OK' | 'PENDING_AUDIT' | 'FLAGGED'>('all');
  const [settings, setSettings] = useState<BankSettings>({
    preferredLanguage: 'English',
    autoAuditAlerts: true,
    grantApproval2FA: true,
  });
  const { language, setLanguage, t, languages, getLanguageLabel } = useLanguage();

  useEffect(() => {
    const saved = loadBankSettings();
    if (!saved) {
      setSettings((s) => ({ ...s, preferredLanguage: language }));
      return;
    }

    setSettings(saved);
    if (saved.preferredLanguage !== language) {
      setLanguage(saved.preferredLanguage as any);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { data: stats, loading: loadingStats, refetch: refetchStats } = useApiFetch(() => statsApi.getInstitutional());
  const { data: shgDirectory, loading: loadingDirectory } = useApiFetch(() => statsApi.getSHGDirectory());
  const { data: ledger } = useApiPolling(() => statsApi.getLedger(), 6000);
  const { mutate: verifyTx, loading: verifyingTx } = useApiMutation((txHash: string) => qrApi.verify(txHash));
  const { mutate: approveGrant, loading: approvingGrant } = useApiMutation((_input: null) => statsApi.approveGrant());

  useEffect(() => {
    setSettings((s) => ({ ...s, preferredLanguage: language }));
  }, [language]);

  const filteredDirectory = useMemo(() => {
    const q = directoryQuery.trim().toLowerCase();
    return (shgDirectory || []).filter((shg: any) => {
      const matchesFilter = auditFilter === 'all' || shg.auditStatus === auditFilter;
      if (!matchesFilter) return false;
      if (!q) return true;
      return (
        String(shg.name || '').toLowerCase().includes(q) ||
        String(shg.registrationId || '').toLowerCase().includes(q)
      );
    });
  }, [shgDirectory, directoryQuery, auditFilter]);

  useEffect(() => {
    const root = dashboardRef.current;
    if (!loadingStats && root && root.querySelector('.dashboard-card')) {
      const ctx = gsap.context(() => {
        gsap.from('.dashboard-card', { y: 40, opacity: 0, duration: 0.6, stagger: 0.1, ease: 'power2.out' });
      }, root);
      return () => ctx.revert();
    }
  }, [loadingStats]);

  const chartMonths = [
    { month: 'Jan', pct: 40 }, { month: 'Feb', pct: 55 }, { month: 'Mar', pct: 45 },
    { month: 'Apr', pct: 70 }, { month: 'May', pct: 85 }, { month: 'Jun', pct: 95 },
  ];

  const handleVerifyScan = async () => {
    if (!scanInput.trim()) {
      toast.error('Enter transaction hash or QR JSON payload');
      return;
    }

    try {
      let txHash = scanInput.trim();
      if (txHash.startsWith('{')) {
        const parsed = JSON.parse(txHash);
        txHash = parsed.txHash || txHash;
      }
      const result = await verifyTx(txHash);
      setScanResult(result);
      toast.success('Transaction verified successfully');
    } catch {
      toast.error('Could not verify transaction payload');
    }
  };

  const handleApproveGrant = async () => {
    try {
      const res = await approveGrant(null);
      toast.success(res.message || 'Grant approved');
      refetchStats();
    } catch {
      toast.error('Grant approval failed');
    }
  };

  const handleCycleFilter = () => {
    const order: Array<'all' | 'IMMUTABLE_OK' | 'PENDING_AUDIT' | 'FLAGGED'> = ['all', 'IMMUTABLE_OK', 'PENDING_AUDIT', 'FLAGGED'];
    const idx = order.indexOf(auditFilter);
    const next = order[(idx + 1) % order.length];
    setAuditFilter(next);
    toast.success(next === 'all' ? 'Showing all SHGs' : `Filter: ${next}`);
  };

  const handleDownloadDirectory = () => {
    const rows = [
      ['Group Name', 'Registration ID', 'Trust Score', 'Active Loans', 'Yield/mo', 'Audit Status'],
      ...filteredDirectory.map((shg: any) => [shg.name, shg.registrationId, shg.trustScore, shg.activeLoans, shg.yieldThisMonth, shg.auditStatus]),
    ];
    const csv = rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `saheli-shg-directory-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Regional SHG directory exported');
  };

  if (activeSection === 'settings') {
    return (
      <div className="p-6 lg:p-10 max-w-4xl mx-auto space-y-6">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-shg-primary mb-2">{t('institutionSettings', 'Institution Settings')}</p>
          <h2 className="text-2xl font-black font-headline text-on-surface">{t('settings', 'Settings')}</h2>
        </div>
        <div className="bg-white border border-border/50 rounded-2xl p-6 space-y-4">
          <p className="text-sm text-muted-foreground">Configure bank-level scanner workflows, audit frequency, and grant release preferences.</p>
          <div>
            <p className="text-xs font-bold uppercase text-muted-foreground mb-2">{t('preferredLanguage', 'Preferred Language')}</p>
            <select
              value={settings.preferredLanguage}
              onChange={(e) => {
                const next = e.target.value as typeof language;
                setLanguage(next);
                toast.success(`${t('languageUpdated', 'Language updated')}: ${getLanguageLabel(next)}`);
              }}
              className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm font-medium text-on-surface focus:outline-none focus:ring-2 focus:ring-shg-primary/30"
            >
              {languages.map((lang) => (
                <option key={lang} value={lang}>
                  {getLanguageLabel(lang)}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center justify-between p-4 bg-surface rounded-xl">
            <span className="text-sm font-semibold">{t('autoAuditAlerts', 'Auto Audit Alerts')}</span>
            <button
              onClick={() => setSettings((s) => ({ ...s, autoAuditAlerts: !s.autoAuditAlerts }))}
              className={`w-12 h-6 rounded-full ${settings.autoAuditAlerts ? 'bg-shg-primary' : 'bg-border'}`}
            >
              <span className={`block w-5 h-5 bg-white rounded-full transition-transform ${settings.autoAuditAlerts ? 'translate-x-6' : 'translate-x-0.5'}`} />
            </button>
          </div>
          <div className="flex items-center justify-between p-4 bg-surface rounded-xl">
            <span className="text-sm font-semibold">{t('grantApproval2FA', 'Grant Approval 2FA')}</span>
            <button
              onClick={() => setSettings((s) => ({ ...s, grantApproval2FA: !s.grantApproval2FA }))}
              className={`w-12 h-6 rounded-full ${settings.grantApproval2FA ? 'bg-shg-primary' : 'bg-border'}`}
            >
              <span className={`block w-5 h-5 bg-white rounded-full transition-transform ${settings.grantApproval2FA ? 'translate-x-6' : 'translate-x-0.5'}`} />
            </button>
          </div>
          <button
            onClick={() => {
              saveBankSettings(settings);
              toast.success('Institution settings saved');
            }}
            className="px-5 py-2.5 bg-shg-primary text-white rounded-xl font-semibold text-sm inline-flex items-center gap-2"
          >
            <Save className="w-4 h-4" />
            {t('saveSettings', 'Save Settings')}
          </button>
        </div>
      </div>
    );
  }

  if (activeSection === 'support') {
    return (
      <div className="p-6 lg:p-10 max-w-4xl mx-auto space-y-6">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-shg-primary mb-2">Institution Support</p>
          <h2 className="text-2xl font-black font-headline text-on-surface">Support</h2>
        </div>
        <div className="bg-white border border-border/50 rounded-2xl p-6 space-y-4">
          <p className="text-sm text-muted-foreground">Need help with scanner onboarding, compliance exports, or grant audit proof?</p>
          <button onClick={() => toast.success('Support request sent to Saheli enterprise team')} className="px-5 py-2.5 bg-shg-primary text-white rounded-xl font-semibold text-sm inline-flex items-center gap-2">
            <LifeBuoy className="w-4 h-4" />
            Contact Support
          </button>
        </div>
      </div>
    );
  }

  return (
    <div ref={dashboardRef} className="p-6 lg:p-10 max-w-7xl mx-auto">
      {/* Header */}
      <header className="mb-10">
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6">
          <div>
            <span className="text-[10px] font-bold text-shg-primary uppercase tracking-widest mb-2 block">
              Institutional Dashboard
            </span>
            <h1 className="text-3xl lg:text-4xl font-black font-headline text-on-surface tracking-tight">
              Financial Oversight
            </h1>
            <p className="text-muted-foreground mt-2 max-w-lg text-sm">
              Monitor, audit, and provide liquidity to regional SHGs with real-time on-chain transparency.
            </p>
          </div>
          <div className="flex gap-4">
            <div className="bg-white px-6 py-4 rounded-xl border border-border/50">
              <span className="text-[10px] font-bold text-muted-foreground uppercase block mb-1">Regional Liquidity</span>
              {loadingStats ? <Skeleton className="h-7 w-24" /> : (
                <span className="text-2xl font-black font-headline text-shg-secondary">
                  ₹{((stats?.regionalLiquidity || 0) / 10000000).toFixed(1)} Cr
                </span>
              )}
            </div>
            <div className="bg-white px-6 py-4 rounded-xl border border-border/50">
              <span className="text-[10px] font-bold text-muted-foreground uppercase block mb-1">Active Grants</span>
              {loadingStats ? <Skeleton className="h-7 w-16" /> : (
                <span className="text-2xl font-black font-headline text-shg-primary">{stats?.activeGrants}</span>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Bento Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* QR Scanner */}
        <div className="lg:col-span-4 dashboard-card bg-white rounded-2xl p-8 flex flex-col items-center justify-center text-center relative overflow-hidden border border-border/50">
          <div className="absolute inset-0 bg-shg-primary/5 opacity-40 pointer-events-none" />
          <div className="relative z-10">
            <div className="w-28 h-28 bg-white rounded-2xl shadow-xl flex items-center justify-center mb-5 mx-auto group cursor-pointer hover:scale-105 transition-transform">
              <QrCode className="w-14 h-14 text-shg-primary" />
            </div>
            <h3 className="text-lg font-bold font-headline mb-2">Offline Verification</h3>
            <p className="text-sm text-muted-foreground mb-5 px-2">
              Scan the member's Physical d-SBT card to fetch immutable credit history from the ledger.
            </p>
            <button
              onClick={() => setScannerOpen(true)}
              className="px-6 py-2.5 bg-shg-primary text-white rounded-full font-bold text-sm hover:shadow-lg transition-all active:scale-95"
            >
              Launch Scanner
            </button>
          </div>
          <div className="absolute top-1/2 left-0 w-full h-[1px] bg-shg-secondary/30 blur-[2px]" />
        </div>

        {/* Analytics Chart */}
        <div className="lg:col-span-8 dashboard-card bg-white rounded-2xl p-6 border border-border/50">
          <div className="flex justify-between items-center mb-6">
            <div>
              <h3 className="text-lg font-bold font-headline">Yield & Repayment Dynamics</h3>
              <p className="text-sm text-muted-foreground">Real-time cross-regional performance data</p>
            </div>
            <div className="flex items-center gap-2 text-xs font-bold text-shg-secondary bg-shg-secondary/10 px-3 py-1.5 rounded-full">
              <span className="w-2 h-2 rounded-full bg-shg-secondary animate-pulse" />
              {loadingStats ? '...' : `${stats?.repaymentRate}%`} Repayment
            </div>
          </div>
          <div className="h-48 flex items-end justify-between gap-3 px-2 mb-6">
            {chartMonths.map((bar, i) => (
              <div key={i} className="flex-1 bg-surface rounded-t-lg relative group h-full flex items-end">
                <div
                  className={`absolute bottom-0 w-full rounded-t-lg transition-all duration-300 group-hover:bg-shg-primary ${
                    i === chartMonths.length - 1 ? 'bg-shg-secondary/40' : 'bg-shg-primary/20'
                  }`}
                  style={{ height: `${bar.pct}%` }}
                />
                <span className="absolute -top-6 left-1/2 -translate-x-1/2 text-[10px] font-bold opacity-0 group-hover:opacity-100 transition-opacity">
                  {bar.month}
                </span>
              </div>
            ))}
          </div>
          <div className="flex flex-col sm:flex-row justify-between items-center pt-4 border-t border-border/50 gap-4">
            <div className="flex gap-6">
              <div>
                <p className="text-[10px] font-bold text-muted-foreground uppercase">Locked Liquidity</p>
                {loadingStats ? <Skeleton className="h-7 w-24 mt-1" /> : (
                  <p className="text-lg font-bold font-headline">
                    ₹{((stats?.lockedLiquidity || 0) / 10000000).toFixed(2)} Cr
                  </p>
                )}
              </div>
              <div>
                <p className="text-[10px] font-bold text-muted-foreground uppercase">On-Chain Audit Frequency</p>
                {loadingStats ? <Skeleton className="h-7 w-24 mt-1" /> : (
                  <p className="text-lg font-bold font-headline">{stats?.auditFrequency}</p>
                )}
              </div>
            </div>
            <button
              onClick={handleApproveGrant}
              disabled={approvingGrant}
              className="bg-shg-secondary text-white px-5 py-2.5 rounded-full font-bold text-sm flex items-center gap-2 hover:opacity-90 transition-opacity shadow-md active:scale-95 disabled:opacity-60"
            >
              <CheckCircle2 className="w-4 h-4" />
              {approvingGrant ? 'Approving...' : '1-Click Grant Approval'}
            </button>
          </div>
        </div>

        {/* SHG Directory */}
        <div className="lg:col-span-12 dashboard-card bg-white rounded-2xl overflow-hidden border border-border/50">
          <div className="px-6 py-4 border-b border-border/50 flex justify-between items-center">
            <h3 className="text-lg font-bold font-headline">
              SHG Directory — Regional Ranking
              {!loadingDirectory && shgDirectory && (
                <span className="ml-2 text-xs font-normal text-muted-foreground">({shgDirectory.length} groups)</span>
              )}
            </h3>
            <div className="flex items-center gap-2">
              <div className="hidden md:flex items-center bg-surface rounded-lg px-2">
                <Search className="w-4 h-4 text-muted-foreground" />
                <input
                  value={directoryQuery}
                  onChange={(e) => setDirectoryQuery(e.target.value)}
                  placeholder="Search SHG or registration ID"
                  className="bg-transparent px-2 py-1.5 text-sm focus:outline-none w-52"
                />
              </div>
              <button onClick={handleCycleFilter} className="p-2 hover:bg-surface rounded-lg transition-colors" title={`Current filter: ${auditFilter}`}><Filter className="w-5 h-5 text-muted-foreground" /></button>
              <button onClick={handleDownloadDirectory} className="p-2 hover:bg-surface rounded-lg transition-colors"><Download className="w-5 h-5 text-muted-foreground" /></button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-surface">
                  <th className="px-6 py-3 text-[10px] font-bold text-muted-foreground uppercase">Group Name</th>
                  <th className="px-6 py-3 text-[10px] font-bold text-muted-foreground uppercase">d-SBT Score</th>
                  <th className="px-6 py-3 text-[10px] font-bold text-muted-foreground uppercase">Active Loans</th>
                  <th className="px-6 py-3 text-[10px] font-bold text-muted-foreground uppercase">Yield/mo</th>
                  <th className="px-6 py-3 text-[10px] font-bold text-muted-foreground uppercase">Audit Status</th>
                  <th className="px-6 py-3 text-[10px] font-bold text-muted-foreground uppercase text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {loadingDirectory ? (
                  [1, 2, 3].map(i => (
                    <tr key={i}>
                      {[1, 2, 3, 4, 5, 6].map(j => (
                        <td key={j} className="px-6 py-4"><Skeleton className="h-6 w-full" /></td>
                      ))}
                    </tr>
                  ))
                ) : filteredDirectory.map((shg: any, i: number) => (
                  <tr key={shg.id} className="hover:bg-surface/50 transition-colors group">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm ${
                          i === 0 ? 'bg-shg-tertiary/10 text-shg-tertiary' :
                          i === 1 ? 'bg-shg-primary/10 text-shg-primary' :
                          'bg-surface text-muted-foreground'
                        }`}>
                          {shg.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2)}
                        </div>
                        <div>
                          <p className="font-bold text-on-surface text-sm">{shg.name}</p>
                          <p className="text-xs text-muted-foreground">Reg: {shg.registrationId}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-2 bg-surface rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${shg.trustScore >= 900 ? 'bg-shg-secondary' : shg.trustScore >= 800 ? 'bg-shg-primary' : 'bg-shg-tertiary'}`}
                            style={{ width: `${shg.trustScore / 10}%` }}
                          />
                        </div>
                        <span className={`text-sm font-bold ${shg.trustScore >= 900 ? 'text-shg-secondary' : shg.trustScore >= 800 ? 'text-shg-primary' : 'text-shg-tertiary'}`}>
                          {shg.trustScore}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4 font-headline font-semibold text-shg-primary text-sm">{shg.activeLoans}</td>
                    <td className="px-6 py-4 text-sm font-semibold text-shg-secondary">+{shg.yieldThisMonth}%</td>
                    <td className="px-6 py-4">
                      <span className={`px-3 py-1 rounded-full text-[10px] font-bold ${
                        shg.auditStatus === 'IMMUTABLE_OK' ? 'bg-shg-secondary/10 text-shg-secondary' :
                        shg.auditStatus === 'PENDING_AUDIT' ? 'bg-shg-tertiary/10 text-shg-tertiary' :
                        'bg-shg-error/10 text-shg-error'
                      }`}>
                        {shg.auditStatus}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={() => {
                          setScannerOpen(true);
                          setScanInput(shg.lastTxHash || '');
                          toast.info(`Reviewing ledger for ${shg.name}`);
                        }}
                        className="text-shg-primary font-bold text-sm hover:underline flex items-center gap-1 ml-auto"
                      >
                        <Search className="w-3 h-3" />
                        Review Ledger
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Aggregate Trust Index */}
        <div className="lg:col-span-4 dashboard-card bg-white rounded-2xl p-6 flex flex-col items-center justify-center border border-border/50">
          <h3 className="text-sm font-bold text-muted-foreground uppercase mb-6">Aggregate Trust Index</h3>
          <div className="relative w-40 h-40 flex items-center justify-center">
            <svg className="w-full h-full transform -rotate-90">
              <circle className="text-shg-secondary/20" cx="80" cy="80" fill="transparent" r="65" stroke="currentColor" strokeWidth="10" />
              <circle
                className="text-shg-secondary"
                cx="80" cy="80" fill="transparent" r="65"
                stroke="currentColor" strokeWidth="10" strokeLinecap="round"
                strokeDasharray="408"
                strokeDashoffset={loadingStats ? 408 : 408 - (408 * (stats?.aggregateTrustIndex || 0) / 100)}
                style={{ transition: 'stroke-dashoffset 1s ease-out' }}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-4xl font-black font-headline text-on-surface">
                {loadingStats ? '...' : stats?.aggregateTrustIndex}
              </span>
              <span className="text-[10px] font-bold text-shg-secondary uppercase tracking-tighter">Excellent</span>
            </div>
          </div>
          <p className="text-center text-xs text-muted-foreground mt-4">
            Regional SHGs performing 14% better than national institutional averages.
          </p>
          <div className="mt-4 grid grid-cols-2 gap-3 w-full">
            <div className="bg-surface rounded-lg p-3 text-center">
              <Landmark className="w-4 h-4 text-shg-primary mx-auto mb-1" />
              <p className="text-xs font-bold">{loadingStats ? '...' : stats?.shgsMonitored}</p>
              <p className="text-[10px] text-muted-foreground">SHGs Monitored</p>
            </div>
            <div className="bg-surface rounded-lg p-3 text-center">
              <Activity className="w-4 h-4 text-shg-secondary mx-auto mb-1" />
              <p className="text-xs font-bold">{loadingStats ? '...' : `${stats?.repaymentRate}%`}</p>
              <p className="text-[10px] text-muted-foreground">Repayment Rate</p>
            </div>
          </div>
        </div>

        {/* Real-Time Ledger Stream */}
        <div className="lg:col-span-8 dashboard-card bg-white rounded-2xl p-6 border border-border/50">
          <div className="flex items-center justify-between mb-5">
            <h3 className="text-lg font-bold font-headline">Real-Time Ledger Stream</h3>
            <div className="flex items-center gap-2 text-xs font-bold text-shg-secondary">
              <span className="w-2 h-2 rounded-full bg-shg-secondary animate-pulse" />
              Live · 6s/block
            </div>
          </div>
          <div className="space-y-3">
            {(ledger || []).slice(0, 5).map((entry: any) => (
              <div key={entry.id} className="flex gap-4 items-start p-3 rounded-lg hover:bg-surface transition-colors">
                <div className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${
                  entry.type === 'credit' ? 'bg-shg-secondary' :
                  entry.type === 'debit' ? 'bg-shg-primary' :
                  entry.type === 'mint' ? 'bg-shg-tertiary' :
                  'bg-muted-foreground'
                }`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">{entry.event}</p>
                  <p className="text-xs text-muted-foreground">TX: {entry.txId} · {timeAgo(entry.timestamp)}</p>
                </div>
                {entry.amount !== 0 && (
                  <div className={`text-sm font-bold flex-shrink-0 ${entry.amount > 0 ? 'text-shg-secondary' : 'text-shg-error'}`}>
                    {entry.amount > 0 ? '+' : ''}₹{Math.abs(entry.amount).toLocaleString('en-IN')}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {scannerOpen && (
        <div className="fixed inset-0 z-50 bg-black/55 flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-white rounded-2xl p-6 border border-border space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold font-headline">Offline Verification Scanner</h3>
              <button onClick={() => setScannerOpen(false)} className="text-sm font-semibold text-muted-foreground hover:text-on-surface">Close</button>
            </div>
            <p className="text-xs text-muted-foreground">Paste transaction hash or full QR JSON payload.</p>
            <textarea
              value={scanInput}
              onChange={(e) => setScanInput(e.target.value)}
              className="w-full border border-border rounded-lg p-3 text-sm min-h-24"
              placeholder='TXHASH... or {"txHash":"..."}'
            />
            <div className="flex justify-end">
              <button onClick={handleVerifyScan} disabled={verifyingTx} className="px-4 py-2 bg-shg-primary text-white rounded-lg text-sm font-semibold disabled:opacity-60">
                {verifyingTx ? 'Verifying...' : 'Verify'}
              </button>
            </div>

            {scanResult && (
              <div className="p-4 rounded-xl bg-surface border border-border/50 space-y-1">
                <p className="text-sm font-bold text-shg-secondary">Verification Successful</p>
                <p className="text-xs text-muted-foreground">TX: {scanResult.txHash}</p>
                <p className="text-xs text-muted-foreground">Block: {scanResult.block}</p>
                <a href={scanResult.explorer} target="_blank" rel="noreferrer" className="text-xs font-semibold text-shg-primary hover:underline">Open AlgoExplorer</a>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
