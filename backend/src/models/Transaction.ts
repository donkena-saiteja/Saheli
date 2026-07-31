import mongoose from 'mongoose';

const transactionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { 
      type: String, 
      enum: ['deposit', 'withdrawal', 'loan_disbursement', 'loan_repayment', 'yield'], 
      required: true 
    },
    amount: { type: Number, required: true },
    description: { type: String, required: true },
    transactionId: { type: String },
    status: { type: String, enum: ['confirmed', 'pending', 'failed'], default: 'pending' },
    agentProcessed: { type: Boolean, default: false },

    /**
     * Whether `transactionId` resolves on the Algorand explorer.
     *
     * 'live'      — broadcast and confirmed on chain; the explorer link works.
     * 'simulated' — anchored locally because the relayer was unfunded or algod
     *               was unreachable. The id is well-formed but exists nowhere.
     *
     * Recorded per row rather than derived, because the relayer can be funded
     * mid-session and history must stay truthful about what happened then.
     */
    settlementMode: { type: String, enum: ['live', 'simulated'], default: 'simulated' },
  },
  { timestamps: true }
);

const Transaction = mongoose.model('Transaction', transactionSchema);
export default Transaction;
