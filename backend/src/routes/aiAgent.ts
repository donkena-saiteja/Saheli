import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import mongoose from 'mongoose';
import User from '../models/User';
import Transaction from '../models/Transaction';
import LoanModel from '../models/Loan';
import MultiSigActionModel from '../models/MultiSigAction';
import { registerTransactionLifecycle, setTransactionLifecycleStatus } from '../services/txEngine';
import { anchorLedgerEntry } from '../services/algorand';
import { processEmergencyLoan, getAgentStatus } from '../services/agentEngine';

const router = Router();

type AILogEntry = {
  id: string;
  type: 'yield_deploy' | 'loan_auto_approve' | 'yield_alert' | 'sync' | 'rebalance' | 'notification';
  icon: string;
  title: string;
  highlight: string;
  timestamp: string;
  amount?: number;
};

async function generateOpenAIWhatsAppReply(args: {
  message: string;
  memberName: string;
}): Promise<string | null> {
  const openAiKey = process.env.OPENAI_API_KEY;
  if (!openAiKey) {
    return null;
  }

  const model = process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini';

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openAiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0.4,
        messages: [
          {
            role: 'system',
            content: [
              'You are Saheli AI, a WhatsApp assistant for Women SHG finance users in India.',
              'Keep replies practical, polite, and short (max 120 words).',
              'If user asks about deposits/withdrawals/loans/balance/QR, guide them with exact next action phrase.',
              'Never invent transaction IDs or balances.',
            ].join(' '),
          },
          {
            role: 'user',
            content: `Member: ${args.memberName}\nMessage: ${args.message}`,
          },
        ],
      }),
    });

    if (!response.ok) {
      return null;
    }

    const json = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const content = json.choices?.[0]?.message?.content?.trim();
    return content || null;
  } catch {
    return null;
  }
}

// Intents the AI agent can parse from WhatsApp messages
function parseIntent(message: string): {
  intent: 'deposit' | 'withdraw' | 'loan' | 'balance' | 'qr' | 'unknown';
  amount?: number;
  purpose?: string;
} {
  const lower = message.toLowerCase();

  const amountMatch =
    lower.match(/(\d[\d,]*)\s*(rupees?|rs\.?|₹)/i) ||
    lower.match(/(₹)\s*(\d[\d,]*)/i) ||
    lower.match(/(\d[\d,]+)/);
  const amount = amountMatch ? parseInt(amountMatch[0].replace(/[^\d]/g, ''), 10) : undefined;

  if (/deposit|save|jama|jamaa|डिपॉजिट|save money/i.test(lower)) {
    return { intent: 'deposit', amount };
  }
  if (/withdraw|nikalo|निकाल|take out|cash out/i.test(lower)) {
    return { intent: 'withdraw', amount };
  }
  if (/loan|borrow|urgent|emergency|need money|medical|hospital|दवाई|उधार|accident|health/i.test(lower)) {
    const purposeMatch = lower.match(/for\s+(.+?)(?:\s*\.|$)/i);
    const isEmergency = /urgent|emergency|medical|hospital|accident|health/i.test(lower);
    return {
      intent: 'loan',
      amount,
      purpose: purposeMatch ? purposeMatch[1] : isEmergency ? 'emergency medical' : 'general purpose',
    };
  }
  if (/balance|kitna|कितना|how much|savings/i.test(lower)) {
    return { intent: 'balance' };
  }
  if (/qr|certificate|proof|verify/i.test(lower)) {
    return { intent: 'qr' };
  }

  return { intent: 'unknown' };
}

async function resolveMember(memberId?: string, memberName?: string) {
  if (memberId && mongoose.Types.ObjectId.isValid(memberId)) {
    const byId = await User.findById(memberId).select('name trustScore totalSavings activeLoans activeLoansAmount yieldEarned role');
    if (byId && byId.role === 'member') return byId;
  }

  if (memberName) {
    const byName = await User.findOne({ name: memberName, role: 'member' }).select('name trustScore totalSavings activeLoans activeLoansAmount yieldEarned role');
    if (byName) return byName;
  }

  return User.findOne({ role: 'member' }).sort({ createdAt: 1 }).select('name trustScore totalSavings activeLoans activeLoansAmount yieldEarned role');
}

