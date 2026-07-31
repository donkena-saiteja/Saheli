/**
 * SBI-style WhatsApp banking state machine.
 *
 * The interaction model mirrors how Indian bank WhatsApp channels actually
 * work, because that is what rural users have already been taught:
 *
 *   "Hi"  -> MPIN prompt -> numbered main menu -> sub-flow -> YES confirmation
 *
 * Everything is plain text, so this runs on the Twilio WhatsApp **Sandbox**
 * with no template approval and no waiting on Meta business verification.
 * Interactive buttons would need an approved sender; numbered menus do not,
 * which is exactly why real banks use them.
 *
 * The same machine backs both the live Twilio webhook and the in-browser
 * simulator, so the demo and production paths cannot drift apart.
 */

import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import WhatsAppSession, { SessionState } from '../models/WhatsAppSession';
import User from '../models/User';
import Transaction from '../models/Transaction';
import LoanModel from '../models/Loan';
import MultiSigActionModel from '../models/MultiSigAction';
import { v4 as uuidv4 } from 'uuid';
import { anchorLedgerEntry, explorerTxUrl } from './algorand';
import { applyPassportEvent, getOrMintPassport, serializePassport } from './dsbt';
import { processEmergencyLoan } from './agentEngine';
import { registerTransactionLifecycle, setTransactionLifecycleStatus } from './txEngine';

const SESSION_TIMEOUT_MS = Number(process.env.WHATSAPP_SESSION_TIMEOUT_MS || 10 * 60 * 1000);
const MAX_MPIN_ATTEMPTS = 3;
const LOCKOUT_MS = 5 * 60 * 1000;
export const DEFAULT_DEMO_MPIN = process.env.WHATSAPP_DEMO_MPIN || '1234';

export interface BankingReply {
  /** Message text to send back to the user. */
  message: string;
  /** Optional media (QR proof) to attach. */
  mediaUrl?: string;
  /** Machine-readable outcome, used by the UI simulator. */
  action?: string;
  transactionId?: string;
  explorerUrl?: string;
  amount?: number;
  state: SessionState;
  authenticated: boolean;
  /** True when the reply concludes a money movement, so the UI can show a QR. */
  showQR?: boolean;
}

export function normalizePhone(phone: string): string {
  return String(phone || '')
    .replace(/^whatsapp:/i, '')
    .replace(/[^\d]/g, '');
}

// ─── Message templates ───────────────────────────────────────────────────────

const MAIN_MENU = [
  '╭───────────────────────────╮',
  '   *SAHELI WhatsApp Banking*',
  '╰───────────────────────────╯',
  '',
  '*1* ⟩ Balance Enquiry',
  '*2* ⟩ Deposit Money',
  '*3* ⟩ Mini Statement',
  '*4* ⟩ Request Loan',
  '*5* ⟩ Loan Status & Repayment',
  '*6* ⟩ Trust Score (d-SBT)',
  '*7* ⟩ Get QR Proof',
  '*8* ⟩ Withdraw Money',
  '*9* ⟩ Help & Support',
  '',
  '_Reply with a number (1-9)._',
  '_Send *EXIT* to log out._',
].join('\n');

function greeting(name: string): string {
  return [
    `🪷 *Namaste ${name}!*`,
    'Welcome to *Saheli WhatsApp Banking*.',
    '',
    'Your SHG savings, loans and trust score — all on Algorand, all from WhatsApp.',
    '',
    '🔐 Please reply with your *4-digit MPIN* to continue.',
    '',
    `_Demo MPIN: ${DEFAULT_DEMO_MPIN}_`,
  ].join('\n');
}

const HELP_TEXT = [
  '*SAHELI HELP*',
  '',
  'Anytime you can send:',
  '• *MENU* — main menu',
  '• *BACK* — previous step',
  '• *EXIT* — log out',
  '• *HELP* — this message',
  '',
  'You can also just *speak or type naturally*:',
  '_"Deposit 500 rupees"_',
  '_"I need 5000 for hospital"_',
  '_"What is my balance"_',
  '',
  '🎙️ Voice notes work too — send one in your own language.',
  '',
  '☎️ SHG support: 1800-SAHELI',
].join('\n');

