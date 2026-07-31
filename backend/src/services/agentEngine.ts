import { v4 as uuidv4 } from 'uuid';
import AgentStateModel from '../models/AgentState';
import Transaction from '../models/Transaction';
import { registerTransactionLifecycle } from './txEngine';
import { anchorLedgerEntry, explorerTxUrl, simulatedTxId } from './algorand';

// ─── Algorand DeFi venues ────────────────────────────────────────────────────

/**
 * Yield venues the agent can route idle SHG capital into. These are the real
 * Algorand DeFi protocols the treasury would integrate with; APYs are the
 * indicative rates used for the demo model.
 */
export const ALGORAND_DEFI_POOLS = [
  { protocol: 'Folks Finance', asset: 'USDC Lending Pool', apy: 5.4 },
  { protocol: 'Folks Finance', asset: 'ALGO Lending Pool', apy: 7.1 },
  { protocol: 'Tinyman', asset: 'USDC/ALGO LP', apy: 9.3 },
  { protocol: 'Algorand Governance', asset: 'ALGO Staking', apy: 6.2 },
  { protocol: 'Pact', asset: 'Stablecoin Vault', apy: 4.8 },
];

/**
 * Records an agent action on Algorand and returns the resulting transaction id.
 * Every agent decision is auditable on chain, which is the whole point of an
 * autonomous treasury: nobody has to trust that the AI did what it claims.
 */
async function anchorAgentAction(params: {
  kind: 'vault' | 'loan_disbursement' | 'yield';
  amount: number;
  detail: string;
  memberId?: string;
}): Promise<{ txId: string; explorerUrl: string; mode: 'live' | 'simulated' }> {
  const anchor = await anchorLedgerEntry({
    kind: params.kind,
    amount: params.amount,
    detail: params.detail,
    memberId: params.memberId,
  });
  return { txId: anchor.txId, explorerUrl: anchor.explorerUrl, mode: anchor.mode };
}

// ─── Agent State ─────────────────────────────────────────────────────────────

export interface VaultPosition {
  id: string;
  protocol: string;
  asset: string;
  deployed: number;
  apy: number;
  yieldAccrued: number;
  stakedAt: string;
  transactionId: string;
  status: 'active' | 'withdrawing' | 'completed';
}

export interface AutoRepayment {
  loanId: string;
  memberId: string;
  memberName: string;
  installmentAmount: number;
  totalInstallments: number;
  paidInstallments: number;
  nextDueDate: string;
  deductionSource: 'future_deposit' | 'yield_share';
  status: 'active' | 'completed' | 'defaulted';
}

export interface AgentLogEntry {
  id: string;
  tag: 'LOAN' | 'VAULT' | 'REPAY' | 'ALERT' | 'SYSTEM';
  message: string;
  detail?: string;
  amount?: number;
  transactionId?: string;
  timestamp: string;
}

export interface AgentState {
  idleFunds: number;
  totalDeployed: number;
  totalYieldHarvested: number;
  lastScanAt: string;
  vaultPositions: VaultPosition[];
  autoRepayments: AutoRepayment[];
  agentLog: AgentLogEntry[];
}

// ─── Initial State ───────────────────────────────────────────────────────────

