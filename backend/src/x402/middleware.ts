/**
 * The x402 payment gate.
 *
 * Wraps any Express route so that it costs money to call:
 *
 *   1. No `X-PAYMENT` header  -> 402 Payment Required + PaymentRequirements
 *   2. `X-PAYMENT` present    -> facilitator verify, then settle
 *   3. Settled                -> handler runs, `X-PAYMENT-RESPONSE` attached
 *
 * Settled revenue is recorded and the treasury share is credited to the SHG,
 * which is the point of the whole exercise.
 */

import { NextFunction, Request, Response } from 'express';
import type { PaymentPayload, PaymentRequired, PaymentRequirements, Network } from '@x402/core/types';
import { getCaip2Network, explorerTxUrl, getRelayerAccount } from '../services/algorand';
import X402Payment from '../models/X402Payment';
import {
  PRICED_RESOURCES,
  ResourceId,
  getPayToAddress,
  getSettlementAsset,
  toDisplayAmount,
} from './pricing';
import { X402_VERSION, SCHEME_EXACT, getFacilitator } from './facilitator';
import { decodePaymentHeader } from './payer';

export const PAYMENT_HEADER = 'x-payment';
export const PAYMENT_RESPONSE_HEADER = 'x-payment-response';

export interface PaidRequest extends Request {
  x402?: {
    resourceId: ResourceId;
    payer?: string;
    transaction: string;
    settlement: string;
    amount: string;
  };
}

/** Builds the PaymentRequirements advertised for a priced resource. */
export function buildRequirements(resourceId: ResourceId): PaymentRequirements {
  const resource = PRICED_RESOURCES[resourceId];
  return {
    scheme: SCHEME_EXACT,
    network: getCaip2Network() as Network,
    asset: getSettlementAsset(),
    amount: resource.amount,
    payTo: getPayToAddress(),
    maxTimeoutSeconds: resource.maxTimeoutSeconds,
    extra: {
      feePayer: getRelayerAccount().address,
      displayPrice: resource.displayPrice,
      assetSymbol: 'USDC',
      assetDecimals: 6,
    },
  };
}

function absoluteUrl(req: Request): string {
  const base = process.env.PUBLIC_BASE_URL?.trim();
  if (base) return `${base.replace(/\/$/, '')}${req.originalUrl}`;
  const proto = req.header('x-forwarded-proto')?.split(',')[0]?.trim() || req.protocol;
  const host = req.header('x-forwarded-host') || req.header('host') || 'localhost';
  return `${proto}://${host}${req.originalUrl}`;
}

/** Builds the full 402 body, per the x402 v2 PaymentRequired shape. */
export function buildPaymentRequired(
  req: Request,
  resourceId: ResourceId,
  error?: string,
): PaymentRequired {
  const resource = PRICED_RESOURCES[resourceId];
  return {
    x402Version: X402_VERSION,
    error,
    resource: {
      url: absoluteUrl(req),
      description: resource.description,
      mimeType: resource.mimeType,
      serviceName: 'Saheli SHG Chain',
      tags: ['shg', 'credit', 'algorand', 'financial-inclusion'],
    },
    accepts: [buildRequirements(resourceId)],
  };
}

/**
 * Express middleware factory. Attach to any route to charge for it.
 */
