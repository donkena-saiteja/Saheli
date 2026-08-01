/**
 * Algorand chain layer for SHG Chain (Saheli).
 *
 * Design goals, in priority order:
 *   1. Real on-chain settlement whenever credentials allow it.
 *   2. Never break a live demo. If the chain is unreachable or the relayer is
 *      unfunded we fall back to deterministic local anchoring and label it
 *      honestly as `simulated` in every API response.
 *   3. Gasless for members. The relayer pays every fee via Algorand fee
 *      pooling, so an SHG member never needs to hold ALGO or know it exists.
 *
 * Two settlement paths are supported:
 *   - `anchorLedgerEntry` writes a 0-amount payment carrying the ledger record
 *     in the transaction note. Real, cheap, needs no ASA opt-in, and yields a
 *     verifiable txid. This is the default and is what keeps the demo robust.
 *   - `transferAsset` moves the SHG-Rupee ASA between accounts for flows where
 *     actual token movement matters (x402 settlement, treasury payouts).
 */

import crypto from 'crypto';
import algosdk from 'algosdk';

// ─── Network configuration ───────────────────────────────────────────────────

export type ChainNetwork = 'testnet' | 'mainnet' | 'localnet';
export type ChainMode = 'live' | 'simulated';

const GENESIS_HASHES: Record<ChainNetwork, string> = {
  mainnet: 'wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=',
  testnet: 'SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=',
  localnet: '',
};

/**
 * CAIP-2 identifiers as defined by the Algorand namespace profile: the first
 * 32 characters of the url-safe base64 genesis hash. These must match
 * `@x402/avm`'s ALGORAND_*_CAIP2 constants exactly or x402 verification fails.
 */
const CAIP2_IDS: Record<ChainNetwork, string> = {
  mainnet: 'algorand:wGHE2Pwdvd7S12BL5FaOP20EGYesN73k',
  testnet: 'algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDe',
  localnet: 'algorand:localnet',
};

const DEFAULT_ALGOD: Record<ChainNetwork, string> = {
  mainnet: 'https://mainnet-api.algonode.cloud',
  testnet: 'https://testnet-api.algonode.cloud',
  localnet: 'http://localhost:4001',
};

const DEFAULT_INDEXER: Record<ChainNetwork, string> = {
  mainnet: 'https://mainnet-idx.algonode.cloud',
  testnet: 'https://testnet-idx.algonode.cloud',
  localnet: 'http://localhost:8980',
};

const EXPLORER_BASE: Record<ChainNetwork, string> = {
  mainnet: 'https://lora.algokit.io/mainnet',
  testnet: 'https://lora.algokit.io/testnet',
  localnet: 'https://lora.algokit.io/localnet',
};

export function getNetwork(): ChainNetwork {
  const raw = (process.env.ALGORAND_NETWORK || 'testnet').trim().toLowerCase();
  if (raw === 'mainnet' || raw === 'localnet') return raw;
  return 'testnet';
}

export function getCaip2Network(): string {
  return CAIP2_IDS[getNetwork()];
}

export function getGenesisHash(): string {
  return GENESIS_HASHES[getNetwork()];
}

/** Minimum fee in microAlgos. Also the per-transaction cost under normal load. */
export const MIN_FEE = 1000;

// ─── Clients ─────────────────────────────────────────────────────────────────

let algodClient: algosdk.Algodv2 | null = null;
let indexerClient: algosdk.Indexer | null = null;

export function getAlgodClient(): algosdk.Algodv2 {
  if (!algodClient) {
    const network = getNetwork();
    const server = (process.env.ALGOD_SERVER || DEFAULT_ALGOD[network]).replace(/\/$/, '');
    const token = process.env.ALGOD_TOKEN || (network === 'localnet' ? 'a'.repeat(64) : '');
    const port = process.env.ALGOD_PORT ? Number(process.env.ALGOD_PORT) : '';
    algodClient = new algosdk.Algodv2(token, server, port);
  }
  return algodClient;
}

