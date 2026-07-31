/**
 * Downloadable reports.
 *
 * Every endpoint serves the same dataset in either .xlsx (default) or .csv, so
 * a bank officer can open it in Excel and an auditor can pipe it into a script.
 */

import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import Transaction from '../models/Transaction';
import User from '../models/User';
import LoanModel from '../models/Loan';
import FraudAlert from '../models/FraudAlert';
import BankDisbursement from '../models/BankDisbursement';
import { buildCsv, buildWorkbook, SheetSpec } from '../services/xlsx';
import { explorerTxUrl, getChainHealth } from '../services/algorand';

const router = Router();

function filenameStamp(): string {
  return new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
}

function send(res: Response, sheets: SheetSpec[], basename: string, format: string) {
  if (format === 'csv') {
    const csv = buildCsv(sheets[0]);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${basename}-${filenameStamp()}.csv"`);
    // Excel needs the BOM to read ₹ and Devanagari names correctly.
    res.send(`﻿${csv}`);
    return;
  }

  const workbook = buildWorkbook(sheets);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${basename}-${filenameStamp()}.xlsx"`);
  res.setHeader('Content-Length', String(workbook.length));
  res.end(workbook);
}

/**
 * Registers `/<name>.xlsx` and `/<name>.csv` for one report.
 *
 * Written as two literal routes rather than a `:ext(xlsx|csv)` param because
 * path-to-regexp's handling of a dot-prefixed parameter differs between Express
 * majors, and a broken download URL is not worth the brevity.
 */
function registerReport(name: string, basename: string, build: (req: Request) => Promise<SheetSpec[]>) {
  const handler = (format: 'xlsx' | 'csv') => async (req: Request, res: Response) => {
    const sheets = await build(req);
    if (!sheets) return;
    send(res, sheets, basename, String(req.query.format || format).toLowerCase() === 'csv' ? 'csv' : 'xlsx');
  };

  router.get(`/${name}.xlsx`, handler('xlsx'));
  router.get(`/${name}.csv`, handler('csv'));
}

const TX_COLUMNS: SheetSpec['columns'] = [
  { header: 'Date', width: 20, format: 'datetime' },
  { header: 'Member', width: 22 },
  { header: 'Phone', width: 18 },
  { header: 'SHG', width: 12 },
  { header: 'Type', width: 20 },
  { header: 'Direction', width: 12 },
  { header: 'Amount (INR)', width: 16, format: 'currency' },
  { header: 'Status', width: 14 },
  { header: 'Description', width: 40 },
  { header: 'Algorand Transaction ID', width: 56 },
  { header: 'Explorer URL', width: 64 },
  { header: 'Processed By', width: 16 },
];

const CREDIT_TYPES = ['deposit', 'yield', 'loan_repayment'];

async function buildTransactionSheet(filter: Record<string, unknown>, limit: number): Promise<SheetSpec> {
  const txs = await Transaction.find(filter)
    .populate('user', 'name phone shgId')
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  return {
    name: 'Transactions',
    columns: TX_COLUMNS,
    rows: (txs as Array<Record<string, any>>).map((tx) => [
      tx.createdAt ? new Date(tx.createdAt) : null,
      tx.user?.name || 'Unknown',
      tx.user?.phone || '',
      tx.user?.shgId || '',
      String(tx.type || '').replace(/_/g, ' '),
      CREDIT_TYPES.includes(tx.type) ? 'Credit' : 'Debit',
      CREDIT_TYPES.includes(tx.type) ? Number(tx.amount) : -Math.abs(Number(tx.amount)),
      tx.status,
      tx.description,
      tx.transactionId || '',
      tx.transactionId ? explorerTxUrl(tx.transactionId) : '',
      tx.agentProcessed ? 'AI Agent' : 'Manual',
    ]),
  };
}

async function buildSummarySheet(): Promise<SheetSpec> {
  const [totals, memberCount, loanCount, health] = await Promise.all([
    Transaction.aggregate([
      { $match: { status: { $ne: 'failed' } } },
      {
        $group: {
          _id: null,
          inflow: { $sum: { $cond: [{ $in: ['$type', CREDIT_TYPES] }, '$amount', 0] } },
          outflow: {
            $sum: { $cond: [{ $in: ['$type', ['withdrawal', 'loan_disbursement']] }, '$amount', 0] },
          },
          count: { $sum: 1 },
        },
      },
    ]),
    User.countDocuments({ role: 'member' }),
    LoanModel.countDocuments({}),
    getChainHealth(),
  ]);

  const inflow = totals[0]?.inflow || 0;
  const outflow = totals[0]?.outflow || 0;

  return {
    name: 'Summary',
    columns: [
      { header: 'Metric', width: 34 },
      { header: 'Value', width: 30 },
    ],
    rows: [
      ['Report generated', new Date().toISOString()],
      ['Members', memberCount],
      ['Transactions recorded', totals[0]?.count || 0],
      ['Total inflow (INR)', inflow],
      ['Total outflow (INR)', outflow],
      ['Net treasury position (INR)', inflow - outflow],
      ['Loans on file', loanCount],
      ['Algorand network', process.env.ALGORAND_NETWORK || 'testnet'],
      ['Settlement mode', health.mode],
      ['Chain round at export', health.round || 'unavailable'],
    ],
  };
}

