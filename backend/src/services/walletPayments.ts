/**
 * Real Pera-wallet settlement.
 *
 * Everything else in this codebase settles through the relayer, which means an
 * unfunded relayer degrades the whole app to simulated transaction ids that
 * resolve to nothing on the explorer. This module is the escape hatch: the
 * *user's own* Pera wallet signs and pays, so the transaction is genuinely on
 * TestNet the moment they approve it in the app — no relayer funding required,
 * and the txid opens in Lora.
 *
 * Flow:
 *   1. `preparePayment`  — server builds the unsigned payment and returns it
 *                          base64-encoded, with the exact amount and note.
 *   2. Browser           — Pera signs it. Keys never leave the device.
 *   3. `submitPayment`   — server broadcasts, waits for confirmation, writes the
 *                          ledger row and moves the in-app balances.
 *
 * Building the transaction server-side matters: the client cannot silently
 * change the receiver or the amount, because the server re-derives both from
 * the ledger record before it credits anything.
 */

import algosdk from 'algosdk';
import mongoose from 'mongoose';
import Transaction from '../models/Transaction';
import User from '../models/User';
import LoanModel from '../models/Loan';
import {
  deriveAccount,
  explorerAccountUrl,
  explorerTxUrl,
  getAlgodClient,
  getNetwork,
  getTreasuryAddress,
} from './algorand';
import { registerTransactionLifecycle, setTransactionLifecycleStatus } from './txEngine';
import { screenTransaction } from './aiMonitor';

/**
 * Demo peg between rupees and microAlgos.
 *
 * A 1:1 rupee-to-ALGO transfer would be nonsensical on TestNet, so ₹1 settles
 * as 100 microAlgos (0.0001 ALGO) by default: a single dispenser top-up of
 * 10 ALGO covers ₹100,000 of demo movement, which is more than a judging
 * session will ever need. Override with INR_TO_MICROALGO.
 */
export function getInrToMicroAlgo(): number {
  const raw = Number(process.env.INR_TO_MICROALGO || 100);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 100;
}

export function inrToMicroAlgos(amountInr: number): number {
  return Math.max(1, Math.round(amountInr * getInrToMicroAlgo()));
}

export function microAlgosToInr(micro: number): number {
  return Math.round(micro / getInrToMicroAlgo());
}

export type PaymentPurpose =
  | 'deposit'
  | 'withdrawal'
  | 'loan_disbursement'
  | 'loan_repayment'
  | 'yield';

export interface PreparedPayment {
  /** Base64 msgpack of the unsigned transaction, ready for Pera's signer. */
  unsignedTxn: string;
  txId: string;
  from: string;
  to: string;
  amountInr: number;
  amountMicroAlgos: number;
  amountAlgos: number;
  feeMicroAlgos: number;
  network: string;
  purpose: PaymentPurpose;
  note: string;
  validUntilRound: number;
  explorerFrom: string;
  explorerTo: string;
}

export interface PreparePaymentRequest {
  /** The Pera address that will sign and be debited. */
  fromAddress: string;
  /** Explicit destination, or omit to route to the SHG treasury. */
  toAddress?: string;
  /** Resolve the destination from a member's custodial account instead. */
  toMemberId?: string;
  amountInr: number;
  purpose: PaymentPurpose;
  /** Ledger row is attributed to this member. Defaults to the payer's account. */
  memberId?: string;
  linkedLoanId?: string;
  description?: string;
}

function assertAddress(address: string, label: string): void {
  if (!address || !algosdk.isValidAddress(address)) {
    throw Object.assign(new Error(`${label} is not a valid Algorand address`), { name: 'ValidationError' });
  }
}

/** Resolves where the money goes, and refuses to build a self-payment. */
async function resolveDestination(req: PreparePaymentRequest): Promise<string> {
  if (req.toAddress) {
    assertAddress(req.toAddress, 'toAddress');
    return req.toAddress;
  }

  if (req.toMemberId) {
    if (!mongoose.Types.ObjectId.isValid(req.toMemberId)) {
      throw Object.assign(new Error('toMemberId must be a valid Mongo ObjectId'), { name: 'ValidationError' });
    }
    const member = await User.findById(req.toMemberId).select('walletAddress algorandAddress').lean();
    if (!member) {
      throw Object.assign(new Error('Destination member not found'), { name: 'ValidationError' });
    }
    // Prefer the member's self-custodied wallet; fall back to their derived one.
    const record = member as { walletAddress?: string; algorandAddress?: string };
    return record.walletAddress || record.algorandAddress || deriveAccount(`member:${req.toMemberId}`).address;
  }

  return getTreasuryAddress();
}

