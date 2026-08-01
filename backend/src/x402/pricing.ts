/**
 * x402 pay-per-use price catalogue.
 *
 * The business model that makes this more than a demo: institutions and their
 * autonomous agents pay per API call for SHG creditworthiness data, and that
 * revenue is routed back into the SHG treasury. The women monetise their own
 * financial reputation instead of having it harvested for free.
 *
 * Prices are expressed in atomic units of the settlement asset (USDC on
 * Algorand TestNet has 6 decimals, so 250000 == 0.25 USDC).
 */

import { getCaip2Network, getShgAsaId, getTreasuryAddress } from '../services/algorand';

/** USDC ASA ids, matching @x402/avm's USDC_TESTNET_ASA_ID / USDC_MAINNET_ASA_ID. */
export const USDC_TESTNET_ASA_ID = '10458941';
export const USDC_MAINNET_ASA_ID = '31566704';
export const USDC_DECIMALS = 6;

/**
 * Native ALGO, expressed as asset id "0" in the exact scheme.
 *
 * ASA settlement (USDC) is right for institutional callers who already hold the
 * token, but it is unusable for an SHG member: a freshly created Pera wallet
 * holds only ALGO from the dispenser and is not opted in to any ASA, so an
 * `axfer` would be rejected before it ever reached the facilitator. The
 * wallet-signed loan flows therefore settle in native ALGO, which every Pera
 * account can pay on day one.
 */
export const NATIVE_ALGO_ASSET = '0';
export const ALGO_DECIMALS = 6;

/**
 * The hardcoded x402 receiver for wallet-signed loan payments.
 *
 * Deliberately a fixed address rather than a derived one: the member's and the
 * leader's Pera wallets pay *this* account, and it is the same account every
 * run, so a judge can open it in the explorer and watch the balance move during
 * the demo. Override with X402_LOAN_PAY_TO if the account is ever rotated.
 */
export const X402_LOAN_RECEIVER = 'LK55I23YL4XPLQMWPOTYKBHL5VJ6EETGWGGC63AZ7G3XXR6BCB3VI3FW6E';

export type ResourceId =
  | 'credit-report'
  | 'member-passport'
  | 'verify-proof'
  | 'grant-eligibility'
  | 'ai-underwriting'
  | 'loan-request'
  | 'loan-approval';

export interface PricedResource {
  id: ResourceId;
  /** Express path pattern this resource is served at. */
  path: string;
  method: 'GET' | 'POST';
  /** Atomic units of the settlement asset. */
  amount: string;
  /** Human-readable price, for UI and the 402 body. */
  displayPrice: string;
  description: string;
  mimeType: string;
  /** Who typically pays — used for the revenue analytics breakdown. */
  payerType: 'bank' | 'ngo' | 'fintech' | 'agent' | 'member' | 'leader';
  /** Share of revenue routed to the SHG treasury (the rest covers infra). */
  treasuryShareBps: number;
  maxTimeoutSeconds: number;
  /**
   * `asa` settles in USDC and is paid by a server-held institutional key.
   * `algo` settles in native ALGO and is signed by the caller's own Pera wallet.
   */
  settlementAsset: 'asa' | 'algo';
  /** Where the money lands: the SHG treasury, or the hardcoded loan receiver. */
  payToKind: 'treasury' | 'loan-receiver';
  /** True when the payer is a human signing in Pera rather than a server key. */
  walletSigned?: boolean;
}