async function buildMemberSheet(): Promise<SheetSpec> {
  const members = await User.find({ role: 'member' })
    .select('name phone shgId trustScore totalSavings activeLoans activeLoansAmount yieldEarned repaymentRate algorandAddress walletAddress')
    .sort({ trustScore: -1 })
    .lean();

  return {
    name: 'Members',
    columns: [
      { header: 'Member', width: 24 },
      { header: 'Phone', width: 18 },
      { header: 'SHG', width: 12 },
      { header: 'Trust Score', width: 14, format: 'number' },
      { header: 'Savings (INR)', width: 16, format: 'currency' },
      { header: 'Active Loans', width: 14, format: 'number' },
      { header: 'Outstanding (INR)', width: 18, format: 'currency' },
      { header: 'Yield Earned (INR)', width: 18, format: 'currency' },
      { header: 'Repayment Rate %', width: 18, format: 'number' },
      { header: 'Custodial Address', width: 60 },
      { header: 'Pera Wallet', width: 60 },
    ],
    rows: (members as Array<Record<string, any>>).map((m) => [
      m.name,
      m.phone || '',
      m.shgId || '',
      m.trustScore ?? 0,
      m.totalSavings ?? 0,
      m.activeLoans ?? 0,
      m.activeLoansAmount ?? 0,
      m.yieldEarned ?? 0,
      m.repaymentRate ?? 100,
      m.algorandAddress || '',
      m.walletAddress || '',
    ]),
  };
}

async function buildLoanSheet(): Promise<SheetSpec> {
  const loans = await LoanModel.find({}).populate('user', 'name phone').sort({ createdAt: -1 }).lean();

  return {
    name: 'Loans',
    columns: [
      { header: 'Requested', width: 20, format: 'datetime' },
      { header: 'Member', width: 24 },
      { header: 'Amount (INR)', width: 16, format: 'currency' },
      { header: 'Purpose', width: 30 },
      { header: 'Status', width: 16 },
      { header: 'Approvals', width: 12 },
      { header: 'Required', width: 12 },
      { header: 'AI Recommendation', width: 20 },
      { header: 'Trust Score', width: 14, format: 'number' },
      { header: 'Repaid (INR)', width: 16, format: 'currency' },
      { header: 'Due Date', width: 16, format: 'date' },
      { header: 'Transaction ID', width: 56 },
    ],
    rows: (loans as Array<Record<string, any>>).map((l) => [
      l.createdAt ? new Date(l.createdAt) : null,
      l.user?.name || 'Unknown',
      l.amount,
      l.purpose,
      l.status,
      l.approvals ?? 0,
      l.approvalsRequired ?? 1,
      l.aiRecommendation || '',
      l.trustScoreAtApplication ?? 0,
      l.repaidAmount ?? 0,
      l.dueDate ? new Date(l.dueDate) : null,
      l.transactionId || '',
    ]),
  };
}

async function buildAlertSheet(): Promise<SheetSpec> {
  const alerts = await FraudAlert.find({}).sort({ riskScore: -1 }).lean();

  return {
    name: 'Compliance Alerts',
    columns: [
      { header: 'Detected', width: 20, format: 'datetime' },
      { header: 'Severity', width: 12 },
      { header: 'Risk Score', width: 12, format: 'number' },
      { header: 'Category', width: 22 },
      { header: 'Member', width: 24 },
      { header: 'Amount (INR)', width: 16, format: 'currency' },
      { header: 'Finding', width: 40 },
      { header: 'Summary', width: 70 },
      { header: 'Recommended Action', width: 46 },
      { header: 'Regulatory Basis', width: 60 },
      { header: 'Status', width: 14 },
      { header: 'Detected By', width: 14 },
    ],
    rows: (alerts as Array<Record<string, any>>).map((a) => [
      a.detectedAt ? new Date(a.detectedAt) : null,
      a.severity,
      a.riskScore,
      String(a.category || '').replace(/_/g, ' '),
      a.subjectName || 'Group level',
      a.amount ?? 0,
      a.title,
      a.summary,
      a.recommendedAction,
      a.regulatoryBasis || '',
      a.status,
      a.source === 'openai' ? 'AI agent' : 'Rule engine',
    ]),
  };
}

