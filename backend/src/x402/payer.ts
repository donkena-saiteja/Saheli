/**
 * x402 client side: builds the Algorand atomic group that satisfies a
 * PaymentRequirements challenge, and encodes it into the X-PAYMENT header.
 *
 * Used by two callers:
 *   - the Bank/NGO dashboard, which pays for a report on the user's behalf;
 *   - the Saheli AI agent, which pays autonomously for premium data during
 *     underwriting (machine-to-machine commerce, no human in the loop).
 */

import algosdk from 'algosdk';
import type { PaymentPayload, PaymentRequirements } from '@x402/core/types';
import {
  MIN_FEE,
  deriveAccount,
  getAlgodClient,
  getChainHealth,
  getGenesisHash,
  getRelayerAccount,
} from '../services/algorand';
import { X402_VERSION, SCHEME_EXACT } from './facilitator';

/**
 * Suggested params for building the group. Uses the live network when
 * reachable and otherwise synthesises valid params from the genesis hash so a
 * spec-correct group can still be produced offline.
 */
async function resolveSuggestedParams(): Promise<algosdk.SuggestedParams> {
  const health = await getChainHealth();
  if (health.mode === 'live') {
    try {
      return await getAlgodClient().getTransactionParams().do();
    } catch {
      /* fall through to offline params */
    }
  }

  const firstValid = Math.max(1, health.round || 1);
  return {
    fee: BigInt(MIN_FEE),
    minFee: BigInt(MIN_FEE),
    firstValid: BigInt(firstValid),
    lastValid: BigInt(firstValid + 1000),
    genesisID: 'testnet-v1.0',
    genesisHash: new Uint8Array(Buffer.from(getGenesisHash(), 'base64')),
    flatFee: true,
  } as unknown as algosdk.SuggestedParams;
}

export interface BuildPaymentOptions {
  /** Subject used to derive the paying account (e.g. a bank user id). */
  payerSubject: string;
  requirements: PaymentRequirements;
  resource?: { url: string; description?: string; mimeType?: string };
}

/**
 * Builds a two-transaction atomic group:
 *   [0] relayer fee-pooling payment (0 value, covers the whole group)
 *   [1] the payer's ASA transfer to payTo  <- paymentIndex
 *
 * The payer therefore spends no ALGO, only the settlement asset.
 */
export async function buildPaymentPayload(
  options: BuildPaymentOptions,
): Promise<PaymentPayload> {
  const { payerSubject, requirements } = options;
  const suggestedParams = await resolveSuggestedParams();
  const payer = deriveAccount(payerSubject);
  const relayer = getRelayerAccount();

  const feePayerParams = { ...suggestedParams, fee: BigInt(MIN_FEE * 2), flatFee: true };
  const payerParams = { ...suggestedParams, fee: BigInt(0), flatFee: true };

  const feeCover = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender: relayer.address,
    receiver: relayer.address,
    amount: 0,
    note: new Uint8Array(Buffer.from('x402:fee-pool')),
    suggestedParams: feePayerParams,
  });

  const payment = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: payer.address,
    receiver: requirements.payTo,
    assetIndex: Number(requirements.asset),
    amount: BigInt(requirements.amount),
    suggestedParams: payerParams,
  });

  const group = algosdk.assignGroupID([feeCover, payment]);
  const signedGroup = [
    Buffer.from(group[0].signTxn(relayer.signer)).toString('base64'),
    Buffer.from(group[1].signTxn(payer.signer)).toString('base64'),
  ];

  return {
    x402Version: X402_VERSION,
    resource: options.resource
      ? {
          url: options.resource.url,
          description: options.resource.description,
          mimeType: options.resource.mimeType,
        }
      : undefined,
    accepted: requirements,
    payload: {
      paymentGroup: signedGroup,
      paymentIndex: 1,
    },
  };
}

/** Encodes a payment payload for the `X-PAYMENT` request header. */
export function encodePaymentHeader(payload: PaymentPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
}

/** Decodes an `X-PAYMENT` header back into a payment payload. */
export function decodePaymentHeader(header: string): PaymentPayload {
  const raw = Buffer.from(header, 'base64').toString('utf8');
  const parsed = JSON.parse(raw) as PaymentPayload;
  if (parsed.accepted?.scheme && parsed.accepted.scheme !== SCHEME_EXACT) {
    throw new Error(`Unsupported scheme: ${parsed.accepted.scheme}`);
  }
  return parsed;
}
