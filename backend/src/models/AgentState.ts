import mongoose from 'mongoose';

const vaultPositionSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    protocol: { type: String, required: true },
    asset: { type: String, required: true },
    deployed: { type: Number, required: true },
    apy: { type: Number, required: true },
    yieldAccrued: { type: Number, default: 0 },
    stakedAt: { type: String, required: true },
    transactionId: { type: String, required: true },
    status: { type: String, enum: ['active', 'withdrawing', 'completed'], default: 'active' },
  },
  { _id: false },
);

const autoRepaymentSchema = new mongoose.Schema(
  {
    loanId: { type: String, required: true },
    memberId: { type: String, required: true },
    memberName: { type: String, required: true },
    installmentAmount: { type: Number, required: true },
    totalInstallments: { type: Number, required: true },
    paidInstallments: { type: Number, default: 0 },
    nextDueDate: { type: String, required: true },
    deductionSource: { type: String, enum: ['future_deposit', 'yield_share'], required: true },
    status: { type: String, enum: ['active', 'completed', 'defaulted'], default: 'active' },
  },
  { _id: false },
);

const agentLogEntrySchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    tag: { type: String, enum: ['LOAN', 'VAULT', 'REPAY', 'ALERT', 'SYSTEM'], required: true },
    message: { type: String, required: true },
    detail: { type: String },
    amount: { type: Number },
    transactionId: { type: String },
    timestamp: { type: String, required: true },
  },
  { _id: false },
);

const agentStateSchema = new mongoose.Schema(
  {
    key: { type: String, unique: true, required: true, default: 'singleton' },
    idleFunds: { type: Number, required: true },
    totalDeployed: { type: Number, required: true },
    totalYieldHarvested: { type: Number, required: true },
    lastScanAt: { type: String, required: true },
    vaultPositions: { type: [vaultPositionSchema], default: [] },
    autoRepayments: { type: [autoRepaymentSchema], default: [] },
    agentLog: { type: [agentLogEntrySchema], default: [] },
  },
  { timestamps: true },
);

const AgentState = mongoose.model('AgentState', agentStateSchema);
export default AgentState;