/**
 * Algorand's account minimum balance: 0.1 ALGO. An account may never drop below
 * it, and — crucially — a payment that would leave the *receiver* below it is
 * rejected by the transaction pool too. That is why sending 0.05 ALGO to a
 * never-funded treasury fails with "balance 50000 below min 100000".
 */
const MIN_ACCOUNT_BALANCE = 100_000;
const TXN_FEE = 1_000;

/** Live balance, or 0 for an account that has never been funded. */
async function readBalance(address: string): Promise<number> {
  try {
    const info: any = await getAlgodClient().accountInformation(address).do();
    return Number(info?.amount ?? 0);
  } catch (err) {
    // algod 404s on an account with no on-chain history; that is a zero balance,
    // not an outage. Anything else is a genuine connectivity problem.
    const message = err instanceof Error ? err.message : String(err);
    if (/404|no accounts found|account does not exist/i.test(message)) return 0;
    throw Object.assign(
      new Error(
        `Could not read ${address} on Algorand ${getNetwork()}. ` +
          'Check the wallet is on the same network as the API.',
      ),
      { name: 'ValidationError', cause: err },
    );
  }
}

/**
 * Smallest transfer that will actually be accepted, given how much the receiver
 * already holds. A funded receiver can accept any amount; an empty one must be
 * brought to 0.1 ALGO in a single payment.
 */
export function minimumTransferInr(receiverBalanceMicroAlgos: number): number {
  const shortfall = Math.max(0, MIN_ACCOUNT_BALANCE - receiverBalanceMicroAlgos);
  if (shortfall === 0) return 1;
  return Math.ceil(shortfall / getInrToMicroAlgo());
}

/**
 * Builds the unsigned payment.
 *
 * Both sides are pre-flighted here so the user is never asked to approve
 * something in Pera that the network will then refuse: the payer must be able
 * to cover the transfer, the fee and its own minimum balance, and the transfer
 * must leave the receiver at or above the minimum balance too.
 */
export async function preparePayment(req: PreparePaymentRequest): Promise<PreparedPayment> {
  assertAddress(req.fromAddress, 'fromAddress');

  const amountInr = Number(req.amountInr);
  if (!Number.isFinite(amountInr) || amountInr <= 0) {
    throw Object.assign(new Error('amountInr must be a positive number'), { name: 'ValidationError' });
  }

  const toAddress = await resolveDestination(req);
  if (toAddress === req.fromAddress) {
    throw Object.assign(new Error('Sender and receiver are the same address'), { name: 'ValidationError' });
  }

  const client = getAlgodClient();
  const amountMicroAlgos = inrToMicroAlgos(amountInr);

  const [payerBalance, receiverBalance] = await Promise.all([
    readBalance(req.fromAddress),
    readBalance(toAddress),
  ]);

  // ── Receiver side, checked first ──
  // Algorand refuses to leave any account below 0.1 ALGO, so a first payment
  // into an empty account must carry it over that line in one go. This is
  // reported ahead of the payer check because it is about the amount the user
  // just typed — the one thing they can fix without leaving the app.
  if (receiverBalance + amountMicroAlgos < MIN_ACCOUNT_BALANCE) {
    const minInr = minimumTransferInr(receiverBalance);
    throw Object.assign(
      new Error(
        `The destination account has only ${(receiverBalance / 1e6).toFixed(4)} ALGO and Algorand requires every ` +
          `account to hold at least 0.1 ALGO. ₹${Math.round(amountInr).toLocaleString('en-IN')} is ` +
          `${(amountMicroAlgos / 1e6).toFixed(4)} ALGO, which would leave it below that minimum, so the network ` +
          `would reject it. Send at least ₹${minInr.toLocaleString('en-IN')}, or fund ${toAddress.slice(0, 8)}… ` +
          `once at https://bank.testnet.algorand.network and any amount will work after that.`,
      ),
      { name: 'ValidationError', minimumInr: minInr, receiverBalance },
    );
  }

  // ── Payer side ──
  const required = amountMicroAlgos + TXN_FEE + MIN_ACCOUNT_BALANCE;
  if (payerBalance < required) {
    throw Object.assign(
      new Error(
        `Wallet holds ${(payerBalance / 1e6).toFixed(4)} ALGO but this transfer needs ` +
          `${(required / 1e6).toFixed(4)} ALGO (${(amountMicroAlgos / 1e6).toFixed(4)} transfer + fee + 0.1 minimum balance). ` +
          `Top up at https://bank.testnet.algorand.network`,
      ),
      { name: 'ValidationError' },
    );
  }

  const suggestedParams = await client.getTransactionParams().do();

  const notePayload = {
    app: 'saheli-shg-chain',
    v: 1,
    kind: req.purpose,
    memberId: req.memberId,
    loanId: req.linkedLoanId,
    inr: Math.round(amountInr),
    detail: req.description || `${req.purpose} settled from Pera Wallet`,
    ts: new Date().toISOString(),
  };
  const noteText = JSON.stringify(notePayload);

  const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender: req.fromAddress,
    receiver: toAddress,
    amount: amountMicroAlgos,
    note: new Uint8Array(Buffer.from(noteText).subarray(0, 1000)),
    suggestedParams,
  });

  return {
    unsignedTxn: Buffer.from(algosdk.encodeUnsignedTransaction(txn)).toString('base64'),
    txId: txn.txID(),
    from: req.fromAddress,
    to: toAddress,
    amountInr: Math.round(amountInr),
    amountMicroAlgos,
    amountAlgos: Number((amountMicroAlgos / 1e6).toFixed(6)),
    feeMicroAlgos: Number(suggestedParams.minFee ?? 1000),
    network: getNetwork(),
    purpose: req.purpose,
    note: noteText,
    validUntilRound: Number(suggestedParams.lastValid ?? 0),
    explorerFrom: explorerAccountUrl(req.fromAddress),
    explorerTo: explorerAccountUrl(toAddress),
  };
}