export function getIndexerClient(): algosdk.Indexer {
  if (!indexerClient) {
    const network = getNetwork();
    const server = (process.env.INDEXER_SERVER || DEFAULT_INDEXER[network]).replace(/\/$/, '');
    const token = process.env.INDEXER_TOKEN || (network === 'localnet' ? 'a'.repeat(64) : '');
    const port = process.env.INDEXER_PORT ? Number(process.env.INDEXER_PORT) : '';
    indexerClient = new algosdk.Indexer(token, server, port);
  }
  return indexerClient;
}

// ─── Accounts ────────────────────────────────────────────────────────────────

export interface ChainAccount {
  address: string;
  signer: Uint8Array;
  mnemonic: string;
}

/**
 * Master seed used to derive every custodial account. Members never manage
 * keys; the platform derives their account deterministically so wallets are
 * reproducible across restarts without a key store.
 *
 * In production this belongs in a KMS/HSM. It is an explicit hackathon
 * trade-off, documented rather than hidden.
 */
function getMasterSeed(): Buffer {
  const configured = process.env.ALGORAND_MASTER_SEED;
  if (configured && configured.length >= 16) {
    return crypto.createHash('sha256').update(configured).digest();
  }
  // Stable across restarts so demo wallets keep their identity without config.
  return crypto.createHash('sha256').update('saheli-shg-chain-default-master-seed-v1').digest();
}

/**
 * Derives a deterministic Algorand account for any subject (a user id, an SHG
 * id, or a role label like `treasury`). Same subject always yields the same
 * address.
 */
export function deriveAccount(subject: string): ChainAccount {
  const seed = crypto
    .createHmac('sha512', getMasterSeed())
    .update(`algorand-account:${subject}`)
    .digest()
    .subarray(0, 32);

  const mnemonic = algosdk.mnemonicFromSeed(new Uint8Array(seed));
  const { addr, sk } = algosdk.mnemonicToSecretKey(mnemonic);
  return { address: addr.toString(), signer: sk, mnemonic };
}

/**
 * The relayer / treasury account. Pays every fee on behalf of members
 * (gasless meta-transactions) and custodies pooled SHG funds.
 */
export function getRelayerAccount(): ChainAccount {
  const mnemonic = process.env.ALGORAND_RELAYER_MNEMONIC?.trim();
  if (mnemonic) {
    const words = mnemonic.split(/\s+/).filter(Boolean);
    if (words.length === 25) {
      const { addr, sk } = algosdk.mnemonicToSecretKey(words.join(' '));
      return { address: addr.toString(), signer: sk, mnemonic: words.join(' ') };
    }
    console.warn('[algorand] ALGORAND_RELAYER_MNEMONIC must be 25 words; falling back to derived relayer.');
  }
  return deriveAccount('relayer:treasury');
}

export function getTreasuryAddress(): string {
  return (process.env.SHG_TREASURY_ADDRESS?.trim() || getRelayerAccount().address);
}

/** SHG-Rupee ASA id. 0 means "not configured", which routes flows to note anchoring. */
export function getShgAsaId(): number {
  const raw = Number(process.env.SHG_ASA_ID || 0);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
}

// ─── Explorer links ──────────────────────────────────────────────────────────

export function explorerTxUrl(txId: string): string {
  return `${EXPLORER_BASE[getNetwork()]}/transaction/${txId}`;
}

export function explorerAccountUrl(address: string): string {
  return `${EXPLORER_BASE[getNetwork()]}/account/${address}`;
}

export function explorerAssetUrl(assetId: number | string): string {
  return `${EXPLORER_BASE[getNetwork()]}/asset/${assetId}`;
}

// ─── Health / mode detection ─────────────────────────────────────────────────

