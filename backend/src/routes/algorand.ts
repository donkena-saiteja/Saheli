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
import {
  getInrToMicroAlgo,
  getWalletBalance,
  preparePayment,
  submitPayment,
} from '../services/walletPayments';

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

// ─── Real wallet settlement ──────────────────────────────────────────────────
// The relayer path degrades to simulated ids when it is unfunded. These three
// endpoints let the user's own Pera wallet pay instead, which always produces a
// genuine TestNet transaction that resolves on the Lora explorer.

// GET /api/algorand/balance/:address — what the wallet actually holds
router.get('/balance/:address', async (req: Request, res: Response) => {
  res.json({ success: true, data: await getWalletBalance(req.params.address) });
});

// GET /api/algorand/rate — the demo rupee peg, so the UI can show both units
router.get('/rate', async (_req: Request, res: Response) => {
  const perInr = getInrToMicroAlgo();
  res.json({
    success: true,
    data: {
      microAlgosPerInr: perInr,
      algosPerInr: perInr / 1e6,
      inrPerAlgo: Math.round(1e6 / perInr),
      note: 'Demo settlement peg for TestNet peer-to-peer transfers. Configure with INR_TO_MICROALGO.',
    },
  });
});

/**
 * POST /api/algorand/payment/prepare
 * Body: { fromAddress, amountInr, purpose, toAddress? | toMemberId?, memberId?, linkedLoanId?, description? }
 *
 * Returns an unsigned transaction for Pera to sign. The server builds it so the
 * client cannot alter the receiver or the amount after the fact.
 */
router.post('/payment/prepare', async (req: Request, res: Response) => {
  const prepared = await preparePayment({
    fromAddress: String(req.body?.fromAddress || ''),
    toAddress: req.body?.toAddress ? String(req.body.toAddress) : undefined,
    toMemberId: req.body?.toMemberId ? String(req.body.toMemberId) : undefined,
    amountInr: Number(req.body?.amountInr),
    purpose: req.body?.purpose || 'deposit',
    memberId: req.body?.memberId ? String(req.body.memberId) : undefined,
    linkedLoanId: req.body?.linkedLoanId ? String(req.body.linkedLoanId) : undefined,
    description: req.body?.description ? String(req.body.description) : undefined,
  });

  res.json({
    success: true,
    data: {
      ...prepared,
      message:
        `Sign in Pera Wallet to send ${prepared.amountAlgos} ALGO ` +
        `(₹${prepared.amountInr.toLocaleString('en-IN')}) to ${prepared.to.slice(0, 8)}….`,
    },
  });
});

/**
 * POST /api/algorand/payment/submit
 * Body: { signedTxn (base64), purpose, memberId?, linkedLoanId?, description? }
 *
 * Broadcasts, waits for confirmation, then writes the ledger row. Balances only
 * move once the chain has accepted the transfer.
 */
router.post('/payment/submit', async (req: Request, res: Response) => {
  const result = await submitPayment({
    signedTxn: String(req.body?.signedTxn || ''),
    purpose: req.body?.purpose || 'deposit',
    memberId: req.body?.memberId ? String(req.body.memberId) : undefined,
    linkedLoanId: req.body?.linkedLoanId ? String(req.body.linkedLoanId) : undefined,
    description: req.body?.description ? String(req.body.description) : undefined,
  });

  res.json({ success: true, data: result });
});

export default router;
