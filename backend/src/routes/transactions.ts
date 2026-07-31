import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import {
  registerTransactionLifecycle,
  setTransactionLifecycleStatus,
} from '../services/txEngine';
import { anchorLedgerEntry, explorerTxUrl } from '../services/algorand';
import Transaction from '../models/Transaction';
import User from '../models/User';
import { recalculateIdleFunds } from '../services/agentEngine';

const router = Router();

function mapTxForLedger(tx: any) {
  const isCredit = ['deposit', 'yield', 'loan_repayment'].includes(tx.type);
  return {
    id: String(tx._id),
    event: `${tx.type}: ${tx.user?.name || 'Member'}`,
    /** Display-only, truncated for narrow ledger rows. Never use this to look a tx up. */
    txId: tx.transactionId ? `${tx.transactionId.slice(0, 12)}...` : `TX-${String(tx._id).slice(-6)}`,
    /**
     * The untruncated Algorand txid. Clients that verify a proof or open an
     * explorer link must use this — the truncated `txId` above resolves to
     * nothing on chain or in the ledger.
     */
    transactionId: tx.transactionId || null,
    explorerUrl: tx.transactionId ? explorerTxUrl(tx.transactionId) : null,
    status: tx.status,
    txType: tx.type,
    amount: isCredit ? tx.amount : -Math.abs(tx.amount),
    type: isCredit ? 'credit' : 'debit',
    memberName: tx.user?.name || 'Member',
    timestamp: tx.createdAt,
  };
}

/** Clamps a caller-supplied limit into a sane range. */
function resolveLimit(raw: unknown, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), 500);
}

// GET /api/transactions?limit=15&memberId=...
router.get('/', async (req: Request, res: Response) => {
  const filter: Record<string, unknown> = { status: { $ne: 'failed' } };

  const memberId = req.query.memberId ? String(req.query.memberId) : '';
  if (memberId) {
    if (!mongoose.Types.ObjectId.isValid(memberId)) {
      res.status(400).json({ success: false, error: 'memberId must be a valid Mongo ObjectId' });
      return;
    }
    filter.user = new mongoose.Types.ObjectId(memberId);
  }

  const txs = await Transaction.find(filter)
    .populate('user', 'name')
    .sort({ createdAt: -1 })
    .limit(resolveLimit(req.query.limit, 15))
    .lean();

  res.json({ success: true, data: txs.map(mapTxForLedger) });
});

// POST /api/transactions (create deposit/withdrawal/yield)
router.post('/', async (req: Request, res: Response) => {
  const { memberId, type, amount, description } = req.body;

  if (!memberId || !type || !amount) {
    res.status(400).json({ success: false, error: 'memberId, type, amount required' });
    return;
  }

  if (!mongoose.Types.ObjectId.isValid(memberId)) {
    res.status(400).json({ success: false, error: 'memberId must be a valid Mongo ObjectId' });
    return;
  }

  const user = await User.findById(memberId);
  if (!user || user.role !== 'member') {
    res.status(404).json({ success: false, error: 'Member not found' });
    return;
  }

  // Anchor the movement on Algorand first; its txid becomes our reference.
  const anchor = await anchorLedgerEntry({
    kind: type,
    memberId: String(user._id),
    shgId: user.shgId || undefined,
    amount,
    detail: description || `${type} via API`,
  });
  const transactionId = anchor.txId;

  registerTransactionLifecycle({
    transactionId,
    type,
    amount,
    initialStatus: anchor.mode === 'live' ? 'confirmed' : 'pending',
    autoConfirm: anchor.mode !== 'live',
  });

  const created = await Transaction.create({
    user: user._id,
    type,
    amount,
    description: description || `${type} via WhatsApp`,
    transactionId,
    status: anchor.mode === 'live' ? 'confirmed' : 'pending',
    agentProcessed: true,
  });

  if (anchor.mode !== 'live') {
    setTimeout(async () => {
      await Transaction.updateOne({ transactionId }, { $set: { status: 'confirmed' } });
      setTransactionLifecycleStatus(transactionId, 'confirmed');
    }, 2500 + Math.floor(Math.random() * 2500));
  }

  if (type === 'deposit') user.totalSavings += amount;
  if (type === 'withdrawal') user.totalSavings = Math.max(0, user.totalSavings - amount);
  if (type === 'yield') user.yieldEarned = (user.yieldEarned || 0) + amount;
  await user.save();

  await recalculateIdleFunds();

  res.status(201).json({
    success: true,
    data: {
      transaction: {
        id: String(created._id),
        type: created.type,
        amount: created.amount,
        description: created.description,
        timestamp: created.createdAt,
        transactionId,
        status: created.status,
        agentProcessed: created.agentProcessed,
        memberName: user.name,
      },
      transactionId,
      explorerUrl: anchor.explorerUrl,
      chainMode: anchor.mode,
      message:
        anchor.mode === 'live'
          ? '✅ Settled on Algorand.'
          : '⏳ Transaction submitted. Confirmation pending.',
    },
  });
});

// GET /api/transactions/ledger?limit=100 (raw ledger stream)
router.get('/ledger', async (req: Request, res: Response) => {
  const ledger = await Transaction.find({ status: { $ne: 'failed' } })
    .populate('user', 'name')
    .sort({ createdAt: -1 })
    .limit(resolveLimit(req.query.limit, 100))
    .lean();

  res.json({ success: true, data: ledger.map(mapTxForLedger) });
});

export default router;