async function buildDisbursementSheet(): Promise<SheetSpec> {
  const queue = await BankDisbursement.find({})
    .populate('user', 'name phone')
    .sort({ createdAt: -1 })
    .lean();

  return {
    name: 'Bank Disbursements',
    columns: [
      { header: 'Queued', width: 20, format: 'datetime' },
      { header: 'Member', width: 24 },
      { header: 'Amount (INR)', width: 16, format: 'currency' },
      { header: 'Status', width: 14 },
      { header: 'Bank Reference', width: 20 },
      { header: 'Processed By', width: 20 },
      { header: 'Processed At', width: 20, format: 'datetime' },
      { header: 'Transaction ID', width: 56 },
      { header: 'Notes', width: 40 },
    ],
    rows: (queue as Array<Record<string, any>>).map((d) => [
      d.queuedAt ? new Date(d.queuedAt) : d.createdAt ? new Date(d.createdAt) : null,
      d.user?.name || 'Unknown',
      d.amount,
      d.status,
      d.bankReference || '',
      d.processedBy || '',
      d.processedAt ? new Date(d.processedAt) : null,
      d.transactionId || '',
      d.notes || '',
    ]),
  };
}

/**
 * GET /api/reports/transactions.xlsx | .csv
 * Optional: ?memberId=<id>&limit=500&status=confirmed&type=deposit
 */
registerReport('transactions', 'saheli-transactions', async (req) => {
  const filter: Record<string, unknown> = {};

  if (req.query.memberId) {
    const memberId = String(req.query.memberId);
    if (!mongoose.Types.ObjectId.isValid(memberId)) {
      throw Object.assign(new Error('memberId must be a valid Mongo ObjectId'), { name: 'CastError' });
    }
    filter.user = new mongoose.Types.ObjectId(memberId);
  }

  if (req.query.status) filter.status = String(req.query.status);
  if (req.query.type) filter.type = String(req.query.type);

  const limit = Math.min(Math.max(Number(req.query.limit) || 5000, 1), 20000);
  return [await buildTransactionSheet(filter, limit), await buildSummarySheet()];
});

/**
 * GET /api/reports/full-ledger.xlsx — the complete institutional pack:
 * summary, transactions, members, loans, disbursements and compliance alerts.
 */
registerReport('full-ledger', 'saheli-full-ledger', async () =>
  Promise.all([
    buildSummarySheet(),
    buildTransactionSheet({}, 20000),
    buildMemberSheet(),
    buildLoanSheet(),
    buildDisbursementSheet(),
    buildAlertSheet(),
  ]),
);

registerReport('members', 'saheli-members', async () => [await buildMemberSheet()]);
registerReport('loans', 'saheli-loans', async () => [await buildLoanSheet()]);
registerReport('compliance', 'saheli-compliance', async () => [await buildAlertSheet()]);

/** GET /api/reports/catalogue — what a client can download, for building menus. */
router.get('/catalogue', async (_req: Request, res: Response) => {
  res.json({
    success: true,
    data: [
      {
        id: 'transactions',
        label: 'Transaction History',
        description: 'Every movement with member, amount, status and Algorand explorer link.',
        xlsx: '/api/reports/transactions.xlsx',
        csv: '/api/reports/transactions.csv',
        sheets: ['Transactions', 'Summary'],
      },
      {
        id: 'full-ledger',
        label: 'Full Institutional Pack',
        description: 'Six-sheet workbook: summary, transactions, members, loans, disbursements, compliance alerts.',
        xlsx: '/api/reports/full-ledger.xlsx',
        csv: '/api/reports/full-ledger.csv',
        sheets: ['Summary', 'Transactions', 'Members', 'Loans', 'Bank Disbursements', 'Compliance Alerts'],
      },
      {
        id: 'members',
        label: 'Member Register',
        description: 'Trust scores, savings, exposure and wallet addresses.',
        xlsx: '/api/reports/members.xlsx',
        csv: '/api/reports/members.csv',
        sheets: ['Members'],
      },
      {
        id: 'loans',
        label: 'Loan Book',
        description: 'Every loan with approval state, AI recommendation and repayment progress.',
        xlsx: '/api/reports/loans.xlsx',
        csv: '/api/reports/loans.csv',
        sheets: ['Loans'],
      },
      {
        id: 'compliance',
        label: 'Compliance Alerts',
        description: 'AI agent fraud findings with severity, regulatory basis and triage state.',
        xlsx: '/api/reports/compliance.xlsx',
        csv: '/api/reports/compliance.csv',
        sheets: ['Compliance Alerts'],
      },
    ],
  });
});

export default router;
