/**
 * Pera Wallet integration.
 *
 * One shared PeraWalletConnect instance for the whole app — the SDK keeps its
 * session in localStorage and registers a WalletConnect bridge, so creating a
 * second instance silently breaks reconnection.
 *
 * Authentication is challenge/response: the backend mints a single-use nonce,
 * Pera signs it with `signData`, and the backend verifies the ed25519 signature
 * against the address' public key. No key, seed phrase or password ever
 * reaches our servers.
 */

import { PeraWalletConnect } from '@perawallet/connect';

/** Algorand chain ids Pera understands. */
const CHAIN_IDS = {
  mainnet: 416001,
  testnet: 416002,
  betanet: 416003,
} as const;

type PeraNetwork = keyof typeof CHAIN_IDS;

function resolveNetwork(): PeraNetwork {
  const raw = String(import.meta.env.VITE_ALGORAND_NETWORK || 'testnet').toLowerCase();
  return raw === 'mainnet' || raw === 'betanet' ? raw : 'testnet';
}

export const PERA_NETWORK = resolveNetwork();

let instance: PeraWalletConnect | null = null;

export function getPeraWallet(): PeraWalletConnect {
  if (!instance) {
    instance = new PeraWalletConnect({
      chainId: CHAIN_IDS[PERA_NETWORK],
      shouldShowSignTxnToast: false,
    });
  }
  return instance;
}

/** True when the user closed the Pera modal instead of hitting a real error. */
export function isUserCancellation(error: unknown): boolean {
  const data = (error as { data?: { type?: string }; message?: string } | null)?.data;
  if (data?.type === 'CONNECT_MODAL_CLOSED' || data?.type === 'SIGN_MODAL_CLOSED') return true;
  const message = String((error as Error | null)?.message || '').toLowerCase();
  return message.includes('modal_closed') || message.includes('cancelled') || message.includes('canceled');
}

export function shortenAddress(address?: string | null): string {
  if (!address) return '';
  return address.length > 14 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

/**
 * Disconnect subscribers.
 *
 * The underlying WalletConnect `off(event)` drops *every* listener for that
 * event, so per-caller listeners would clobber each other. We keep one real
 * listener and fan out to subscribers ourselves. The listener also has to be
 * re-attached after each connect, because `connector` is null until a session
 * exists.
 */
type DisconnectHandler = () => void;
const disconnectHandlers = new Set<DisconnectHandler>();

function attachDisconnectListener(): void {
  const connector = getPeraWallet().connector;
  if (!connector) return;
  connector.off('disconnect');
  connector.on('disconnect', () => {
    for (const handler of disconnectHandlers) handler();
  });
}

/** Subscribes to wallet disconnects. Returns an unsubscribe function. */
export function onPeraDisconnect(handler: DisconnectHandler): () => void {
  disconnectHandlers.add(handler);
  attachDisconnectListener();
  return () => {
    disconnectHandlers.delete(handler);
  };
}

/** Opens the Pera modal (or deep-links on mobile) and returns the accounts. */
export async function connectPera(): Promise<string[]> {
  const pera = getPeraWallet();
  let accounts: string[];
  try {
    accounts = await pera.connect();
  } catch (error) {
    // A stale WalletConnect session makes connect() throw on the second try.
    // Clearing it and retrying once turns a dead-end into a working modal.
    if (isUserCancellation(error)) throw error;
    await pera.disconnect().catch(() => undefined);
    accounts = await pera.connect();
  }
  attachDisconnectListener();
  return accounts;
}

/** Restores a previous session without prompting. Returns [] when there is none. */
export async function reconnectPera(): Promise<string[]> {
  try {
    const accounts = await getPeraWallet().reconnectSession();
    if (accounts.length > 0) attachDisconnectListener();
    return accounts;
  } catch {
    return [];
  }
}

export async function disconnectPera(): Promise<void> {
  try {
    await getPeraWallet().disconnect();
  } catch {
    /* the session is gone either way */
  }
}

/**
 * Asks Pera to sign the challenge text and returns the signature as base64.
 *
 * Pera signs `"MX" || data` — the Algorand arbitrary-bytes domain prefix — and
 * the backend prepends the same two bytes before verifying, so the two sides
 * agree without either hard-coding the other's format.
 */
export async function signChallenge(message: string, address: string): Promise<string> {
  const pera = getPeraWallet();

  const signatures = await pera.signData(
    [
      {
        data: new TextEncoder().encode(message),
        message: 'Sign in to Saheli — no funds move and no fee is charged.',
      },
    ],
    address,
  );

  const signature = signatures?.[0];
  if (!signature || signature.length === 0) {
    throw new Error('Pera Wallet returned an empty signature.');
  }

  return toBase64(signature);
}

/** Base64 without depending on a Node Buffer polyfill in the browser. */
function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
