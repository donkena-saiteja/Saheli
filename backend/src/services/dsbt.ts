/**
 * Dynamic Soulbound Token (d-SBT) service — the "Financial Health Passport".
 *
 * Unlike a static credit score, the passport is a living on-chain record: each
 * repayment, deposit streak, or default re-anchors new state to Algorand, so an
 * institution can audit the entire trajectory instead of trusting one number.
 *
 * Soulbound property: the passport is bound to an address derived by the
 * platform for the member. There is no transfer path exposed anywhere in the
 * API — the token represents reputation, which by definition cannot be sold.
 */

import mongoose from 'mongoose';
import DSBT from '../models/DSBT';
import User from '../models/User';
import { anchorLedgerEntry, deriveAccount, explorerAccountUrl } from './algorand';

export type DsbtTier = 'BRONZE' | 'SILVER' | 'GOLD' | 'PLATINUM';

export function scoreToTier(score: number): DsbtTier {
  if (score >= 900) return 'PLATINUM';
  if (score >= 800) return 'GOLD';
  if (score >= 650) return 'SILVER';
  return 'BRONZE';
}

/** Visual identity for the passport, which changes as the tier changes. */
export function tierVisual(tier: DsbtTier) {
  switch (tier) {
    case 'PLATINUM':
      return { color: '#7dd3fc', badge: '◆◆◆◆', label: 'Platinum Trust', creditMultiplier: 5 };
    case 'GOLD':
      return { color: '#fbbf24', badge: '◆◆◆', label: 'Gold Trust', creditMultiplier: 3 };
    case 'SILVER':
      return { color: '#cbd5e1', badge: '◆◆', label: 'Silver Trust', creditMultiplier: 2 };
    default:
      return { color: '#d6a07a', badge: '◆', label: 'Building Trust', creditMultiplier: 1 };
  }
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(1000, Math.round(score)));
}

/**
 * Fetches a member's passport, minting one on first access.
 */
export async function getOrMintPassport(userId: string) {
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    throw new Error('Invalid member id');
  }

  const existing = await DSBT.findOne({ user: userId });
  if (existing) return existing;

  const user = await User.findById(userId).select('name trustScore shgId role');
  if (!user) throw new Error('Member not found');

  const account = deriveAccount(`member:${userId}`);
  const score = clampScore(user.trustScore || 750);
  const tier = scoreToTier(score);

  const anchor = await anchorLedgerEntry({
    kind: 'dsbt',
    memberId: userId,
    shgId: user.shgId ?? undefined,
    detail: `mint:${tier}:${score}`,
  });

  return DSBT.create({
    user: userId,
    shgId: user.shgId,
    address: account.address,
    score,
    tier,
    mintedAt: new Date(),
    lastAnchorTxId: anchor.txId,
    lastAnchorUrl: anchor.explorerUrl,
    lastAnchorMode: anchor.mode,
    history: [
      {
        score,
        tier,
        reason: 'Passport minted',
        delta: 0,
        transactionId: anchor.txId,
        explorerUrl: anchor.explorerUrl,
        chainMode: anchor.mode,
        at: new Date().toISOString(),
      },
    ],
  });
}

export type PassportEvent =
  | 'on_time_repayment'
  | 'late_repayment'
  | 'default'
  | 'deposit_streak'
  | 'loan_taken'
  | 'loan_cleared';

const EVENT_WEIGHTS: Record<PassportEvent, number> = {
  on_time_repayment: 12,
  late_repayment: -18,
  default: -85,
  deposit_streak: 6,
  loan_taken: -3,
  loan_cleared: 25,
};

/**
 * Applies an event to the passport, recomputes the tier, and re-anchors the
 * new state on chain. This is what makes the token *dynamic*.
 */
export async function applyPassportEvent(args: {
  userId: string;
  event: PassportEvent;
  amount?: number;
  note?: string;
}) {
  const passport = await getOrMintPassport(args.userId);

  const delta = EVENT_WEIGHTS[args.event];
  const previousTier = passport.tier as DsbtTier;
  const nextScore = clampScore((passport.score || 750) + delta);
  const nextTier = scoreToTier(nextScore);

  passport.score = nextScore;
  passport.tier = nextTier;

  switch (args.event) {
    case 'on_time_repayment':
      passport.onTimeRepayments += 1;
      passport.totalRepaid += args.amount || 0;
      break;
    case 'late_repayment':
      passport.lateRepayments += 1;
      passport.totalRepaid += args.amount || 0;
      break;
    case 'loan_taken':
      passport.totalBorrowed += args.amount || 0;
      break;
    case 'deposit_streak':
      passport.consecutiveOnTimeDeposits += 1;
      break;
    case 'default':
      passport.consecutiveOnTimeDeposits = 0;
      break;
    default:
      break;
  }

  const reason =
    args.note ||
    `${args.event.replace(/_/g, ' ')}${args.amount ? ` (₹${args.amount.toLocaleString('en-IN')})` : ''}`;

  const anchor = await anchorLedgerEntry({
    kind: 'dsbt',
    memberId: args.userId,
    shgId: passport.shgId || undefined,
    amount: args.amount,
    detail: `${args.event}:${nextTier}:${nextScore}`,
  });

  passport.lastAnchorTxId = anchor.txId;
  passport.lastAnchorUrl = anchor.explorerUrl;
  passport.lastAnchorMode = anchor.mode;
  passport.history.unshift({
    score: nextScore,
    tier: nextTier,
    reason,
    delta,
    transactionId: anchor.txId,
    explorerUrl: anchor.explorerUrl,
    chainMode: anchor.mode,
    at: new Date().toISOString(),
  } as never);

  // Keep the embedded history bounded.
  if (passport.history.length > 50) {
    passport.history = passport.history.slice(0, 50) as never;
  }

  await passport.save();

  // Keep the denormalised score on the user in sync for existing dashboards.
  await User.updateOne(
    { _id: args.userId },
    { $set: { trustScore: nextScore, trustGrade: nextTier } },
  );

  return {
    passport,
    delta,
    tierChanged: previousTier !== nextTier,
    previousTier,
    anchor,
  };
}

/** Shapes a passport for API responses, including its visual identity. */
export function serializePassport(passport: any) {
  const tier = (passport.tier || 'SILVER') as DsbtTier;
  const visual = tierVisual(tier);

  return {
    memberId: String(passport.user),
    shgId: passport.shgId,
    address: passport.address,
    explorerUrl: explorerAccountUrl(passport.address),
    assetId: passport.assetId || 0,
    score: passport.score,
    tier,
    visual,
    soulbound: true,
    transferable: false,
    metrics: {
      onTimeRepayments: passport.onTimeRepayments,
      lateRepayments: passport.lateRepayments,
      totalBorrowed: passport.totalBorrowed,
      totalRepaid: passport.totalRepaid,
      consecutiveOnTimeDeposits: passport.consecutiveOnTimeDeposits,
      repaymentRate:
        passport.onTimeRepayments + passport.lateRepayments > 0
          ? Math.round(
              (passport.onTimeRepayments / (passport.onTimeRepayments + passport.lateRepayments)) * 100,
            )
          : 100,
    },
    lastAnchor: {
      transactionId: passport.lastAnchorTxId,
      explorerUrl: passport.lastAnchorUrl,
      mode: passport.lastAnchorMode,
    },
    mintedAt: passport.mintedAt,
    history: (passport.history || []).slice(0, 20),
  };
}
