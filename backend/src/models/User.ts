import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },

    // Phone is the primary identifier for password sign-in, but wallet users
    // sign in with a signature instead and may never supply one. Sparse keeps
    // the uniqueness guarantee without rejecting multiple phone-less accounts.
    phone: { type: String, unique: true, sparse: true },
    password: {
      type: String,
      required(this: { walletAddress?: string }) {
        return !this.walletAddress;
      },
    },
    role: { type: String, enum: ['member', 'leader', 'bank'], default: 'member' },
    shgId: { type: String },

    /**
     * Self-custodied Algorand address proven by a Pera Wallet signature.
     * Distinct from `algorandAddress`, which is the platform-derived custodial
     * account. A user can have both: custodial for gasless SHG flows, Pera for
     * authentication and self-custody.
     */
    walletAddress: { type: String, unique: true, sparse: true },
    /** How this account authenticates. */
    authProvider: { type: String, enum: ['password', 'pera-wallet'], default: 'password' },

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

// Match user entered password to hashed password in database.
// Wallet-only accounts have no password hash — bcrypt.compare would throw on
// undefined, so refuse the password path explicitly instead.
userSchema.methods.matchPassword = async function (enteredPassword: string) {
  if (!this.password || !enteredPassword) return false;
  return await bcrypt.compare(enteredPassword, this.password);
};

// Encrypt password using bcrypt
userSchema.pre('save', async function () {
  if (!this.isModified('password') || !this.password) {
    return;
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

const User = mongoose.model('User', userSchema);
export default User;
