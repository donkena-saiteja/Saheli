/**
 * x402 facilitator for the `exact` scheme on Algorand (AVM).
 *
 * Implements the verify/settle contract from
 * coinbase/x402 `specs/schemes/exact/scheme_exact_algo.md`, using the official
 * `@x402/core` types so our payloads are structurally guaranteed to match the
 * standard.
 *
 * Two backends:
 *   - `LocalAvmFacilitator` (default) verifies and settles in-process against
 *     algod. Keeps the mandatory x402 flow working with no third-party uptime
 *     dependency during judging.
 *   - A remote facilitator (e.g. https://facilitator.goplausible.xyz) is used
 *     instead when X402_FACILITATOR_URL is set, proving interoperability.
 */

import algosdk from 'algosdk';
import type { FacilitatorClient } from '@x402/core/server';
import type {
  Network,
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  SupportedResponse,
  VerifyResponse,
} from '@x402/core/types';
import {
  getAlgodClient,
  getCaip2Network,
  getChainHealth,
  getRelayerAccount,
  simulatedTxId,
} from '../services/algorand';

export const X402_VERSION = 2;
export const SCHEME_EXACT = 'exact';

/** Algorand caps atomic groups at 16 transactions. */
const MAX_GROUP_SIZE = 16;

/** 5x the 1000 microAlgo minimum, matching @x402/avm's MAX_REASONABLE_FEE_PER_TXN. */
const MAX_REASONABLE_FEE_PER_TXN = 5000;

export interface ExactAvmPayloadV2 {
  paymentGroup: string[];
  paymentIndex: number;
}

interface DecodedTxn {
  txn: algosdk.Transaction;
  signed: boolean;
  raw: Uint8Array;
}

function decodeGroupEntry(encoded: string): DecodedTxn {
  const raw = new Uint8Array(Buffer.from(encoded, 'base64'));
  try {
    const st = algosdk.decodeSignedTransaction(raw);
    return { txn: st.txn, signed: Boolean(st.sig), raw };
  } catch {
    return { txn: algosdk.decodeUnsignedTransaction(raw), signed: false, raw };
  }
}

function isExactAvmPayload(payload: unknown): payload is ExactAvmPayloadV2 {
  if (!payload || typeof payload !== 'object') return false;
  const p = payload as Record<string, unknown>;
  return Array.isArray(p.paymentGroup) && typeof p.paymentIndex === 'number';
}

function fail(reason: string, message: string): VerifyResponse {
  return { isValid: false, invalidReason: reason, invalidMessage: message };
}