export const PRICED_RESOURCES: Record<ResourceId, PricedResource> = {
  'credit-report': {
    id: 'credit-report',
    path: '/api/x402/credit-report/:shgId',
    method: 'GET',
    amount: '250000', // 0.25 USDC
    displayPrice: '$0.25',
    description: 'Full on-chain credit report for an SHG: d-SBT trust passport, repayment history, treasury health.',
    mimeType: 'application/json',
    payerType: 'bank',
    treasuryShareBps: 8000,
    maxTimeoutSeconds: 120,
    settlementAsset: 'asa',
    payToKind: 'treasury',
  },
  'member-passport': {
    id: 'member-passport',
    path: '/api/x402/member-passport/:memberId',
    method: 'GET',
    amount: '100000', // 0.10 USDC
    displayPrice: '$0.10',
    description: 'Individual member financial health passport backed by a dynamic Soulbound Token.',
    mimeType: 'application/json',
    payerType: 'bank',
    treasuryShareBps: 9000,
    maxTimeoutSeconds: 120,
    settlementAsset: 'asa',
    payToKind: 'treasury',
  },
  'verify-proof': {
    id: 'verify-proof',
    path: '/api/x402/verify-proof',
    method: 'POST',
    amount: '10000', // 0.01 USDC
    displayPrice: '$0.01',
    description: 'Machine-scale verification of a Saheli QR proof against the Algorand ledger.',
    mimeType: 'application/json',
    payerType: 'fintech',
    treasuryShareBps: 7000,
    maxTimeoutSeconds: 60,
    settlementAsset: 'asa',
    payToKind: 'treasury',
  },
  'grant-eligibility': {
    id: 'grant-eligibility',
    path: '/api/x402/grant-eligibility/:shgId',
    method: 'GET',
    amount: '500000', // 0.50 USDC
    displayPrice: '$0.50',
    description: 'Cryptographic milestone attestation for NGO/government grant release decisions.',
    mimeType: 'application/json',
    payerType: 'ngo',
    treasuryShareBps: 8500,
    maxTimeoutSeconds: 180,
    settlementAsset: 'asa',
    payToKind: 'treasury',
  },
  'ai-underwriting': {
    id: 'ai-underwriting',
    path: '/api/x402/ai-underwriting',
    method: 'POST',
    amount: '1000000', // 1.00 USDC
    displayPrice: '$1.00',
    description: 'Agentic underwriting opinion: AI risk assessment with on-chain evidence citations.',
    mimeType: 'application/json',
    payerType: 'agent',
    treasuryShareBps: 6000,
    maxTimeoutSeconds: 300,
    settlementAsset: 'asa',
    payToKind: 'treasury',
  },

  // ── Wallet-signed loan gates ───────────────────────────────────────────────
  // These two are what make x402 load-bearing rather than decorative: a loan
  // cannot be requested or approved until the person doing it has settled a
  // payment from their own Pera wallet. Priced in native ALGO so any
  // dispenser-funded wallet can pay without an ASA opt-in.

  'loan-request': {
    id: 'loan-request',
    path: '/api/loans/request',
    method: 'POST',
    amount: '50000', // 0.05 ALGO
    displayPrice: '0.05 ALGO',
    description:
      'Underwriting fee: runs the AI credit assessment for a new micro-loan request and routes it for leader approval.',
    mimeType: 'application/json',
    payerType: 'member',
    treasuryShareBps: 10000,
    maxTimeoutSeconds: 300,
    settlementAsset: 'algo',
    payToKind: 'loan-receiver',
    walletSigned: true,
  },
  'loan-approval': {
    id: 'loan-approval',
    path: '/api/multisig/:id/sign',
    method: 'POST',
    amount: '50000', // 0.05 ALGO
    displayPrice: '0.05 ALGO',
    description:
      'Disbursement fee: commits the SHG leader’s approval as an Algorand atomic group and settles the loan against the treasury.',
    mimeType: 'application/json',
    payerType: 'leader',
    treasuryShareBps: 10000,
    maxTimeoutSeconds: 300,
    settlementAsset: 'algo',
    payToKind: 'loan-receiver',
    walletSigned: true,
  },
};

/** Resources whose payment is signed in the browser by the caller's Pera wallet. */
export function isWalletSignedResource(resourceId: ResourceId): boolean {
  return Boolean(PRICED_RESOURCES[resourceId]?.walletSigned);
}

/** The hardcoded account that receives every wallet-signed loan payment. */
export function getLoanReceiverAddress(): string {
  return process.env.X402_LOAN_PAY_TO?.trim() || X402_LOAN_RECEIVER;
}

/**
 * The asset a resource settles in.
 *
 * `"0"` means native ALGO — the wallet-signed loan gates. Everything else
 * settles in an ASA (USDC by default), which is what an institutional caller
 * with a funded server key uses.
 */
export function getSettlementAsset(resourceId?: ResourceId): string {
  if (resourceId && PRICED_RESOURCES[resourceId]?.settlementAsset === 'algo') {
    return NATIVE_ALGO_ASSET;
  }

  const override = process.env.X402_SETTLEMENT_ASA_ID?.trim();
  if (override && Number(override) > 0) return override;

  const shgAsa = getShgAsaId();
  if (shgAsa > 0) return String(shgAsa);

  return getCaip2Network().includes('wGHE2Pwdvd7S12BL5FaOP20EGYesN73k')
    ? USDC_MAINNET_ASA_ID
    : USDC_TESTNET_ASA_ID;
}

/**
 * Where a resource's revenue lands.
 *
 * Loan gates pay the hardcoded receiver; data resources pay the SHG treasury.
 */
export function getPayToAddress(resourceId?: ResourceId): string {
  if (resourceId && PRICED_RESOURCES[resourceId]?.payToKind === 'loan-receiver') {
    return getLoanReceiverAddress();
  }
  return process.env.X402_PAY_TO?.trim() || getTreasuryAddress();
}

/** Ticker shown in the 402 body and the UI. */
export function getAssetSymbol(resourceId?: ResourceId): string {
  return resourceId && PRICED_RESOURCES[resourceId]?.settlementAsset === 'algo' ? 'ALGO' : 'USDC';
}

export function toDisplayAmount(atomicAmount: string, decimals = USDC_DECIMALS): string {
  const value = Number(atomicAmount) / 10 ** decimals;
  return value.toFixed(decimals).replace(/0+$/, '').replace(/\.$/, '');
}

export function listResources(): PricedResource[] {
  return Object.values(PRICED_RESOURCES);
}