interface HealthCache {
  mode: ChainMode;
  relayerBalance: number;
  round: number;
  checkedAt: number;
  reason?: string;
  /**
   * Whether algod answered at all — independent of relayer funding.
   *
   * `mode` conflates two very different failures: an unreachable node, and a
   * reachable node with a broke relayer. Flows where the *user's own wallet*
   * pays the fee (Pera-signed x402) do not care about the relayer, and must
   * still settle for real. They check this instead of `mode`.
   */
  reachable: boolean;
}

let healthCache: HealthCache | null = null;
const HEALTH_TTL_MS = 30_000;

/**
 * Live mode requires a reachable algod AND a relayer holding enough ALGO to
 * pay fees. Anything else degrades to simulated so the product keeps working.
 */
export async function getChainHealth(force = false): Promise<HealthCache> {
  if (!force && healthCache && Date.now() - healthCache.checkedAt < HEALTH_TTL_MS) {
    return healthCache;
  }

  if ((process.env.ALGORAND_FORCE_SIMULATION || '').toLowerCase() === 'true') {
    healthCache = {
      mode: 'simulated',
      relayerBalance: 0,
      round: 0,
      checkedAt: Date.now(),
      reason: 'ALGORAND_FORCE_SIMULATION=true',
      reachable: false,
    };
    return healthCache;
  }

  try {
    const client = getAlgodClient();
    const relayer = getRelayerAccount();

    const status = await withTimeout(client.status().do(), 6000);
    const info = await withTimeout(client.accountInformation(relayer.address).do(), 6000);

    const balance = Number(info.amount ?? 0);
    // Need headroom above the 0.1 ALGO minimum balance to actually pay fees.
    const fundedEnough = balance >= 200_000;

    healthCache = {
      mode: fundedEnough ? 'live' : 'simulated',
      relayerBalance: balance,
      round: Number(status.lastRound ?? 0),
      checkedAt: Date.now(),
      reason: fundedEnough
        ? undefined
        : `Relayer ${relayer.address} holds ${balance} microAlgos. Fund it at https://bank.testnet.algorand.network to enable live settlement.`,
      reachable: true,
    };
  } catch (err) {
    healthCache = {
      mode: 'simulated',
      relayerBalance: 0,
      round: 0,
      checkedAt: Date.now(),
      reason: err instanceof Error ? `algod unreachable: ${err.message}` : 'algod unreachable',
      reachable: false,
    };
  }

  return healthCache;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms)),
  ]);
}

// ─── Simulated settlement ────────────────────────────────────────────────────

/**
 * Produces a well-formed Algorand transaction id (52-char base32 of 32 bytes)
 * derived from the payload, so simulated receipts are stable and look right in
 * the UI. Always paired with `mode: 'simulated'` in responses — we never claim
 * a simulated txid is on-chain.
 */
export function simulatedTxId(payload: unknown): string {
  const digest = crypto
    .createHash('sha256')
    .update(typeof payload === 'string' ? payload : JSON.stringify(payload))
    .digest();
  return base32NoPad(digest);
}

function base32NoPad(buf: Buffer): string {
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += ALPHABET[(value << (5 - bits)) & 31];
  }
  return out.slice(0, 52);
}

// ─── Settlement results ──────────────────────────────────────────────────────

export interface SettlementResult {
  txId: string;
  mode: ChainMode;
  network: ChainNetwork;
  caip2: string;
  confirmedRound?: number;
  explorerUrl: string;
  feePaidByRelayer: boolean;
  /** Populated when we degraded to simulation, so callers can surface why. */
  note?: string;
}

function simulatedResult(payload: unknown, note?: string): SettlementResult {
  const txId = simulatedTxId(payload);
  return {
    txId,
    mode: 'simulated',
    network: getNetwork(),
    caip2: getCaip2Network(),
    explorerUrl: explorerTxUrl(txId),
    feePaidByRelayer: true,
    note,
  };
}

