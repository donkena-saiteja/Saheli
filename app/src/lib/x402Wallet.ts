/**
 * Browser-side x402 client for wallet-signed resources.
 *
 * This is a real x402 client, not a wrapper around a server-side shortcut: the
 * browser receives the `PaymentRequirements`, gets the payment signed by the
 * user's own Pera wallet, constructs the `X-PAYMENT` header itself, and retries
 * the gated request. The server only ever sees a header it must independently
 * verify and settle.
 *
 * The one thing the browser does NOT do is choose the receiver or the amount —
 * the unsigned transaction is built server-side from the hardcoded receiver, so
 * a tampered client can only produce a payment the facilitator will reject.
 * (`verify` returns `invalid_receiver` / `insufficient_amount`; there is a test
 * for exactly this in backend/scripts/verify-x402-loan-gate.js.)
 */

import { x402Api } from './api';
import { signPayment } from './pera';

export type WalletResourceId = 'loan-request' | 'loan-approval';

/** Where we are in the 402 loop, for the live protocol panel. */
export type X402StepId = 'challenge' | 'build' | 'sign' | 'settle' | 'unlock';
export type X402StepStatus = 'pending' | 'active' | 'done' | 'failed';

export interface X402Step {
  id: X402StepId;
  label: string;
  detail?: string;
  status: X402StepStatus;
}

export const X402_STEP_TEMPLATE: X402Step[] = [
  { id: 'challenge', label: 'HTTP 402 Payment Required', status: 'pending' },
  { id: 'build', label: 'Server builds the Algorand payment', status: 'pending' },
  { id: 'sign', label: 'Pera Wallet signs on your device', status: 'pending' },
  { id: 'settle', label: 'Facilitator verifies & settles on-chain', status: 'pending' },
  { id: 'unlock', label: 'Resource unlocked', status: 'pending' },
];

export interface PreparedX402 {
  /** Ready for the `X-PAYMENT` header on the retried request. */
  paymentHeader: string;
  txId: string;
  payer: string;
  payTo: string;
  amountAlgos: number;
  displayPrice: string;
  assetSymbol: string;
  explorerPayTo: string;
  challenge: unknown;
}

export interface PayWithPeraOptions {
  resourceId: WalletResourceId;
  payerAddress: string;
  context?: Record<string, unknown>;
  /** Called on every protocol transition so the UI can narrate it live. */
  onStep?: (id: X402StepId, status: X402StepStatus, detail?: string) => void;
}

/**
 * Runs the client half of the 402 loop and returns the header that unlocks the
 * resource. Deliberately stops short of calling the gated route: the caller
 * owns that request (its body, its error handling), and passing the header in
 * keeps the payment and the action in one atomic user gesture.
 */
export async function payWithPera(options: PayWithPeraOptions): Promise<PreparedX402> {
  const { resourceId, payerAddress, context, onStep } = options;

  // ── 1 + 2. Challenge, and the payment that satisfies it ──
  onStep?.('challenge', 'active');
  onStep?.('build', 'active');

  let prepared;
  try {
    prepared = await x402Api.walletPrepare({ resourceId, payerAddress, context });
  } catch (err) {
    onStep?.('challenge', 'failed');
    onStep?.('build', 'failed', (err as Error).message);
    throw err;
  }

  const requirement = (prepared.challenge as { accepts?: Array<Record<string, unknown>> })?.accepts?.[0];
  onStep?.(
    'challenge',
    'done',
    `${prepared.displayPrice} · ${String(requirement?.scheme ?? 'exact')} · ${String(
      requirement?.network ?? '',
    )}`,
  );
  onStep?.('build', 'done', `Pay ${prepared.amountAlgos} ALGO to ${shorten(prepared.payTo)}`);

  // ── 3. Signature, on the user's device ──
  onStep?.('sign', 'active', 'Approve the payment in Pera Wallet');
  let signedTxn: string;
  try {
    signedTxn = await signPayment(prepared.unsignedTxn, payerAddress);
  } catch (err) {
    onStep?.('sign', 'failed');
    throw err;
  }
  onStep?.('sign', 'done', `Signed by ${shorten(payerAddress)}`);

  // ── 4. The header the gated route will verify and settle ──
  const paymentHeader = encodePaymentHeader({
    x402Version: 2,
    accepted: prepared.requirements,
    resource: {
      url: prepared.resourceId,
      description: prepared.description,
      mimeType: 'application/json',
    },
    payload: { paymentGroup: [signedTxn], paymentIndex: 0 },
  });

  onStep?.('settle', 'active', 'Broadcasting to Algorand TestNet…');

  return {
    paymentHeader,
    txId: prepared.txId,
    payer: payerAddress,
    payTo: prepared.payTo,
    amountAlgos: prepared.amountAlgos,
    displayPrice: prepared.displayPrice,
    assetSymbol: prepared.assetSymbol,
    explorerPayTo: prepared.explorerPayTo,
    challenge: prepared.challenge,
  };
}

/** base64(JSON) — the `X-PAYMENT` encoding from the x402 spec. */
function encodePaymentHeader(payload: unknown): string {
  const json = JSON.stringify(payload);
  // btoa is latin1-only; the payload is base64 + ASCII JSON, but encode defensively.
  const bytes = new TextEncoder().encode(json);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/** Reads the `X-PAYMENT-RESPONSE` receipt the server attaches after settling. */
export function decodePaymentResponse(header: string | null): {
  success: boolean;
  payer?: string;
  transaction?: string;
  network?: string;
} | null {
  if (!header) return null;
  try {
    return JSON.parse(atob(header));
  } catch {
    return null;
  }
}

function shorten(address: string): string {
  return address.length > 14 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}
