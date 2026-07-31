import express, { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import User from '../models/User';
import { protect } from '../middleware/auth';
import { seedDemoData } from '../services/seed';
import {
  createChallenge,
  isValidAlgorandAddress,
  shortenAddress,
  verifyChallenge,
} from '../services/walletAuth';
import { explorerAccountUrl, getCaip2Network } from '../services/algorand';

const router = express.Router();

const VALID_ROLES = ['member', 'leader', 'bank'] as const;
type Role = (typeof VALID_ROLES)[number];

function normalizeRole(role: unknown): Role {
  return VALID_ROLES.includes(role as Role) ? (role as Role) : 'member';
}

const generateToken = (id: string) => {
  return jwt.sign({ id }, process.env.JWT_SECRET || 'saheli_secret_key_123', {
    expiresIn: '30d',
  });
};

router.post('/register', async (req: Request, res: Response) => {
  try {
    const { name, password, role, shgId } = req.body;
    const phone = String(req.body?.phone || '').trim();

    if (!name || !phone || !password) {
      return res.status(400).json({ success: false, error: 'name, phone and password are required' });
    }

    const userExists = await User.findOne({ phone });
    if (userExists) {
      return res.status(400).json({ success: false, error: 'User already exists with this phone number' });
    }

    const user = await User.create({
      name,
      phone,
      password,
      role: normalizeRole(role),
      shgId,
      authProvider: 'password',
    });

    res.status(201).json({
      success: true,
      data: {
        _id: user._id,
        name: user.name,
        phone: user.phone,
        role: user.role,
        shgId: user.shgId,
        walletAddress: user.walletAddress,
        authProvider: user.authProvider,
        token: generateToken(user._id as unknown as string),
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/login', async (req: Request, res: Response) => {
  try {
    const phone = String(req.body?.phone || '').trim();
    const { password } = req.body;
    const user = phone ? await User.findOne({ phone }) : null;

    if (user && (await (user as any).matchPassword(password))) {
      res.json({
        success: true,
        data: {
          _id: user._id,
          name: user.name,
          phone: user.phone,
          role: user.role,
          shgId: user.shgId,
          walletAddress: user.walletAddress,
          authProvider: user.authProvider,
          token: generateToken(user._id as unknown as string),
        }
      });
    } else {
      res.status(401).json({ success: false, error: 'Invalid phone number or password' });
    }
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ─── Pera Wallet sign-in ───────────────────────────────────────────────────
// Two steps: ask for a challenge, then return it signed. The server never sees
// a key, and each nonce is single-use so a captured signature cannot be replayed.

// POST /api/auth/wallet/challenge  { address }
router.post('/wallet/challenge', async (req: Request, res: Response) => {
  try {
    const address = String(req.body?.address || '').trim();

    if (!isValidAlgorandAddress(address)) {
      return res.status(400).json({
        success: false,
        error: 'A valid 58-character Algorand address is required.',
      });
    }

    const challenge = createChallenge(address);
    const existing = await User.findOne({ walletAddress: address }).select('name role shgId').lean();

    res.json({
      success: true,
      data: {
        address,
        nonce: challenge.nonce,
        message: challenge.message,
        expiresAt: new Date(challenge.expiresAt).toISOString(),
        network: getCaip2Network(),
        // Lets the UI say "welcome back" instead of asking for a name again.
        knownAccount: existing
          ? { name: (existing as any).name, role: (existing as any).role, shgId: (existing as any).shgId }
          : null,
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/auth/wallet/verify  { address, nonce, signature, name?, role?, shgId? }
router.post('/wallet/verify', async (req: Request, res: Response) => {
  try {
    const address = String(req.body?.address || '').trim();
    const nonce = String(req.body?.nonce || '');
    const signature = String(req.body?.signature || '');

    if (!isValidAlgorandAddress(address) || !nonce || !signature) {
      return res.status(400).json({
        success: false,
        error: 'address, nonce and signature are all required.',
      });
    }

    const verification = verifyChallenge({ address, nonce, signature });
    if (!verification.ok) {
      const messages: Record<string, string> = {
        unknown_nonce: 'Challenge not found. It may have already been used — please connect again.',
        expired: 'Challenge expired. Please connect again.',
        address_mismatch: 'The signing account does not match the account that requested the challenge.',
        malformed_signature: 'Signature is not a valid 64-byte ed25519 signature.',
        bad_signature: 'Signature does not match this Algorand address.',
      };
      return res.status(401).json({
        success: false,
        error: messages[verification.reason || ''] || 'Wallet signature verification failed.',
        reason: verification.reason,
      });
    }

    let user = await User.findOne({ walletAddress: address });
    let created = false;

    if (!user) {
      user = await User.create({
        name: String(req.body?.name || '').trim() || `Pera ${shortenAddress(address)}`,
        role: normalizeRole(req.body?.role),
        shgId: req.body?.shgId ? String(req.body.shgId).trim() : undefined,
        walletAddress: address,
        authProvider: 'pera-wallet',
        algorandAddress: address,
      });
      created = true;
    }

    res.status(created ? 201 : 200).json({
      success: true,
      data: {
        _id: user._id,
        name: user.name,
        phone: user.phone,
        role: user.role,
        shgId: user.shgId,
        walletAddress: user.walletAddress,
        authProvider: user.authProvider,
        explorerUrl: explorerAccountUrl(address),
        isNewAccount: created,
        token: generateToken(user._id as unknown as string),
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Links a Pera wallet to the account that is already signed in, so an existing
 * password user can upgrade to self-custody without losing their history.
 */
// POST /api/auth/wallet/link  { address, nonce, signature }
router.post('/wallet/link', protect, async (req: any, res: Response) => {
  try {
    const address = String(req.body?.address || '').trim();
    const nonce = String(req.body?.nonce || '');
    const signature = String(req.body?.signature || '');

    if (!isValidAlgorandAddress(address) || !nonce || !signature) {
      return res.status(400).json({
        success: false,
        error: 'address, nonce and signature are all required.',
      });
    }

    const verification = verifyChallenge({ address, nonce, signature });
    if (!verification.ok) {
      return res.status(401).json({
        success: false,
        error: 'Wallet signature verification failed.',
        reason: verification.reason,
      });
    }

    const claimedBy = await User.findOne({ walletAddress: address }).select('_id').lean();
    if (claimedBy && String((claimedBy as any)._id) !== String(req.user._id)) {
      return res.status(409).json({
        success: false,
        error: 'That wallet is already linked to another Saheli account.',
      });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    user.walletAddress = address;
    await user.save();

    res.json({
      success: true,
      data: {
        _id: user._id,
        name: user.name,
        walletAddress: user.walletAddress,
        explorerUrl: explorerAccountUrl(address),
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/profile', protect, async (req: any, res: Response) => {
  const user = await User.findById(req.user._id).select('-password');
  if (user) {
    res.json({ success: true, data: user });
  } else {
    res.status(404).json({ success: false, error: 'User not found' });
  }
});

// ─── Demo Seed ─────────────────────────────────────────────────────────────
// Builds a full SHG with deposit history, loans and d-SBT passports.
// Pass { "reset": true } to wipe first for a deterministic re-run mid-demo.
router.post('/seed-demo', async (req: Request, res: Response) => {
  try {
    const result = await seedDemoData(Boolean(req.body?.reset));
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
