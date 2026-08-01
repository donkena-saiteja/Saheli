/**
 * Wallet-signed x402: the member's or leader's own Pera wallet pays the 402.
 *
 * The other payer in this codebase (`payer.ts`) signs with a server-held key on
 * behalf of an institution. That is right for machine-to-machine calls, but it
 * cannot be the story for a loan: the whole point is that *the person* settles
 * a real payment from a wallet only they control, before the loan moves.
 *
 * Flow, and why it is split this way:
 *
 *   1. `prepareWalletPayment` — the SERVER builds the unsigned payment. The
 *      browser therefore cannot alter the receiver or the amount; it can only
 *      approve or refuse what the server already committed to. The receiver is
 *      the hardcoded X402_LOAN_RECEIVER, never client input.
 *   2. Pera signs it on the user's device. No key ever reaches us.
 *   3. The client wraps the signed blob in an `X-PAYMENT` header and retries
 *      the gated route, exactly as an x402 client is supposed to. The
 *      facilitator then verifies and broadcasts it.
 *
 * The group is one self-funded transaction: the payer covers their own fee, so
 * this path keeps working even when the relayer is empty.
 */

import algosdk from 'algosdk';
import type { PaymentPayload, PaymentRequirements } from '@x402/core/types';
import {
  explorerAccountUrl,
  explorerTxUrl,
  getAlgodClient,
  getNetwork,
} from '../services/algorand';
import { X402_VERSION, SCHEME_EXACT } from './facilitator';
import {
  NATIVE_ALGO_ASSET,
  PRICED_RESOURCES,
  ResourceId,
  getAssetSymbol,
  getLoanReceiverAddress,
  isWalletSignedResource,
} from './pricing';

/** Algorand refuses to leave any account holding less than 0.1 ALGO. */
const MIN_ACCOUNT_BALANCE = 100_000;
const TXN_FEE = 1_000;

function validationError(message: string, extra?: Record<string, unknown>): Error {
  return Object.assign(new Error(message), { name: 'ValidationError', ...extra });
}

/** Live balance. A 404 from algod means "never funded", not "outage". */
async function readBalance(address: string): Promise<number> {
  try {
    const info: any = await getAlgodClient().accountInformation(address).do();
    return Number(info?.amount ?? 0);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/404|no accounts found|account does not exist/i.test(message)) return 0;
    throw validationError(
      `Could not reach Algorand ${getNetwork()} to check ${address.slice(0, 8)}…. ` +
        'Check your connection and retry.',
    );
  }
}

export interface WalletPaymentContext {
  /** Which loan / approval this payment unlocks, for the on-chain note. */
  loanId?: string;
  memberId?: string;
  memberName?: string;
  actionId?: string;
  amountInr?: number;
  purpose?: string;
}

export interface PreparedWalletPayment {
  resourceId: ResourceId;
  /** Base64 msgpack of the unsigned payment, ready for Pera's signer. */
  unsignedTxn: string;
  txId: string;
  /** Echoed back so the client can build a spec-shaped X-PAYMENT header. */
  requirements: PaymentRequirements;
  payer: string;
  payTo: string;
  amountAtomic: string;
  amountAlgos: number;
  assetSymbol: string;
  displayPrice: string;
  description: string;
  network: string;
  validUntilRound: number;
  explorerPayer: string;
  explorerPayTo: string;
  note: string;
}

/**
 * Builds the unsigned x402 payment for a wallet-signed resource.
 *
 * Both accounts are pre-flighted here so the user is never asked to approve
 * something in Pera that the network will then refuse — a rejection after
 * signing is the single worst thing that can happen in a live demo.
 */