// ─── On-chain ledger anchoring ───────────────────────────────────────────────

export interface LedgerAnchor {
  kind: 'deposit' | 'withdrawal' | 'loan_disbursement' | 'loan_repayment' | 'yield' | 'grant' | 'x402' | 'dsbt' | 'vault';
  shgId?: string;
  memberId?: string;
  amount?: number;
  reference?: string;
  detail?: string;
}

/**
 * Writes an SHG ledger record to Algorand as the note of a 0-amount payment
 * from the relayer to itself. Real transaction, real txid, real immutability,
 * no ASA opt-in required. Note field caps at 1000 bytes.
 */
export async function anchorLedgerEntry(anchor: LedgerAnchor): Promise<SettlementResult> {
  const notePayload = {
    app: 'saheli-shg-chain',
    v: 1,
    ...anchor,
    ts: new Date().toISOString(),
  };

  const health = await getChainHealth();
  if (health.mode !== 'live') {
    return simulatedResult(notePayload, health.reason);
  }

  try {
    const client = getAlgodClient();
    const relayer = getRelayerAccount();
    const suggestedParams = await withTimeout(client.getTransactionParams().do(), 6000);

    const note = new Uint8Array(Buffer.from(JSON.stringify(notePayload)).subarray(0, 1000));
    const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      sender: relayer.address,
      receiver: relayer.address,
      amount: 0,
      note,
      suggestedParams,
    });

    const signed = txn.signTxn(relayer.signer);
    const txId = txn.txID();
    await withTimeout(client.sendRawTransaction(signed).do(), 10000);
    const confirmed = await withTimeout(algosdk.waitForConfirmation(client, txId, 8), 20000);

    return {
      txId,
      mode: 'live',
      network: getNetwork(),
      caip2: getCaip2Network(),
      confirmedRound: Number((confirmed as any)?.confirmedRound ?? 0) || undefined,
      explorerUrl: explorerTxUrl(txId),
      feePaidByRelayer: true,
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'submission failed';
    console.warn(`[algorand] anchor failed, degrading to simulated: ${reason}`);
    healthCache = null; // re-probe next call
    return simulatedResult(notePayload, `live submission failed: ${reason}`);
  }
}

// ─── ASA transfer (gasless via fee pooling) ──────────────────────────────────

export interface AssetTransferRequest {
  fromSubject: string;
  toAddress: string;
  amount: number;
  assetId?: number;
  memo?: string;
}

/**
 * Transfers the SHG-Rupee ASA. The member's transfer carries fee 0 and the
 * relayer contributes a fee-pooling payment covering the whole group, so the
 * member spends no ALGO. This is the "gasless meta-transaction" feature.
 */
export async function transferAsset(req: AssetTransferRequest): Promise<SettlementResult> {
  const assetId = req.assetId ?? getShgAsaId();
  const payload = { ...req, assetId };

  const health = await getChainHealth();
  if (health.mode !== 'live' || !assetId) {
    return simulatedResult(payload, assetId ? health.reason : 'SHG_ASA_ID not configured');
  }

  try {
    const client = getAlgodClient();
    const relayer = getRelayerAccount();
    const member = deriveAccount(req.fromSubject);
    const suggestedParams = await withTimeout(client.getTransactionParams().do(), 6000);

    // Member pays nothing; relayer covers both fees through pooling.
    const memberParams = { ...suggestedParams, fee: BigInt(0), flatFee: true };
    const relayerParams = { ...suggestedParams, fee: BigInt(MIN_FEE * 2), flatFee: true };

    const transfer = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      sender: member.address,
      receiver: req.toAddress,
      assetIndex: assetId,
      amount: req.amount,
      note: req.memo ? new Uint8Array(Buffer.from(req.memo).subarray(0, 1000)) : undefined,
      suggestedParams: memberParams,
    });

    const feeCover = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      sender: relayer.address,
      receiver: relayer.address,
      amount: 0,
      note: new Uint8Array(Buffer.from('saheli:gasless-fee-pool')),
      suggestedParams: relayerParams,
    });

    const group = algosdk.assignGroupID([feeCover, transfer]);
    const signedGroup = [group[0].signTxn(relayer.signer), group[1].signTxn(member.signer)];

    const txId = group[1].txID();
    await withTimeout(client.sendRawTransaction(signedGroup).do(), 10000);
    const confirmed = await withTimeout(algosdk.waitForConfirmation(client, txId, 8), 20000);

    return {
      txId,
      mode: 'live',
      network: getNetwork(),
      caip2: getCaip2Network(),
      confirmedRound: Number((confirmed as any)?.confirmedRound ?? 0) || undefined,
      explorerUrl: explorerTxUrl(txId),
      feePaidByRelayer: true,
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'transfer failed';
    console.warn(`[algorand] asset transfer failed, degrading to simulated: ${reason}`);
    healthCache = null;
    return simulatedResult(payload, `live transfer failed: ${reason}`);
  }
}