// ─── Session helpers ─────────────────────────────────────────────────────────

async function loadSession(phone: string, profileName?: string) {
  const key = normalizePhone(phone);
  let session = await WhatsAppSession.findOne({ phone: key });

  if (!session) {
    session = await WhatsAppSession.create({
      phone: key,
      profileName,
      state: 'GREETING',
      context: {},
    });
  }

  // Expire idle sessions the way a bank channel would.
  const idleMs = Date.now() - new Date(session.lastMessageAt || Date.now()).getTime();
  if (session.authenticated && idleMs > SESSION_TIMEOUT_MS) {
    session.authenticated = false;
    session.state = 'GREETING';
    session.context = {};
  }

  if (profileName && !session.profileName) session.profileName = profileName;
  session.lastMessageAt = new Date();
  session.messageCount = (session.messageCount || 0) + 1;

  return session;
}

async function resolveUserByPhone(phone: string) {
  const digits = normalizePhone(phone);
  // An empty inbound number must never match a phone-less (wallet-only)
  // account, so bail before touching the database.
  if (!digits) return null;

  const candidates = await User.find({ role: 'member', phone: { $exists: true, $ne: null } })
    .select('name phone shgId mpinHash trustScore totalSavings activeLoans activeLoansAmount yieldEarned');
  return candidates.find((u) => u.phone && normalizePhone(u.phone) === digits) || null;
}

async function verifyMpin(user: any, entered: string): Promise<boolean> {
  if (user.mpinHash) {
    return bcrypt.compare(entered, user.mpinHash);
  }
  // Seeded demo accounts fall back to the documented demo MPIN.
  return entered === DEFAULT_DEMO_MPIN;
}

function formatInr(value: number): string {
  return `₹${Math.round(value).toLocaleString('en-IN')}`;
}

// ─── Natural language shortcuts ──────────────────────────────────────────────

interface ParsedIntent {
  intent: 'deposit' | 'withdraw' | 'loan' | 'balance' | 'statement' | 'score' | 'qr' | 'menu' | 'unknown';
  amount?: number;
  purpose?: string;
}

/**
 * Lets a user (or a transcribed voice note) skip straight to an action instead
 * of walking the menu. Recognises English, Hindi and Telugu keyword forms.
 */
export function parseNaturalLanguage(message: string): ParsedIntent {
  const lower = message.toLowerCase().trim();

  const amountMatch =
    lower.match(/(?:rs\.?|₹|rupees?)\s*(\d[\d,]*)/i) ||
    lower.match(/(\d[\d,]*)\s*(?:rs\.?|₹|rupees?|rupaye|rupaya)/i) ||
    lower.match(/\b(\d{2,7})\b/);
  const amount = amountMatch ? parseInt(amountMatch[1].replace(/[^\d]/g, ''), 10) : undefined;

  if (/\b(deposit|save|saving|jama|डिपॉजिट|जमा|డిపాజిట్)\b/i.test(lower)) {
    return { intent: 'deposit', amount };
  }
  if (/\b(withdraw|nikal|निकाल|withdrawal|cash out|తీసుకో)\b/i.test(lower)) {
    return { intent: 'withdraw', amount };
  }
  if (/\b(loan|borrow|udhar|उधार|कर्ज|emergency|urgent|hospital|medical|दवाई|అప్పు)\b/i.test(lower)) {
    const purposeMatch = lower.match(/(?:for|ke liye|కోసం)\s+([a-zऀ-ॿఀ-౿\s]+)/i);
    const emergency = /emergency|urgent|hospital|medical|accident|दवाई|अस्पताल/i.test(lower);
    return {
      intent: 'loan',
      amount,
      purpose: purposeMatch?.[1]?.trim() || (emergency ? 'medical emergency' : 'general purpose'),
    };
  }
  if (/\b(balance|kitna|कितना|शेष|how much|savings|బ్యాలెన్స్)\b/i.test(lower)) {
    return { intent: 'balance' };
  }
  if (/\b(statement|history|transactions|पिछला|లావాదేవీ)\b/i.test(lower)) {
    return { intent: 'statement' };
  }
  if (/\b(score|trust|credit|passport|सिबिल|स्कोर)\b/i.test(lower)) {
    return { intent: 'score' };
  }
  if (/\b(qr|proof|receipt|certificate|प्रमाण)\b/i.test(lower)) {
    return { intent: 'qr' };
  }
  if (/\b(menu|main|start|hi|hello|hey|namaste|नमस्ते|హాయ్)\b/i.test(lower)) {
    return { intent: 'menu' };
  }

  return { intent: 'unknown', amount };
}

