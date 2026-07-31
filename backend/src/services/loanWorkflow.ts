/**
 * Loan approval workflow — the single source of truth.
 *
 * Two separate code paths used to be able to approve the same loan (the loans
 * router and the multisig router), each maintaining its own counter, and the
 * default threshold was three signatures that a single leader could never
 * reach because signatures were de-duplicated by signer id. The result was a
 * loan that showed up twice in the leader dashboard and could not be approved
 * at all.
 *
 * Now: one loan, one pending approval record, one leader signature, one
 * settlement. Both routers delegate here so they cannot drift apart again.
 */

import { v4 as uuidv4 } from 'uuid';
import mongoose from 'mongoose';
import LoanModel from '../models/Loan';
import MultiSigActionModel from '../models/MultiSigAction';
import Transaction from '../models/Transaction';
import User from '../models/User';
import { anchorLedgerEntry, explorerTxUrl } from './algorand';
import { registerTransactionLifecycle, setTransactionLifecycleStatus } from './txEngine';
import { recalculateIdleFunds } from './agentEngine';

/**
 * How many leaders must sign off on a loan.
 *
 * One. An SHG has a single elected leader who authorises disbursements at the
 * weekly meeting; requiring three signatures modelled a committee that does not
 * exist and deadlocked every request. Emergency and high-trust cases used to
 * "fast-track" to 1 — now that IS the standard, and the AI recommendation
 * carries the risk signal instead of the signature count.
 */
export const LEADER_APPROVALS_REQUIRED = 1;

export interface SettlementSummary {
  transactionId: string;
  explorerUrl: string;
  mode: 'live' | 'simulated';
  treasuryBalanceAfter: number;
  memberOutstandingAfter: number;
  requiresWalletSettlement: boolean;
  walletHint?: string;
}

/** Net pooled position: what the group can actually lend right now. */
export async function getTreasuryBalance(): Promise<number> {
  const totals = await Transaction.aggregate([
    { $match: { status: { $ne: 'failed' } } },
    {
      $group: {
        _id: null,
        inflow: {
          $sum: { $cond: [{ $in: ['$type', ['deposit', 'yield', 'loan_repayment']] }, '$amount', 0] },
        },
        outflow: {
          $sum: { $cond: [{ $in: ['$type', ['withdrawal', 'loan_disbursement']] }, '$amount', 0] },
        },
      },
    },
  ]);

  return Math.max(0, (totals[0]?.inflow || 0) - (totals[0]?.outflow || 0));
}

/**
 * Creates the one pending approval record for a loan.
 * Idempotent: a second call for the same loan returns the existing record
 * instead of stacking another approval the leader would have to clear.
 */
export async function openLoanApproval(params: {
  loanId: string;
  memberName: string;
  amount: number;
  isEmergency?: boolean;
}) {
  const existing = await MultiSigActionModel.findOne({
    linkedLoanId: params.loanId,
    status: 'pending',
  });
  if (existing) return existing;

  return MultiSigActionModel.create({
    id: uuidv4(),
    type: 'loan_approval',
    description: `Loan approval for ${params.memberName}`,
    amount: params.amount,
    requestedBy: params.memberName,
    signatures: [],
    signaturesRequired: LEADER_APPROVALS_REQUIRED,
    status: 'pending',
    isEmergency: Boolean(params.isEmergency),
    linkedLoanId: params.loanId,
    destinationRole: 'leader',
    createdAt: new Date().toISOString(),
  });
}

/**
 * Performs the actual money movement for an approved loan.
 *
 * This is the step that was missing: approving used to flip a status and queue
 * a "bank disbursement" that credited the member without ever debiting the
 * pool, so the treasury never went down. Now the disbursement is written as a
 * real outflow row — which is what every treasury figure in the app is derived
 * from — and the member's outstanding balance goes up to match.
 */
