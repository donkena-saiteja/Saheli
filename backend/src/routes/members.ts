import { Router, Request, Response } from 'express';
import User from '../models/User';
import Transaction from '../models/Transaction';

const router = Router();

// GET /api/members — Public (Leaders & Banks see all)
router.get('/', async (_req: Request, res: Response) => {
  try {
    const members = await User.find({ role: 'member' }).select('-password');
    res.json({ success: true, data: members });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/members/:id — Public
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const member = await User.findById(req.params.id).select('-password');
    if (!member) {
      return res.status(404).json({ success: false, error: 'Member not found' });
    }
    res.json({ success: true, data: member });
  } catch (error: any) {
    // CastError = invalid ObjectId, fall back to mock
    if (error.name === 'CastError') {
      return res.status(404).json({ success: false, error: 'Member not found' });
    }
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/members/:id/transactions — Public
router.get('/:id/transactions', async (req: Request, res: Response) => {
  try {
    const transactions = await Transaction.find({ user: req.params.id }).sort({ createdAt: -1 });
    res.json({ success: true, data: transactions });
  } catch (error: any) {
    if (error.name === 'CastError') {
      return res.status(404).json({ success: false, error: 'Member not found' });
    }
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;

