/**
 * Algorand chain transparency endpoints.
 *
 * These exist so nobody has to take our word for anything: the dashboards, the
 * QR scanner, and any judge with curl can read the live chain state, the
 * relayer balance, and verify individual transactions.
 */

import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import {
  deriveAccount,
  explorerAccountUrl,
  explorerTxUrl,
  getChainInfo,
  getChainHealth,
  verifyOnChain,
} from '../services/algorand';
import User from '../models/User';

const router = Router();

// GET /api/algorand/info — network, mode, relayer, treasury, explorer links
router.get('/info', async (_req: Request, res: Response) => {
  res.json({ success: true, data: await getChainInfo() });
});

// GET /api/algorand/health — cheap liveness probe, forces a re-check
router.get('/health', async (_req: Request, res: Response) => {
  const health = await getChainHealth(true);
  res.json({
    success: true,
    data: {
      mode: health.mode,
      reason: health.reason,
      lastRound: health.round,
      relayerBalanceMicroAlgos: health.relayerBalance,
      checkedAt: new Date(health.checkedAt).toISOString(),
    },
  });
});

// GET /api/algorand/tx/:txId — on-chain verification of a single transaction
router.get('/tx/:txId', async (req: Request, res: Response) => {
  const verification = await verifyOnChain(req.params.txId);
  res.json({ success: true, data: verification });
});

// GET /api/algorand/wallet/:memberId — the member's derived (gasless) wallet
router.get('/wallet/:memberId', async (req: Request, res: Response) => {
  const { memberId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(memberId)) {
    res.status(400).json({ success: false, error: 'memberId must be a valid id' });
    return;
  }

  const user = await User.findById(memberId).select('name role shgId').lean();
  if (!user) {
    res.status(404).json({ success: false, error: 'Member not found' });
    return;
  }

  const account = deriveAccount(`member:${memberId}`);

  res.json({
    success: true,
    data: {
      memberId,
      name: (user as any).name,
      shgId: (user as any).shgId,
      address: account.address,
      explorerUrl: explorerAccountUrl(account.address),
      custody: 'platform-derived',
      gasless: true,
      note: 'The member never handles keys or ALGO. The relayer pays every fee via Algorand fee pooling.',
    },
  });
});

export default router;