export function requirePayment(resourceId: ResourceId) {
  const resource = PRICED_RESOURCES[resourceId];

  return async (req: PaidRequest, res: Response, next: NextFunction): Promise<void> => {
    const header = req.header(PAYMENT_HEADER);

    // Step 1 — no payment presented yet.
    if (!header) {
      res
        .status(402)
        .set('Accept-Payment', `${SCHEME_EXACT} ${getCaip2Network()}`)
        .json(buildPaymentRequired(req, resourceId, 'Payment required to access this resource'));
      return;
    }

    // Step 2 — decode and verify.
    let payload: PaymentPayload;
    try {
      payload = decodePaymentHeader(header);
    } catch (err) {
      res.status(400).json({
        success: false,
        error: `Malformed X-PAYMENT header: ${err instanceof Error ? err.message : 'decode failed'}`,
      });
      return;
    }

    const requirements = buildRequirements(resourceId);
    const facilitator = getFacilitator();

    const verification = await facilitator.verify(payload, requirements);
    if (!verification.isValid) {
      res.status(402).json({
        ...buildPaymentRequired(req, resourceId, verification.invalidMessage || 'Payment verification failed'),
        verifyError: {
          reason: verification.invalidReason,
          message: verification.invalidMessage,
        },
      });
      return;
    }

    // Step 3 — settle.
    const settlement = await facilitator.settle(payload, requirements);
    const settlementKind = String(
      (settlement.extra as Record<string, unknown> | undefined)?.settlement ?? 'simulated',
    );

    if (!settlement.success) {
      await recordPayment({
        resourceId,
        req,
        requirements,
        payer: settlement.payer || verification.payer,
        transaction: settlement.transaction,
        settlement: 'failed',
        status: 'failed',
        errorReason: settlement.errorReason,
      }).catch(() => undefined);

      res.status(402).json({
        ...buildPaymentRequired(req, resourceId, settlement.errorMessage || 'Settlement failed'),
        settleError: {
          reason: settlement.errorReason,
          message: settlement.errorMessage,
        },
      });
      return;
    }

    const confirmedRound = Number(
      (settlement.extra as Record<string, unknown> | undefined)?.confirmedRound ?? 0,
    );

    await recordPayment({
      resourceId,
      req,
      requirements,
      payer: settlement.payer,
      transaction: settlement.transaction,
      settlement: settlementKind === 'onchain' ? 'onchain' : 'simulated',
      status: 'settled',
      confirmedRound: confirmedRound || undefined,
    }).catch((err) => {
      console.warn(`[x402] could not record payment: ${err?.message || err}`);
    });

    // Attach the settlement receipt for the client, per spec.
    res.set(
      PAYMENT_RESPONSE_HEADER,
      Buffer.from(
        JSON.stringify({
          success: true,
          errorReason: null,
          payer: settlement.payer,
          transaction: settlement.transaction,
          network: settlement.network,
        }),
        'utf8',
      ).toString('base64'),
    );

    req.x402 = {
      resourceId,
      payer: settlement.payer,
      transaction: settlement.transaction,
      settlement: settlementKind,
      amount: resource.amount,
    };

    next();
  };
}

async function recordPayment(args: {
  resourceId: ResourceId;
  req: Request;
  requirements: PaymentRequirements;
  payer?: string;
  transaction: string;
  settlement: 'onchain' | 'simulated' | 'failed';
  status: 'settled' | 'failed';
  confirmedRound?: number;
  errorReason?: string;
}) {
  const resource = PRICED_RESOURCES[args.resourceId];
  const treasuryShare = (
    (BigInt(resource.amount) * BigInt(resource.treasuryShareBps)) /
    BigInt(10000)
  ).toString();

  await X402Payment.create({
    resourceId: args.resourceId,
    resourcePath: args.req.originalUrl,
    method: args.req.method,
    scheme: SCHEME_EXACT,
    network: args.requirements.network,
    asset: args.requirements.asset,
    amount: resource.amount,
    displayAmount: toDisplayAmount(resource.amount),
    payer: args.payer,
    payerType: resource.payerType,
    payTo: args.requirements.payTo,
    transactionId: args.transaction,
    settlement: args.settlement,
    confirmedRound: args.confirmedRound,
    explorerUrl: args.transaction ? explorerTxUrl(args.transaction) : undefined,
    treasuryShare,
    treasuryShareBps: resource.treasuryShareBps,
    status: args.status,
    errorReason: args.errorReason,
    shgId: (args.req.params as Record<string, string>)?.shgId,
    requestedBy: args.req.header('x-requested-by') || undefined,
  });
}
