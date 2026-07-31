import mongoose from 'mongoose';

/**
 * Dynamic Soulbound Token — a member's "Financial Health Passport".
 *
 * Non-transferable by construction: the record is bound to a derived Algorand
 * address the member does not control transfer rights over, and every score
 * change is re-anchored on chain so a bank can audit the whole trajectory
 * rather than trusting a single number.
 */
const dsbtHistorySchema = new mongoose.Schema(
  {
    score: { type: Number, required: true },
    tier: { type: String, required: true },
    reason: { type: String, required: true },
    delta: { type: Number, default: 0 },
    transactionId: { type: String },
    explorerUrl: { type: String },
    chainMode: { type: String, enum: ['live', 'simulated'], default: 'simulated' },
    at: { type: String, required: true },
  },
  { _id: false },
);

const dsbtSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
    shgId: { type: String, index: true },

    /** Algorand address the passport is bound to. */
    address: { type: String, required: true },
    /** ASA id when a real soulbound asset has been minted. */
    assetId: { type: Number, default: 0 },

    score: { type: Number, default: 750, min: 0, max: 1000 },
    tier: { type: String, enum: ['BRONZE', 'SILVER', 'GOLD', 'PLATINUM'], default: 'SILVER' },

    onTimeRepayments: { type: Number, default: 0 },
    lateRepayments: { type: Number, default: 0 },
    totalBorrowed: { type: Number, default: 0 },
    totalRepaid: { type: Number, default: 0 },
    consecutiveOnTimeDeposits: { type: Number, default: 0 },

    /** Latest on-chain anchor of the passport state. */
    lastAnchorTxId: { type: String },
    lastAnchorUrl: { type: String },
    lastAnchorMode: { type: String, enum: ['live', 'simulated'], default: 'simulated' },
    mintedAt: { type: Date },

    history: { type: [dsbtHistorySchema], default: [] },
  },
  { timestamps: true },
);

const DSBT = mongoose.model('DSBT', dsbtSchema);
export default DSBT;
