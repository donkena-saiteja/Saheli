import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import User from '../models/User';

export interface AuthRequest extends Request {
  user?: any;
}

export const protect = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const header = req.headers.authorization;

  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Not authorized, no token' });
  }

  const token = header.slice('Bearer '.length).trim();
  if (!token) {
    return res.status(401).json({ success: false, error: 'Not authorized, no token' });
  }

  try {
    const decoded: any = jwt.verify(token, process.env.JWT_SECRET || 'saheli_secret_key_123');

    req.user = await User.findById(decoded.id).select('-password');
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'User not found' });
    }
  } catch {
    // Expired or tampered token — no stack trace needed, this is routine.
    return res.status(401).json({ success: false, error: 'Not authorized, token failed' });
  }

  // Outside the try, so an error thrown downstream is not misreported as an
  // authentication failure (and cannot trigger a second res.status call).
  return next();
};

// Role-Based Access Control (RBAC)
export const authorize = (...roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ 
        success: false, 
        error: `User role '${req.user?.role}' is not authorized to access this route` 
      });
    }
    next();
  };
};
