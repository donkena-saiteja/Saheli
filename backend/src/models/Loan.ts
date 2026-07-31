import mongoose from 'mongoose';

const loanSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    amount: { type: Number, required: true },
    purpose: { type: String, required: true },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'bank_pending', 'repaying', 'repaid'],
      default: 'pending',
    },
    trustScoreAtApplication: { type: Number },
    
    // AI Agent fields
    aiRecommendation: { type: String, enum: ['approve', 'review', 'reject'] },
    aiReason: { type: String },
    
    // Approval workflow
    approvals: { type: Number, default: 0 },
    approvalsRequired: { type: Number, default: 3 },
    
    // Lifecycle
    disbursedAt: { type: Date },
    dueDate: { type: Date },
    repaidAmount: { type: Number, default: 0 },
    transactionId: { type: String },
  },
  { timestamps: true }
);

const Loan = mongoose.model('Loan', loanSchema);
export default Loan;