// ─── Banking actions ─────────────────────────────────────────────────────────

async function recordTransaction(params: {
  userId: string;
  type: 'deposit' | 'withdrawal' | 'loan_disbursement' | 'loan_repayment' | 'yield';
  amount: number;
  description: string;
  shgId?: string;
}) {
  const anchor = await anchorLedgerEntry({
    kind: params.type === 'withdrawal' ? 'withdrawal' : (params.type as any),
    memberId: params.userId,
    shgId: params.shgId,
    amount: params.amount,
    detail: params.description,
  });

  registerTransactionLifecycle({
    transactionId: anchor.txId,
    type: params.type,
    amount: params.amount,
    initialStatus: anchor.mode === 'live' ? 'confirmed' : 'pending',
    autoConfirm: anchor.mode !== 'live',
  });

  await Transaction.create({
    user: params.userId,
    type: params.type,
    amount: params.amount,
    description: params.description,
    transactionId: anchor.txId,
    status: anchor.mode === 'live' ? 'confirmed' : 'pending',
    agentProcessed: true,
  });

  if (anchor.mode !== 'live') {
    setTimeout(async () => {
      await Transaction.updateOne({ transactionId: anchor.txId }, { $set: { status: 'confirmed' } });
      setTransactionLifecycleStatus(anchor.txId, 'confirmed');
    }, 2500);
  }

  return anchor;
}

// ─── The state machine ───────────────────────────────────────────────────────

