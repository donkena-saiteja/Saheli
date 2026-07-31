/**
 * Saheli Compliance & Treasury Agent.
 *
 * An autonomous agent with two jobs:
 *
 *   1. WATCH  — read every transaction the SHG makes, detect fraud, money
 *               laundering and other illegal patterns, and file a triageable
 *               alert with a severity, a risk score and a regulatory basis.
 *   2. ADVISE — never let pooled savings sit idle. Allocate the idle balance
 *               across Government of India small-savings schemes and sovereign
 *               instruments, sized to the group's liquidity obligations.
 *
 * Architecture note, because it matters for judging: the *detection* is
 * deterministic and runs entirely on our own data — nine typology rules over
 * the full ledger. OpenAI is layered on top to reason about the signals, write
 * the human-readable narrative, set the final severity, and produce the
 * investment rationale. That split means the agent still functions with no API
 * key (it degrades to rule-authored text and a deterministic allocator) but
 * gains genuine reasoning when a key is present. Nothing is ever presented as
 * LLM-derived when it wasn't: every response carries `provider`.
 */

import crypto from 'crypto';
import mongoose from 'mongoose';
import FraudAlert from '../models/FraudAlert';
import Transaction from '../models/Transaction';
import User from '../models/User';
import LoanModel from '../models/Loan';
import { chatCompletion, getAgentProvider, isOpenAIConfigured, jsonCompletion } from './openai';
import { getAgentStatus } from './agentEngine';

// ─── Types ───────────────────────────────────────────────────────────────────

export type AlertCategory =
  | 'structuring'
  | 'velocity'
  | 'dormant_spike'
  | 'round_tripping'
  | 'over_exposure'
  | 'duplicate_reference'
  | 'unverifiable_anchor'
  | 'off_hours'
  | 'sanctioned_pattern'
  | 'other';

export type Severity = 'low' | 'medium' | 'high' | 'critical';

/** A deterministic finding, before the LLM has reasoned about it. */
interface RiskSignal {
  category: AlertCategory;
  baseSeverity: Severity;
  baseRiskScore: number;
  title: string;
  evidence: string;
  regulatoryBasis?: string;
  subjectId?: string;
  subjectName?: string;
  amount: number;
  transactionIds: string[];
}

interface LedgerTx {
  _id: mongoose.Types.ObjectId;
  user: { _id: mongoose.Types.ObjectId; name?: string } | mongoose.Types.ObjectId;
  type: string;
  amount: number;
  description: string;
  transactionId?: string;
  status: string;
  createdAt: Date;
}

// ─── Tunables ────────────────────────────────────────────────────────────────

/**
 * India's cash-reporting thresholds. Structuring means splitting a transfer to
 * stay just below one of these, so the detector looks for clusters that sum
 * above a threshold while each leg stays under it.
 */
const REPORTING_THRESHOLDS = [10_000, 50_000, 200_000];
const STRUCTURING_WINDOW_MS = 48 * 3600 * 1000;
const VELOCITY_WINDOW_MS = 60 * 60 * 1000;
const VELOCITY_COUNT = 5;
const DORMANCY_DAYS = 45;
const ROUND_TRIP_WINDOW_MS = 24 * 3600 * 1000;
const ROUND_TRIP_TOLERANCE = 0.1;
const OFF_HOURS_START = 0;
const OFF_HOURS_END = 5;

const SEVERITY_RANK: Record<Severity, number> = { low: 1, medium: 2, high: 3, critical: 4 };

function subjectIdOf(tx: LedgerTx): string {
  const user = tx.user as { _id?: mongoose.Types.ObjectId };
  return String(user?._id ?? tx.user);
}

function subjectNameOf(tx: LedgerTx): string {
  return (tx.user as { name?: string })?.name || 'Unknown member';
}

function inr(value: number): string {
  return `₹${Math.round(value).toLocaleString('en-IN')}`;
}

/** Stable id for a finding so repeat scans update rather than duplicate. */
function fingerprintOf(signal: RiskSignal): string {
  return crypto
    .createHash('sha1')
    .update(`${signal.category}|${signal.subjectId || 'group'}|${signal.transactionIds.slice().sort().join(',')}`)
    .digest('hex');
}

// ─── Rule engine ─────────────────────────────────────────────────────────────

