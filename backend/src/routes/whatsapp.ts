/**
 * WhatsApp banking transport.
 *
 * Two entry points into the same state machine:
 *   POST /webhook/whatsapp   — live Twilio traffic (TwiML response)
 *   POST /api/whatsapp/simulate — the in-browser simulator
 *
 * Because both share `handleWhatsAppMessage`, what a judge sees in the browser
 * is byte-for-byte what a real WhatsApp user receives.
 */

import express, { Express, Request, Response, Router } from 'express';
import twilio from 'twilio';
import QRCode from 'qrcode';
import {
  handleWhatsAppMessage,
  normalizePhone,
  resetSession,
  DEFAULT_DEMO_MPIN,
} from '../services/whatsappBanking';
import { isDatabaseReady } from '../config/db';

const router = Router();

// ─── Twilio helpers ──────────────────────────────────────────────────────────

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildTwiml(message: string, mediaUrl?: string) {
  // WhatsApp caps a body at 1600 characters.
  const safe = escapeXml(message).slice(0, 1550);
  const media = mediaUrl ? `<Media>${escapeXml(mediaUrl)}</Media>` : '';
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${safe}${media}</Message></Response>`;
}

function signatureValidationEnabled() {
  const raw = (process.env.TWILIO_VALIDATE_SIGNATURE || '').trim().toLowerCase();
  if (!raw) return process.env.NODE_ENV === 'production';
  return ['1', 'true', 'yes', 'on'].includes(raw);
}

function publicRequestUrl(req: Request): string {
  const configured = process.env.PUBLIC_BASE_URL?.trim();
  if (configured) return `${configured.replace(/\/$/, '')}${req.originalUrl}`;
  const proto = req.header('x-forwarded-proto')?.split(',')[0]?.trim() || req.protocol;
  const host = req.header('x-forwarded-host') || req.header('host') || 'localhost';
  return `${proto}://${host}${req.originalUrl}`;
}

export function isValidTwilioRequest(req: Request): boolean {
  if (!signatureValidationEnabled()) return true;

  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const signature = req.header('x-twilio-signature');
  if (!authToken || !signature) return false;

  return twilio.validateRequest(
    authToken,
    signature,
    publicRequestUrl(req),
    (req.body || {}) as Record<string, string>,
  );
}