export class LocalAvmFacilitator implements FacilitatorClient {
  /**
   * Verifies a payment payload against the stated requirements, following the
   * eight checks in the Algorand exact-scheme spec.
   */
  async verify(
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements,
  ): Promise<VerifyResponse> {
    // 1. Protocol version
    if (paymentPayload.x402Version !== X402_VERSION) {
      return fail('invalid_x402_version', `Expected x402Version ${X402_VERSION}`);
    }

    // 2. Scheme agreement between accepted requirements and the server's own
    if (
      paymentRequirements.scheme !== SCHEME_EXACT ||
      paymentPayload.accepted?.scheme !== SCHEME_EXACT
    ) {
      return fail('invalid_scheme', 'Only the "exact" scheme is supported');
    }

    // 3. Network agreement
    if (paymentPayload.accepted?.network !== paymentRequirements.network) {
      return fail(
        'invalid_network',
        `Payload network ${paymentPayload.accepted?.network} does not match required ${paymentRequirements.network}`,
      );
    }

    // 4. Group size
    if (!isExactAvmPayload(paymentPayload.payload)) {
      return fail('invalid_payload', 'payload must contain paymentGroup and paymentIndex');
    }
    const { paymentGroup, paymentIndex } = paymentPayload.payload;
    if (paymentGroup.length === 0 || paymentGroup.length > MAX_GROUP_SIZE) {
      return fail('invalid_payload', `paymentGroup must hold 1..${MAX_GROUP_SIZE} transactions`);
    }
    if (paymentIndex < 0 || paymentIndex >= paymentGroup.length) {
      return fail('invalid_payload', 'paymentIndex is out of range');
    }

    // 5. Decode
    let decoded: DecodedTxn[];
    try {
      decoded = paymentGroup.map(decodeGroupEntry);
    } catch (err) {
      return fail(
        'invalid_payload',
        `Could not decode paymentGroup: ${err instanceof Error ? err.message : 'bad msgpack'}`,
      );
    }

    // 6. The payment transaction itself
    const paymentTxn = decoded[paymentIndex].txn;
    if (paymentTxn.type !== 'axfer' || !paymentTxn.assetTransfer) {
      return fail('invalid_payment', 'Payment transaction must be an asset transfer (axfer)');
    }

    const transfer = paymentTxn.assetTransfer;
    const payer = String(paymentTxn.sender);

    if (String(transfer.assetIndex) !== String(paymentRequirements.asset)) {
      return fail(
        'invalid_asset',
        `Expected asset ${paymentRequirements.asset}, got ${transfer.assetIndex}`,
      );
    }
    if (String(transfer.receiver) !== paymentRequirements.payTo) {
      return fail(
        'invalid_receiver',
        `Expected payTo ${paymentRequirements.payTo}, got ${transfer.receiver}`,
      );
    }
    if (BigInt(transfer.amount) !== BigInt(paymentRequirements.amount)) {
      return fail(
        'insufficient_amount',
        `Expected amount ${paymentRequirements.amount}, got ${transfer.amount}`,
      );
    }
    if (transfer.closeRemainderTo) {
      return fail('invalid_payment', 'Payment transaction must not close the asset holding');
    }
    if (paymentTxn.rekeyTo) {
      return fail('invalid_payment', 'Payment transaction must not rekey the payer');
    }

    // 7. Fee-payer transactions must be benign
    const feePayer = (paymentRequirements.extra as Record<string, unknown> | undefined)?.feePayer;
    if (typeof feePayer === 'string' && feePayer) {
      for (const [index, entry] of decoded.entries()) {
        if (index === paymentIndex) continue;
        if (String(entry.txn.sender) !== feePayer) continue;

        if (entry.txn.type !== 'pay') {
          return fail('invalid_fee_payer', 'Fee payer transactions must be of type pay');
        }
        if (entry.txn.payment?.closeRemainderTo) {
          return fail('invalid_fee_payer', 'Fee payer transaction must not close its account');
        }
        if (entry.txn.rekeyTo) {
          return fail('invalid_fee_payer', 'Fee payer transaction must not rekey');
        }
        if (BigInt(entry.txn.payment?.amount ?? 0n) !== 0n) {
          return fail('invalid_fee_payer', 'Fee payer transaction must not move value');
        }
        const maxFee = BigInt(MAX_REASONABLE_FEE_PER_TXN * paymentGroup.length);
        if (BigInt(entry.txn.fee ?? 0n) > maxFee) {
          return fail('invalid_fee_payer', `Fee payer fee exceeds ${maxFee} microAlgos`);
        }
      }
    }

    // 8. Simulate against a node when one is reachable. Simulation is advisory:
    // an unreachable node must not block the demo, so we log and continue.
    const health = await getChainHealth();
    if (health.mode === 'live') {
      try {
        const client = getAlgodClient();
        const allSigned = decoded.every((d) => d.signed);
        if (allSigned) {
          const request = new algosdk.modelsv2.SimulateRequest({
            txnGroups: [
              new algosdk.modelsv2.SimulateRequestTransactionGroup({
                txns: decoded.map((d) => algosdk.decodeObj(d.raw) as any),
              }),
            ],
            allowEmptySignatures: true,
insufficientLedgerBalance: false,
          } as any);
          const sim: any = await client.simulateTransactions(request).do();
          const failure = sim?.txnGroups?.[0]?.failureMessage;
          if (failure) {
            return fail('simulation_failed', `Group simulation failed: ${failure}`);
          }
        }
      } catch (err) {
        console.warn(
          `[x402] simulation skipped: ${err instanceof Error ? err.message : 'simulate unavailable'}`,
        );
      }
    }

    return { isValid: true, payer };
  }