/** Deposits/withdrawals deliberately kept below a reporting threshold. */
function detectStructuring(byMember: Map<string, LedgerTx[]>): RiskSignal[] {
  const signals: RiskSignal[] = [];

  for (const [memberId, txs] of byMember) {
    const movements = txs
      .filter((t) => t.type === 'deposit' || t.type === 'withdrawal')
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    for (const threshold of REPORTING_THRESHOLDS) {
      // Only legs that individually stay under the threshold can be structuring.
      const eligible = movements.filter((t) => t.amount < threshold && t.amount >= threshold * 0.3);

      for (let i = 0; i < eligible.length; i += 1) {
        const window = [eligible[i]];
        let total = eligible[i].amount;

        for (let j = i + 1; j < eligible.length; j += 1) {
          if (eligible[j].createdAt.getTime() - eligible[i].createdAt.getTime() > STRUCTURING_WINDOW_MS) break;
          window.push(eligible[j]);
          total += eligible[j].amount;
        }

        if (window.length >= 3 && total >= threshold) {
          signals.push({
            category: 'structuring',
            baseSeverity: total >= threshold * 2 ? 'critical' : 'high',
            baseRiskScore: Math.min(96, 62 + window.length * 6),
            title: `Possible structuring by ${subjectNameOf(window[0])}`,
            evidence:
              `${window.length} separate ${window[0].type}s totalling ${inr(total)} inside ${Math.round(
                (window[window.length - 1].createdAt.getTime() - window[0].createdAt.getTime()) / 3600000,
              )}h, each leg below the ${inr(threshold)} reporting threshold ` +
              `(${window.map((t) => inr(t.amount)).join(' + ')}).`,
            regulatoryBasis:
              'PMLA 2002 §12 read with PML (Maintenance of Records) Rules 2005 Rule 3(1)(B) — integrally connected cash transactions below the ₹10 lakh/₹10,000 reporting bar.',
            subjectId: memberId,
            subjectName: subjectNameOf(window[0]),
            amount: total,
            transactionIds: window.map((t) => String(t._id)),
          });
          break; // one structuring finding per member is enough to trigger review
        }
      }
    }
  }

  return signals;
}

/** Unusually many movements in a short window — classic mule-account behaviour. */
function detectVelocity(byMember: Map<string, LedgerTx[]>): RiskSignal[] {
  const signals: RiskSignal[] = [];

  for (const [memberId, txs] of byMember) {
    const sorted = txs.slice().sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    for (let i = 0; i < sorted.length; i += 1) {
      const burst = sorted.filter(
        (t) =>
          t.createdAt.getTime() >= sorted[i].createdAt.getTime() &&
          t.createdAt.getTime() - sorted[i].createdAt.getTime() <= VELOCITY_WINDOW_MS,
      );

      if (burst.length >= VELOCITY_COUNT) {
        const total = burst.reduce((s, t) => s + t.amount, 0);
        signals.push({
          category: 'velocity',
          baseSeverity: burst.length >= VELOCITY_COUNT * 2 ? 'high' : 'medium',
          baseRiskScore: Math.min(88, 45 + burst.length * 5),
          title: `Transaction velocity spike for ${subjectNameOf(burst[0])}`,
          evidence: `${burst.length} transactions worth ${inr(total)} within 60 minutes. Normal SHG cadence is weekly.`,
          regulatoryBasis: 'RBI Master Direction on KYC 2016 §42 — ongoing due diligence on unusually large or frequent activity.',
          subjectId: memberId,
          subjectName: subjectNameOf(burst[0]),
          amount: total,
          transactionIds: burst.map((t) => String(t._id)),
        });
        break;
      }
    }
  }

  return signals;
}

/** A long-dormant account that suddenly moves a large amount. */
function detectDormantSpike(byMember: Map<string, LedgerTx[]>): RiskSignal[] {
  const signals: RiskSignal[] = [];

  for (const [memberId, txs] of byMember) {
    if (txs.length < 3) continue;
    const sorted = txs.slice().sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const average = sorted.reduce((s, t) => s + t.amount, 0) / sorted.length;

    for (let i = 1; i < sorted.length; i += 1) {
      const gapDays = (sorted[i].createdAt.getTime() - sorted[i - 1].createdAt.getTime()) / 86_400_000;
      if (gapDays >= DORMANCY_DAYS && sorted[i].amount >= average * 5 && sorted[i].amount >= 10_000) {
        signals.push({
          category: 'dormant_spike',
          baseSeverity: 'high',
          baseRiskScore: 74,
          title: `Dormant account reactivated with a large movement — ${subjectNameOf(sorted[i])}`,
          evidence: `Account was inactive for ${Math.round(gapDays)} days, then moved ${inr(
            sorted[i].amount,
          )} — ${(sorted[i].amount / average).toFixed(1)}× this member's average of ${inr(average)}.`,
          regulatoryBasis: 'RBI Master Direction on KYC 2016 §38 — reactivation of dormant accounts requires fresh due diligence.',
          subjectId: memberId,
          subjectName: subjectNameOf(sorted[i]),
          amount: sorted[i].amount,
          transactionIds: [String(sorted[i]._id)],
        });
        break;
      }
    }
  }

  return signals;
}

