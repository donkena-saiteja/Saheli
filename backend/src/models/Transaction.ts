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
  },
  { timestamps: true }
);

const Transaction = mongoose.model('Transaction', transactionSchema);
export default Transaction;