// ─── Atomic multi-signature approval group ───────────────────────────────────

export interface AtomicApprovalRequest {
  approverSubjects: string[];
  shgId: string;
  actionId: string;
  description: string;
  amount: number;
}

/**
 * Emulates an SHG joint account: each approving leader contributes a signed
 * attestation transaction, all bundled into one Algorand atomic group. Either
 * every approval lands in the same block or none do — funds cannot move on a
 * partial quorum.
 */
export async function submitAtomicApproval(req: AtomicApprovalRequest): Promise<SettlementResult & { approvals: number }> {
  const payload = { ...req };
  const health = await getChainHealth();

  // Algorand caps atomic groups at 16 transactions.
  const approvers = req.approverSubjects.slice(0, 15);

  if (health.mode !== 'live') {
    return { ...simulatedResult(payload, health.reason), approvals: approvers.length };
  }

  try {
    const client = getAlgodClient();
    const relayer = getRelayerAccount();
    const suggestedParams = await withTimeout(client.getTransactionParams().do(), 6000);

    const relayerParams = { ...suggestedParams, fee: BigInt(MIN_FEE * (approvers.length + 1)), flatFee: true };
    const zeroFeeParams = { ...suggestedParams, fee: BigInt(0), flatFee: true };

    const feeCover = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      sender: relayer.address,
      receiver: relayer.address,
      amount: 0,
      note: new Uint8Array(
        Buffer.from(
          JSON.stringify({
            app: 'saheli-shg-chain',
            kind: 'multisig-approval',
            actionId: req.actionId,
            shgId: req.shgId,
            description: req.description,
            amount: req.amount,
            quorum: approvers.length,
          }),
        ).subarray(0, 1000),
      ),
      suggestedParams: relayerParams,
    });

    const approvalTxns = approvers.map((subject, index) => {
      const approver = deriveAccount(subject);
      return algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        sender: approver.address,
        receiver: relayer.address,
        amount: 0,
        note: new Uint8Array(
          Buffer.from(
            JSON.stringify({ approval: index + 1, actionId: req.actionId, signer: subject }),
          ).subarray(0, 1000),
        ),
        suggestedParams: zeroFeeParams,
      });
    });

    const group = algosdk.assignGroupID([feeCover, ...approvalTxns]);
    const signed = [
      group[0].signTxn(relayer.signer),
      ...approvers.map((subject, i) => group[i + 1].signTxn(deriveAccount(subject).signer)),
    ];

    const txId = group[0].txID();
    await withTimeout(client.sendRawTransaction(signed).do(), 12000);
    const confirmed = await withTimeout(algosdk.waitForConfirmation(client, txId, 8), 20000);

    return {
      txId,
      mode: 'live',
      network: getNetwork(),
      caip2: getCaip2Network(),
      confirmedRound: Number((confirmed as any)?.confirmedRound ?? 0) || undefined,
      explorerUrl: explorerTxUrl(txId),
      feePaidByRelayer: true,
      approvals: approvers.length,
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'atomic group failed';
    console.warn(`[algorand] atomic approval failed, degrading to simulated: ${reason}`);
    healthCache = null;
    return {
      ...simulatedResult(payload, `live atomic group failed: ${reason}`),
      approvals: approvers.length,
    };
  }
}