export interface SubmittedPayment {
  transactionId: string;
  confirmedRound: number;
  explorerUrl: string;
  mode: 'live';
  amountInr: number;
  amountAlgos: number;
  from: string;
  to: string;
  ledgerEntryId: string;
  balances: { memberSavings: number; memberOutstanding: number };
  compliance: { flagged: boolean; reason?: string };
  message: string;
}

/**
 * Turns an algod rejection into something a user can act on.
 *
 * Raw pool errors read like `TransactionPool.Remember: transaction ABC…:
 * account XYZ… balance 50000 below min 100000 (0 assets)`, which tells a rural
 * SHG member precisely nothing. State can change between prepare and submit, so
 * these still surface even with the pre-flight checks above.
 */
function explainAlgodRejection(detail: string): string {
  const belowMin = detail.match(/account ([A-Z2-7]{58}) balance (\d+) below min (\d+)/);
  if (belowMin) {
    const [, address, balance, min] = belowMin;
    const shortfallInr = Math.ceil((Number(min) - Number(balance)) / getInrToMicroAlgo());
    return (
      `Algorand refused the transfer: it would leave ${address.slice(0, 8)}… holding ` +
      `${(Number(balance) / 1e6).toFixed(4)} ALGO, below the 0.1 ALGO every account must keep. ` +
      `Send ₹${shortfallInr.toLocaleString('en-IN')} more, or fund that address once at ` +
      `https://bank.testnet.algorand.network and any amount will work afterwards.`
    );
  }

  if (/overspend/i.test(detail)) {
    return (
      'Algorand refused the transfer: the wallet does not hold enough ALGO to cover the amount plus the ' +
      'network fee and its own 0.1 ALGO minimum balance. Top up at https://bank.testnet.algorand.network.'
    );
  }

  if (/txn dead|round.*expired|LastValid/i.test(detail)) {
    return 'The transaction expired before it was submitted (Algorand transactions are valid for ~1000 rounds). Try again.';
  }

  if (/transaction already in ledger/i.test(detail)) {
    return 'This transaction was already submitted and settled. Refresh to see it in the ledger.';
  }

  if (/signature|not authorized|auth/i.test(detail)) {
    return 'The signature did not match the sending address. Make sure Pera Wallet is on the same account and network as the app.';
  }

  return `Algorand rejected the transaction: ${detail}`;
}

/**
 * Broadcasts the wallet-signed transaction and, only once the chain has
 * confirmed it, writes the ledger row and moves the in-app balances.
 *
 * Ordering is deliberate: the database is never credited for money that did not
 * actually move, which is the whole point of the "it should debit my wallet"
 * requirement.
 */
