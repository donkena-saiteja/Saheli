import crypto from 'crypto';

type SendWhatsAppArgs = {
  toPhone: string;
  body?: string;
  mediaUrl?: string;
  contentSid?: string;
  contentVariables?: Record<string, string | number | boolean>;
};

type SendQRWhatsAppArgs = {
  toPhone: string;
  memberName?: string;
  transactionId: string;
  explorerUrl: string;
  qrDataUrl: string;
};

function normalizePhone(phone: string): string {
  const trimmed = phone.trim();
  if (trimmed.startsWith('whatsapp:')) {
    return trimmed;
  }

  const compact = trimmed.replace(/[\s-]/g, '');
  const withPlus = compact.startsWith('+') ? compact : `+${compact}`;
  return `whatsapp:${withPlus}`;
}

function getTwilioFromAddress(): string {
  const from = process.env.TWILIO_WHATSAPP_FROM || process.env.TWILIO_WHATSAPP_NUMBER;
  if (!from) {
    throw new Error('TWILIO_WHATSAPP_FROM or TWILIO_WHATSAPP_NUMBER is not configured');
  }
  return normalizePhone(from);
}

function getTwilioStatusCallbackUrl(): string | undefined {
  const explicit = process.env.TWILIO_STATUS_CALLBACK_URL?.trim();
  if (explicit) {
    return explicit;
  }

  const publicBaseUrl = process.env.PUBLIC_BASE_URL?.trim();
  if (!publicBaseUrl) {
    return undefined;
  }

  return `${publicBaseUrl.replace(/\/$/, '')}/webhook/twilio/status`;
}

async function uploadQRCodeToCloudinary(qrDataUrl: string, publicId: string): Promise<string> {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  if (!cloudName) {
    throw new Error('CLOUDINARY_CLOUD_NAME is not configured');
  }

  const folder = process.env.CLOUDINARY_FOLDER || 'saheli/qr-proofs';
  const uploadPreset = process.env.CLOUDINARY_UPLOAD_PRESET;

  const formData = new FormData();
  formData.append('file', qrDataUrl);
  formData.append('folder', folder);
  formData.append('public_id', publicId);

  if (uploadPreset) {
    // Unsigned upload flow using preset
    formData.append('upload_preset', uploadPreset);
  } else {
    // Signed upload flow using API key + secret
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;
    if (!apiKey || !apiSecret) {
      throw new Error('Cloudinary credentials missing. Set CLOUDINARY_UPLOAD_PRESET or CLOUDINARY_API_KEY/CLOUDINARY_API_SECRET');
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const toSign = `folder=${folder}&public_id=${publicId}&timestamp=${timestamp}`;
    const signature = crypto.createHash('sha1').update(`${toSign}${apiSecret}`).digest('hex');

    formData.append('api_key', apiKey);
    formData.append('timestamp', String(timestamp));
    formData.append('signature', signature);
  }

  const uploadRes = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
    method: 'POST',
    body: formData,
  });

  const uploadJson = (await uploadRes.json().catch(() => ({}))) as {
    secure_url?: string;
    error?: { message?: string };
  };

  if (!uploadRes.ok || !uploadJson.secure_url) {
    throw new Error(uploadJson.error?.message || 'Cloudinary upload failed');
  }

  return uploadJson.secure_url;
}

export async function sendWhatsAppMessage({
  toPhone,
  body,
  mediaUrl,
  contentSid,
  contentVariables,
}: SendWhatsAppArgs) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;

  if (!accountSid || !authToken) {
    throw new Error('TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN is not configured');
  }

  if (!body && !contentSid) {
    throw new Error('Either body or contentSid is required to send a WhatsApp message');
  }

  const params = new URLSearchParams();
  params.set('To', normalizePhone(toPhone));
  if (messagingServiceSid) {
    params.set('MessagingServiceSid', messagingServiceSid);
  } else {
    params.set('From', getTwilioFromAddress());
  }

  if (body) {
    params.set('Body', body);
  }

  if (contentSid) {
    params.set('ContentSid', contentSid);
    if (contentVariables && Object.keys(contentVariables).length > 0) {
      params.set('ContentVariables', JSON.stringify(contentVariables));
    }
  }

  if (mediaUrl) {
    params.append('MediaUrl', mediaUrl);
  }

  const statusCallback = getTwilioStatusCallbackUrl();
  if (statusCallback) {
    params.set('StatusCallback', statusCallback);
  }

  const twilioRes = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  const twilioJson = (await twilioRes.json().catch(() => ({}))) as {
    sid?: string;
    status?: string;
    message?: string;
    code?: number;
  };

  if (!twilioRes.ok || !twilioJson.sid) {
    throw new Error(twilioJson.message || `Twilio request failed (${twilioRes.status})`);
  }

  return {
    sid: twilioJson.sid,
    status: twilioJson.status || 'queued',
  };
}

export async function sendQRCodeWhatsAppReceipt({
  toPhone,
  memberName,
  transactionId,
  explorerUrl,
  qrDataUrl,
}: SendQRWhatsAppArgs) {
  const publicId = `qr-${transactionId.slice(0, 16)}-${Date.now()}`;
  const mediaUrl = await uploadQRCodeToCloudinary(qrDataUrl, publicId);

  const body = [
    `Namaste ${memberName || 'Member'}!`,
    'Your Saheli transaction QR proof is ready.',
    `Transaction ID: ${transactionId}`,
    `Verify: ${explorerUrl}`,
  ].join('\n');

  const message = await sendWhatsAppMessage({
    toPhone,
    body,
    mediaUrl,
  });

  return {
    mediaUrl,
    messageSid: message.sid,
    twilioStatus: message.status,
  };
}

export async function sendWhatsAppTemplateMessage(args: {
  toPhone: string;
  contentSid: string;
  contentVariables?: Record<string, string | number | boolean>;
}) {
  return sendWhatsAppMessage({
    toPhone: args.toPhone,
    contentSid: args.contentSid,
    contentVariables: args.contentVariables,
  });
}
