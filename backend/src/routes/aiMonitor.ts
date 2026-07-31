/**
 * Autonomous compliance & treasury agent API.
 *
 * `/scan` is safe to call repeatedly — findings are upserted by fingerprint, so
 * the reviewer's triage state survives.
 */

import { Router, Request, Response } from 'express';
import FraudAlert from '../models/FraudAlert';
import Transaction from '../models/Transaction';
import User from '../models/User';
import { simulatedTxId } from '../services/algorand';
import {
  GOVERNMENT_SCHEMES,
  askAgent,
  getMonitorStatus,
  getTreasuryAdvisory,
  runComplianceScan,
} from '../services/aiMonitor';

const router = Router();

function mapAlert(doc: any) {
  return {
    id: String(doc._id),
    fingerprint: doc.fingerprint,
    category: doc.category,
    severity: doc.severity,
    riskScore: doc.riskScore,
    title: doc.title,
    summary: doc.summary,
    recommendedAction: doc.recommendedAction,
    regulatoryBasis: doc.regulatoryBasis,
    subjectName: doc.subjectName,
    amount: doc.amount,
    transactionIds: doc.transactionIds || [],
    status: doc.status,
    reviewedBy: doc.reviewedBy,
    reviewedAt: doc.reviewedAt,
    reviewNote: doc.reviewNote,
    source: doc.source,
    detectedAt: doc.detectedAt,
  };
}

// GET /api/ai-monitor/status
router.get('/status', async (_req: Request, res: Response) => {
  res.json({ success: true, data: await getMonitorStatus() });
});

// POST /api/ai-monitor/scan — run the full ledger sweep
router.post('/scan', async (_req: Request, res: Response) => {
  const result = await runComplianceScan();
  res.json({
    success: true,
    data: {
      ...result,
      message:
        result.signalsDetected === 0
          ? `Swept ${result.scannedTransactions} transactions across ${result.scannedMembers} members. No suspicious pattern found.`
          : `Swept ${result.scannedTransactions} transactions and raised ${result.signalsDetected} finding${
              result.signalsDetected === 1 ? '' : 's'
            }. Highest severity: ${result.highestSeverity}.`,
    },
  });
});

// GET /api/ai-monitor/alerts?status=open&severity=high
router.get('/alerts', async (req: Request, res: Response) => {
  const filter: Record<string, unknown> = {};
  const status = String(req.query.status || 'open');
  if (status !== 'all') filter.status = status;
  if (req.query.severity) filter.severity = String(req.query.severity);

  const alerts = await FraudAlert.find(filter).sort({ riskScore: -1, detectedAt: -1 }).limit(100).lean();
  res.json({ success: true, data: alerts.map(mapAlert) });
});

// POST /api/ai-monitor/alerts/:id/review — clear or escalate a finding
router.post('/alerts/:id/review', async (req: Request, res: Response) => {
  const { status, note, reviewedBy } = req.body || {};

  if (!['cleared', 'escalated', 'open'].includes(String(status))) {
    res.status(400).json({ success: false, error: 'status must be one of: cleared, escalated, open' });
    return;
  }

  const alert = await FraudAlert.findById(req.params.id).catch(() => null);
  if (!alert) {
    res.status(404).json({ success: false, error: 'Alert not found' });
    return;
  }

  alert.set({
    status,
    reviewNote: note || alert.reviewNote,
    reviewedBy: reviewedBy || 'compliance_officer',
    reviewedAt: new Date(),
  });
  await alert.save();

  res.json({
    success: true,
    data: {
      alert: mapAlert(alert.toObject()),
      message:
        status === 'cleared'
          ? 'Alert cleared. It will not reopen on the next scan.'
          : status === 'escalated'
            ? 'Alert escalated to the bank compliance desk.'
            : 'Alert reopened.',
    },
  });
});

