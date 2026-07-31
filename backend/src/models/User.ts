import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    phone: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, enum: ['member', 'leader', 'bank'], default: 'member' },
    shgId: { type: String },

    /** Hashed 4-digit MPIN for WhatsApp banking. Falls back to the demo MPIN. */
    mpinHash: { type: String, select: false },
    /** Derived Algorand address. Cached so dashboards avoid re-deriving. */
    algorandAddress: { type: String },


    // Stats (from previous mock data compatibility)
    trustScore: { type: Number, default: 750 },
    trustGrade: { type: String, default: 'GOOD' },
    totalSavings: { type: Number, default: 0 },
    activeLoans: { type: Number, default: 0 },
    activeLoansAmount: { type: Number, default: 0 },
    yieldEarned: { type: Number, default: 0 },
    repaymentRate: { type: Number, default: 100 },
    badges: [{ type: String }],
  },
  { timestamps: true }
);

// Match user entered password to hashed password in database
userSchema.methods.matchPassword = async function (enteredPassword: string) {
  return await bcrypt.compare(enteredPassword, this.password);
};

// Encrypt password using bcrypt
userSchema.pre('save', async function () {
  if (!this.isModified('password')) {
    return;
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

const User = mongoose.model('User', userSchema);
export default User;