export async function handleWhatsAppMessage(args: {
  phone: string;
  message: string;
  profileName?: string;
  /** True when the text came from a transcribed voice note. */
  fromVoice?: boolean;
}): Promise<BankingReply> {
  const raw = (args.message || '').trim();
  const upper = raw.toUpperCase();
  const session = await loadSession(args.phone, args.profileName);

  const reply = (
    message: string,
    extra: Partial<BankingReply> = {},
  ): BankingReply => ({
    message,
    state: session.state as SessionState,
    authenticated: Boolean(session.authenticated),
    ...extra,
  });

  const finish = async (r: BankingReply) => {
    await session.save();
    return r;
  };

  // ── Global commands ──
  if (upper === 'EXIT' || upper === 'LOGOUT') {
    session.authenticated = false;
    session.state = 'GREETING';
    session.context = {};
    return finish(
      reply('👋 You have been logged out securely.\n\nSend *Hi* anytime to bank again.'),
    );
  }

  if (upper === 'HELP') {
    return finish(reply(HELP_TEXT));
  }

  // ── Lockout ──
  if (session.lockedUntil && session.lockedUntil.getTime() > Date.now()) {
    const mins = Math.ceil((session.lockedUntil.getTime() - Date.now()) / 60000);
    return finish(
      reply(`🔒 Too many incorrect MPIN attempts.\n\nPlease try again in *${mins} minute(s)*.`),
    );
  }

  const user = await resolveUserByPhone(args.phone);

  // ── Unregistered number ──
  if (!user) {
    return finish(
      reply(
        [
          '🪷 *Welcome to Saheli WhatsApp Banking*',
          '',
          `This number (${normalizePhone(args.phone)}) is not registered with any SHG yet.`,
          '',
          'Please ask your SHG leader to register you, or sign up on the Saheli web portal.',
          '',
          '_Judges/demo: run the seed endpoint, then message from a seeded member number._',
        ].join('\n'),
      ),
    );
  }

  session.user = user._id as mongoose.Types.ObjectId;

  // ── Authentication ──
  if (!session.authenticated) {
    if (session.state === 'AWAITING_MPIN' && /^\d{4}$/.test(raw)) {
      const ok = await verifyMpin(user, raw);
      if (!ok) {
        session.mpinAttempts = (session.mpinAttempts || 0) + 1;
        if (session.mpinAttempts >= MAX_MPIN_ATTEMPTS) {
          session.lockedUntil = new Date(Date.now() + LOCKOUT_MS);
          session.mpinAttempts = 0;
          session.state = 'LOCKED';
          return finish(
            reply('🔒 *Account temporarily locked* after 3 incorrect attempts.\n\nTry again in 5 minutes.'),
          );
        }
        const left = MAX_MPIN_ATTEMPTS - session.mpinAttempts;
        return finish(reply(`❌ Incorrect MPIN. *${left} attempt(s) remaining.*`));
      }

      session.authenticated = true;
      session.mpinAttempts = 0;
      session.state = 'MENU';
      return finish(
        reply(`✅ *Verified.* Welcome back, ${user.name}!\n\n${MAIN_MENU}`, { action: 'authenticated' }),
      );
    }

    session.state = 'AWAITING_MPIN';
    return finish(reply(greeting(user.name)));
  }

  // ── Authenticated: navigation shortcuts ──
  if (upper === 'MENU' || upper === 'BACK') {
    session.state = 'MENU';
    session.context = {};
    return finish(reply(MAIN_MENU));
  }

  // ── Pending confirmation ──
  if (session.state === 'AWAITING_CONFIRMATION') {
    const ctx = (session.context || {}) as Record<string, any>;

    if (/^(yes|y|confirm|ok|haan|हाँ|1)$/i.test(raw)) {
      session.state = 'MENU';
      session.context = {};
      return finish(await executeConfirmedAction(user, ctx, reply));
    }

    if (/^(no|n|cancel|nahi|नहीं|2)$/i.test(raw)) {
      session.state = 'MENU';
      session.context = {};
      return finish(reply(`❌ Cancelled. Nothing was debited.\n\n${MAIN_MENU}`));
    }

    return finish(reply('Please reply *YES* to confirm or *NO* to cancel.'));
  }

  // ── Amount capture states ──
  if (session.state === 'AWAITING_DEPOSIT_AMOUNT' || session.state === 'AWAITING_WITHDRAW_AMOUNT') {
    const amount = parseInt(raw.replace(/[^\d]/g, ''), 10);
    if (!Number.isFinite(amount) || amount <= 0) {
      return finish(reply('Please enter a valid amount in numbers.\n_Example:_ *500*'));
    }

    const isDeposit = session.state === 'AWAITING_DEPOSIT_AMOUNT';
    if (!isDeposit && amount > (user.totalSavings || 0)) {
      session.state = 'MENU';
      return finish(
        reply(
          `❌ Insufficient balance.\n\nYou have ${formatInr(user.totalSavings || 0)}.\n\n${MAIN_MENU}`,
        ),
      );
    }

    session.context = { action: isDeposit ? 'deposit' : 'withdraw', amount };
    session.state = 'AWAITING_CONFIRMATION';
    return finish(reply(buildConfirmation(isDeposit ? 'deposit' : 'withdraw', amount, user)));
  }

  if (session.state === 'AWAITING_LOAN_AMOUNT') {
    const amount = parseInt(raw.replace(/[^\d]/g, ''), 10);
    if (!Number.isFinite(amount) || amount <= 0) {
      return finish(reply('Please enter a valid loan amount.\n_Example:_ *5000*'));
    }
    session.context = { action: 'loan', amount };
    session.state = 'AWAITING_LOAN_PURPOSE';
    return finish(
      reply(
        [
          '*LOAN PURPOSE*',
          '',
          `Amount: *${formatInr(amount)}*`,
          '',
          'What is this loan for?',
          '',
          '*1* ⟩ Medical emergency',
          '*2* ⟩ Children education',
          '*3* ⟩ Business / livelihood',
          '*4* ⟩ Agriculture',
          '*5* ⟩ Other',
          '',
          '_Reply with a number, or type the reason._',
        ].join('\n'),
      ),
    );
  }

  if (session.state === 'AWAITING_LOAN_PURPOSE') {
    const purposes: Record<string, string> = {
      '1': 'medical emergency',
      '2': 'children education',
      '3': 'business livelihood',
      '4': 'agriculture',
      '5': 'other',
    };
    const purpose = purposes[raw] || raw || 'general purpose';
    session.context = { ...(session.context as any), purpose };
    session.state = 'AWAITING_CONFIRMATION';
    const amount = (session.context as any).amount;
    return finish(reply(buildLoanConfirmation(amount, purpose, user)));
  }

  // ── Main menu selection ──
  if (/^[1-9]$/.test(raw)) {
    return finish(await handleMenuChoice(raw, user, session, reply));
  }

  // ── Natural language / voice fallback ──
  const parsed = parseNaturalLanguage(raw);
  switch (parsed.intent) {
    case 'menu':
      session.state = 'MENU';
      return finish(reply(MAIN_MENU));
    case 'balance':
      return finish(await handleMenuChoice('1', user, session, reply));
    case 'statement':
      return finish(await handleMenuChoice('3', user, session, reply));
    case 'score':
      return finish(await handleMenuChoice('6', user, session, reply));
    case 'qr':
      return finish(await handleMenuChoice('7', user, session, reply));
    case 'deposit':
      if (parsed.amount) {
        session.context = { action: 'deposit', amount: parsed.amount };
        session.state = 'AWAITING_CONFIRMATION';
        return finish(reply(buildConfirmation('deposit', parsed.amount, user), { action: 'nlp_deposit' }));
      }
      return finish(await handleMenuChoice('2', user, session, reply));
    case 'withdraw':
      if (parsed.amount) {
        session.context = { action: 'withdraw', amount: parsed.amount };
        session.state = 'AWAITING_CONFIRMATION';
        return finish(reply(buildConfirmation('withdraw', parsed.amount, user), { action: 'nlp_withdraw' }));
      }
      return finish(await handleMenuChoice('8', user, session, reply));
    case 'loan':
      if (parsed.amount) {
        session.context = { action: 'loan', amount: parsed.amount, purpose: parsed.purpose };
        session.state = 'AWAITING_CONFIRMATION';
        return finish(
          reply(buildLoanConfirmation(parsed.amount, parsed.purpose || 'general purpose', user), {
            action: 'nlp_loan',
          }),
        );
      }
      return finish(await handleMenuChoice('4', user, session, reply));
    default:
      return finish(
        reply(
          [
            args.fromVoice
              ? `🎙️ I heard: _"${raw}"_`
              : "I didn't quite catch that.",
            '',
            MAIN_MENU,
          ].join('\n'),
        ),
      );
  }
}

