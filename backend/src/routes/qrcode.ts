import { Router, Request, Response } from 'express';
import QRCode from 'qrcode';
import { verifyTransaction } from '../services/txEngine';
import { anchorLedgerEntry, explorerTxUrl, getCaip2Network, verifyOnChain } from '../services/algorand';
import { sendQRCodeWhatsAppReceipt } from '../services/whatsapp';
import mongoose from 'mongoose';
import User from '../models/User';

const router = Router();

/** Absolute base URL for links that must resolve from someone else's device. */
function getPublicBaseUrl(req: Request): string {
  const configured = process.env.PUBLIC_BASE_URL?.trim();
  if (configured) return configured.replace(/\/$/, '');
  const proto = req.header('x-forwarded-proto')?.split(',')[0]?.trim() || req.protocol;
  const host = req.header('x-forwarded-host') || req.header('host') || 'localhost:3001';
  return `${proto}://${host}`;
}

// POST /api/qr/generate
router.post('/generate', async (req: Request, res: Response) => {
  try {
    const {
      transactionId,
      memberId,
      memberName,
      memberPhone,
      amount,
      type,
      autoSendWhatsApp = true,
    } = req.body;

    const hash =
      transactionId ||
      (
        await anchorLedgerEntry({
          kind: 'deposit',
          memberId: memberId || undefined,
          amount,
          detail: 'standalone QR proof',
        })
      ).txId;
    let resolvedMemberName = memberName;
    let resolvedPhone = memberPhone;

    if ((!resolvedMemberName || !resolvedPhone) && memberId && mongoose.Types.ObjectId.isValid(memberId)) {
      const member = await User.findById(memberId).select('name phone role').lean();
      if (member && member.role === 'member') {
        resolvedMemberName = resolvedMemberName || member.name;
        resolvedPhone = resolvedPhone || member.phone;
      }
    }

    // The scanner may be an offline bank officer with no knowledge of our host,
    // so every URL in the payload has to be absolute. A relative path here
    // makes the proof unverifiable, which defeats the entire feature.
    const explorerUrl = explorerTxUrl(hash);
    const verifyUrl = `${getPublicBaseUrl(req)}/api/qr/verify/${hash}`;
    const chainStatus = await verifyTransaction(hash);

    const qrPayload = JSON.stringify({
      platform: 'Saheli',
      version: 2,
      transactionId: hash,
      memberId: memberId || undefined,
      memberName: resolvedMemberName || 'Member',
      amount,
      type: type || 'deposit',
      verified: true,
      txStatus: chainStatus.status,
      network: getCaip2Network(),
      explorerUrl,
      verifyUrl,
      timestamp: new Date().toISOString(),
    });

    const qrDataUrl = await QRCode.toDataURL(qrPayload, {
      errorCorrectionLevel: 'M',
      type: 'image/png',
      width: 300,
      margin: 2,
      color: {
        dark: '#191C1D',
        light: '#FFFFFF',
      },
    });

    const targetPhone = resolvedPhone;

    let whatsapp: {
      attempted: boolean;
      sent: boolean;
      messageSid?: string;
      mediaUrl?: string;
      status?: string;
      error?: string;
    } = {
      attempted: false,
      sent: false,
    };

    if (autoSendWhatsApp && targetPhone) {
      whatsapp.attempted = true;
      try {
        const delivery = await sendQRCodeWhatsAppReceipt({
          toPhone: targetPhone,
          memberName: resolvedMemberName || 'Member',
          transactionId: hash,
          explorerUrl,
          qrDataUrl,
        });
        whatsapp = {
          attempted: true,
          sent: true,
          messageSid: delivery.messageSid,
          mediaUrl: delivery.mediaUrl,
          status: delivery.twilioStatus,
        };
      } catch (error) {
        const errMessage = error instanceof Error ? error.message : 'Failed to send WhatsApp message';
        whatsapp = {
          attempted: true,
          sent: false,
          error: errMessage,
        };
      }
    }

    res.json({
      success: true,
      data: {
        transactionId: hash,
        qrCode: qrDataUrl,
        payload: JSON.parse(qrPayload),
        whatsapp,
        message: whatsapp.sent
          ? 'QR proof generated and sent to member on WhatsApp.'
          : 'QR proof generated. Share this with any bank officer to verify.',
      },
    });
  } catch (_err) {
    res.status(500).json({ success: false, error: 'QR generation failed' });
  }
});

// GET /api/qr/verify/:transactionId
// Checks the Algorand ledger first, then our own records. An institution
// should be able to trust this without trusting us.
router.get('/verify/:transactionId', async (req: Request, res: Response) => {
  const { transactionId } = req.params;

  const [ledger, chain] = await Promise.all([
    verifyTransaction(transactionId),
    verifyOnChain(transactionId),
  ]);

  const verdict = chain.found
    ? 'VERIFIED_ONCHAIN'
    : ledger.valid
      ? 'VERIFIED_LEDGER'
      : 'NOT_FOUND';

  res.json({
    success: true,
    data: {
      transactionId,
      ...ledger,
      verdict,
      onChain: chain,
      explorerUrl: explorerTxUrl(transactionId),
      network: getCaip2Network(),
      message:
        verdict === 'VERIFIED_ONCHAIN'
          ? 'Transaction confirmed on the Algorand ledger.'
          : verdict === 'VERIFIED_LEDGER'
            ? 'Transaction present in the Saheli ledger; on-chain settlement is pending or simulated.'
            : 'Transaction not found.',
    },
  });
});

export default router;
