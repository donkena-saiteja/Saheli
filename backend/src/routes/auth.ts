import express, { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import User from '../models/User';
import { protect } from '../middleware/auth';
import { seedDemoData } from '../services/seed';

const router = express.Router();

const generateToken = (id: string) => {
  return jwt.sign({ id }, process.env.JWT_SECRET || 'saheli_secret_key_123', {
    expiresIn: '30d',
  });
};

router.post('/register', async (req: Request, res: Response) => {
  try {
    const { name, phone, password, role, shgId } = req.body;

    const userExists = await User.findOne({ phone });
    if (userExists) {
      return res.status(400).json({ success: false, error: 'User already exists with this phone number' });
    }

    const user = await User.create({
      name,
      phone,
      password,
      role: role || 'member',
      shgId
    });

    if (user) {
      res.status(201).json({
        success: true,
        data: {
          _id: user._id,
          name: user.name,
          phone: user.phone,
          role: user.role,
          shgId: user.shgId,
          token: generateToken(user._id as unknown as string),
        }
      });
    } else {
      res.status(400).json({ success: false, error: 'Invalid user data format' });
    }
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/login', async (req: Request, res: Response) => {
  try {
    const { phone, password } = req.body;
    const user = await User.findOne({ phone });

    if (user && (await (user as any).matchPassword(password))) {
      res.json({
        success: true,
        data: {
          _id: user._id,
          name: user.name,
          phone: user.phone,
          role: user.role,
          shgId: user.shgId,
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
