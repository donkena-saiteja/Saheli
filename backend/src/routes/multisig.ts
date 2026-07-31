import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { registerTransactionLifecycle } from '../services/txEngine';
import { submitAtomicApproval, explorerTxUrl } from '../services/algorand';
import MultiSigActionModel from '../models/MultiSigAction';
import LoanModel from '../models/Loan';
import { queueBankDisbursement } from '../services/bankDisbursementService';

const router = Router();

function mapDocToAction(doc: any) {
  return {
    id: doc.id,
    type: doc.type,
    description: doc.description,
    amount: doc.amount,
    requestedBy: doc.requestedBy,
    signatures: doc.signatures || [],
    signaturesRequired: doc.signaturesRequired,
    status: doc.status,
    createdAt: doc.createdAt,
    transactionId: doc.transactionId,
    explorerUrl: doc.transactionId ? explorerTxUrl(doc.transactionId) : undefined,
    atomicGroup: true,
  };
}

// GET /api/multisig/pending
router.get('/pending', async (_req: Request, res: Response) => {
  const pending = await MultiSigActionModel.find({ status: 'pending' }).sort({ createdAt: -1 }).lean();
  res.json({ success: true, data: pending.map(mapDocToAction) });
});

// GET /api/multisig
router.get('/', async (_req: Request, res: Response) => {
  const actions = await MultiSigActionModel.find().sort({ createdAt: -1 }).lean();
  res.json({ success: true, data: actions.map(mapDocToAction) });
});

// POST /api/multisig/:id/sign
router.post('/:id/sign', async (req: Request, res: Response) => {
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

  let message = `Approval ${action.signatures.length}/${action.signaturesRequired} recorded.`;

  if (action.signatures.length >= action.signaturesRequired) {
    action.status = 'executed';

    // Joint-account emulation: every leader's approval is bundled into ONE
    // Algorand atomic group. Either all approvals commit in the same block or
    // none do, so funds can never move on a partial quorum.
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
    message =
      `Threshold reached. ${atomic.approvals} approvals committed as a single Algorand atomic group. ` +
      `Ref: ${atomic.txId.slice(0, 12)}...`;

    if (action.type === 'loan_approval' && action.linkedLoanId) {
      const loan = await LoanModel.findById(action.linkedLoanId);
      if (loan) {
        loan.approvals = action.signatures.length;
        loan.approvalsRequired = action.signaturesRequired;
        loan.status = 'approved';
        await loan.save();

        await queueBankDisbursement({
          loanId: String(loan._id),
          userId: String(loan.user),
          amount: loan.amount,
          notes: 'Leader approvals completed; sent to bank for payout',
          autoProcess: true,
        });

        message = 'Leader threshold reached. Loan forwarded to bank for payout processing.';
      }
    }
  }

  await action.save();

  res.json({
    success: true,
    data: { action: mapDocToAction(action), message },
  });
});

// POST /api/multisig/:id/reject
router.post('/:id/reject', async (req: Request, res: Response) => {
  const action = await MultiSigActionModel.findOne({ id: req.params.id });
  if (!action) {
    res.status(404).json({ success: false, error: 'Action not found' });
    return;
  }

  action.status = 'rejected';
  await action.save();
  res.json({
    success: true,
    data: { action: mapDocToAction(action), message: 'Action rejected by leader.' },
  });
});

// POST /api/multisig (create new action)
router.post('/', async (req: Request, res: Response) => {
  const { type, description, amount, requestedBy, signaturesRequired, linkedLoanId, destinationRole } = req.body;

  const created = await MultiSigActionModel.create({
    id: uuidv4(),
    type: type || 'loan_approval',
    description: description || 'New approval action',
    amount: amount || 0,
    requestedBy: requestedBy || 'AI Agent',
    signatures: [],
    signaturesRequired: signaturesRequired || 3,
    status: 'pending',
    createdAt: new Date().toISOString(),
    linkedLoanId,
    destinationRole: destinationRole || 'leader',
  });

  res.status(201).json({ success: true, data: mapDocToAction(created) });
});

export default router;