// ─── Verification via indexer ────────────────────────────────────────────────

export interface ChainVerification {
  found: boolean;
  txId: string;
  mode: ChainMode;
  confirmedRound?: number;
  sender?: string;
  receiver?: string;
  amount?: number;
  fee?: number;
  roundTime?: string;
  note?: Record<string, unknown> | string;
  explorerUrl: string;
  source: 'indexer' | 'algod' | 'unavailable';
}

/**
 * Looks a transaction up on-chain. Used by the offline QR proof flow so a bank
 * officer's scan is checked against the ledger rather than our own database.
 */
export async function verifyOnChain(txId: string): Promise<ChainVerification> {
  const base: ChainVerification = {
    found: false,
    txId,
    mode: (await getChainHealth()).mode,
    explorerUrl: explorerTxUrl(txId),
    source: 'unavailable',
  };

  if (!/^[A-Z2-7]{52}$/.test(txId)) {
    return base;
  }

  try {
    const indexer = getIndexerClient();
    const res: any = await withTimeout(indexer.lookupTransactionByID(txId).do(), 8000);
    const tx = res?.transaction;
    if (!tx) return base;

    let decodedNote: Record<string, unknown> | string | undefined;
    if (tx.note) {
      try {
        const raw = Buffer.from(tx.note).toString('utf8');
        decodedNote = JSON.parse(raw);
      } catch {
        decodedNote = Buffer.from(tx.note).toString('utf8');
      }
    }

    return {
      found: true,
      txId,
      mode: 'live',
      confirmedRound: Number(tx.confirmedRound ?? 0) || undefined,
      sender: tx.sender,
      receiver: tx.paymentTransaction?.receiver || tx.assetTransferTransaction?.receiver,
      amount: Number(tx.paymentTransaction?.amount ?? tx.assetTransferTransaction?.amount ?? 0),
      fee: Number(tx.fee ?? 0),
      roundTime: tx.roundTime ? new Date(Number(tx.roundTime) * 1000).toISOString() : undefined,
      note: decodedNote,
      explorerUrl: explorerTxUrl(txId),
      source: 'indexer',
    };
  } catch {
    return base;
  }
}

// ─── Public chain summary ────────────────────────────────────────────────────

export async function getChainInfo() {
  const health = await getChainHealth();
  const relayer = getRelayerAccount();
  const asaId = getShgAsaId();

  return {
    network: getNetwork(),
    caip2: getCaip2Network(),
    genesisHash: getGenesisHash(),
    mode: health.mode,
    modeReason: health.reason,
    lastRound: health.round,
    relayer: {
      address: relayer.address,
      balanceMicroAlgos: health.relayerBalance,
      balanceAlgos: Number((health.relayerBalance / 1e6).toFixed(6)),
      explorerUrl: explorerAccountUrl(relayer.address),
      dispenser: getNetwork() === 'testnet' ? 'https://bank.testnet.algorand.network' : undefined,
    },
    treasury: {
      address: getTreasuryAddress(),
      explorerUrl: explorerAccountUrl(getTreasuryAddress()),
    },
    shgAsset: asaId
      ? { id: asaId, explorerUrl: explorerAssetUrl(asaId) }
      : { id: 0, note: 'SHG_ASA_ID not configured; ledger entries are anchored via transaction notes.' },
    explorerBase: EXPLORER_BASE[getNetwork()],
    gasless: true,
    minFeeMicroAlgos: MIN_FEE,
  };
}