async function saveMemberTransaction(params: {
  userId: string;
  type: 'deposit' | 'withdrawal' | 'loan_disbursement' | 'loan_repayment' | 'yield';
  amount: number;
  description: string;
  agentProcessed?: boolean;
  transactionId?: string;
}): Promise<string> {
  const anchor = params.transactionId
    ? null
    : await anchorLedgerEntry({
        kind: params.type,
        memberId: params.userId,
        amount: params.amount,
        detail: params.description,
      });
  const transactionId = params.transactionId || anchor!.txId;
  registerTransactionLifecycle({
    transactionId,
    type: params.type,
    amount: params.amount,
    initialStatus: anchor?.mode === 'live' ? 'confirmed' : 'pending',
    autoConfirm: anchor?.mode !== 'live',
  });

  await Transaction.create({
    user: params.userId,
    type: params.type,
    amount: params.amount,
    description: params.description,
    transactionId,
    status: 'pending',
    agentProcessed: params.agentProcessed ?? true,
  });

  setTimeout(async () => {
    await Transaction.updateOne({ transactionId }, { $set: { status: 'confirmed' } });
    setTransactionLifecycleStatus(transactionId, 'confirmed');
  }, 2500 + Math.floor(Math.random() * 2500));

  return transactionId;
}

async function buildAgentResponse(
  intent: ReturnType<typeof parseIntent>,
  memberName = 'SHG Member',
  memberId?: string,
): Promise<{
  reply: string;
  action?: string;
  transactionId?: string;
  amount?: number;
  showQR?: boolean;
}> {
  const member = await resolveMember(memberId, memberName);
  const effectiveName = member?.name || memberName;

  switch (intent.intent) {
    case 'deposit': {
      const amt = intent.amount || 500;
      let transactionId: string | undefined;

      if (member) {
        transactionId = await saveMemberTransaction({
          userId: String(member._id),
          type: 'deposit',
          amount: amt,
          description: 'Deposit via AI chat',
        });

        member.totalSavings = (member.totalSavings || 0) + amt;
        await member.save();
      }

      const nextBalance = (member?.totalSavings || 0).toLocaleString('en-IN');
      return {
        reply: `Done. Your deposit of ₹${amt.toLocaleString('en-IN')} has been recorded.\n\nNew balance: ₹${nextBalance}\n\nRef ID: ${transactionId || 'processing'}\n\nUse the generated QR as proof if needed.`,
        action: 'deposit_confirmed',
        transactionId,
        amount: amt,
        showQR: true,
      };
    }
    case 'withdraw': {
      const amt = intent.amount || 500;
      let transactionId: string | undefined;

      if (member) {
        transactionId = await saveMemberTransaction({
          userId: String(member._id),
          type: 'withdrawal',
          amount: amt,
          description: 'Withdrawal via AI chat',
        });

        member.totalSavings = Math.max(0, (member.totalSavings || 0) - amt);
        await member.save();
      }

      return {
        reply: `Withdrawal of ₹${amt.toLocaleString('en-IN')} initiated.\n\nPlease visit your nearest BC agent with this receipt.\n\nRef ID: ${transactionId || 'processing'}`,
        action: 'withdraw_initiated',
        transactionId,
        amount: amt,
        showQR: true,
      };
    }
    case 'loan': {
      const amt = intent.amount || 5000;
      const trustScore = member?.trustScore || 750;
      const effectiveMemberId = member ? String(member._id) : memberId || '';

      const agentResult = await processEmergencyLoan({
        memberId: effectiveMemberId,
        memberName: effectiveName,
        trustScore,
        amount: amt,
        purpose: intent.purpose || 'general purpose',
      });

      if (member) {
        if (agentResult.autoApproved && agentResult.transactionId) {
          await LoanModel.create({
            user: member._id,
            amount: amt,
            purpose: intent.purpose || 'general purpose',
            status: 'repaying',
            trustScoreAtApplication: trustScore,
            aiRecommendation: 'approve',
            aiReason: agentResult.reason,
            approvals: 1,
            approvalsRequired: 1,
            disbursedAt: new Date(),
            dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            repaidAmount: 0,
            transactionId: agentResult.transactionId,
          });

          member.activeLoans = (member.activeLoans || 0) + 1;
          member.activeLoansAmount = (member.activeLoansAmount || 0) + amt;
          await member.save();

          await saveMemberTransaction({
            userId: String(member._id),
            type: 'loan_disbursement',
            amount: amt,
            description: `Emergency loan disbursed for ${intent.purpose || 'general purpose'}`,
            transactionId: agentResult.transactionId,
          });
        } else {
          const loan = await LoanModel.create({
            user: member._id,
            amount: amt,
            purpose: intent.purpose || 'general purpose',
            status: 'pending',
            trustScoreAtApplication: trustScore,
            aiRecommendation: trustScore >= 700 ? 'approve' : 'review',
            aiReason: agentResult.reason,
            approvals: 0,
            approvalsRequired: agentResult.threshold,
            repaidAmount: 0,
          });

          await MultiSigActionModel.create({
            id: uuidv4(),
            type: 'loan_approval',
            description: `Loan approval for ${effectiveName}`,
            amount: amt,
            requestedBy: effectiveName,
            signatures: [],
            signaturesRequired: agentResult.threshold,
            status: 'pending',
            linkedLoanId: String(loan._id),
            destinationRole: 'leader',
            createdAt: new Date().toISOString(),
          });
        }
      }

      if (agentResult.autoApproved) {
        const installment = agentResult.autoRepayment?.installmentAmount || Math.ceil(amt / 6);
        return {
          reply: `Emergency loan disbursed.\n\nTrust Score: ${trustScore}/1000\nApproval threshold: 1-of-3 (emergency override)\nAmount: ₹${amt.toLocaleString('en-IN')}\nPurpose: ${intent.purpose}\n\nFunds sent instantly.\nRef: ${agentResult.transactionId || 'processing'}\n\nAuto-repayment scheduled: ₹${installment.toLocaleString('en-IN')} x 6 installments.`,
          action: 'emergency_loan_disbursed',
          transactionId: agentResult.transactionId,
          amount: amt,
          showQR: true,
        };
      }

      return {
        reply: `Loan request received.\n\nAmount: ₹${amt.toLocaleString('en-IN')}\nPurpose: ${intent.purpose || 'General use'}\n\nTrust score evaluated: ${trustScore}/1000\nRouting to ${agentResult.threshold}-of-3 leader approval.\n\nYou will get an update after review.`,
        action: 'loan_pending_approval',
        amount: amt,
      };
    }
    case 'balance': {
      if (!member) {
        return {
          reply: 'Account not found. Please log in from the app and try again.',
        };
      }

      return {
        reply: `${effectiveName}'s account\n\nSavings: ₹${(member.totalSavings || 0).toLocaleString('en-IN')}\nActive Loans: ₹${(member.activeLoansAmount || 0).toLocaleString('en-IN')}\nYield Earned: ₹${(member.yieldEarned || 0).toLocaleString('en-IN')}\nTrust Score: ${member.trustScore || 0}/1000`,
      };
    }
    case 'qr': {
      const qrAnchor = await anchorLedgerEntry({
        kind: 'deposit',
        memberId: member ? String(member._id) : undefined,
        detail: 'QR proof certificate requested',
      });
      const transactionId = qrAnchor.txId;
      return {
        reply: 'Generating your QR proof certificate. You can share it with a bank officer for verification.',
        action: 'qr_generated',
        transactionId,
        showQR: true,
      };
    }
    default:
      return {
        reply:
          'Namaste! I am your Saheli AI Agent.\n\nYou can say:\n- Deposit 500 rupees\n- I need a loan for ₹5000\n- My balance\n- Generate QR proof',
      };
  }
}

