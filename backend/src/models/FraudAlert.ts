import mongoose from 'mongoose';

/**
 * A finding raised by the autonomous compliance agent.
 *
 * Alerts are persisted rather than recomputed on every request so that a
 * reviewer's triage decision (`open` -> `cleared` / `escalated`) survives the
 * next scan, and so the audit trail shows what the agent knew and when.
 */
const fraudAlertSchema = new mongoose.Schema(
  {
    /** Stable hash of the underlying signal, so re-scans update instead of duplicating. */
    fingerprint: { type: String, required: true, unique: true, index: true },

    category: {
      type: String,
      enum: [
        'structuring',
        'velocity',
        'dormant_spike',
        'round_tripping',
        'over_exposure',
        'duplicate_reference',
        'unverifiable_anchor',
        'off_hours',
        'sanctioned_pattern',
        'other',
      ],
      required: true,
    },
    severity: { type: String, enum: ['low', 'medium', 'high', 'critical'], default: 'medium' },
    /** 0-100. Drives ranking in the reviewer queue. */
    riskScore: { type: Number, default: 50 },

    title: { type: String, required: true },
    summary: { type: String, required: true },
    /** What a human should actually do about it. */
    recommendedAction: { type: String, default: 'Review with the SHG leader.' },
    /** Regulation or policy the pattern maps to, when one applies. */
    regulatoryBasis: { type: String },

    subject: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    subjectName: { type: String },
    amount: { type: Number, default: 0 },
    transactionIds: { type: [String], default: [] },

    status: { type: String, enum: ['open', 'cleared', 'escalated'], default: 'open' },
    reviewedBy: { type: String },
    reviewedAt: { type: Date },
    reviewNote: { type: String },

    /** 'openai' when the narrative came from the LLM, 'rules' when deterministic. */
    source: { type: String, enum: ['openai', 'rules'], default: 'rules' },
    detectedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

fraudAlertSchema.index({ status: 1, riskScore: -1 });

const FraudAlert = mongoose.model('FraudAlert', fraudAlertSchema);
export default FraudAlert;