/** Transcribes a Twilio voice note with Whisper, when a key is configured. */
async function transcribeVoiceNote(mediaUrl: string, contentType?: string): Promise<string | null> {
  const openAiKey = process.env.OPENAI_API_KEY;
  if (!openAiKey || !mediaUrl) return null;

  try {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    const headers: Record<string, string> = {};
    if (sid && token) {
      headers.Authorization = `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`;
    }

    const mediaRes = await fetch(mediaUrl, { headers });
    if (!mediaRes.ok) return null;

    const audio = Buffer.from(await mediaRes.arrayBuffer());
    const form = new FormData();
    form.append('model', 'whisper-1');
    form.append('file', new Blob([new Uint8Array(audio)], { type: contentType || 'audio/ogg' }), 'voice.ogg');

    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${openAiKey}` },
      body: form,
    });
    if (!res.ok) return null;

    const json = (await res.json()) as { text?: string };
    return json.text?.trim() || null;
  } catch {
    return null;
  }
}

// ─── Webhook registration ────────────────────────────────────────────────────

/**
 * Registers the Twilio webhooks on the app. Kept outside the `/api` router so
 * these paths bypass the database-ready guard and can answer Twilio even while
 * the database is still coming up.
 */
export function registerWhatsAppWebhooks(app: Express) {
  app.post('/webhook/whatsapp', express.urlencoded({ extended: false }), async (req, res) => {
    if (!isValidTwilioRequest(req)) {
      res.status(403).type('text/xml').send(buildTwiml('Request signature could not be verified.'));
      return;
    }

    const { Body, From, ProfileName, NumMedia, MediaUrl0, MediaContentType0 } = req.body || {};

    let text = String(Body || '').trim();
    let fromVoice = false;

    const hasAudio = Number(NumMedia || 0) > 0 && /^audio\//i.test(String(MediaContentType0 || ''));
    if (!text && hasAudio) {
      const transcript = await transcribeVoiceNote(MediaUrl0, MediaContentType0);
      if (transcript) {
        text = transcript;
        fromVoice = true;
      }
    }

    if (!text) {
      res
        .type('text/xml')
        .send(
          buildTwiml(
            hasAudio
              ? '🎙️ I received your voice note but could not transcribe it. Please send your request as text, or ask the admin to configure OPENAI_API_KEY.'
              : 'Send *Hi* to start banking with Saheli.',
          ),
        );
      return;
    }

    if (!isDatabaseReady()) {
      res
        .type('text/xml')
        .send(buildTwiml('Saheli is starting up. Please send your message again in a few seconds.'));
      return;
    }

    try {
      const reply = await handleWhatsAppMessage({
        phone: String(From || ''),
        message: text,
        profileName: ProfileName,
        fromVoice,
      });

      console.log(
        `[WhatsApp] ${normalizePhone(String(From))} -> state=${reply.state} action=${reply.action || 'n/a'}`,
      );

      res.type('text/xml').send(buildTwiml(reply.message, reply.mediaUrl));
    } catch (err) {
      console.error('[WhatsApp] handler error:', err);
      res
        .type('text/xml')
        .send(buildTwiml('Something went wrong on our side. Please send *MENU* to try again.'));
    }
  });

  app.post('/webhook/twilio/status', express.urlencoded({ extended: false }), (req, res) => {
    if (!isValidTwilioRequest(req)) {
      res.status(403).json({ success: false, error: 'Invalid Twilio signature' });
      return;
    }

    const { MessageSid, MessageStatus, To, ErrorCode, ErrorMessage } = req.body || {};
    console.log(
      `[Twilio Status] sid=${MessageSid} status=${MessageStatus} to=${To}` +
        `${ErrorCode ? ` errorCode=${ErrorCode}` : ''}${ErrorMessage ? ` error=${ErrorMessage}` : ''}`,
    );

    res.json({ success: true });
  });
}

// ─── Browser simulator (same state machine) ──────────────────────────────────

router.post('/simulate', async (req: Request, res: Response) => {
  const { phone, message, profileName, fromVoice } = req.body || {};

  if (!phone || !message) {
    res.status(400).json({ success: false, error: 'phone and message are required' });
    return;
  }

  const reply = await handleWhatsAppMessage({
    phone: String(phone),
    message: String(message),
    profileName,
    fromVoice: Boolean(fromVoice),
  });

  // Attach a QR image inline when the step produced a proof.
  let qrCode: string | undefined;
  if (reply.showQR && reply.transactionId) {
    try {
      qrCode = await QRCode.toDataURL(
        JSON.stringify({
          platform: 'Saheli',
          transactionId: reply.transactionId,
          verifyUrl: reply.explorerUrl,
          amount: reply.amount,
        }),
        { errorCorrectionLevel: 'M', width: 300, margin: 2 },
      );
    } catch {
      /* QR is a nice-to-have */
    }
  }

  res.json({ success: true, data: { ...reply, qrCode } });
});

router.post('/reset', async (req: Request, res: Response) => {
  const { phone } = req.body || {};
  if (!phone) {
    res.status(400).json({ success: false, error: 'phone is required' });
    return;
  }
  await resetSession(String(phone));
  res.json({ success: true, data: { reset: true } });
});

router.get('/info', (_req: Request, res: Response) => {
  const configured = Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
  res.json({
    success: true,
    data: {
      provider: 'twilio',
      configured,
      sandboxNumber: process.env.TWILIO_WHATSAPP_FROM || process.env.TWILIO_WHATSAPP_NUMBER || 'whatsapp:+14155238886',
      webhookPath: '/webhook/whatsapp',
      statusCallbackPath: '/webhook/twilio/status',
      demoMpin: DEFAULT_DEMO_MPIN,
      voiceSupported: Boolean(process.env.OPENAI_API_KEY),
      style: 'numbered-menu (SBI-style); works on Twilio Sandbox with no template approval',
    },
  });
});

export default router;
