import mongoose from 'mongoose';

/**
 * Ledger of every x402 pay-per-use settlement. Doubles as the revenue book
 * that shows how much institutional API spend flowed back into SHG treasuries.
 */
const x402PaymentSchema = new mongoose.Schema(
  {
    resourceId: { type: String, required: true, index: true },
    resourcePath: { type: String, required: true },
    method: { type: String, default: 'GET' },

    scheme: { type: String, default: 'exact' },
    network: { type: String, required: true },
    asset: { type: String, required: true },
    /** Atomic units of the settlement asset. */
    amount: { type: String, required: true },
    displayAmount: { type: String },

    payer: { type: String },
    payerType: { type: String, enum: ['bank', 'ngo', 'fintech', 'agent'], default: 'bank' },
    payTo: { type: String, required: true },

    transactionId: { type: String, index: true },
    settlement: { type: String, enum: ['onchain', 'simulated', 'failed'], default: 'simulated' },
    confirmedRound: { type: Number },
    explorerUrl: { type: String },

    /** Portion of this payment credited to the SHG treasury, in atomic units. */
    treasuryShare: { type: String, default: '0' },
    treasuryShareBps: { type: Number, default: 0 },

    status: { type: String, enum: ['settled', 'failed'], default: 'settled', index: true },
    errorReason: { type: String },

    shgId: { type: String, index: true },
    requestedBy: { type: String },
  },
  { timestamps: true },
);

const X402Payment = mongoose.model('X402Payment', x402PaymentSchema);
export default X402Payment;