const initialAgentState: AgentState = {
  idleFunds: 345800,
  totalDeployed: 900000,
  totalYieldHarvested: 52400,
  lastScanAt: new Date(Date.now() - 120000).toISOString(),
  vaultPositions: [
    {
      id: 'vault1',
      protocol: 'Folks Finance',
      asset: 'USDC Lending Pool',
      deployed: 500000,
      apy: 5.4,
      yieldAccrued: 4200,
      stakedAt: new Date(Date.now() - 7 * 24 * 3600000).toISOString(),
      transactionId: simulatedTxId('agent-seed-1'),
      status: 'active',
    },
    {
      id: 'vault2',
      protocol: 'Tinyman',
      asset: 'USDC/ALGO LP',
      deployed: 250000,
      apy: 9.3,
      yieldAccrued: 2380,
      stakedAt: new Date(Date.now() - 14 * 24 * 3600000).toISOString(),
      transactionId: simulatedTxId('agent-seed-2'),
      status: 'active',
    },
    {
      id: 'vault3',
      protocol: 'Algorand Governance',
      asset: 'ALGO Staking',
      deployed: 150000,
      apy: 6.2,
      yieldAccrued: 1020,
      stakedAt: new Date(Date.now() - 3 * 24 * 3600000).toISOString(),
      transactionId: simulatedTxId('agent-seed-3'),
      status: 'active',
    },
  ],
  autoRepayments: [
    {
      loanId: 'loan2',
      memberId: 'm2',
      memberName: 'Sita Ramaiah',
      installmentAmount: 1083,
      totalInstallments: 6,
      paidInstallments: 3,
      nextDueDate: new Date(Date.now() + 7 * 24 * 3600000).toISOString(),
      deductionSource: 'future_deposit',
      status: 'active',
    },
  ],
  agentLog: [
    {
      id: 'al1',
      tag: 'VAULT',
      message: 'Deployed ₹5,00,000 → Folks Finance (USDC Lending Pool)',
      detail: '5.4% APY confirmed on Algorand.',
      amount: 500000,
      transactionId: simulatedTxId('agent-seed-4'),
      timestamp: new Date(Date.now() - 7 * 24 * 3600000).toISOString(),
    },
    {
      id: 'al2',
      tag: 'VAULT',
      message: 'Invested ₹2,50,000 → Tinyman (USDC/ALGO LP)',
      detail: '9.3% APY. Liquidity provision on Algorand DEX.',
      amount: 250000,
      transactionId: simulatedTxId('agent-seed-5'),
      timestamp: new Date(Date.now() - 14 * 24 * 3600000).toISOString(),
    },
    {
      id: 'al3',
      tag: 'LOAN',
      message: 'Emergency loan auto-approved for Lakshmi Devi',
      detail: 'Trust Score 850/1000 cleared. 1-of-3 threshold. ₹5,000 disbursed.',
      amount: 5000,
      transactionId: simulatedTxId('agent-seed-6'),
      timestamp: new Date(Date.now() - 2 * 3600000).toISOString(),
    },
    {
      id: 'al4',
      tag: 'REPAY',
      message: 'Auto-deducted ₹1,083 from Sita Ramaiah deposit',
      detail: 'Installment 3/6. Loan loan2 on track.',
      amount: 1083,
      timestamp: new Date(Date.now() - 4 * 3600000).toISOString(),
    },
    {
      id: 'al5',
      tag: 'ALERT',
      message: 'Idle funds detected: ₹3,45,800 uninvested',
      detail: 'Scanning for optimal yield opportunities...',
      amount: 345800,
      timestamp: new Date(Date.now() - 30 * 60000).toISOString(),
    },
    {
      id: 'al6',
      tag: 'SYSTEM',
      message: 'Agent sweep complete — 3 pools healthy',
      detail: 'Total AUM: ₹9,00,000 | Avg APY: 5.2%',
      timestamp: new Date(Date.now() - 120000).toISOString(),
    },
  ],
};

export let agentState: AgentState = JSON.parse(JSON.stringify(initialAgentState));

function cloneState(state: AgentState): AgentState {
  return JSON.parse(JSON.stringify(state));
}