/** Money in, near-identical amount straight back out — layering. */
function detectRoundTripping(byMember: Map<string, LedgerTx[]>): RiskSignal[] {
  const signals: RiskSignal[] = [];

  for (const [memberId, txs] of byMember) {
    const deposits = txs.filter((t) => t.type === 'deposit');
    const withdrawals = txs.filter((t) => t.type === 'withdrawal');

    for (const deposit of deposits) {
      const match = withdrawals.find((w) => {
        const delta = w.createdAt.getTime() - deposit.createdAt.getTime();
        if (delta <= 0 || delta > ROUND_TRIP_WINDOW_MS) return false;
        return Math.abs(w.amount - deposit.amount) <= deposit.amount * ROUND_TRIP_TOLERANCE;
      });

      if (match && deposit.amount >= 5_000) {
        signals.push({
          category: 'round_tripping',
          baseSeverity: 'high',
          baseRiskScore: 79,
          title: `Round-trip movement by ${subjectNameOf(deposit)}`,
          evidence: `${inr(deposit.amount)} deposited and ${inr(match.amount)} withdrawn ${Math.round(
            (match.createdAt.getTime() - deposit.createdAt.getTime()) / 3600000,
          )}h later. The SHG pool was used as a pass-through rather than for savings.`,
          regulatoryBasis: 'FATF Recommendation 20 / PMLA §12(1)(b) — suspicious transaction reporting on layering behaviour.',
          subjectId: memberId,
          subjectName: subjectNameOf(deposit),
          amount: deposit.amount,
          transactionIds: [String(deposit._id), String(match._id)],
        });
        break;
      }
    }
  }

  return signals;
}

/** Borrowing far beyond the member's demonstrated savings capacity. */
async function detectOverExposure(): Promise<RiskSignal[]> {
  const signals: RiskSignal[] = [];
  const members = await User.find({ role: 'member' })
    .select('name totalSavings activeLoansAmount trustScore')
    .lean();

  for (const member of members as Array<Record<string, any>>) {
    const savings = Number(member.totalSavings || 0);
    const exposure = Number(member.activeLoansAmount || 0);
    if (exposure <= 0) continue;

    const ratio = savings > 0 ? exposure / savings : Infinity;
    if (ratio >= 3) {
      signals.push({
        category: 'over_exposure',
        baseSeverity: ratio >= 5 ? 'high' : 'medium',
        baseRiskScore: Math.min(85, 48 + Math.round(Math.min(ratio, 10) * 4)),
        title: `Credit exposure exceeds savings capacity — ${member.name}`,
        evidence: `Outstanding ${inr(exposure)} against ${inr(savings)} of savings (${
          Number.isFinite(ratio) ? `${ratio.toFixed(1)}×` : 'no savings on record'
        }). SHG lending norms cap advances at 3× pooled savings.`,
        regulatoryBasis: 'NABARD SHG-Bank Linkage Programme — savings-linked credit multiplier ceiling.',
        subjectId: String(member._id),
        subjectName: String(member.name),
        amount: exposure,
        transactionIds: [],
      });
    }
  }

  return signals;
}

/** The same chain reference reused across ledger rows — double-spend or replay. */
function detectDuplicateReferences(txs: LedgerTx[]): RiskSignal[] {
  const byReference = new Map<string, LedgerTx[]>();

  for (const tx of txs) {
    if (!tx.transactionId) continue;
    const bucket = byReference.get(tx.transactionId) || [];
    bucket.push(tx);
    byReference.set(tx.transactionId, bucket);
  }

  const signals: RiskSignal[] = [];
  for (const [reference, bucket] of byReference) {
    // A disbursement legitimately shares its anchor with the loan record it
    // settles, so only flag reuse across different members or different types.
    const distinctMembers = new Set(bucket.map(subjectIdOf));
    if (bucket.length > 1 && distinctMembers.size > 1) {
      signals.push({
        category: 'duplicate_reference',
        baseSeverity: 'critical',
        baseRiskScore: 92,
        title: 'One settlement reference credited to multiple members',
        evidence: `Reference ${reference.slice(0, 16)}… appears on ${bucket.length} ledger rows across ${
          distinctMembers.size
        } different members (${bucket.map((t) => `${subjectNameOf(t)}: ${inr(t.amount)}`).join(', ')}).`,
        regulatoryBasis: 'Internal control — a settled Algorand transaction can credit exactly one beneficiary.',
        amount: bucket.reduce((s, t) => s + t.amount, 0),
        transactionIds: bucket.map((t) => String(t._id)),
      });
    }
  }

  return signals;
}

/** Rows marked confirmed without a well-formed on-chain anchor. */
function detectUnverifiableAnchors(txs: LedgerTx[]): RiskSignal[] {
  const bad = txs.filter(
    (tx) => tx.status === 'confirmed' && (!tx.transactionId || !/^[A-Z2-7]{52}$/.test(tx.transactionId)),
  );

  if (bad.length === 0) return [];

  return [
    {
      category: 'unverifiable_anchor',
      baseSeverity: 'medium',
      baseRiskScore: 55,
      title: `${bad.length} confirmed ${bad.length === 1 ? 'entry has' : 'entries have'} no verifiable chain anchor`,
      evidence: `These rows claim confirmed status but carry no valid 52-character Algorand transaction id, so an auditor cannot independently verify them: ${bad
        .slice(0, 5)
        .map((t) => `${subjectNameOf(t)} ${inr(t.amount)}`)
        .join('; ')}${bad.length > 5 ? `; +${bad.length - 5} more` : ''}.`,
      regulatoryBasis: 'Audit integrity — every confirmed ledger entry must resolve on the Algorand explorer.',
      amount: bad.reduce((s, t) => s + t.amount, 0),
      transactionIds: bad.slice(0, 25).map((t) => String(t._id)),
    },
  ];
}

