import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import LoanModel from '../models/Loan';
import User from '../models/User';
import MultiSigActionModel from '../models/MultiSigAction';
import BankDisbursement from '../models/BankDisbursement';
import { explorerTxUrl } from '../services/algorand';
import { processBankDisbursement } from '../services/bankDisbursementService';
import { PaidRequest, requirePayment } from '../x402/middleware';
import {
  LEADER_APPROVALS_REQUIRED,
  declineLoan,
  getTreasuryBalance,
  openLoanApproval,
  settleApprovedLoan,
} from '../services/loanWorkflow';

const router = Router();

function evaluateLoan(trustScore: number, amount: number, purpose: string): {
  recommendation: 'approve' | 'review' | 'reject';
  reason: string;
  isEmergency: boolean;
} {
  const isEmergency = /medical|hospital|emergency|health|accident|urgent/i.test(purpose);
  const isMicroLoan = amount <= 5000;

  if (trustScore >= 800 && isMicroLoan) {
    return {
      recommendation: 'approve',
      reason: `Trust score ${trustScore}/1000 with a micro-loan amount. Recommend approval.`,
      isEmergency,
    };
  }
  if (trustScore >= 750 && isEmergency) {
    return {
      recommendation: 'approve',
      reason: `Emergency request. Trust score ${trustScore}/1000 clears the emergency threshold. Recommend immediate approval.`,
      isEmergency,
    };
  }
  if (trustScore >= 700) {
    return {
      recommendation: 'approve',
      reason: `Trust score ${trustScore}/1000 meets the approval threshold.`,
      isEmergency,
    };
  }
  if (trustScore >= 600) {
    return {
      recommendation: 'review',
      reason: `Trust score ${trustScore}/1000 is below the confidence threshold. Leader review recommended before approval.`,
      isEmergency,
    };
  }
  return {
    recommendation: 'reject',
    reason: `Trust score ${trustScore}/1000 is insufficient for this amount. Member should build repayment consistency first.`,
    isEmergency,
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
    approvalsRequired: doc.approvalsRequired ?? LEADER_APPROVALS_REQUIRED,
    disbursedAt: doc.disbursedAt,
    dueDate: doc.dueDate,
    repaidAmount: doc.repaidAmount,
    createdAt: doc.createdAt,
    transactionId: doc.transactionId,
    explorerUrl: doc.transactionId ? explorerTxUrl(doc.transactionId) : null,
  };
}

// GET /api/loans?status=pending
router.get('/', async (req: Request, res: Response) => {
  const filter: Record<string, unknown> = {};
  if (req.query.status) filter.status = String(req.query.status);

  const loans = await LoanModel.find(filter)
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
//
// x402-gated. The member's own Pera wallet must settle the underwriting fee to
// the hardcoded receiver BEFORE the request is evaluated or routed for
// approval: without an X-PAYMENT header this returns HTTP 402 and no loan is
// created. Pay-per-use, enforced at the only place it can't be faked.
router.post('/request', requirePayment('loan-request'), async (req: PaidRequest, res: Response) => {
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

  const loan = await LoanModel.create({
    user: member._id,
    amount: normalizedAmount,
    purpose: String(purpose),
    status: 'pending',
    trustScoreAtApplication: member.trustScore || 700,
    aiRecommendation: evaluation.recommendation,
    aiReason: evaluation.reason,
    approvals: 0,
    approvalsRequired: LEADER_APPROVALS_REQUIRED,
    repaidAmount: 0,
  });

  // Exactly one pending approval, even if the request is retried.
  if (evaluation.recommendation !== 'reject') {
    await openLoanApproval({
      loanId: String(loan._id),
      memberName: member.name,
      amount: normalizedAmount,
      isEmergency: evaluation.isEmergency,
    });
  }

  const hydrated = await LoanModel.findById(loan._id).populate('user', 'name').lean();

  res.status(201).json({
    success: true,
    data: {
      loan: mapLoan(hydrated || loan.toObject()),
      evaluation,
      approvalsRequired: LEADER_APPROVALS_REQUIRED,
      // Receipt for the x402 payment that unlocked this request, so the UI can
      // link straight to the settled transaction on the explorer.
      x402: req.x402
        ? { ...req.x402, explorerUrl: explorerTxUrl(req.x402.transaction) }
        : null,
      message:
        evaluation.recommendation === 'reject'
          ? 'Loan request recorded but not routed for approval — trust score is below the lending threshold.'
          : 'Loan request submitted. One SHG leader approval releases the funds.',
    },
  });
});

// POST /api/loans/:id/approve — the single leader sign-off
//
// Gated identically to the multisig path, so a leader cannot sidestep the x402
// fee by hitting the other endpoint.
router.post('/:id/approve', requirePayment('loan-approval'), async (req: PaidRequest, res: Response) => {
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

  const approvedBy = String(req.body.signerId || req.body.approvedBy || 'SHG Leader');
  const settlement = await settleApprovedLoan(String(loan._id), approvedBy);

  // Close the linked approval record so the loan cannot be approved twice from
  // the multi-sig panel.
  await MultiSigActionModel.updateMany(
    { linkedLoanId: String(loan._id), status: 'pending' },
    {
      $set: {
        status: 'executed',
        signatures: [approvedBy],
        signaturesRequired: LEADER_APPROVALS_REQUIRED,
        transactionId: settlement.transactionId,
      },
    },
  );

  const hydrated = await LoanModel.findById(loan._id).populate('user', 'name').lean();

  res.json({
    success: true,
    data: {
      loan: mapLoan(hydrated || loan.toObject()),
      settlement,
      x402: req.x402 ? { ...req.x402, explorerUrl: explorerTxUrl(req.x402.transaction) } : null,
      message:
        `Approved by ${approvedBy}. ₹${loan.amount.toLocaleString('en-IN')} debited from the SHG treasury ` +
        `(balance now ₹${settlement.treasuryBalanceAfter.toLocaleString('en-IN')}).`,
    },
  });
});

// POST /api/loans/:id/decline — rejects this loan only
router.post('/:id/decline', async (req: Request, res: Response) => {
  const result = await declineLoan({
    loanId: req.params.id,
    reason: req.body?.reason,
    declinedBy: req.body?.declinedBy || 'SHG Leader',
  });

  const hydrated = await LoanModel.findById(result.loanId).populate('user', 'name').lean();

  res.json({
    success: true,
    data: {
      loan: hydrated ? mapLoan(hydrated) : null,
      ...result,
      message:
        `Loan declined. ${result.actionsRejected} linked approval closed. ` +
        `${result.remainingPending} other approval${result.remainingPending === 1 ? '' : 's'} still pending and untouched.`,
    },
  });
});

// GET /api/loans/treasury/balance — what the pool can lend right now
router.get('/treasury/balance', async (_req: Request, res: Response) => {
  const balance = await getTreasuryBalance();
  res.json({ success: true, data: { balance, currency: 'INR' } });
});

export default router;