export async function settleApprovedLoan(loanId: string, approvedBy: string): Promise<SettlementSummary> {
  const loan = await LoanModel.findById(loanId);
  if (!loan) {
    throw Object.assign(new Error('Loan not found'), { name: 'ValidationError' });
  }

  const member = await User.findById(loan.user);
  if (!member) {
    throw Object.assign(new Error('Borrower account not found'), { name: 'ValidationError' });
  }

  // Guard against double settlement if approve is clicked twice quickly.
  const alreadySettled = await Transaction.findOne({
    user: member._id,
    type: 'loan_disbursement',
    amount: loan.amount,
    description: { $regex: `loan:${String(loan._id)}` },
  });

  if (alreadySettled) {
    return {
      transactionId: alreadySettled.transactionId || '',
      explorerUrl: alreadySettled.transactionId ? explorerTxUrl(alreadySettled.transactionId) : '',
      mode: 'simulated',
      treasuryBalanceAfter: await getTreasuryBalance(),
      memberOutstandingAfter: member.activeLoansAmount || 0,
      requiresWalletSettlement: false,
    };
  }

  const anchor = await anchorLedgerEntry({
    kind: 'loan_disbursement',
    memberId: String(member._id),
    shgId: member.shgId || undefined,
    amount: loan.amount,
    detail: `leader-approved by ${approvedBy}: ${loan.purpose}`,
  });

  registerTransactionLifecycle({
    transactionId: anchor.txId,
    type: 'loan_disbursement',
    amount: loan.amount,
    initialStatus: anchor.mode === 'live' ? 'confirmed' : 'pending',
    autoConfirm: anchor.mode !== 'live',
  });

  // The debit. Every treasury/liquidity figure is aggregated from these rows,
  // so writing it here is what makes the money actually leave the pool.
  await Transaction.create({
    user: member._id,
    type: 'loan_disbursement',
    amount: loan.amount,
    description: `Loan disbursed after leader approval — ${loan.purpose} [loan:${String(loan._id)}]`,
    transactionId: anchor.txId,
    status: anchor.mode === 'live' ? 'confirmed' : 'pending',
    settlementMode: anchor.mode,
    agentProcessed: false,
  });

  if (anchor.mode !== 'live') {
    setTimeout(() => {
      void Transaction.updateOne({ transactionId: anchor.txId }, { $set: { status: 'confirmed' } })
        .then(() => setTransactionLifecycleStatus(anchor.txId, 'confirmed'))
        .catch(() => undefined);
    }, 2500);
  }

  loan.status = 'repaying';
  loan.approvals = LEADER_APPROVALS_REQUIRED;
  loan.approvalsRequired = LEADER_APPROVALS_REQUIRED;
  loan.disbursedAt = new Date();
  loan.dueDate = loan.dueDate || new Date(Date.now() + 30 * 24 * 3600 * 1000);
  loan.transactionId = anchor.txId;
  await loan.save();

  member.activeLoans = (member.activeLoans || 0) + 1;
  member.activeLoansAmount = (member.activeLoansAmount || 0) + loan.amount;
  await member.save();

  await recalculateIdleFunds();

  const treasuryBalanceAfter = await getTreasuryBalance();

  return {
    transactionId: anchor.txId,
    explorerUrl: anchor.explorerUrl,
    mode: anchor.mode,
    treasuryBalanceAfter,
    memberOutstandingAfter: member.activeLoansAmount || 0,
    // In simulated mode the txid does not exist on chain. Tell the caller so the
    // UI can offer the Pera-signed path, which always produces a real one.
    requiresWalletSettlement: anchor.mode !== 'live',
    walletHint:
      anchor.mode !== 'live'
        ? 'The relayer is unfunded, so this entry is anchored locally. Use "Pay from Pera Wallet" to settle the same amount on TestNet and get an explorer-resolvable transaction id.'
        : undefined,
  };
}

/**
 * Declines exactly one loan.
 *
 * Scoped by loan id and asserted afterwards: the previous implementation set a
 * status without any linkage check, which is how a single decline could appear
 * to take the whole queue with it.
 */
export async function declineLoan(params: {
  loanId: string;
  reason?: string;
  declinedBy?: string;
}): Promise<{ loanId: string; actionsRejected: number; remainingPending: number }> {
  if (!mongoose.Types.ObjectId.isValid(params.loanId)) {
    throw Object.assign(new Error('Loan not found'), { name: 'ValidationError' });
  }

  const loan = await LoanModel.findById(params.loanId);
  if (!loan) {
    throw Object.assign(new Error('Loan not found'), { name: 'ValidationError' });
  }

  if (loan.status !== 'pending') {
    throw Object.assign(new Error(`Loan is already ${loan.status}`), { name: 'ValidationError' });
  }

  loan.status = 'rejected';
  loan.aiReason = params.reason
    ? `Declined by ${params.declinedBy || 'leader'}: ${params.reason}`
    : loan.aiReason;
  await loan.save();

  // Only approvals linked to THIS loan, and only ones still pending.
  const result = await MultiSigActionModel.updateMany(
    { linkedLoanId: String(loan._id), status: 'pending' },
    { $set: { status: 'rejected' } },
  );

  const remainingPending = await MultiSigActionModel.countDocuments({ status: 'pending' });

  return {
    loanId: String(loan._id),
    actionsRejected: result.modifiedCount ?? 0,
    remainingPending,
  };
}