// GET /api/ai-agent/log
router.get('/log', async (_req: Request, res: Response) => {
  const [recentTx, recentLoans] = await Promise.all([
    Transaction.find({ status: { $ne: 'failed' } }).sort({ createdAt: -1 }).limit(6).populate('user', 'name').lean(),
    LoanModel.find().sort({ createdAt: -1 }).limit(4).populate('user', 'name').lean(),
  ]);

  const txLog: AILogEntry[] = recentTx.map((tx: any) => ({
    id: String(tx._id),
    type: 'sync',
    icon: 'CheckCircle2',
    title: `${tx.type} by ${tx.user?.name || 'Member'}`,
    highlight: tx.status,
    timestamp: tx.createdAt,
    amount: tx.amount,
  }));

  const loanLog: AILogEntry[] = recentLoans.map((loan: any) => ({
    id: String(loan._id),
    type: loan.status === 'repaying' ? 'loan_auto_approve' : 'notification',
    icon: loan.status === 'repaying' ? 'Zap' : 'Clock',
    title: `Loan ${loan.status} for ${loan.user?.name || 'Member'}`,
    highlight: loan.aiRecommendation || 'review',
    timestamp: loan.createdAt,
    amount: loan.amount,
  }));

  const combined = [...txLog, ...loanLog]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 10);

  res.json({ success: true, data: combined });
});

