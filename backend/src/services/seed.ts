/**
 * Demo seed.
 *
 * Builds a believable SHG rather than three empty accounts: real members with
 * differing trust tiers, a deposit history that makes the treasury charts move,
 * loans in every lifecycle state, and minted d-SBT passports. Without this the
 * dashboards look broken on a fresh database.
 */

import bcrypt from 'bcryptjs';
import User from '../models/User';
import Transaction from '../models/Transaction';
import LoanModel from '../models/Loan';
import MultiSigActionModel from '../models/MultiSigAction';
import FraudAlert from '../models/FraudAlert';
import DSBT from '../models/DSBT';
import X402Payment from '../models/X402Payment';
import WhatsAppSession from '../models/WhatsAppSession';
import { resetAgentStateFromLedger } from './agentEngine';
import { anchorLedgerEntry, deriveAccount, simulatedTxId } from './algorand';
import { getOrMintPassport } from './dsbt';
import { LEADER_APPROVALS_REQUIRED, openLoanApproval } from './loanWorkflow';
import { DEFAULT_DEMO_MPIN } from './whatsappBanking';

const SHG_ID = 'shg1';

interface SeedMember {
  name: string;
  phone: string;
  trustScore: number;
  savings: number;
  depositCount: number;
}

const MEMBERS: SeedMember[] = [
  { name: 'Lakshmi Devi', phone: '+91-9876543210', trustScore: 880, savings: 24500, depositCount: 18 },
  { name: 'Sita Ramaiah', phone: '+91-9876543211', trustScore: 810, savings: 19800, depositCount: 15 },
  { name: 'Kamala Bai', phone: '+91-9876543212', trustScore: 925, savings: 31200, depositCount: 22 },
  { name: 'Radha Krishnan', phone: '+91-9876543213', trustScore: 690, savings: 8400, depositCount: 7 },
  { name: 'Anjali Sharma', phone: '+91-9876543214', trustScore: 755, savings: 14300, depositCount: 11 },
  { name: 'Meera Patel', phone: '+91-9876543215', trustScore: 640, savings: 5600, depositCount: 5 },
];

const STAFF = [
  { name: 'Leader Priya', phone: '+91-9000000001', role: 'leader', shgId: SHG_ID },
  { name: 'Leader Sunita', phone: '+91-9000000003', role: 'leader', shgId: SHG_ID },
  { name: 'Bank Manager', phone: '+91-9000000002', role: 'bank' },
];

const DEMO_PASSWORD = 'demo1234';

export interface SeedResult {
  reset: boolean;
  members: number;
  staff: number;
  transactions: number;
  loans: number;
  passports: number;
  pendingApprovals: number;
  credentials: Record<string, string>;
}

/**
 * @param reset When true, wipes demo collections first so repeated runs during
 *              a demo stay deterministic instead of stacking duplicates.
 */
