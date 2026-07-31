import mongoose from 'mongoose';

/**
 * A WhatsApp banking session, modelled on how SBI/HDFC WhatsApp banking works:
 * the user authenticates with an MPIN, then navigates a numbered menu, and
 * every money movement needs an explicit YES confirmation.
 *
 * Sessions are persisted so a conversation survives a server restart mid-demo.
 */
export const SESSION_STATES = [
  'GREETING',
  'AWAITING_MPIN',
  'MENU',
  'AWAITING_DEPOSIT_AMOUNT',
  'AWAITING_WITHDRAW_AMOUNT',
  'AWAITING_LOAN_AMOUNT',
  'AWAITING_LOAN_PURPOSE',
  'AWAITING_CONFIRMATION',
  'AWAITING_LANGUAGE',
  'LOCKED',
] as const;

export type SessionState = (typeof SESSION_STATES)[number];

const whatsAppSessionSchema = new mongoose.Schema(
  {
    /** Normalised digits-only phone number, used as the session key. */
    phone: { type: String, required: true, unique: true, index: true },
    waId: { type: String },
    profileName: { type: String },

    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    authenticated: { type: Boolean, default: false },
    mpinAttempts: { type: Number, default: 0 },
    lockedUntil: { type: Date },

    state: { type: String, enum: SESSION_STATES, default: 'GREETING' },
    language: { type: String, default: 'en' },

    /** Whatever the current step needs to remember (amount, purpose, action). */
    context: { type: mongoose.Schema.Types.Mixed, default: {} },

    lastMessageAt: { type: Date, default: Date.now },
    messageCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);

const WhatsAppSession = mongoose.model('WhatsAppSession', whatsAppSessionSchema);
export default WhatsAppSession;
