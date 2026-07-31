/**
 * Pera Wallet sign-in — challenge/response authentication.
 *
 * Password sign-in proves you know a secret the server also stores. Wallet
 * sign-in proves you control an Algorand private key, and the server never
 * holds anything worth stealing. That matters here: Saheli already derives
 * custodial accounts for members who cannot safeguard a seed phrase, but SHG
 * leaders, bank officers and NGO auditors *can*, and they should not have to
 * trust us with a password.
 *
 * Flow:
 *   1. Client asks for a challenge for its address.
 *   2. Server mints a single-use nonce, remembers it with a short TTL.
 *   3. Pera signs the challenge text with `signData`.
 *   4. Server verifies the ed25519 signature against the address' public key
 *      and burns the nonce.
 *
 * Signature format: Pera's `signData` signs `"MX" || data` (the Algorand
 * arbitrary-byte-signing domain prefix), so verification must prepend the same
 * two bytes. This mirrors `PeraWalletConnect.verifySignature` exactly.
 */

import crypto from 'crypto';
import algosdk from 'algosdk';
import nacl from 'tweetnacl';

/** Domain prefix Algorand uses for signing arbitrary (non-transaction) bytes. */
const SIGN_DATA_PREFIX = Uint8Array.from([77, 88]); // "MX"

const CHALLENGE_TTL_MS = Number(process.env.WALLET_CHALLENGE_TTL_MS || 5 * 60 * 1000);
const MAX_OUTSTANDING_CHALLENGES = 5000;

export interface WalletChallenge {
  address: string;
  nonce: string;
  message: string;
  issuedAt: number;
  expiresAt: number;
}

/**
 * Outstanding challenges, keyed by nonce. In-process on purpose: challenges
 * live for minutes and are single-use, so persisting them buys nothing. A
 * multi-instance deployment should swap this for Redis — noted rather than
 * pretended away.
 */
const challenges = new Map<string, WalletChallenge>();

function pruneExpired(): void {
  const now = Date.now();
  for (const [nonce, challenge] of challenges) {
    if (challenge.expiresAt <= now) challenges.delete(nonce);
  }
  // Hard cap so a flood of unanswered challenges cannot grow without bound.
  if (challenges.size > MAX_OUTSTANDING_CHALLENGES) {
    const excess = challenges.size - MAX_OUTSTANDING_CHALLENGES;
    let removed = 0;
    for (const nonce of challenges.keys()) {
      challenges.delete(nonce);
      if (++removed >= excess) break;
    }
  }
}

export function isValidAlgorandAddress(address: unknown): address is string {
  return typeof address === 'string' && algosdk.isValidAddress(address.trim());
}

/** Human-readable text the wallet displays before the user approves. */
function buildChallengeMessage(address: string, nonce: string, issuedAt: number): string {
  return [
    'Saheli — SHG Chain',
    '',
    'Sign this message to prove you control this account.',
    'This is a signature, not a transaction. It costs nothing and moves no funds.',
    '',
    `Address: ${address}`,
    `Nonce:   ${nonce}`,
    `Issued:  ${new Date(issuedAt).toISOString()}`,
  ].join('\n');
}

export function createChallenge(rawAddress: string): WalletChallenge {
  pruneExpired();

  const address = rawAddress.trim();
  const nonce = crypto.randomBytes(24).toString('base64url');
  const issuedAt = Date.now();

  const challenge: WalletChallenge = {
    address,
    nonce,
    message: buildChallengeMessage(address, nonce, issuedAt),
    issuedAt,
    expiresAt: issuedAt + CHALLENGE_TTL_MS,
  };

  challenges.set(nonce, challenge);
  return challenge;
}

export type ChallengeFailure =
  | 'unknown_nonce'
  | 'expired'
  | 'address_mismatch'
  | 'bad_signature'
  | 'malformed_signature';

export interface VerificationResult {
  ok: boolean;
  reason?: ChallengeFailure;
  address?: string;
  message?: string;
}

function decodeSignature(signature: string): Uint8Array | null {
  try {
    // Accept base64 and base64url; Pera clients differ on which they send.
    const normalized = signature.replace(/-/g, '+').replace(/_/g, '/');
    const bytes = new Uint8Array(Buffer.from(normalized, 'base64'));
    return bytes.length === nacl.sign.signatureLength ? bytes : null;
  } catch {
    return null;
  }
}

/**
 * Verifies a signed challenge and burns the nonce. A nonce is consumed on the
 * first verification attempt whatever the outcome, so a captured signature can
 * never be replayed.
 */
export function verifyChallenge(args: {
  address: string;
  nonce: string;
  signature: string;
}): VerificationResult {
  pruneExpired();

  const challenge = challenges.get(args.nonce);
  if (!challenge) return { ok: false, reason: 'unknown_nonce' };

  // Single-use: burn it before doing any work with it.
  challenges.delete(args.nonce);

  if (challenge.expiresAt <= Date.now()) return { ok: false, reason: 'expired' };
  if (challenge.address !== args.address.trim()) return { ok: false, reason: 'address_mismatch' };

  const signature = decodeSignature(args.signature);
  if (!signature) return { ok: false, reason: 'malformed_signature' };

  try {
    const { publicKey } = algosdk.decodeAddress(challenge.address);
    const messageBytes = new Uint8Array(Buffer.from(challenge.message, 'utf8'));

    const signed = new Uint8Array(SIGN_DATA_PREFIX.length + messageBytes.length);
    signed.set(SIGN_DATA_PREFIX, 0);
    signed.set(messageBytes, SIGN_DATA_PREFIX.length);

    const valid = nacl.sign.detached.verify(signed, signature, publicKey);
    if (!valid) return { ok: false, reason: 'bad_signature' };

    return { ok: true, address: challenge.address, message: challenge.message };
  } catch {
    return { ok: false, reason: 'bad_signature' };
  }
}

/** Short, human-friendly rendering of an address: ABCD1234…WXYZ. */
export function shortenAddress(address: string): string {
  return address.length > 14 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

/** Test/ops helper — drops every outstanding challenge. */
export function clearChallenges(): void {
  challenges.clear();
}