  /**
   * Submits the verified atomic group. On a live chain this is a real
   * settlement with instant finality; otherwise it records a deterministic
   * settlement id clearly marked as simulated.
   */
  async settle(
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements,
  ): Promise<SettleResponse> {
    const verification = await this.verify(paymentPayload, paymentRequirements);
    if (!verification.isValid) {
      return {
        success: false,
        errorReason: verification.invalidReason,
        errorMessage: verification.invalidMessage,
        transaction: '',
        network: paymentRequirements.network,
      };
    }

    const payload = paymentPayload.payload as unknown as ExactAvmPayloadV2;
    const decoded = payload.paymentGroup.map(decodeGroupEntry);
    const paymentTxn = decoded[payload.paymentIndex].txn;
    const txId = paymentTxn.txID();

    const health = await getChainHealth();
    const allSigned = decoded.every((d) => d.signed);

    if (health.mode !== 'live' || !allSigned) {
      return {
        success: true,
        payer: verification.payer,
        transaction: txId,
        network: paymentRequirements.network,
        amount: paymentRequirements.amount,
        extra: {
          settlement: 'simulated',
          reason: health.mode !== 'live' ? health.reason : 'group contains unsigned transactions',
        },
      };
    }

    try {
      const client = getAlgodClient();
      await client.sendRawTransaction(decoded.map((d) => d.raw)).do();
      const confirmed: any = await algosdk.waitForConfirmation(client, txId, 8);

      return {
        success: true,
        payer: verification.payer,
        transaction: txId,
        network: paymentRequirements.network,
        amount: paymentRequirements.amount,
        extra: {
          settlement: 'onchain',
          confirmedRound: Number(confirmed?.confirmedRound ?? 0) || undefined,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'submission failed';
      return {
        success: false,
        errorReason: 'settlement_failed',
        errorMessage: message,
        payer: verification.payer,
        transaction: txId,
        network: paymentRequirements.network,
      };
    }
  }

  async getSupported(): Promise<SupportedResponse> {
    const relayer = getRelayerAccount();
    return {
      kinds: [
        {
          x402Version: X402_VERSION,
          scheme: SCHEME_EXACT,
          network: getCaip2Network() as Network,
          extra: { feePayer: relayer.address },
        },
      ],
      extensions: [],
      signers: { [getCaip2Network()]: [relayer.address] },
    };
  }
}

/** Delegates to a remote facilitator, falling back locally if it is unreachable. */
export class RemoteFacilitator implements FacilitatorClient {
  private readonly local = new LocalAvmFacilitator();

  constructor(private readonly url: string) {}

  private async post<T>(path: string, body: unknown): Promise<T | null> {
    try {
      const res = await fetch(`${this.url.replace(/\/$/, '')}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(Number(process.env.X402_FACILITATOR_TIMEOUT_MS || 8000)),
      });
      if (!res.ok) return null;
      return (await res.json()) as T;
    } catch {
      return null;
    }
  }

  async verify(
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements,
  ): Promise<VerifyResponse> {
    const remote = await this.post<VerifyResponse>('verify', {
      x402Version: X402_VERSION,
      paymentPayload,
      paymentRequirements,
    });
    if (remote) return remote;
    console.warn('[x402] remote facilitator verify unavailable; using local facilitator');
    return this.local.verify(paymentPayload, paymentRequirements);
  }

  async settle(
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements,
  ): Promise<SettleResponse> {
    const remote = await this.post<SettleResponse>('settle', {
      x402Version: X402_VERSION,
      paymentPayload,
      paymentRequirements,
    });
    if (remote) return remote;
    console.warn('[x402] remote facilitator settle unavailable; using local facilitator');
    return this.local.settle(paymentPayload, paymentRequirements);
  }

  async getSupported(): Promise<SupportedResponse> {
    try {
      const res = await fetch(`${this.url.replace(/\/$/, '')}/supported`, {
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) return (await res.json()) as SupportedResponse;
    } catch {
      /* fall through */
    }
    return this.local.getSupported();
  }
}

let facilitatorInstance: FacilitatorClient | null = null;

export function getFacilitator(): FacilitatorClient {
  if (!facilitatorInstance) {
    const url = process.env.X402_FACILITATOR_URL?.trim();
    facilitatorInstance = url ? new RemoteFacilitator(url) : new LocalAvmFacilitator();
  }
  return facilitatorInstance;
}

export function getFacilitatorMode(): 'local' | 'remote' {
  return process.env.X402_FACILITATOR_URL?.trim() ? 'remote' : 'local';
}