async function persistAgentState(): Promise<void> {
  await AgentStateModel.findOneAndUpdate(
    { key: 'singleton' },
    { key: 'singleton', ...agentState },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
}

export async function initializeAgentState(): Promise<void> {
  const existing = await AgentStateModel.findOne({ key: 'singleton' }).lean<AgentState & { key: string }>();

  if (existing) {
    const { key: _key, ...persisted } = existing;
    agentState = cloneState(persisted as AgentState);
    return;
  }

  agentState = cloneState(initialAgentState);
  await persistAgentState();
}

/**
 * Rebuilds the agent's position so it is consistent with the actual ledger.
 *
 * The demo state used to hard-code ₹9,00,000 of vault deployments against a
 * ledger holding a fraction of that, so `recalculateIdleFunds` — which is
 * `treasury − vaultAUM` — clamped idle funds to zero and the treasury advisor
 * had nothing to recommend. Deriving the split from the real net position keeps
 * the vault panel, the idle-fund figure and the investment advice describing
 * the same money.
 *
 * @param deployedShare Fraction of the net treasury modelled as already
 *                      deployed to yield. The remainder is what the agent
 *                      reports as idle and offers to invest.
 */
export async function resetAgentStateFromLedger(deployedShare = 0.35): Promise<AgentState> {
  const inflowTypes = ['deposit', 'yield', 'loan_repayment'];
  const outflowTypes = ['withdrawal', 'loan_disbursement'];

  const [inflows, outflows] = await Promise.all([
    Transaction.aggregate([
      { $match: { type: { $in: inflowTypes }, status: { $ne: 'failed' } } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
    Transaction.aggregate([
      { $match: { type: { $in: outflowTypes }, status: { $ne: 'failed' } } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
  ]);

  const netTreasury = Math.max(0, (inflows[0]?.total || 0) - (outflows[0]?.total || 0));
  const totalDeployed = Math.floor((netTreasury * deployedShare) / 100) * 100;

  // Spread the deployed share across three real Algorand DeFi venues.
  const weights = [0.45, 0.3, 0.25];
  const pools = [ALGORAND_DEFI_POOLS[0], ALGORAND_DEFI_POOLS[2], ALGORAND_DEFI_POOLS[3]];

  const vaultPositions: VaultPosition[] = pools.map((pool, index) => {
    const deployed =
      index === pools.length - 1
        ? totalDeployed - weights.slice(0, -1).reduce((s, w) => s + Math.floor((totalDeployed * w) / 100) * 100, 0)
        : Math.floor((totalDeployed * weights[index]) / 100) * 100;
    const stakedAt = new Date(Date.now() - (index + 1) * 5 * 24 * 3600_000).toISOString();
    const hoursStaked = (Date.now() - new Date(stakedAt).getTime()) / 3600000;

    return {
      id: `vault${index + 1}`,
      protocol: pool.protocol,
      asset: pool.asset,
      deployed: Math.max(0, deployed),
      apy: pool.apy,
      yieldAccrued: Math.floor((Math.max(0, deployed) * pool.apy) / 100 / 8760 * hoursStaked),
      stakedAt,
      transactionId: simulatedTxId(`agent-vault-${index}-${netTreasury}`),
      status: 'active',
    };
  });

  const vaultAum = vaultPositions.reduce((s, v) => s + v.deployed, 0);

  agentState = {
    ...agentState,
    idleFunds: Math.max(0, netTreasury - vaultAum),
    totalDeployed: vaultAum,
    totalYieldHarvested: agentState.totalYieldHarvested,
    lastScanAt: new Date().toISOString(),
    vaultPositions,
    agentLog: [
      {
        id: uuidv4(),
        tag: 'SYSTEM',
        message: `Position rebuilt from ledger — ₹${netTreasury.toLocaleString('en-IN')} net treasury`,
        detail: `₹${vaultAum.toLocaleString('en-IN')} deployed across ${vaultPositions.length} pools · ₹${Math.max(
          0,
          netTreasury - vaultAum,
        ).toLocaleString('en-IN')} idle and available to invest.`,
        amount: netTreasury,
        timestamp: new Date().toISOString(),
      },
      ...agentState.agentLog.slice(0, 8),
    ],
  };

  await persistAgentState();
  return agentState;
}

export async function recalculateIdleFunds(): Promise<number> {
  const inflowTypes = ['deposit', 'yield', 'loan_repayment'];
  const outflowTypes = ['withdrawal', 'loan_disbursement'];

  const [inflows, outflows] = await Promise.all([
    Transaction.aggregate([{ $match: { type: { $in: inflowTypes }, status: { $ne: 'failed' } } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
    Transaction.aggregate([{ $match: { type: { $in: outflowTypes }, status: { $ne: 'failed' } } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
  ]);

  const totalInflow = inflows[0]?.total || 0;
  const totalOutflow = outflows[0]?.total || 0;
  const vaultAum = agentState.vaultPositions.reduce((sum, v) => sum + v.deployed, 0);
  const netTreasury = Math.max(0, totalInflow - totalOutflow);

  agentState.idleFunds = Math.max(0, netTreasury - vaultAum);
  agentState.lastScanAt = new Date().toISOString();
  await persistAgentState();

  return agentState.idleFunds;
}

// ─── Agent Actions ────────────────────────────────────────────────────────────

export async function deployIdleFunds(amount?: number): Promise<{
  vault: VaultPosition;
  logEntry: AgentLogEntry;
  newIdleFunds: number;
}> {
  const deployAmount = amount || Math.min(agentState.idleFunds, 50000);
  const protocols = ALGORAND_DEFI_POOLS;
  const chosen = protocols[Math.floor(Math.random() * protocols.length)];

  const anchor = await anchorAgentAction({
    kind: 'vault',
    amount: deployAmount,
    detail: `deploy:${chosen.protocol}:${chosen.asset}`,
  });
  const transactionId = anchor.txId;
  registerTransactionLifecycle({
    transactionId,
    type: 'investment_deploy',
    amount: deployAmount,
    initialStatus: anchor.mode === 'live' ? 'confirmed' : 'pending',
    autoConfirm: anchor.mode !== 'live',
  });

  const vault: VaultPosition = {
    id: uuidv4(),
    protocol: chosen.protocol,
    asset: chosen.asset,
    deployed: deployAmount,
    apy: chosen.apy,
    yieldAccrued: 0,
    stakedAt: new Date().toISOString(),
    transactionId,
    status: 'active',
  };

  agentState.vaultPositions.push(vault);
  agentState.idleFunds = Math.max(0, agentState.idleFunds - deployAmount);
  agentState.totalDeployed += deployAmount;
  agentState.lastScanAt = new Date().toISOString();

  const logEntry: AgentLogEntry = {
    id: uuidv4(),
    tag: 'VAULT',
    message: `Deployed ₹${deployAmount.toLocaleString('en-IN')} → ${chosen.protocol} (${chosen.asset})`,
    detail: `${chosen.apy}% APY. Ref: ${transactionId.slice(0, 16)}...`,
    amount: deployAmount,
    transactionId,
    timestamp: new Date().toISOString(),
  };
  agentState.agentLog.unshift(logEntry);
  await persistAgentState();

  return { vault, logEntry, newIdleFunds: agentState.idleFunds };
}

export async function harvestYield(vaultId?: string): Promise<{
  harvested: number;
  logEntry: AgentLogEntry;
}> {
  const targetVaults = vaultId
    ? agentState.vaultPositions.filter(v => v.id === vaultId)
    : agentState.vaultPositions.filter(v => v.status === 'active');

  const totalHarvested = targetVaults.reduce((sum, v) => {
    const hoursStaked = (Date.now() - new Date(v.stakedAt).getTime()) / 3600000;
    const accrued = Math.floor((v.deployed * v.apy / 100 / 8760) * hoursStaked);
    const toHarvest = v.yieldAccrued || accrued;
    v.yieldAccrued = 0;
    return sum + toHarvest;
  }, 0);

  const harvestedAmount = Math.max(totalHarvested, 1200);
  agentState.totalYieldHarvested += harvestedAmount;
  agentState.idleFunds += harvestedAmount;

  const harvestAnchor = await anchorAgentAction({
    kind: 'yield',
    amount: harvestedAmount,
    detail: `harvest:${targetVaults.length}-pools`,
  });
  registerTransactionLifecycle({
    transactionId: harvestAnchor.txId,
    type: 'yield_harvest',
    amount: harvestedAmount,
    initialStatus: harvestAnchor.mode === 'live' ? 'confirmed' : 'pending',
    autoConfirm: harvestAnchor.mode !== 'live',
  });

  const logEntry: AgentLogEntry = {
    id: uuidv4(),
    tag: 'VAULT',
    message: `Harvested ₹${harvestedAmount.toLocaleString('en-IN')} yield from ${targetVaults.length} Algorand DeFi pools`,
    detail: `Yield redistributed to SHG treasury. Verify: ${harvestAnchor.explorerUrl}`,
    amount: harvestedAmount,
    transactionId: harvestAnchor.txId,
    timestamp: new Date().toISOString(),
  };
  agentState.agentLog.unshift(logEntry);
  await persistAgentState();

  return { harvested: harvestedAmount, logEntry };
}

export async function processEmergencyLoan(params: {
  memberId: string;
  memberName: string;
  trustScore: number;
  amount: number;
  purpose: string;
}): Promise<{
  approved: boolean;
  autoApproved: boolean;
  threshold: number;
  transactionId?: string;
  autoRepayment?: AutoRepayment;
  logEntry: AgentLogEntry;
  reason: string;
}> {
  const { memberId, memberName, trustScore, amount, purpose } = params;
  const isEmergency = /medical|hospital|emergency|health|urgent|accident/i.test(purpose);
  const isMicroLoan = amount <= 5000;
  const isHighScore = trustScore >= 750;

  let approved = false;
  let autoApproved = false;
  let threshold = 3;
  let reason = '';
  let transactionId: string | undefined;
  let autoRepayment: AutoRepayment | undefined;

  if (isMicroLoan && trustScore >= 800) {
    approved = true;
    autoApproved = true;
    threshold = 1;
    reason = `✅ Trust Score ${trustScore}/1000 exceeds micro-loan auto-approval threshold. Funds disbursed instantly.`;
  } else if (isEmergency && isHighScore) {
    approved = true;
    autoApproved = true;
    threshold = 1;
    reason = `🚨 Emergency override activated. Trust Score ${trustScore}/1000. Approval threshold lowered to 1-of-3. Disbursed in <3s.`;
  } else if (trustScore >= 700) {
    approved = false;
    autoApproved = false;
    threshold = 3;
    reason = `📋 Routed to standard 3-of-3 approval. Trust Score ${trustScore}/1000 qualifies for approval.`;
  } else {
    approved = false;
    autoApproved = false;
    threshold = 3;
    reason = `⚠️ Trust Score ${trustScore}/1000 below emergency threshold (750). Standard review required.`;
  }

  if (autoApproved) {
    const loanAnchor = await anchorAgentAction({
      kind: 'loan_disbursement',
      amount,
      detail: `emergency-loan:${purpose}`,
      memberId,
    });
    transactionId = loanAnchor.txId;
    registerTransactionLifecycle({
      transactionId,
      type: 'loan_disbursement',
      amount,
      initialStatus: loanAnchor.mode === 'live' ? 'confirmed' : 'pending',
      autoConfirm: loanAnchor.mode !== 'live',
    });
    const installmentAmount = Math.ceil(amount / 6);
    autoRepayment = {
      loanId: uuidv4(),
      memberId,
      memberName,
      installmentAmount,
      totalInstallments: 6,
      paidInstallments: 0,
      nextDueDate: new Date(Date.now() + 30 * 24 * 3600000).toISOString(),
      deductionSource: 'future_deposit',
      status: 'active',
    };
    agentState.autoRepayments.push(autoRepayment);
    agentState.idleFunds = Math.max(0, agentState.idleFunds - amount);
  }

  const logEntry: AgentLogEntry = {
    id: uuidv4(),
    tag: 'LOAN',
    message: autoApproved
      ? `Emergency loan disbursed for ${memberName} — ₹${amount.toLocaleString('en-IN')}`
      : `Loan request routed to approval workflow for ${memberName} — ₹${amount.toLocaleString('en-IN')}`,
    detail: reason,
    amount,
    transactionId,
    timestamp: new Date().toISOString(),
  };
  agentState.agentLog.unshift(logEntry);
  agentState.lastScanAt = new Date().toISOString();
  await persistAgentState();

  return { approved, autoApproved, threshold, transactionId, autoRepayment, logEntry, reason };
}

export function getAgentStatus() {
  // Tick yield accruals
  agentState.vaultPositions.forEach(v => {
    if (v.status === 'active') {
      const hoursStaked = (Date.now() - new Date(v.stakedAt).getTime()) / 3600000;
      v.yieldAccrued = Math.floor((v.deployed * v.apy / 100 / 8760) * hoursStaked);
    }
  });

  return {
    ...agentState,
    totalVaultAUM: agentState.vaultPositions.reduce((s, v) => s + v.deployed, 0),
    pendingYield: agentState.vaultPositions.reduce((s, v) => s + v.yieldAccrued, 0),
    averageAPY: agentState.vaultPositions.length
      ? agentState.vaultPositions.reduce((s, v) => s + v.apy, 0) / agentState.vaultPositions.length
      : 0,
  };
}
