import mongoose from 'mongoose';

const multiSigActionSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true, index: true },
    type: {
      type: String,
      enum: ['loan_approval', 'fund_deployment', 'yield_rebalance', 'grant_disbursement'],
      required: true,
    },
    description: { type: String, required: true },
    amount: { type: Number, required: true },
    requestedBy: { type: String, required: true },
    signatures: { type: [String], default: [] },
    signaturesRequired: { type: Number, default: 3 },
    status: { type: String, enum: ['pending', 'executed', 'rejected'], default: 'pending' },
    isEmergency: { type: Boolean, default: false },
    linkedLoanId: { type: String },
    destinationRole: { type: String, enum: ['leader', 'bank'], default: 'leader' },
    createdAt: { type: String, required: true },
    transactionId: { type: String },
  },
  { timestamps: true },
);

const MultiSigAction = mongoose.model('MultiSigAction', multiSigActionSchema);
export default MultiSigAction;