// GET /api/ai-monitor/investments — government scheme allocation for idle funds
router.get('/investments', async (req: Request, res: Response) => {
  const override = req.query.idleFunds !== undefined ? Number(req.query.idleFunds) : undefined;
  const advisory = await getTreasuryAdvisory(
    Number.isFinite(override) && (override as number) >= 0 ? override : undefined,
  );

  res.json({
    success: true,
    data: { ...advisory, catalogue: GOVERNMENT_SCHEMES },
  });
});

// GET /api/ai-monitor/schemes — the full instrument catalogue
router.get('/schemes', async (_req: Request, res: Response) => {
  res.json({ success: true, data: GOVERNMENT_SCHEMES });
});

/**
 * POST /api/ai-monitor/simulate-threat
 *
 * Injects a live suspicious pattern and immediately re-scans, so the detection
 * can be demonstrated end-to-end rather than described. The injected rows are
 * labelled in their description and are ordinary ledger entries — the agent is
 * given no hint they are synthetic and catches them with the production rules.
 *
 * Body: { pattern?: 'structuring' | 'velocity' | 'round_trip', memberId? }
 */
router.post('/simulate-threat', async (req: Request, res: Response) => {
  const pattern = String(req.body?.pattern || 'structuring');

  const member = req.body?.memberId
    ? await User.findById(String(req.body.memberId)).catch(() => null)
    : await User.findOne({ role: 'member' }).sort({ trustScore: 1 });

  if (!member) {
    res.status(400).json({ success: false, error: 'No member available. Seed the demo data first.' });
    return;
  }

  const stamp = Date.now();
  const injected: Array<{ type: string; amount: number; at: Date }> = [];

  if (pattern === 'velocity') {
    for (let i = 0; i < 11; i += 1) {
      injected.push({ type: i % 2 ? 'withdrawal' : 'deposit', amount: 2500, at: new Date(stamp - i * 4 * 60 * 1000) });
    }
  } else if (pattern === 'round_trip') {
    injected.push({ type: 'deposit', amount: 22000, at: new Date(stamp - 6 * 3600 * 1000) });
    injected.push({ type: 'withdrawal', amount: 21500, at: new Date(stamp - 3600 * 1000) });
  } else {
    for (let i = 0; i < 4; i += 1) {
      injected.push({ type: 'deposit', amount: 9700, at: new Date(stamp - i * 6 * 3600 * 1000) });
    }
  }

  for (const [index, entry] of injected.entries()) {
    await Transaction.create({
      user: member._id,
      type: entry.type,
      amount: entry.amount,
      description: `Live threat simulation — ${pattern.replace(/_/g, ' ')} leg ${index + 1}/${injected.length}`,
      transactionId: simulatedTxId(`threat:${pattern}:${stamp}:${index}`),
      status: 'confirmed',
      agentProcessed: false,
      createdAt: entry.at,
      updatedAt: entry.at,
    });
  }

  const scan = await runComplianceScan();
  const newest = await FraudAlert.find({ subject: member._id, status: 'open' })
    .sort({ riskScore: -1 })
    .limit(5)
    .lean();

  res.json({
    success: true,
    data: {
      pattern,
      member: member.name,
      injectedTransactions: injected.length,
      injectedValue: injected.reduce((s, e) => s + e.amount, 0),
      scan,
      caught: newest.map(mapAlert),
      message: newest.length
        ? `Agent detected ${newest.length} finding${newest.length === 1 ? '' : 's'} against ${member.name} within one sweep.`
        : `Injected ${injected.length} transactions; no rule threshold was crossed.`,
    },
  });
});

// POST /api/ai-monitor/ask — natural-language question over the group's data
router.post('/ask', async (req: Request, res: Response) => {
  const question = String(req.body?.question || '').trim();
  if (!question) {
    res.status(400).json({ success: false, error: 'question is required' });
    return;
  }

  const result = await askAgent(question);
  res.json({ success: true, data: { question, ...result } });
});

export default router;
