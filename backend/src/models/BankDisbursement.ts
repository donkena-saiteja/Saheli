import mongoose from 'mongoose';

const bankDisbursementSchema = new mongoose.Schema(
  {
    loan: { type: mongoose.Schema.Types.ObjectId, ref: 'Loan', required: true, index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    amount: { type: Number, required: true },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
    bankReference: { type: String },
    transactionId: { type: String },
    queuedAt: { type: Date, default: Date.now },
    processedAt: { type: Date },
    processedBy: { type: String },
    notes: { type: String },
  },
  { timestamps: true },
);

const BankDisbursement = mongoose.model('BankDisbursement', bankDisbursementSchema);
export default BankDisbursement;
