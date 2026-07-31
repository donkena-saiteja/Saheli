import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import LoanModel from '../models/Loan';
import User from '../models/User';
import MultiSigActionModel from '../models/MultiSigAction';
import BankDisbursement from '../models/BankDisbursement';
import { anchorLedgerEntry } from '../services/algorand';
import { queueBankDisbursement, processBankDisbursement } from '../services/bankDisbursementService';

const router = Router();

function evaluateLoan(trustScore: number, amount: number, purpose: string): {
  recommendation: 'approve' | 'review' | 'reject';
  reason: string;
  fastTrack: boolean;
} {
  const isEmergency = /medical|hospital|emergency|health/i.test(purpose);
  const isMicroLoan = amount <= 5000;

  if (trustScore >= 800 && isMicroLoan) {
    return {
      recommendation: 'approve',
      reason: `Trust score ${trustScore}/1000. Micro-loan qualifies for fast-track leader approval.`,
      fastTrack: true,
    };
  }
  if (trustScore >= 750 && isEmergency) {
    return {
      recommendation: 'approve',
      reason: `Emergency medical loan. Trust score ${trustScore}/1000 clears emergency threshold. Routing for expedited 1/3 approval.`,
      fastTrack: true,
    };
  }
  if (trustScore >= 700) {
    return {
      recommendation: 'approve',
      reason: `Trust score ${trustScore}/1000 meets approval threshold. Routing for standard approval.`,
      fastTrack: false,
    };
  }
  if (trustScore >= 600) {
    return {
      recommendation: 'review',
      reason: `Trust score ${trustScore}/1000 is below confidence threshold. Manual review by SHG leader recommended.`,
      fastTrack: false,
    };
  }
  return {
    recommendation: 'reject',
    reason: `Trust score ${trustScore}/1000 is insufficient for this loan amount. Member should improve repayment consistency first.`,
    fastTrack: false,
  };
}

function mapLoan(doc: any) {
  return {
    id: String(doc._id),
    memberId: String(doc.user?._id || doc.user),
    memberName: doc.user?.name || 'Member',
    amount: doc.amount,
    purpose: doc.purpose,
    status: doc.status,
    trustScoreAtApplication: doc.trustScoreAtApplication,
    aiRecommendation: doc.aiRecommendation,
    aiReason: doc.aiReason,
    approvals: doc.approvals,
    approvalsRequired: doc.approvalsRequired,
    disbursedAt: doc.disbursedAt,
    dueDate: doc.dueDate,
    repaidAmount: doc.repaidAmount,
    createdAt: doc.createdAt,
    transactionId: doc.transactionId,
  };
}

// GET /api/loans
router.get('/', async (_req: Request, res: Response) => {
  const loans = await LoanModel.find()
    .populate('user', 'name')
    .sort({ createdAt: -1 })
    .lean();
  res.json({ success: true, data: loans.map(mapLoan) });
});

// GET /api/loans/bank-queue/list
router.get('/bank-queue/list', async (_req: Request, res: Response) => {
  const queue = await BankDisbursement.find({ status: 'pending' })
    .populate('loan', 'amount purpose status')
    .populate('user', 'name phone')
    .sort({ createdAt: -1 })
    .lean();

  res.json({ success: true, data: queue });
});

// POST /api/loans/bank-queue/:id/process
router.post('/bank-queue/:id/process', async (req: Request, res: Response) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    res.status(404).json({ success: false, error: 'Queue item not found' });
    return;
  }

  const processed = await processBankDisbursement(req.params.id, req.body.processedBy || 'BANK_OFFICER');
  if (!processed) {
    res.status(404).json({ success: false, error: 'Queue item not found' });
    return;
  }

  res.json({ success: true, data: processed });
});

// GET /api/loans/:id
router.get('/:id', async (req: Request, res: Response) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    res.status(404).json({ success: false, error: 'Loan not found' });
    return;
  }

  const loan = await LoanModel.findById(req.params.id).populate('user', 'name').lean();
  if (!loan) {
    res.status(404).json({ success: false, error: 'Loan not found' });
    return;
  }

  res.json({ success: true, data: mapLoan(loan) });
});

