import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { registerTransactionLifecycle } from '../services/txEngine';
import { submitAtomicApproval, explorerTxUrl } from '../services/algorand';
import MultiSigActionModel from '../models/MultiSigAction';
import LoanModel from '../models/Loan';
import { LEADER_APPROVALS_REQUIRED, declineLoan, settleApprovedLoan } from '../services/loanWorkflow';
import { PaidRequest, requirePayment } from '../x402/middleware';

const router = Router();

function mapDocToAction(doc: any) {
  const signatures = doc.signatures || [];
  const required = doc.signaturesRequired || LEADER_APPROVALS_REQUIRED;

  return {
    id: doc.id,
    type: doc.type,
    description: doc.description,
    amount: doc.amount,
    requestedBy: doc.requestedBy,
    signatures,
    signaturesRequired: required,
    /** Convenience for the UI so it never has to recompute the ratio. */
    approvalProgress: Math.min(1, signatures.length / Math.max(1, required)),
    status: doc.status,
    isEmergency: Boolean(doc.isEmergency),
    linkedLoanId: doc.linkedLoanId,
    destinationRole: doc.destinationRole || 'leader',
    createdAt: doc.createdAt,
    transactionId: doc.transactionId,
    explorerUrl: doc.transactionId ? explorerTxUrl(doc.transactionId) : undefined,
    atomicGroup: true,
  };
}

// GET /api/multisig/pending?destinationRole=leader
router.get('/pending', async (req: Request, res: Response) => {
  const filter: Record<string, unknown> = { status: 'pending' };
  if (req.query.destinationRole) filter.destinationRole = String(req.query.destinationRole);

  const pending = await MultiSigActionModel.find(filter).sort({ createdAt: -1 }).lean();
  res.json({ success: true, data: pending.map(mapDocToAction) });
});

// GET /api/multisig
router.get('/', async (req: Request, res: Response) => {
  const filter: Record<string, unknown> = {};
  if (req.query.status) filter.status = String(req.query.status);
  if (req.query.destinationRole) filter.destinationRole = String(req.query.destinationRole);

  const actions = await MultiSigActionModel.find(filter).sort({ createdAt: -1 }).lean();
  res.json({ success: true, data: actions.map(mapDocToAction) });
});

// POST /api/multisig/:id/sign
//
// x402-gated, same as the loan request. The leader settles the disbursement fee
// from their own Pera wallet to the hardcoded receiver before their signature
// is recorded — so a 402 here means nothing was approved and no treasury
// movement happened.
router.post('/:id/sign', requirePayment('loan-approval'), async (req: PaidRequest, res: Response) => {
  const action = await MultiSigActionModel.findOne({ id: req.params.id });
  if (!action) {
    res.status(404).json({ success: false, error: 'Action not found' });
    return;
  }

  if (action.status !== 'pending') {
    res.status(400).json({ success: false, error: `Action is already ${action.status}` });
    return;
  }

  const signerId = req.body.signerId || `leader_${uuidv4().slice(0, 4)}`;
  if (!action.signatures.includes(signerId)) {
    action.signatures.push(signerId);
  }

  // A leader signing twice must not deadlock the action. Signatures are
  // de-duplicated by signer, so the threshold is enforced against distinct
  // signers and a single-leader SHG can always reach it.
  const required = Math.max(1, action.signaturesRequired || LEADER_APPROVALS_REQUIRED);
  let message = `Approval ${action.signatures.length}/${required} recorded.`;
  let settlement = null;

  if (action.signatures.length >= required) {
    action.status = 'executed';

    // Every approving signature is bundled into ONE Algorand atomic group:
    // either all of them commit in the same block or none do, so funds can
    // never move on a partial quorum.
    const atomic = await submitAtomicApproval({
      approverSubjects: action.signatures.map((s: string) => `leader:${s}`),
      shgId: 'shg1',
      actionId: action.id,
      description: action.description,
      amount: action.amount,
    });

    action.transactionId = atomic.txId;
    registerTransactionLifecycle({
      transactionId: atomic.txId,
      type: action.type,
      amount: action.amount,
      initialStatus: atomic.mode === 'live' ? 'confirmed' : 'pending',
      autoConfirm: atomic.mode !== 'live',
    });

    message = `Approved. Committed as an Algorand atomic group (${atomic.approvals} signature${
      atomic.approvals === 1 ? '' : 's'
    }). Ref: ${atomic.txId.slice(0, 12)}…`;

    if (action.type === 'loan_approval' && action.linkedLoanId) {
      const loan = await LoanModel.findById(action.linkedLoanId).catch(() => null);
      if (loan && loan.status === 'pending') {
        // Same settlement path the loans router uses, so the treasury is
        // debited identically whichever panel the leader approved from.
        settlement = await settleApprovedLoan(String(loan._id), signerId);
        message =
          `Loan approved and settled. ₹${loan.amount.toLocaleString('en-IN')} left the SHG treasury ` +
          `(balance now ₹${settlement.treasuryBalanceAfter.toLocaleString('en-IN')}).`;
      }
    }
  }

  await action.save();

  res.json({
    success: true,
    data: {
      action: mapDocToAction(action),
      settlement,
      x402: req.x402 ? { ...req.x402, explorerUrl: explorerTxUrl(req.x402.transaction) } : null,
      message,
    },
  });
});

// POST /api/multisig/:id/reject — rejects THIS action only
router.post('/:id/reject', async (req: Request, res: Response) => {
  const action = await MultiSigActionModel.findOne({ id: req.params.id });
  if (!action) {
    res.status(404).json({ success: false, error: 'Action not found' });
    return;
  }

  if (action.status !== 'pending') {
    res.status(400).json({ success: false, error: `Action is already ${action.status}` });
    return;
  }

  action.status = 'rejected';
  await action.save();

  // Reject the loan this approval belongs to — and nothing else. Scoped by the
  // action's own linkedLoanId so one decline can never touch another request.
  let loanDeclined: string | null = null;
  if (action.type === 'loan_approval' && action.linkedLoanId) {
    const result = await declineLoan({
      loanId: action.linkedLoanId,
      reason: req.body?.reason,
      declinedBy: req.body?.declinedBy || 'SHG Leader',
    }).catch(() => null);
    loanDeclined = result?.loanId || null;
  }

  const remainingPending = await MultiSigActionModel.countDocuments({ status: 'pending' });

  res.json({
    success: true,
    data: {
      action: mapDocToAction(action),
      loanDeclined,
      remainingPending,
      message:
        `Declined "${action.description}". ${remainingPending} other approval${
          remainingPending === 1 ? '' : 's'
        } still pending and unaffected.`,
    },
  });
});

// POST /api/multisig (create new action)
router.post('/', async (req: Request, res: Response) => {
  const { type, description, amount, requestedBy, signaturesRequired, linkedLoanId, destinationRole, isEmergency } =
    req.body;

  const created = await MultiSigActionModel.create({
    id: uuidv4(),
    type: type || 'loan_approval',
    description: description || 'New approval action',
    amount: amount || 0,
    requestedBy: requestedBy || 'AI Agent',
    signatures: [],
    signaturesRequired: Math.max(1, Number(signaturesRequired) || LEADER_APPROVALS_REQUIRED),
    status: 'pending',
    isEmergency: Boolean(isEmergency),
    createdAt: new Date().toISOString(),
    linkedLoanId,
    destinationRole: destinationRole || 'leader',
  });

  res.status(201).json({ success: true, data: mapDocToAction(created) });
});

export default router;