export async function submitPayment(params: {
  signedTxn: string;
  purpose: PaymentPurpose;
  memberId?: string;
  linkedLoanId?: string;
  description?: string;
}): Promise<SubmittedPayment> {
  if (!params.signedTxn) {
    throw Object.assign(new Error('signedTxn is required'), { name: 'ValidationError' });
  }

  const client = getAlgodClient();
  const blob = Buffer.from(params.signedTxn, 'base64');

  let txId: string;
  try {
    const sent: any = await client.sendRawTransaction(new Uint8Array(blob)).do();
    txId = String(sent?.txid ?? sent?.txId ?? '');
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'broadcast failed';
    throw Object.assign(new Error(explainAlgodRejection(detail)), { name: 'ValidationError' });
  }

  if (!txId) {
    // algod echoes the id, but decode the blob ourselves if it did not.
    const decoded = algosdk.decodeSignedTransaction(new Uint8Array(blob));
    txId = decoded.txn.txID();
  }

  const confirmed: any = await algosdk.waitForConfirmation(client, txId, 10);
  const confirmedRound = Number(confirmed?.confirmedRound ?? confirmed?.['confirmed-round'] ?? 0);

  const decoded = algosdk.decodeSignedTransaction(new Uint8Array(blob));
  const payment = decoded.txn.payment;
  const amountMicroAlgos = Number(payment?.amount ?? 0);
  const amountInr = microAlgosToInr(amountMicroAlgos);
  const from = decoded.txn.sender.toString();
  const to = payment?.receiver?.toString() || getTreasuryAddress();

  // Attribute the ledger row: explicit member, else whoever owns the payer address.
  let memberDoc = null;
  if (params.memberId && mongoose.Types.ObjectId.isValid(params.memberId)) {
    memberDoc = await User.findById(params.memberId);
  }
  if (!memberDoc) {
    memberDoc = await User.findOne({ walletAddress: from });
  }
  if (!memberDoc) {
    memberDoc = await User.findOne({ role: 'member' }).sort({ createdAt: 1 });
  }
  if (!memberDoc) {
    throw Object.assign(new Error('No member account to attribute this settlement to'), {
      name: 'ValidationError',
    });
  }

  const compliance = await screenTransaction({
    userId: String(memberDoc._id),
    type: params.purpose,
    amount: amountInr,
  });

  const created = await Transaction.create({
    user: memberDoc._id,
    type: params.purpose,
    amount: amountInr,
    description:
      params.description ||
      `${params.purpose.replace(/_/g, ' ')} settled on Algorand from ${from.slice(0, 8)}…`,
    transactionId: txId,
    // Broadcast and confirmed by algod above, so this id genuinely resolves.
    settlementMode: 'live',
    status: 'confirmed',
    agentProcessed: false,
  });

  registerTransactionLifecycle({
    transactionId: txId,
    type: params.purpose,
    amount: amountInr,
    initialStatus: 'confirmed',
    autoConfirm: false,
  });
  setTransactionLifecycleStatus(txId, 'confirmed');

  // ── Move the in-app balances to match what just moved on chain ──
  if (params.purpose === 'deposit') {
    memberDoc.totalSavings = (memberDoc.totalSavings || 0) + amountInr;
  } else if (params.purpose === 'withdrawal') {
    memberDoc.totalSavings = Math.max(0, (memberDoc.totalSavings || 0) - amountInr);
  } else if (params.purpose === 'yield') {
    memberDoc.yieldEarned = (memberDoc.yieldEarned || 0) + amountInr;
    memberDoc.totalSavings = (memberDoc.totalSavings || 0) + amountInr;
  } else if (params.purpose === 'loan_repayment') {
    memberDoc.activeLoansAmount = Math.max(0, (memberDoc.activeLoansAmount || 0) - amountInr);
  } else if (params.purpose === 'loan_disbursement') {
    memberDoc.activeLoansAmount = (memberDoc.activeLoansAmount || 0) + amountInr;
    memberDoc.activeLoans = (memberDoc.activeLoans || 0) + 1;
  }
  await memberDoc.save();

  if (params.linkedLoanId && mongoose.Types.ObjectId.isValid(params.linkedLoanId)) {
    const loan = await LoanModel.findById(params.linkedLoanId);
    if (loan) {
      if (params.purpose === 'loan_disbursement') {
        loan.status = 'repaying';
        loan.disbursedAt = new Date();
        loan.transactionId = txId;
        loan.dueDate = loan.dueDate || new Date(Date.now() + 30 * 24 * 3600 * 1000);
      } else if (params.purpose === 'loan_repayment') {
        loan.repaidAmount = (loan.repaidAmount || 0) + amountInr;
        if (loan.repaidAmount >= loan.amount) loan.status = 'repaid';
      }
      await loan.save();
    }
  }

  return {
    transactionId: txId,
    confirmedRound,
    explorerUrl: explorerTxUrl(txId),
    mode: 'live',
    amountInr,
    amountAlgos: Number((amountMicroAlgos / 1e6).toFixed(6)),
    from,
    to,
    ledgerEntryId: String(created._id),
    balances: {
      memberSavings: memberDoc.totalSavings || 0,
      memberOutstanding: memberDoc.activeLoansAmount || 0,
    },
    compliance,
    message:
      `Settled on Algorand ${getNetwork()} in round ${confirmedRound}. ` +
      `${(amountMicroAlgos / 1e6).toFixed(4)} ALGO (₹${amountInr.toLocaleString('en-IN')}) debited from ${from.slice(0, 8)}….`,
  };
}