function buildConfirmation(kind: 'deposit' | 'withdraw', amount: number, user: any): string {
  const isDeposit = kind === 'deposit';
  return [
    `⚠️ *CONFIRM ${isDeposit ? 'DEPOSIT' : 'WITHDRAWAL'}*`,
    '',
    `Amount      : *${formatInr(amount)}*`,
    `${isDeposit ? 'To' : 'From'}          : SHG Treasury`,
    `Current bal : ${formatInr(user.totalSavings || 0)}`,
    `New balance : ${formatInr(isDeposit ? (user.totalSavings || 0) + amount : (user.totalSavings || 0) - amount)}`,
    `Network fee : *₹0* _(paid by Saheli)_`,
    '',
    'Reply *YES* to confirm or *NO* to cancel.',
  ].join('\n');
}

function buildLoanConfirmation(amount: number, purpose: string, user: any): string {
  return [
    '⚠️ *CONFIRM LOAN REQUEST*',
    '',
    `Amount      : *${formatInr(amount)}*`,
    `Purpose     : ${purpose}`,
    `Trust score : ${user.trustScore || 750}/1000`,
    `Repayment   : ${formatInr(Math.ceil(amount / 6))} × 6 instalments`,
    '',
    'The Saheli AI agent will assess this instantly.',
    '',
    'Reply *YES* to submit or *NO* to cancel.',
  ].join('\n');
}