// POST /api/loans/request
router.post('/request', async (req: Request, res: Response) => {
  const { memberId, amount, purpose } = req.body;

  if (!memberId || !amount || !purpose) {
    res.status(400).json({ success: false, error: 'memberId, amount, purpose required' });
    return;
  }

  if (!mongoose.Types.ObjectId.isValid(memberId)) {
    res.status(400).json({ success: false, error: 'memberId must be a valid Mongo ObjectId' });
    return;
  }

  const normalizedAmount = Number(amount);
  if (!Number.isFinite(normalizedAmount) || normalizedAmount <= 0) {
    res.status(400).json({ success: false, error: 'amount must be a positive number' });
    return;
  }

  const member = await User.findById(memberId);
  if (!member || member.role !== 'member') {
    res.status(404).json({ success: false, error: 'Member not found' });
    return;
  }

  const evaluation = evaluateLoan(member.trustScore || 700, normalizedAmount, String(purpose));
  const approvalsRequired = evaluation.fastTrack ? 1 : 3;

  const loan = await LoanModel.create({
    user: member._id,
    amount: normalizedAmount,
    purpose: String(purpose),
    status: 'pending',
    trustScoreAtApplication: member.trustScore || 700,
    aiRecommendation: evaluation.recommendation,
    aiReason: evaluation.reason,
    approvals: 0,
    approvalsRequired,
    repaidAmount: 0,
  });

  if (evaluation.recommendation !== 'reject') {
    await MultiSigActionModel.create({
      id: uuidv4(),
      type: 'loan_approval',
      description: `Loan approval for ${member.name}`,
      amount: normalizedAmount,
      requestedBy: member.name,
      signatures: [],
      signaturesRequired: approvalsRequired,
      status: 'pending',
      linkedLoanId: String(loan._id),
      destinationRole: 'leader',
      createdAt: new Date().toISOString(),
    });
  }

  const hydrated = await LoanModel.findById(loan._id).populate('user', 'name').lean();

  res.status(201).json({
    success: true,
    data: {
      loan: mapLoan(hydrated || loan.toObject()),
      evaluation,
      message: 'Loan request submitted. Leader approval is required before funds are disbursed and QR proof is generated.',
    },
  });
});

// POST /api/loans/:id/approve
router.post('/:id/approve', async (req: Request, res: Response) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    res.status(404).json({ success: false, error: 'Loan not found' });
    return;
  }

  const loan = await LoanModel.findById(req.params.id);
  if (!loan) {
    res.status(404).json({ success: false, error: 'Loan not found' });
    return;
  }

  if (loan.status !== 'pending') {
    res.status(400).json({ success: false, error: `Loan is already ${loan.status}` });
    return;
  }

  loan.approvals += 1;

  let message = `Approval ${loan.approvals}/${loan.approvalsRequired} recorded.`;
  if (loan.approvals >= loan.approvalsRequired) {
    loan.status = 'bank_pending';
    const approvalAnchor = await anchorLedgerEntry({
      kind: 'loan_disbursement',
      memberId: String(loan.user),
      amount: loan.amount,
      detail: `leader-approved:${loan.purpose}`,
    });
    loan.transactionId = approvalAnchor.txId;
    loan.disbursedAt = new Date();
    loan.dueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    message = 'Approval threshold reached! Loan moved for bank payout processing.';

    await queueBankDisbursement({
      loanId: String(loan._id),
      userId: String(loan.user),
      amount: loan.amount,
      notes: 'Manual leader approval endpoint triggered',
      autoProcess: true,
    });
  }

  await loan.save();

  const action = await MultiSigActionModel.findOne({ linkedLoanId: String(loan._id), status: 'pending' });
  if (action) {
    const signerId = req.body.signerId || 'leader_manual';
    action.signatures = Array.from(new Set([...(action.signatures || []), signerId]));
    action.signaturesRequired = loan.approvalsRequired;
    if (loan.status !== 'pending') {
      action.status = 'executed';
      action.transactionId = loan.transactionId;
    }
    await action.save();
  }

  const hydrated = await LoanModel.findById(loan._id).populate('user', 'name').lean();
  const mapped = mapLoan(hydrated || loan.toObject());
  res.json({ success: true, data: { loan: mapped, message } });
});

export default router;