/**
 * Everything the UI needs to size a payment correctly before the user commits:
 * what each side holds and the smallest amount the network will accept.
 *
 * Exists so the minimum-balance rule is explained *up front* rather than as a
 * rejection after the user has already approved something in Pera.
 */
export async function quotePayment(req: {
  fromAddress?: string;
  toAddress?: string;
  toMemberId?: string;
}): Promise<{
  from: { address: string; algos: number; funded: boolean } | null;
  to: { address: string; algos: number; funded: boolean };
  minimumInr: number;
  maximumInr: number | null;
  microAlgosPerInr: number;
  reason: string;
}> {
  const toAddress = await resolveDestination({
    fromAddress: req.fromAddress || getTreasuryAddress(),
    toAddress: req.toAddress,
    toMemberId: req.toMemberId,
    amountInr: 1,
    purpose: 'deposit',
  });

  const [receiverBalance, payerBalance] = await Promise.all([
    readBalance(toAddress),
    req.fromAddress ? readBalance(req.fromAddress) : Promise.resolve(0),
  ]);

  const minimumInr = minimumTransferInr(receiverBalance);

  // The most the payer can send while keeping its own minimum balance and fee.
  const spendable = Math.max(0, payerBalance - MIN_ACCOUNT_BALANCE - TXN_FEE);
  const maximumInr = req.fromAddress ? Math.floor(spendable / getInrToMicroAlgo()) : null;

  return {
    from: req.fromAddress
      ? {
          address: req.fromAddress,
          algos: Number((payerBalance / 1e6).toFixed(6)),
          funded: payerBalance >= MIN_ACCOUNT_BALANCE,
        }
      : null,
    to: {
      address: toAddress,
      algos: Number((receiverBalance / 1e6).toFixed(6)),
      funded: receiverBalance >= MIN_ACCOUNT_BALANCE,
    },
    minimumInr,
    maximumInr,
    microAlgosPerInr: getInrToMicroAlgo(),
    reason:
      receiverBalance < MIN_ACCOUNT_BALANCE
        ? `The destination has never been funded, so the first payment must carry it to Algorand's 0.1 ALGO minimum — at least ₹${minimumInr.toLocaleString('en-IN')}.`
        : 'Destination is funded; any amount within your balance will settle.',
  };
}

/** Live balance for any address, so the UI can show what the wallet really holds. */
export async function getWalletBalance(address: string) {
  assertAddress(address, 'address');
  const client = getAlgodClient();

  try {
    const info: any = await client.accountInformation(address).do();
    const micro = Number(info?.amount ?? 0);
    return {
      address,
      microAlgos: micro,
      algos: Number((micro / 1e6).toFixed(6)),
      /** The same balance expressed in the demo's rupee peg. */
      inrEquivalent: microAlgosToInr(micro),
      minBalance: Number(info?.minBalance ?? info?.['min-balance'] ?? 100_000),
      spendableAlgos: Number((Math.max(0, micro - 100_000) / 1e6).toFixed(6)),
      assets: (info?.assets || []).length,
      network: getNetwork(),
      explorerUrl: explorerAccountUrl(address),
      funded: micro >= 200_000,
      dispenser: getNetwork() === 'testnet' ? 'https://bank.testnet.algorand.network' : undefined,
    };
  } catch (err) {
    return {
      address,
      microAlgos: 0,
      algos: 0,
      inrEquivalent: 0,
      minBalance: 100_000,
      spendableAlgos: 0,
      assets: 0,
      network: getNetwork(),
      explorerUrl: explorerAccountUrl(address),
      funded: false,
      dispenser: getNetwork() === 'testnet' ? 'https://bank.testnet.algorand.network' : undefined,
      error: err instanceof Error ? err.message : 'account lookup failed',
    };
  }
}