async function handleMenuChoice(
  choice: string,
  user: any,
  session: any,
  reply: (m: string, e?: Partial<BankingReply>) => BankingReply,
): Promise<BankingReply> {
  switch (choice) {
    case '1': {
      session.state = 'MENU';
      return reply(
        [
          '💰 *BALANCE ENQUIRY*',
          '',
          `Account   : ${user.name}`,
          `SHG       : ${user.shgId || 'unassigned'}`,
          '',
          `Savings   : *${formatInr(user.totalSavings || 0)}*`,
          `Loans     : ${formatInr(user.activeLoansAmount || 0)}`,
          `Yield     : ${formatInr(user.yieldEarned || 0)}`,
          `Trust     : ${user.trustScore || 750}/1000`,
          '',
          '_Balances are derived from Algorand-anchored records._',
          '',
          'Reply *MENU* for more options.',
        ].join('\n'),
        { action: 'balance_enquiry' },
      );
    }

    case '2': {
      session.state = 'AWAITING_DEPOSIT_AMOUNT';
      return reply(
        [
          '💵 *DEPOSIT MONEY*',
          '',
          'How much would you like to deposit?',
          '',
          '_Enter the amount in numbers._',
          '_Example:_ *500*',
          '',
          'Reply *BACK* for the main menu.',
        ].join('\n'),
      );
    }

    case '3': {
      session.state = 'MENU';
      const txs = await Transaction.find({ user: user._id })
        .sort({ createdAt: -1 })
        .limit(5)
        .lean();

      if (txs.length === 0) {
        return reply('📄 *MINI STATEMENT*\n\nNo transactions yet.\n\nReply *MENU* for options.');
      }

      const lines = txs.map((t: any) => {
        const credit = ['deposit', 'yield', 'loan_repayment'].includes(t.type);
        const date = new Date(t.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
        return `${credit ? '🟢' : '🔴'} ${date}  ${credit ? '+' : '-'}${formatInr(t.amount)}  ${t.type.replace(/_/g, ' ')}`;
      });

      return reply(
        [
          '📄 *MINI STATEMENT*',
          `_Last ${txs.length} transactions_`,
          '',
          ...lines,
          '',
          `Balance: *${formatInr(user.totalSavings || 0)}*`,
          '',
          'Reply *7* for a verifiable QR proof.',
        ].join('\n'),
        { action: 'mini_statement' },
      );
    }

    case '4': {
      session.state = 'AWAITING_LOAN_AMOUNT';
      return reply(
        [
          '🏦 *REQUEST LOAN*',
          '',
          `Your trust score: *${user.trustScore || 750}/1000*`,
          '',
          'How much do you need?',
          '',
          '_Enter the amount in numbers._',
          '_Example:_ *5000*',
          '',
          'Reply *BACK* for the main menu.',
        ].join('\n'),
      );
    }

    case '5': {
      session.state = 'MENU';
      const loans = await LoanModel.find({ user: user._id }).sort({ createdAt: -1 }).limit(3).lean();
      if (loans.length === 0) {
        return reply('📋 *LOAN STATUS*\n\nYou have no loans on record.\n\nReply *4* to request one.');
      }

      const lines = loans.map((l: any) => {
        const outstanding = Math.max(0, (l.amount || 0) - (l.repaidAmount || 0));
        return [
          `• *${formatInr(l.amount)}* — ${l.purpose}`,
          `  Status: ${String(l.status).replace(/_/g, ' ')}`,
          `  Outstanding: ${formatInr(outstanding)}`,
          l.transactionId ? `  Proof: ${l.transactionId.slice(0, 12)}...` : '',
        ]
          .filter(Boolean)
          .join('\n');
      });

      return reply(
        ['📋 *LOAN STATUS*', '', ...lines, '', 'Reply *MENU* for options.'].join('\n'),
        { action: 'loan_status' },
      );
    }

    case '6': {
      session.state = 'MENU';
      const passport = serializePassport(await getOrMintPassport(String(user._id)));
      return reply(
        [
          '🎖️ *TRUST SCORE — d-SBT PASSPORT*',
          '',
          `${passport.visual.badge}  *${passport.visual.label}*`,
          '',
          `Score        : *${passport.score}/1000*`,
          `Tier         : ${passport.tier}`,
          `Repayment    : ${passport.metrics.repaymentRate}%`,
          `On-time      : ${passport.metrics.onTimeRepayments}`,
          `Credit power : ${passport.visual.creditMultiplier}× your savings`,
          '',
          'This is a *Soulbound Token* on Algorand.',
          'It cannot be sold or transferred — it is your reputation.',
          '',
          passport.lastAnchor.explorerUrl
            ? `🔗 Verify: ${passport.lastAnchor.explorerUrl}`
            : '',
          '',
          'Banks can read this to approve loans instantly.',
        ]
          .filter(Boolean)
          .join('\n'),
        { action: 'trust_score' },
      );
    }

    case '7': {
      session.state = 'MENU';
      const last = await Transaction.findOne({ user: user._id }).sort({ createdAt: -1 }).lean();
      if (!last) {
        return reply('📱 *QR PROOF*\n\nNo transaction to certify yet.\n\nReply *2* to make a deposit first.');
      }
      const txId = (last as any).transactionId;
      return reply(
        [
          '📱 *QR PROOF CERTIFICATE*',
          '',
          `Transaction : ${(last as any).type.replace(/_/g, ' ')}`,
          `Amount      : ${formatInr((last as any).amount)}`,
          `Tx ID       : ${txId}`,
          '',
          `🔗 ${explorerTxUrl(txId)}`,
          '',
          'Show the QR below to any bank or NGO officer.',
          'They can verify it *offline* — no app needed.',
        ].join('\n'),
        { action: 'qr_proof', transactionId: txId, explorerUrl: explorerTxUrl(txId), showQR: true },
      );
    }

    case '8': {
      session.state = 'AWAITING_WITHDRAW_AMOUNT';
      return reply(
        [
          '🏧 *WITHDRAW MONEY*',
          '',
          `Available: *${formatInr(user.totalSavings || 0)}*`,
          '',
          'How much would you like to withdraw?',
          '',
          '_Example:_ *500*',
          '',
          'Reply *BACK* for the main menu.',
        ].join('\n'),
      );
    }

    case '9': {
      session.state = 'MENU';
      return reply(HELP_TEXT, { action: 'help' });
    }

    default:
      return reply(MAIN_MENU);
  }
}

async function executeConfirmedAction(
  user: any,
  ctx: Record<string, any>,
  reply: (m: string, e?: Partial<BankingReply>) => BankingReply,
): Promise<BankingReply> {
  const amount = Number(ctx.amount || 0);

  if (ctx.action === 'deposit') {
    const anchor = await recordTransaction({
      userId: String(user._id),
      type: 'deposit',
      amount,
      description: 'Deposit via WhatsApp banking',
      shgId: user.shgId,
    });

    user.totalSavings = (user.totalSavings || 0) + amount;
    await user.save();
    await applyPassportEvent({
      userId: String(user._id),
      event: 'deposit_streak',
      amount,
      note: 'On-time WhatsApp deposit',
    }).catch(() => undefined);

    return reply(
      [
        '✅ *DEPOSIT SUCCESSFUL*',
        '',
        `Amount      : *${formatInr(amount)}*`,
        `New balance : *${formatInr(user.totalSavings)}*`,
        `Network fee : ₹0 _(paid by Saheli)_`,
        '',
        `Tx ID : ${anchor.txId}`,
        `🔗 ${anchor.explorerUrl}`,
        anchor.mode === 'simulated' ? '_(settlement simulated — fund the relayer for live mode)_' : '',
        '',
        '📱 Your QR proof is attached. Show it to any bank officer.',
        '',
        'Reply *MENU* for more options.',
      ]
        .filter(Boolean)
        .join('\n'),
      {
        action: 'deposit_confirmed',
        transactionId: anchor.txId,
        explorerUrl: anchor.explorerUrl,
        amount,
        showQR: true,
      },
    );
  }

  if (ctx.action === 'withdraw') {
    const anchor = await recordTransaction({
      userId: String(user._id),
      type: 'withdrawal',
      amount,
      description: 'Withdrawal via WhatsApp banking',
      shgId: user.shgId,
    });

    user.totalSavings = Math.max(0, (user.totalSavings || 0) - amount);
    await user.save();

    return reply(
      [
        '✅ *WITHDRAWAL INITIATED*',
        '',
        `Amount      : *${formatInr(amount)}*`,
        `New balance : *${formatInr(user.totalSavings)}*`,
        '',
        `Tx ID : ${anchor.txId}`,
        `🔗 ${anchor.explorerUrl}`,
        '',
        'Collect cash from your SHG leader or BC agent.',
        'Show the attached QR as proof.',
        '',
        'Reply *MENU* for more options.',
      ].join('\n'),
      {
        action: 'withdraw_confirmed',
        transactionId: anchor.txId,
        explorerUrl: anchor.explorerUrl,
        amount,
        showQR: true,
      },
    );
  }

  if (ctx.action === 'loan') {
    const purpose = String(ctx.purpose || 'general purpose');
    const result = await processEmergencyLoan({
      memberId: String(user._id),
      memberName: user.name,
      trustScore: user.trustScore || 750,
      amount,
      purpose,
    });

    if (result.autoApproved && result.transactionId) {
      await LoanModel.create({
        user: user._id,
        amount,
        purpose,
        status: 'repaying',
        trustScoreAtApplication: user.trustScore || 750,
        aiRecommendation: 'approve',
        aiReason: result.reason,
        approvals: 1,
        approvalsRequired: 1,
        disbursedAt: new Date(),
        dueDate: new Date(Date.now() + 30 * 24 * 3600 * 1000),
        repaidAmount: 0,
        transactionId: result.transactionId,
      });

      user.activeLoans = (user.activeLoans || 0) + 1;
      user.activeLoansAmount = (user.activeLoansAmount || 0) + amount;
      await user.save();

      await recordTransaction({
        userId: String(user._id),
        type: 'loan_disbursement',
        amount,
        description: `Emergency loan — ${purpose}`,
        shgId: user.shgId,
      });

      await applyPassportEvent({
        userId: String(user._id),
        event: 'loan_taken',
        amount,
        note: `Loan disbursed for ${purpose}`,
      }).catch(() => undefined);

      const installment = Math.ceil(amount / 6);
      return reply(
        [
          '🚨 *EMERGENCY LOAN APPROVED*',
          '',
          `The AI agent checked your on-chain trust score and approved this instantly.`,
          '',
          `Amount    : *${formatInr(amount)}*`,
          `Purpose   : ${purpose}`,
          `Approval  : 1-of-3 _(emergency override)_`,
          `Repayment : ${formatInr(installment)} × 6, auto-deducted`,
          '',
          `Tx ID : ${result.transactionId}`,
          `🔗 ${explorerTxUrl(result.transactionId)}`,
          '',
          '📱 QR proof attached.',
          '',
          'Reply *MENU* for more options.',
        ].join('\n'),
        {
          action: 'loan_approved',
          transactionId: result.transactionId,
          explorerUrl: explorerTxUrl(result.transactionId),
          amount,
          showQR: true,
        },
      );
    }

    const loan = await LoanModel.create({
      user: user._id,
      amount,
      purpose,
      status: 'pending',
      trustScoreAtApplication: user.trustScore || 750,
      aiRecommendation: (user.trustScore || 750) >= 700 ? 'approve' : 'review',
      aiReason: result.reason,
      approvals: 0,
      approvalsRequired: result.threshold,
      repaidAmount: 0,
    });

    await MultiSigActionModel.create({
      id: uuidv4(),
      type: 'loan_approval',
      description: `Loan approval for ${user.name}`,
      amount,
      requestedBy: user.name,
      signatures: [],
      signaturesRequired: result.threshold,
      status: 'pending',
      linkedLoanId: String(loan._id),
      destinationRole: 'leader',
      createdAt: new Date().toISOString(),
    });

    return reply(
      [
        '📋 *LOAN REQUEST SUBMITTED*',
        '',
        `Amount  : *${formatInr(amount)}*`,
        `Purpose : ${purpose}`,
        '',
        result.reason,
        '',
        `Routed for *${result.threshold}-of-3* leader approval.`,
        'You will get a WhatsApp update as soon as it is reviewed.',
        '',
        'Reply *5* to check status anytime.',
      ].join('\n'),
      { action: 'loan_pending', amount },
    );
  }

  return reply(`Nothing to confirm.\n\n${MAIN_MENU}`);
}

/** Resets a session — used by the browser simulator's "restart" control. */
export async function resetSession(phone: string) {
  await WhatsAppSession.deleteOne({ phone: normalizePhone(phone) });
}
