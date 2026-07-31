import { v4 as uuidv4 } from 'uuid';
import LoanModel from '../models/Loan';
import User from '../models/User';
import Transaction from '../models/Transaction';
import BankDisbursement from '../models/BankDisbursement';
import { registerTransactionLifecycle, setTransactionLifecycleStatus } from './txEngine';
import { anchorLedgerEntry } from './algorand';

export async function queueBankDisbursement(params: {
  loanId: string;
  userId: string;
  amount: number;
  notes?: string;
  autoProcess?: boolean;
}): Promise<any> {
  const existing = await BankDisbursement.findOne({ loan: params.loanId, status: 'pending' });
  if (existing) return existing;

  const queued = await BankDisbursement.create({
    loan: params.loanId,
    user: params.userId,
    amount: params.amount,
    status: 'pending',
    notes: params.notes,
    queuedAt: new Date(),
  });

  if (params.autoProcess !== false) {
    const delay = 2500 + Math.floor(Math.random() * 3500);
    setTimeout(() => {
      processBankDisbursement(String(queued._id), 'BANK_AUTOMATION').catch(() => {
        // Best-effort async simulation for hackathon flow.
      });
    }, delay);
  }

  return queued;
}

export async function processBankDisbursement(disbursementId: string, processedBy = 'BANK_OFFICER'): Promise<any> {
  const disbursement = await BankDisbursement.findById(disbursementId);
  if (!disbursement || disbursement.status !== 'pending') {
    return disbursement;
  }

  const loan = await LoanModel.findById(disbursement.loan);
  const user = await User.findById(disbursement.user);
  if (!loan || !user) {
    disbursement.status = 'rejected';
    disbursement.notes = 'Loan/member record unavailable during bank processing';
    disbursement.processedAt = new Date();
    disbursement.processedBy = processedBy;
    await disbursement.save();
    return disbursement;
  }

  const anchor = await anchorLedgerEntry({
    kind: 'loan_disbursement',
    memberId: String(user._id),
    shgId: user.shgId || undefined,
    amount: disbursement.amount,
    detail: `bank payout by ${processedBy}`,
  });
  const transactionId = anchor.txId;
  registerTransactionLifecycle({
    transactionId,
    type: 'loan_disbursement',
    amount: disbursement.amount,
    initialStatus: anchor.mode === 'live' ? 'confirmed' : 'pending',
    autoConfirm: anchor.mode !== 'live',
  });

  disbursement.status = 'approved';
  disbursement.transactionId = transactionId;
  disbursement.bankReference = `BANK-${uuidv4().slice(0, 8).toUpperCase()}`;
  disbursement.processedBy = processedBy;
  disbursement.processedAt = new Date();
  await disbursement.save();

  loan.status = 'repaying';
  loan.disbursedAt = new Date();
  loan.dueDate = loan.dueDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  loan.transactionId = transactionId;
  await loan.save();

  user.activeLoans = (user.activeLoans || 0) + 1;
  user.activeLoansAmount = (user.activeLoansAmount || 0) + disbursement.amount;
  await user.save();

  await Transaction.create({
    user: user._id,
    type: 'loan_disbursement',
    amount: disbursement.amount,
    description: `Loan disbursed by bank (${disbursement.bankReference})`,
    transactionId,
    status: 'pending',
    settlementMode: anchor.mode,
    agentProcessed: false,
  });

  setTimeout(async () => {
    await Transaction.updateOne({ transactionId }, { $set: { status: 'confirmed' } });
    setTransactionLifecycleStatus(transactionId, 'confirmed');
  }, 2500 + Math.floor(Math.random() * 2500));

  return disbursement;
}
