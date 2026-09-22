import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';

// Same shape every controller locally redeclares as `AuthedRequest` (e.g.
// src/controllers/adminController.ts) - kept in sync by hand since there is
// no shared types module yet.
type AuthedRequest = Request & { user?: { userId: string; userType: string } };

const requireAuth = (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const token = authHeader.split(' ')[1];

    const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as { userId: string; userType: string };

    req.user = {
      userId: decoded.userId,
      userType: decoded.userType
    };

    next();
  } catch (error: any) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }

    return res.status(401).json({ error: 'Invalid token' });
  }
};

const requireUserType = (...types: string[]) => {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.user || !types.includes(req.user.userType)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
};

const optionalAuth = (req: AuthedRequest, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next();
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as { userId: string; userType: string };

    req.user = {
      userId: decoded.userId,
      userType: decoded.userType
    };

    next();
  } catch (error) {
    next();
  }
};

// `export =` (rather than `export default`) so require('../middleware/auth')
// in any remaining plain .js route file gets these three functions directly,
// exactly matching the original module.exports shape.
export = { requireAuth, requireUserType, optionalAuth };