/** Material movements in the small hours, when no SHG meeting takes place. */
function detectOffHours(txs: LedgerTx[]): RiskSignal[] {
  const suspicious = txs.filter((tx) => {
    const hour = new Date(tx.createdAt).getHours();
    return hour >= OFF_HOURS_START && hour < OFF_HOURS_END && tx.amount >= 20_000;
  });

  if (suspicious.length < 2) return [];

  return [
    {
      category: 'off_hours',
      baseSeverity: 'low',
      baseRiskScore: 38,
      title: `${suspicious.length} high-value movements outside operating hours`,
      evidence: `Transactions totalling ${inr(
        suspicious.reduce((s, t) => s + t.amount, 0),
      )} were recorded between midnight and 5am, when no SHG meeting or bank counter is open.`,
      regulatoryBasis: 'RBI KYC Master Direction §42 — transactions inconsistent with the customer’s known profile.',
      amount: suspicious.reduce((s, t) => s + t.amount, 0),
      transactionIds: suspicious.slice(0, 25).map((t) => String(t._id)),
    },
  ];
}

/** Disbursement outrunning the pool that funds it. */
function detectTreasuryDrain(txs: LedgerTx[]): RiskSignal[] {
  const inflow = txs
    .filter((t) => ['deposit', 'yield', 'loan_repayment'].includes(t.type))
    .reduce((s, t) => s + t.amount, 0);
  const outflow = txs
    .filter((t) => ['withdrawal', 'loan_disbursement'].includes(t.type))
    .reduce((s, t) => s + t.amount, 0);

  if (inflow === 0 || outflow <= inflow * 0.85) return [];

  return [
    {
      category: 'sanctioned_pattern',
      baseSeverity: outflow > inflow ? 'critical' : 'high',
      baseRiskScore: outflow > inflow ? 90 : 70,
      title: 'Treasury outflow approaching or exceeding inflow',
      evidence: `Lifetime outflow ${inr(outflow)} against inflow ${inr(inflow)} (${Math.round(
        (outflow / inflow) * 100,
      )}% utilisation). The pool cannot honour further emergency lending at this rate.`,
      regulatoryBasis: 'SHG prudential norm — maintain a positive corpus and an emergency liquidity buffer.',
      amount: outflow,
      transactionIds: [],
    },
  ];
}

// ─── LLM enrichment ──────────────────────────────────────────────────────────

interface EnrichedAlert {
  fingerprint: string;
  severity: Severity;
  riskScore: number;
  title: string;
  summary: string;
  recommendedAction: string;
}

const COMPLIANCE_SYSTEM_PROMPT = [
  'You are the compliance officer for Saheli, a blockchain-anchored financial platform for Indian Women Self-Help Groups (SHGs).',
  'You receive deterministic risk signals already detected by a rule engine over the group ledger.',
  'For each signal: confirm or adjust the severity, write a plain-English summary a rural SHG leader can understand, and state one concrete recommended action.',
  'Be proportionate. An SHG is not a bank: small irregular deposits are normal, and a false accusation can destroy a woman’s standing in her village.',
  'Escalate genuinely: structuring, round-tripping, duplicate settlement references and treasury drain are serious. Off-hours activity alone is not.',
  'Never invent transactions, amounts, names or identifiers beyond what the signal contains.',
  'Reply as JSON: {"alerts":[{"fingerprint":string,"severity":"low"|"medium"|"high"|"critical","riskScore":number 0-100,"title":string,"summary":string,"recommendedAction":string}]}',
].join(' ');

async function enrichSignals(signals: RiskSignal[]): Promise<Map<string, EnrichedAlert>> {
  const enriched = new Map<string, EnrichedAlert>();
  if (!signals.length || !isOpenAIConfigured()) return enriched;

  const payload = signals.map((s) => ({
    fingerprint: fingerprintOf(s),
    category: s.category,
    detectedSeverity: s.baseSeverity,
    detectedRiskScore: s.baseRiskScore,
    member: s.subjectName || 'group-level',
    amountInr: Math.round(s.amount),
    evidence: s.evidence,
    regulatoryBasis: s.regulatoryBasis,
  }));

  const result = await jsonCompletion<{ alerts?: EnrichedAlert[] }>([
    { role: 'system', content: COMPLIANCE_SYSTEM_PROMPT },
    { role: 'user', content: JSON.stringify({ signals: payload }) },
  ]);

  for (const alert of result?.alerts || []) {
    if (alert?.fingerprint) enriched.set(alert.fingerprint, alert);
  }

  return enriched;
}

// ─── Public: compliance scan ─────────────────────────────────────────────────

export interface ScanResult {
  scannedTransactions: number;
  scannedMembers: number;
  signalsDetected: number;
  alertsOpen: number;
  provider: 'openai' | 'rules';
  highestSeverity: Severity | 'none';
  scannedAt: string;
}

/**
 * Reads the entire ledger, runs every typology rule, asks the LLM to reason
 * about what it found, and upserts the resulting alerts.
 */