export async function seedDemoData(reset = false): Promise<SeedResult> {
  if (reset) {
    await Promise.all([
      User.deleteMany({}),
      Transaction.deleteMany({}),
      LoanModel.deleteMany({}),
      MultiSigActionModel.deleteMany({}),
      // Cleared too, so a re-seeded demo starts from a clean compliance slate
      // and the agent re-derives its findings from the fresh ledger.
      FraudAlert.deleteMany({}),
      DSBT.deleteMany({}),
      X402Payment.deleteMany({}),
      WhatsAppSession.deleteMany({}),
    ]);
  }

  const mpinHash = await bcrypt.hash(DEFAULT_DEMO_MPIN, 10);
  let transactionCount = 0;
  let loanCount = 0;
  let passportCount = 0;
  let pendingApprovals = 0;

  // ── Members ──
  const createdMembers = [];
  for (const spec of MEMBERS) {
    let member = await User.findOne({ phone: spec.phone });

    if (!member) {
      member = await User.create({
        name: spec.name,
        phone: spec.phone,
        password: DEMO_PASSWORD,
        role: 'member',
        shgId: SHG_ID,
        mpinHash,
        trustScore: spec.trustScore,
        totalSavings: 0,
        algorandAddress: '',
      });
    }

    // Cache the derived chain address for the dashboards.
    member.algorandAddress = deriveAccount(`member:${member._id}`).address;
    member.mpinHash = mpinHash;
    await member.save();

    createdMembers.push({ doc: member, spec });
  }

  // ── Deposit history (spread backwards so charts have a slope) ──
  for (const { doc: member, spec } of createdMembers) {
    const existing = await Transaction.countDocuments({ user: member._id, type: 'deposit' });
    if (existing > 0) continue;

    const perDeposit = Math.round(spec.savings / spec.depositCount);
    let running = 0;

    for (let i = 0; i < spec.depositCount; i += 1) {
      const daysAgo = (spec.depositCount - i) * 7;
      const createdAt = new Date(Date.now() - daysAgo * 24 * 3600 * 1000);
      const amount = i === spec.depositCount - 1 ? spec.savings - running : perDeposit;
      running += amount;

      await Transaction.create({
        user: member._id,
        type: 'deposit',
        amount,
        description: `Weekly SHG savings deposit #${i + 1}`,
        transactionId: simulatedTxId(`seed:${member._id}:deposit:${i}`),
        status: 'confirmed',
        agentProcessed: true,
        createdAt,
        updatedAt: createdAt,
      });
      transactionCount += 1;
    }

    member.totalSavings = spec.savings;
    await member.save();
  }

  // ── Loans across the lifecycle ──
  const loanSpecs: Array<{
    memberIndex: number;
    amount: number;
    purpose: string;
    status: string;
    repaid: number;
  }> = [
    { memberIndex: 1, amount: 6500, purpose: 'medical emergency', status: 'repaying', repaid: 3250 },
    { memberIndex: 2, amount: 12000, purpose: 'business livelihood', status: 'repaid', repaid: 12000 },
    { memberIndex: 0, amount: 5000, purpose: 'children education', status: 'repaying', repaid: 1666 },
    { memberIndex: 4, amount: 9000, purpose: 'agriculture', status: 'pending', repaid: 0 },
    { memberIndex: 3, amount: 4000, purpose: 'medical emergency', status: 'pending', repaid: 0 },
  ];

  for (const spec of loanSpecs) {
    const target = createdMembers[spec.memberIndex];
    if (!target) continue;

    const exists = await LoanModel.findOne({ user: target.doc._id, amount: spec.amount, purpose: spec.purpose });
    if (exists) continue;

    const loan = await LoanModel.create({
      user: target.doc._id,
      amount: spec.amount,
      purpose: spec.purpose,
      status: spec.status,
      trustScoreAtApplication: target.spec.trustScore,
      aiRecommendation: target.spec.trustScore >= 700 ? 'approve' : 'review',
      aiReason: `Trust score ${target.spec.trustScore}/1000 evaluated against on-chain repayment history.`,
      approvals: spec.status === 'pending' ? 0 : LEADER_APPROVALS_REQUIRED,
      approvalsRequired: LEADER_APPROVALS_REQUIRED,
      repaidAmount: spec.repaid,
      disbursedAt: spec.status === 'pending' ? undefined : new Date(Date.now() - 30 * 24 * 3600 * 1000),
      dueDate: new Date(Date.now() + 30 * 24 * 3600 * 1000),
      transactionId: spec.status === 'pending' ? undefined : simulatedTxId(`seed:loan:${target.doc._id}:${spec.amount}`),
    });
    loanCount += 1;

    if (spec.status === 'pending') {
      await openLoanApproval({
        loanId: String(loan._id),
        memberName: target.spec.name,
        amount: spec.amount,
        isEmergency: /medical|hospital|emergency/i.test(spec.purpose),
      });
      pendingApprovals += 1;
    }

    if (spec.status !== 'pending') {
      target.doc.activeLoans = spec.status === 'repaying' ? (target.doc.activeLoans || 0) + 1 : target.doc.activeLoans || 0;
      target.doc.activeLoansAmount =
        spec.status === 'repaying'
          ? (target.doc.activeLoansAmount || 0) + (spec.amount - spec.repaid)
          : target.doc.activeLoansAmount || 0;
      await target.doc.save();

      await Transaction.create({
        user: target.doc._id,
        type: 'loan_disbursement',
        amount: spec.amount,
        description: `Loan disbursed — ${spec.purpose}`,
        transactionId: loan.transactionId,
        status: 'confirmed',
        agentProcessed: true,
        createdAt: new Date(Date.now() - 30 * 24 * 3600 * 1000),
      });
      transactionCount += 1;

      if (spec.repaid > 0) {
        await Transaction.create({
          user: target.doc._id,
          type: 'loan_repayment',
          amount: spec.repaid,
          description: 'Auto-deducted loan repayment',
          transactionId: simulatedTxId(`seed:repay:${loan._id}`),
          status: 'confirmed',
          agentProcessed: true,
          createdAt: new Date(Date.now() - 7 * 24 * 3600 * 1000),
        });
        transactionCount += 1;
      }
    }
  }

  // ── Yield distribution, so the agent panel has something to show ──
  const yieldExists = await Transaction.countDocuments({ type: 'yield' });
  if (yieldExists === 0) {
    for (const { doc: member } of createdMembers.slice(0, 4)) {
      const amount = Math.round(((member.totalSavings || 0) * 0.052) / 12);
      if (amount <= 0) continue;
      await Transaction.create({
        user: member._id,
        type: 'yield',
        amount,
        description: 'Monthly yield from Algorand DeFi pools',
        transactionId: simulatedTxId(`seed:yield:${member._id}`),
        status: 'confirmed',
        agentProcessed: true,
        createdAt: new Date(Date.now() - 3 * 24 * 3600 * 1000),
      });
      member.yieldEarned = (member.yieldEarned || 0) + amount;
      await member.save();
      transactionCount += 1;
    }
  }

  // ── Planted anomalies, so the compliance agent has real work to do ──
  //
  // A clean ledger means the fraud detector correctly reports nothing, which
  // demonstrates nothing. These are textbook AML typologies deliberately woven
  // into the history — they are marked in the description so nobody mistakes
  // them for an accident, and the agent is given no hint that they exist: it
  // has to find them with the same rules it runs against real activity.
  const anomalyCount = await Transaction.countDocuments({ description: /red-team pattern/i });
  if (anomalyCount === 0) {
    const structurer = createdMembers[5]?.doc; // Meera Patel — lowest trust tier
    const roundTripper = createdMembers[3]?.doc; // Radha Krishnan

    if (structurer) {
      // Structuring: four legs, each just under the ₹10,000 reporting bar,
      // inside 30 hours.
      const base = Date.now() - 4 * 24 * 3600 * 1000;
      for (let i = 0; i < 4; i += 1) {
        const at = new Date(base + i * 8 * 3600 * 1000);
        await Transaction.create({
          user: structurer._id,
          type: 'deposit',
          amount: 9400,
          description: `Cash deposit (red-team pattern: structuring leg ${i + 1}/4)`,
          transactionId: simulatedTxId(`seed:anomaly:structuring:${structurer._id}:${i}`),
          status: 'confirmed',
          agentProcessed: false,
          createdAt: at,
          updatedAt: at,
        });
        transactionCount += 1;
      }
      structurer.totalSavings = (structurer.totalSavings || 0) + 4 * 9400;
      await structurer.save();
    }

    if (roundTripper) {
      // Layering: money in, near-identical amount straight back out.
      const inAt = new Date(Date.now() - 2 * 24 * 3600 * 1000);
      const outAt = new Date(inAt.getTime() + 5 * 3600 * 1000);

      await Transaction.create({
        user: roundTripper._id,
        type: 'deposit',
        amount: 18000,
        description: 'Deposit from external source (red-team pattern: round-trip in)',
        transactionId: simulatedTxId(`seed:anomaly:roundtrip:in:${roundTripper._id}`),
        status: 'confirmed',
        agentProcessed: false,
        createdAt: inAt,
        updatedAt: inAt,
      });

      await Transaction.create({
        user: roundTripper._id,
        type: 'withdrawal',
        amount: 17500,
        description: 'Same-day withdrawal (red-team pattern: round-trip out)',
        transactionId: simulatedTxId(`seed:anomaly:roundtrip:out:${roundTripper._id}`),
        status: 'confirmed',
        agentProcessed: false,
        createdAt: outAt,
        updatedAt: outAt,
      });

      transactionCount += 2;
      roundTripper.totalSavings = Math.max(0, (roundTripper.totalSavings || 0) + 500);
      await roundTripper.save();
    }
  }

  // ── Staff ──
  let staffCount = 0;
  for (const spec of STAFF) {
    const exists = await User.findOne({ phone: spec.phone });
    if (!exists) {
      await User.create({ ...spec, password: DEMO_PASSWORD, mpinHash });
      staffCount += 1;
    }
  }

  // ── d-SBT passports ──
  for (const { doc: member } of createdMembers) {
    try {
      await getOrMintPassport(String(member._id));
      passportCount += 1;
    } catch {
      /* passport minting is best effort during seed */
    }
  }

  // ── Align the agent's vault position with the ledger we just built ──
  // Without this the vault panel and the idle-fund advisor describe a treasury
  // that does not exist, and idle funds clamp to zero.
  await resetAgentStateFromLedger().catch((err) => {
    console.warn('[seed] could not rebuild agent state:', err?.message || err);
  });

  // ── Anchor the seed itself, so the chain has a genesis marker ──
  await anchorLedgerEntry({
    kind: 'deposit',
    shgId: SHG_ID,
    detail: `demo seed: ${createdMembers.length} members`,
  }).catch(() => undefined);

  return {
    reset,
    members: createdMembers.length,
    staff: staffCount,
    transactions: transactionCount,
    loans: loanCount,
    passports: passportCount,
    pendingApprovals,
    credentials: {
      member: `${MEMBERS[0].phone} / ${DEMO_PASSWORD}`,
      leader: `${STAFF[0].phone} / ${DEMO_PASSWORD}`,
      bank: `${STAFF[2].phone} / ${DEMO_PASSWORD}`,
      whatsappMpin: DEFAULT_DEMO_MPIN,
    },
  };
}