export async function prepareWalletPayment(args: {
  resourceId: ResourceId;
  payerAddress: string;
  requirements: PaymentRequirements;
  context?: WalletPaymentContext;
}): Promise<PreparedWalletPayment> {
  const { resourceId, payerAddress, requirements, context } = args;
  const resource = PRICED_RESOURCES[resourceId];

  if (!resource) throw validationError(`Unknown x402 resource: ${resourceId}`);
  if (!isWalletSignedResource(resourceId)) {
    throw validationError(`${resourceId} is not a wallet-signed resource`);
  }
  if (!payerAddress || !algosdk.isValidAddress(payerAddress)) {
    throw validationError('Connect a Pera Wallet first — payerAddress is not a valid Algorand address.');
  }
  if (String(requirements.asset) !== NATIVE_ALGO_ASSET) {
    throw validationError('Wallet-signed x402 resources must settle in native ALGO.');
  }

  const payTo = getLoanReceiverAddress();
  if (payTo !== requirements.payTo) {
    throw validationError('Receiver mismatch between the challenge and the hardcoded receiver.');
  }
  if (payTo === payerAddress) {
    throw validationError(
      'This wallet is the configured x402 receiver, so it cannot pay itself. Sign in with a different Pera account.',
    );
  }

  const amount = Number(requirements.amount);
  const [payerBalance, receiverBalance] = await Promise.all([
    readBalance(payerAddress),
    readBalance(payTo),
  ]);

  // ── Payer must cover amount + fee + its own 0.1 ALGO floor ──
  const required = amount + TXN_FEE + MIN_ACCOUNT_BALANCE;
  if (payerBalance < required) {
    throw validationError(
      `This x402 payment needs ${(required / 1e6).toFixed(4)} ALGO ` +
        `(${(amount / 1e6).toFixed(4)} fee + network fee + Algorand's 0.1 ALGO minimum balance) but ` +
        `${payerAddress.slice(0, 8)}… holds ${(payerBalance / 1e6).toFixed(4)} ALGO. ` +
        'Top up free at https://bank.testnet.algorand.network and try again.',
      { dispenser: 'https://bank.testnet.algorand.network', payerBalance },
    );
  }

  // ── Receiver must not be left below the floor by this payment ──
  if (receiverBalance + amount < MIN_ACCOUNT_BALANCE) {
    throw validationError(
      `The x402 receiver ${payTo.slice(0, 8)}… has never been funded, and ${(amount / 1e6).toFixed(4)} ALGO ` +
        "would leave it under Algorand's 0.1 ALGO account minimum, so the network would reject the payment. " +
        'Send that address 0.1 ALGO once at https://bank.testnet.algorand.network.',
      { dispenser: 'https://bank.testnet.algorand.network', receiverBalance },
    );
  }

  const suggestedParams = await getAlgodClient().getTransactionParams().do();

  // The note is the audit trail: it ties this exact on-chain payment to the
  // loan it unlocked, so a judge scanning the explorer sees *why* it happened.
  const notePayload = {
    app: 'saheli-shg-chain',
    protocol: 'x402',
    v: X402_VERSION,
    scheme: SCHEME_EXACT,
    resource: resourceId,
    payerType: resource.payerType,
    ...(context || {}),
    ts: new Date().toISOString(),
  };
  const noteText = JSON.stringify(notePayload);

  const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender: payerAddress,
    receiver: payTo,
    amount,
    note: new Uint8Array(Buffer.from(noteText).subarray(0, 1000)),
    suggestedParams,
  });

  return {
    resourceId,
    unsignedTxn: Buffer.from(algosdk.encodeUnsignedTransaction(txn)).toString('base64'),
    txId: txn.txID(),
    requirements,
    payer: payerAddress,
    payTo,
    amountAtomic: requirements.amount,
    amountAlgos: Number((amount / 1e6).toFixed(6)),
    assetSymbol: getAssetSymbol(resourceId),
    displayPrice: resource.displayPrice,
    description: resource.description,
    network: getNetwork(),
    validUntilRound: Number(suggestedParams.lastValid ?? 0),
    explorerPayer: explorerAccountUrl(payerAddress),
    explorerPayTo: explorerAccountUrl(payTo),
    note: noteText,
  };
}

/**
 * Wraps a Pera-signed payment into the x402 payload the facilitator expects.
 *
 * A single-transaction group with `paymentIndex: 0` — valid under the exact
 * scheme, and the simplest thing that can possibly settle.
 */
export function buildWalletPaymentPayload(args: {
  signedTxn: string;
  requirements: PaymentRequirements;
  resourceUrl?: string;
  description?: string;
}): PaymentPayload {
  return {
    x402Version: X402_VERSION,
    resource: args.resourceUrl
      ? { url: args.resourceUrl, description: args.description, mimeType: 'application/json' }
      : undefined,
    accepted: args.requirements,
    payload: {
      paymentGroup: [args.signedTxn],
      paymentIndex: 0,
    },
  };
}

/** Status of the hardcoded receiver, so the UI can prove where the money goes. */
export async function getReceiverStatus() {
  const address = getLoanReceiverAddress();
  const balance = await readBalance(address).catch(() => 0);

  return {
    address,
    network: getNetwork(),
    microAlgos: balance,
    algos: Number((balance / 1e6).toFixed(6)),
    funded: balance >= MIN_ACCOUNT_BALANCE,
    explorerUrl: explorerAccountUrl(address),
    dispenser: getNetwork() === 'testnet' ? 'https://bank.testnet.algorand.network' : undefined,
    hardcoded: !process.env.X402_LOAN_PAY_TO?.trim(),
  };
}

export { explorerTxUrl };