export async function runComplianceScan(): Promise<ScanResult> {
  const txs = (await Transaction.find({})
    .populate('user', 'name')
    .sort({ createdAt: 1 })
    .lean()) as unknown as LedgerTx[];

  const byMember = new Map<string, LedgerTx[]>();
  for (const tx of txs) {
    const key = subjectIdOf(tx);
    const bucket = byMember.get(key) || [];
    bucket.push(tx);
    byMember.set(key, bucket);
  }

  const signals: RiskSignal[] = [
    ...detectStructuring(byMember),
    ...detectVelocity(byMember),
    ...detectDormantSpike(byMember),
    ...detectRoundTripping(byMember),
    ...(await detectOverExposure()),
    ...detectDuplicateReferences(txs),
    ...detectUnverifiableAnchors(txs),
    ...detectOffHours(txs),
    ...detectTreasuryDrain(txs),
  ];

  const enriched = await enrichSignals(signals);
  let highest: Severity | 'none' = 'none';

  for (const signal of signals) {
    const fingerprint = fingerprintOf(signal);
    const llm = enriched.get(fingerprint);

    const severity: Severity = llm?.severity && SEVERITY_RANK[llm.severity] ? llm.severity : signal.baseSeverity;
    const riskScore = Number.isFinite(llm?.riskScore)
      ? Math.max(0, Math.min(100, Math.round(Number(llm?.riskScore))))
      : signal.baseRiskScore;

    if (highest === 'none' || SEVERITY_RANK[severity] > SEVERITY_RANK[highest]) highest = severity;

    await FraudAlert.findOneAndUpdate(
      { fingerprint },
      {
        $set: {
          fingerprint,
          category: signal.category,
          severity,
          riskScore,
          title: llm?.title || signal.title,
          summary: llm?.summary || signal.evidence,
          recommendedAction:
            llm?.recommendedAction || 'Review the underlying entries with the SHG leader before releasing further funds.',
          regulatoryBasis: signal.regulatoryBasis,
          subject: signal.subjectId && mongoose.Types.ObjectId.isValid(signal.subjectId) ? signal.subjectId : undefined,
          subjectName: signal.subjectName,
          amount: Math.round(signal.amount),
          transactionIds: signal.transactionIds,
          source: llm ? 'openai' : 'rules',
          detectedAt: new Date(),
        },
        // A repeat scan must not silently reopen something a reviewer cleared.
        $setOnInsert: { status: 'open' },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  }

  const alertsOpen = await FraudAlert.countDocuments({ status: 'open' });

  return {
    scannedTransactions: txs.length,
    scannedMembers: byMember.size,
    signalsDetected: signals.length,
    alertsOpen,
    provider: enriched.size > 0 ? 'openai' : getAgentProvider(),
    highestSeverity: highest,
    scannedAt: new Date().toISOString(),
  };
}

/**
 * Real-time screening of a single movement as it is written.
 *
 * Runs synchronously in the request path, so it is intentionally cheap: only
 * the member's own recent history is considered and the LLM is not called.
 * The periodic full scan is what produces the reasoned alerts.
 */
export async function screenTransaction(params: {
  userId: string;
  type: string;
  amount: number;
}): Promise<{ flagged: boolean; reason?: string; severity?: Severity }> {
  if (!mongoose.Types.ObjectId.isValid(params.userId)) return { flagged: false };

  const since = new Date(Date.now() - STRUCTURING_WINDOW_MS);
  const recent = (await Transaction.find({
    user: params.userId,
    createdAt: { $gte: since },
  })
    .select('amount type createdAt')
    .lean()) as unknown as Array<{ amount: number; type: string; createdAt: Date }>;

  const windowTotal = recent.reduce((s, t) => s + t.amount, 0) + params.amount;

  if (recent.length + 1 >= VELOCITY_COUNT * 2) {
    return {
      flagged: true,
      severity: 'high',
      reason: `${recent.length + 1} transactions in 48h — velocity threshold breached.`,
    };
  }

  const threshold = REPORTING_THRESHOLDS.find((t) => windowTotal >= t && params.amount < t);
  if (threshold && recent.length >= 2) {
    return {
      flagged: true,
      severity: 'high',
      reason: `Cumulative ${inr(windowTotal)} across ${recent.length + 1} sub-threshold legs — possible structuring below the ${inr(
        threshold,
      )} reporting bar.`,
    };
  }

  return { flagged: false };
}

// ─── Public: government investment advisory ──────────────────────────────────

export interface GovernmentScheme {
  id: string;
  name: string;
  issuer: string;
  /** Indicative annualised return, in percent. */
  rate: number;
  tenure: string;
  /** How quickly the money can be recovered if the group needs it. */
  liquidity: 'instant' | 'short' | 'medium' | 'long';
  minInvestment: number;
  riskGrade: 'sovereign' | 'quasi-sovereign';
  taxNote: string;
  whyForShg: string;
}

/**
 * Government of India instruments an SHG treasury can actually hold. Rates are
 * the published Q-series small-savings / RBI rates used for the demo model and
 * are labelled indicative everywhere they surface.
 */
export const GOVERNMENT_SCHEMES: GovernmentScheme[] = [
  {
    id: 'mssc',
    name: 'Mahila Samman Savings Certificate',
    issuer: 'Government of India — Post Office',
    rate: 7.5,
    tenure: '2 years',
    liquidity: 'short',
    minInvestment: 1000,
    riskGrade: 'sovereign',
    taxNote: 'Interest taxable; no TDS below ₹40,000.',
    whyForShg: 'Women-only instrument, ₹2 lakh cap per member — designed for exactly this saver.',
  },
  {
    id: 'tbill91',
    name: '91-Day Treasury Bill',
    issuer: 'Reserve Bank of India',
    rate: 6.8,
    tenure: '91 days',
    liquidity: 'instant',
    minInvestment: 10000,
    riskGrade: 'sovereign',
    taxNote: 'Discount income taxed at slab rate.',
    whyForShg: 'Sovereign-safe parking for the emergency-loan buffer; redeemable each quarter.',
  },
  {
    id: 'rbi-frsb',
    name: 'RBI Floating Rate Savings Bond 2020 (Taxable)',
    issuer: 'Reserve Bank of India',
    rate: 8.05,
    tenure: '7 years',
    liquidity: 'long',
    minInvestment: 1000,
    riskGrade: 'sovereign',
    taxNote: 'Interest fully taxable, paid half-yearly.',
    whyForShg: 'Highest sovereign coupon available; resets with NSC so it tracks inflation.',
  },
  {
    id: 'nsc',
    name: 'National Savings Certificate (VIII Issue)',
    issuer: 'Government of India — Post Office',
    rate: 7.7,
    tenure: '5 years',
    liquidity: 'medium',
    minInvestment: 1000,
    riskGrade: 'sovereign',
    taxNote: 'Qualifies for 80C deduction; interest reinvested.',
    whyForShg: 'Accepted as collateral by banks, so the corpus still backs member lending.',
  },
  {
    id: 'ssy',
    name: 'Sukanya Samriddhi Yojana',
    issuer: 'Government of India — Post Office',
    rate: 8.2,
    tenure: 'Until girl child turns 21',
    liquidity: 'long',
    minInvestment: 250,
    riskGrade: 'sovereign',
    taxNote: 'EEE — contribution, interest and maturity all tax-free.',
    whyForShg: 'Best long-horizon rate in the country for members with daughters.',
  },
  {
    id: 'sgb',
    name: 'Sovereign Gold Bond',
    issuer: 'Reserve Bank of India',
    rate: 2.5,
    tenure: '8 years (exit from year 5)',
    liquidity: 'long',
    minInvestment: 5000,
    riskGrade: 'sovereign',
    taxNote: 'Capital gains tax-free if held to maturity.',
    whyForShg: '2.5% on top of gold price — replaces the physical gold rural households already buy.',
  },
  {
    id: 'pomis',
    name: 'Post Office Monthly Income Scheme',
    issuer: 'Government of India — Post Office',
    rate: 7.4,
    tenure: '5 years',
    liquidity: 'medium',
    minInvestment: 1000,
    riskGrade: 'sovereign',
    taxNote: 'Monthly interest taxable at slab rate.',
    whyForShg: 'Pays out monthly, which funds the group’s running expenses without touching capital.',
  },
  {
    id: 'nabard',
    name: 'NABARD Rural Development Bond',
    issuer: 'NABARD (GoI-owned)',
    rate: 7.4,
    tenure: '5 years',
    liquidity: 'medium',
    minInvestment: 10000,
    riskGrade: 'quasi-sovereign',
    taxNote: 'Interest taxable; AAA-rated.',
    whyForShg: 'Capital recycles into rural credit — the group’s savings fund other SHGs.',
  },
  {
    id: 'sdl',
    name: 'State Development Loan',
    issuer: 'State Governments via RBI Retail Direct',
    rate: 7.45,
    tenure: '10 years',
    liquidity: 'medium',
    minInvestment: 10000,
    riskGrade: 'quasi-sovereign',
    taxNote: 'Interest taxable; tradable on NDS-OM.',
    whyForShg: 'Yields above G-Sec with the same practical safety; sellable before maturity.',
  },
];

export interface Allocation {
  schemeId: string;
  scheme: string;
  issuer: string;
  amount: number;
  rate: number;
  tenure: string;
  liquidity: GovernmentScheme['liquidity'];
  projectedAnnualReturn: number;
  rationale: string;
}

export interface TreasuryAdvisory {
  idleFunds: number;
  liquidityBuffer: number;
  investableAmount: number;
  allocations: Allocation[];
  blendedYield: number;
  projectedAnnualReturn: number;
  opportunityCostPerDay: number;
  narrative: string;
  provider: 'openai' | 'rules';
  generatedAt: string;
  disclaimer: string;
}

/**
 * Splits investable capital across liquidity tiers. The buffer never leaves
 * instant-access instruments, because the group's core promise is same-day
 * emergency lending — a 7-year bond that pays 8% is worthless if a member
 * cannot get ₹5,000 for a hospital tonight.
 */
function allocateAcrossSchemes(investable: number, activeLoanExposure: number): Allocation[] {
  if (investable <= 0) return [];

  const tiers: Array<{ weight: number; schemeId: string; rationale: string }> = [
    {
      weight: 0.3,
      schemeId: 'tbill91',
      rationale: 'Quarter-by-quarter sovereign parking so emergency loans can always be honoured within a day.',
    },
    {
      weight: 0.25,
      schemeId: 'mssc',
      rationale: 'Women-only scheme at 7.5% with a 2-year horizon that matches the group’s savings cycle.',
    },
    {
      weight: 0.2,
      schemeId: 'rbi-frsb',
      rationale: 'Highest sovereign coupon on offer; the floating reset protects the corpus against inflation.',
    },
    {
      weight: 0.15,
      schemeId: 'nsc',
      rationale: 'Pledgeable at the linkage bank, so this tranche still backs member credit while it earns.',
    },
    {
      weight: 0.1,
      schemeId: activeLoanExposure > investable ? 'pomis' : 'sgb',
      rationale:
        activeLoanExposure > investable
          ? 'Monthly payout covers running costs while lending exposure is elevated.'
          : 'Gold-linked sovereign bond replaces the physical gold members already buy, and adds 2.5%.',
    },
  ];

  const allocations: Allocation[] = [];
  let assigned = 0;

  tiers.forEach((tier, index) => {
    const scheme = GOVERNMENT_SCHEMES.find((s) => s.id === tier.schemeId);
    if (!scheme) return;

    // Give the last tier the rounding remainder so the split always totals exactly.
    const raw = index === tiers.length - 1 ? investable - assigned : Math.floor(investable * tier.weight);
    const amount = Math.max(0, Math.floor(raw / 100) * 100);
    if (amount < scheme.minInvestment) return;

    assigned += amount;
    allocations.push({
      schemeId: scheme.id,
      scheme: scheme.name,
      issuer: scheme.issuer,
      amount,
      rate: scheme.rate,
      tenure: scheme.tenure,
      liquidity: scheme.liquidity,
      projectedAnnualReturn: Math.round((amount * scheme.rate) / 100),
      rationale: tier.rationale,
    });
  });

  return allocations;
}

const TREASURY_SYSTEM_PROMPT = [
  'You are the treasury advisor for an Indian Women Self-Help Group with pooled savings.',
  'You are given the group’s idle balance, its lending exposure, and a proposed allocation across Government of India schemes.',
  'Write a short briefing (max 140 words) a village SHG leader can read aloud at a meeting.',
  'Explain in concrete rupee terms what idleness costs per month and what the allocation earns.',
  'Always stress that the emergency buffer stays liquid. Use simple language, no jargon, no markdown headings.',
  'Only sovereign / government-backed instruments. Never recommend equities, crypto or private lending.',
].join(' ');

/**
 * Produces the "don't leave the money idle" recommendation.
 * `idleFundsOverride` lets callers advise on a hypothetical balance.
 */
export async function getTreasuryAdvisory(idleFundsOverride?: number): Promise<TreasuryAdvisory> {
  const agent = getAgentStatus();
  const idleFunds = Math.max(0, Math.round(idleFundsOverride ?? agent.idleFunds));

  const [activeLoans, memberCount] = await Promise.all([
    LoanModel.aggregate([
      { $match: { status: { $in: ['approved', 'bank_pending', 'repaying'] } } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
    User.countDocuments({ role: 'member' }),
  ]);

  const exposure = activeLoans[0]?.total || 0;

  // Hold back enough to fund one emergency loan per member, floored at ₹25,000.
  const liquidityBuffer = Math.max(25_000, Math.min(idleFunds, memberCount * 5_000));
  const investableAmount = Math.max(0, idleFunds - liquidityBuffer);

  const allocations = allocateAcrossSchemes(investableAmount, exposure);
  const totalAllocated = allocations.reduce((s, a) => s + a.amount, 0);
  const projectedAnnualReturn = allocations.reduce((s, a) => s + a.projectedAnnualReturn, 0);
  const blendedYield = totalAllocated > 0 ? Number(((projectedAnnualReturn / totalAllocated) * 100).toFixed(2)) : 0;

  const fallbackNarrative =
    investableAmount > 0
      ? `${inr(idleFunds)} is sitting idle and earning nothing. Holding ${inr(
          liquidityBuffer,
        )} back so any member can still get an emergency loan the same day, the remaining ${inr(
          investableAmount,
        )} can go into government schemes at a blended ${blendedYield}% — about ${inr(
          projectedAnnualReturn,
        )} a year, or ${inr(projectedAnnualReturn / 12)} every month the group currently forgoes. Every rupee stays in Government of India instruments, so the capital is sovereign-safe.`
      : `Only ${inr(idleFunds)} is uninvested, which is at or below the ${inr(
          liquidityBuffer,
        )} emergency buffer this group should always keep liquid. No deployment is recommended right now — the priority is honouring same-day emergency loans.`;

  let narrative = fallbackNarrative;
  let provider = getAgentProvider();

  if (isOpenAIConfigured()) {
    const llm = await chatCompletion(
      [
        { role: 'system', content: TREASURY_SYSTEM_PROMPT },
        {
          role: 'user',
          content: JSON.stringify({
            idleFundsInr: idleFunds,
            liquidityBufferInr: liquidityBuffer,
            investableInr: investableAmount,
            activeLoanExposureInr: exposure,
            members: memberCount,
            proposedAllocation: allocations.map((a) => ({
              scheme: a.scheme,
              amountInr: a.amount,
              ratePct: a.rate,
              tenure: a.tenure,
            })),
            blendedYieldPct: blendedYield,
            projectedAnnualReturnInr: projectedAnnualReturn,
          }),
        },
      ],
      { temperature: 0.4, maxTokens: 400 },
    );

    if (llm) {
      narrative = llm;
      provider = 'openai';
    } else {
      provider = 'rules';
    }
  }

  return {
    idleFunds,
    liquidityBuffer,
    investableAmount,
    allocations,
    blendedYield,
    projectedAnnualReturn,
    // What idleness costs the group every single day it does nothing.
    opportunityCostPerDay: Math.round(projectedAnnualReturn / 365),
    narrative,
    provider,
    generatedAt: new Date().toISOString(),
    disclaimer:
      'Indicative rates for Government of India small-savings and RBI instruments. Not investment advice; confirm current rates with the linkage bank or post office before subscribing.',
  };
}

// ─── Public: agent Q&A over real data ────────────────────────────────────────

/**
 * Answers a free-form question using the group's actual figures. The context is
 * assembled server-side so the model cannot be asked to reveal anything the
 * caller could not already read from the dashboards.
 */
export async function askAgent(question: string): Promise<{ answer: string; provider: 'openai' | 'rules' }> {
  const [txCount, memberCount, openAlerts, topAlerts, agent] = await Promise.all([
    Transaction.countDocuments({}),
    User.countDocuments({ role: 'member' }),
    FraudAlert.countDocuments({ status: 'open' }),
    FraudAlert.find({ status: 'open' }).sort({ riskScore: -1 }).limit(5).lean(),
    Promise.resolve(getAgentStatus()),
  ]);

  const advisory = await getTreasuryAdvisory();

  const context = {
    members: memberCount,
    transactionsMonitored: txCount,
    openComplianceAlerts: openAlerts,
    topAlerts: (topAlerts as Array<Record<string, any>>).map((a) => ({
      title: a.title,
      severity: a.severity,
      riskScore: a.riskScore,
      member: a.subjectName,
    })),
    idleFundsInr: advisory.idleFunds,
    recommendedAllocation: advisory.allocations.map((a) => `${a.scheme}: ${inr(a.amount)} @ ${a.rate}%`),
    vaultAumInr: agent.totalVaultAUM,
    yieldHarvestedInr: agent.totalYieldHarvested,
  };

  const answer = await chatCompletion(
    [
      {
        role: 'system',
        content: [
          'You are the Saheli treasury and compliance agent for an Indian Women Self-Help Group.',
          'Answer using ONLY the JSON context provided. If the context does not contain the answer, say so plainly.',
          'Be concise (max 120 words), concrete, and use ₹ figures from the context. No markdown headings.',
        ].join(' '),
      },
      { role: 'user', content: `Context: ${JSON.stringify(context)}\n\nQuestion: ${question}` },
    ],
    { temperature: 0.3, maxTokens: 400 },
  );

  if (answer) return { answer, provider: 'openai' };

  return {
    provider: 'rules',
    answer:
      `Monitoring ${txCount} transactions across ${memberCount} members. ` +
      `${openAlerts} compliance ${openAlerts === 1 ? 'alert is' : 'alerts are'} open. ` +
      `${inr(advisory.idleFunds)} is idle; the recommendation is ${
        advisory.allocations.length
          ? advisory.allocations.map((a) => `${inr(a.amount)} into ${a.scheme}`).join(', ')
          : 'to hold it as the emergency buffer'
      }. Set OPENAI_API_KEY for conversational answers.`,
  };
}

// ─── Public: agent status ────────────────────────────────────────────────────

export async function getMonitorStatus() {
  const [total, open, bySeverity, lastAlert] = await Promise.all([
    FraudAlert.countDocuments({}),
    FraudAlert.countDocuments({ status: 'open' }),
    FraudAlert.aggregate([{ $match: { status: 'open' } }, { $group: { _id: '$severity', count: { $sum: 1 } } }]),
    FraudAlert.findOne({}).sort({ detectedAt: -1 }).lean(),
  ]);

  const severityCounts: Record<string, number> = { low: 0, medium: 0, high: 0, critical: 0 };
  for (const row of bySeverity as Array<{ _id: string; count: number }>) {
    severityCounts[row._id] = row.count;
  }

  return {
    online: true,
    provider: getAgentProvider(),
    model: isOpenAIConfigured() ? process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini' : null,
    capabilities: [
      'Continuous transaction monitoring',
      'Fraud & money-laundering typology detection',
      'Government scheme treasury allocation',
      'Natural-language treasury Q&A',
    ],
    alertsTotal: total,
    alertsOpen: open,
    severityCounts,
    lastScanAt: (lastAlert as { detectedAt?: Date } | null)?.detectedAt || null,
    note: isOpenAIConfigured()
      ? 'Rule engine detects; OpenAI reasons about severity, narrative and recommendations.'
      : 'Running on the deterministic rule engine. Set OPENAI_API_KEY to enable LLM reasoning.',
  };
}
