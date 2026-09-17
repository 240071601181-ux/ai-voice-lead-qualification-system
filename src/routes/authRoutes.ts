import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth';
import { loginRateLimit } from '../middleware/loginRateLimit';
import {
  loginHandler,
  logoutHandler,
  meHandler,
  refreshHandler,
  registerHandler,
} from '../controllers/authController';

const router = Router();

// Phase 11 — first-party authentication (bcrypt + short-lived access JWT +
// rotating HttpOnly refresh cookie). Brute-force protection on credential
// endpoints; no passwords/hashes/secrets ever leave the backend.
router.post('/register', loginRateLimit, registerHandler);
router.post('/login', loginRateLimit, loginHandler);
router.post('/refresh', refreshHandler);
router.post('/logout', logoutHandler);
router.get('/me', requireAuth, meHandler);

export default router;
