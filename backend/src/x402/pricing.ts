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

export type ResourceId =
  | 'credit-report'
  | 'member-passport'
  | 'verify-proof'
  | 'grant-eligibility'
  | 'ai-underwriting';

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
  payerType: 'bank' | 'ngo' | 'fintech' | 'agent';
  /** Share of revenue routed to the SHG treasury (the rest covers infra). */
  treasuryShareBps: number;
  maxTimeoutSeconds: number;
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
  },
};

/** The ASA used to settle x402 payments. Defaults to USDC on the active network. */
export function getSettlementAsset(): string {
  const override = process.env.X402_SETTLEMENT_ASA_ID?.trim();
  if (override && Number(override) > 0) return override;

  const shgAsa = getShgAsaId();
  if (shgAsa > 0) return String(shgAsa);

  return getCaip2Network().includes('wGHE2Pwdvd7S12BL5FaOP20EGYesN73k')
    ? USDC_MAINNET_ASA_ID
    : USDC_TESTNET_ASA_ID;
}

/** Address that receives x402 revenue. Defaults to the SHG treasury. */
export function getPayToAddress(): string {
  return process.env.X402_PAY_TO?.trim() || getTreasuryAddress();
}

export function toDisplayAmount(atomicAmount: string, decimals = USDC_DECIMALS): string {
  const value = Number(atomicAmount) / 10 ** decimals;
  return value.toFixed(decimals).replace(/0+$/, '').replace(/\.$/, '');
}

export function listResources(): PricedResource[] {
  return Object.values(PRICED_RESOURCES);
}