// GET /api/ai-agent/suggestions
router.get('/suggestions', async (req: Request, res: Response) => {
  const { memberId } = req.query;

  const defaultSuggestions = [
    { label: 'Deposit savings', text: 'Deposit 500 rupees' },
    { label: 'Request loan', text: 'I need a loan for ₹5000' },
    { label: 'My balance', text: 'My balance' },
    { label: 'Generate QR proof', text: 'Generate QR proof' },
  ];

  if (!memberId || typeof memberId !== 'string' || !mongoose.Types.ObjectId.isValid(memberId)) {
    res.json({ success: true, data: defaultSuggestions });
    return;
  }

  const [user, latestTx] = await Promise.all([
    User.findById(memberId).select('totalSavings activeLoans trustScore').lean(),
    Transaction.findOne({ user: memberId }).sort({ createdAt: -1 }).lean(),
  ]);

  if (!user) {
    res.json({ success: true, data: defaultSuggestions });
    return;
  }

  const suggestions = [] as Array<{ label: string; text: string }>;

  if ((user.activeLoans || 0) > 0) {
    suggestions.push({ label: 'Loan status', text: 'Check my loan status' });
  }

  if ((user.totalSavings || 0) < 1000) {
    suggestions.push({ label: 'Add weekly savings', text: 'Deposit 500 rupees' });
  }

  const lastTxAgeDays = latestTx?.createdAt
    ? Math.floor((Date.now() - new Date(latestTx.createdAt).getTime()) / (24 * 60 * 60 * 1000))
    : 999;
  if (lastTxAgeDays > 30) {
    suggestions.push({ label: 'Sync new deposit', text: 'Deposit 1000 rupees' });
  }

  if ((user.trustScore || 0) >= 800) {
    suggestions.push({ label: 'Emergency ₹8000 hospital', text: 'Emergency 8000 rupees for hospital' });
  }

  suggestions.push({ label: 'My balance', text: 'My balance' });
  suggestions.push({ label: 'Generate QR proof', text: 'Generate QR proof' });

  res.json({ success: true, data: suggestions.slice(0, 5) });
});

// GET /api/ai-agent/insights
router.get('/insights', async (_req: Request, res: Response) => {
  const [membersCount, txTotals] = await Promise.all([
    User.countDocuments({ role: 'member' }),
    Transaction.aggregate([
      { $match: { status: { $ne: 'failed' } } },
      {
        $group: {
          _id: null,
          inflow: {
            $sum: {
              $cond: [{ $in: ['$type', ['deposit', 'yield', 'loan_repayment']] }, '$amount', 0],
            },
          },
          outflow: {
            $sum: {
              $cond: [{ $in: ['$type', ['withdrawal', 'loan_disbursement']] }, '$amount', 0],
            },
          },
        },
      },
    ]),
  ]);

  const inflow = txTotals[0]?.inflow || 0;
  const outflow = txTotals[0]?.outflow || 0;
  const status = getAgentStatus();

  const treasuryStats = {
    totalLiquidity: Math.max(0, inflow - outflow),
    idleFunds: status.idleFunds,
    totalYieldHarvested: status.totalYieldHarvested,
    activeMembers: membersCount,
  };

  res.json({
    success: true,
    data: {
      treasuryStats,
      insights: [
        {
          type: 'yield_opportunity',
          title: 'Idle Fund Opportunity',
          body: `₹${status.idleFunds.toLocaleString('en-IN')} currently idle. Recommend deployment to active yield pools.`,
          action: 'deploy_funds',
          priority: 'high',
        },
        {
          type: 'repayment_reminder',
          title: 'Upcoming Repayments',
          body: `${status.autoRepayments.filter((r) => r.status === 'active').length} active repayment schedules are currently tracked.`,
          action: 'send_reminders',
          priority: 'medium',
        },
        {
          type: 'score_update',
          title: 'Trust and liquidity sync',
          body: `Treasury net liquidity now at ₹${Math.max(0, inflow - outflow).toLocaleString('en-IN')}.`,
          priority: 'low',
        },
      ],
    },
  });
});

// POST /api/ai-agent/chat
router.post('/chat', async (req: Request, res: Response) => {
  const { message, memberId, memberName = 'SHG Member' } = req.body;

  if (!message) {
    res.status(400).json({ success: false, error: 'message is required' });
    return;
  }

  const intent = parseIntent(message);
  const response = await buildAgentResponse(intent, memberName, memberId);

  // For free-form WhatsApp queries, try a real LLM response and keep deterministic fallback.
  if (intent.intent === 'unknown') {
    const llmReply = await generateOpenAIWhatsAppReply({
      message,
      memberName,
    });
    if (llmReply) {
      response.reply = llmReply;
    }
  }

  // Log the interaction
  console.log(`[AI Agent] Member: ${memberName} | Intent: ${intent.intent} | Message: "${message}"`);

  res.json({
    success: true,
    data: {
      memberId,
      originalMessage: message,
      detectedIntent: intent.intent,
      detectedAmount: intent.amount,
      aiProvider: intent.intent === 'unknown' && process.env.OPENAI_API_KEY ? 'openai+fallback' : 'rules',
      ...response,
      txHash: response.transactionId,
    },
  });
});

export default router;
