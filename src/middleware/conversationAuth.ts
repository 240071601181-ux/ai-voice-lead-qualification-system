import { NextFunction, Request, Response } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Minimal HS256 JWT foundation for the text conversation API (Phase 3).
 *
 * There is no pre-existing backend auth mechanism, so this module provides
 * token verification only: no user store, no fake users, no hardcoded
 * credentials. Issuance happens wherever the deployer owns identity
 * (tests use signChatToken with a test-only secret).
 *
 * Fail-closed: requests are rejected with 401 when CHAT_JWT_SECRET is
 * unset, the header is missing/malformed, or the token is invalid/expired.
 * Secrets and tokens are never logged.
 */

export interface ChatAuthRequest extends Request {
  /** Opaque subject from the verified token (`sub` claim). */
  chatSubject?: string;
}

interface ChatTokenPayload {
  sub: string;
  iat: number;
  exp: number;
}

const base64UrlEncode = (input: string | Buffer): string =>
  Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');

const base64UrlDecode = (input: string): Buffer => {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(padded, 'base64');
};

const getSecret = (): string => process.env.CHAT_JWT_SECRET || '';

const signPart = (data: string, secret: string): string =>
  base64UrlEncode(createHmac('sha256', secret).update(data).digest());

/**
 * Mint a token (tests/tooling only — production issuance is out of scope).
 * Throws when no secret is configured rather than signing insecurely.
 */
export const signChatToken = (
  subject: string,
  expiresInSec = 3600,
  secret: string = getSecret()
): string => {
  if (!secret) {
    throw new Error('CHAT_JWT_SECRET is not configured');
  }
  if (!subject || typeof subject !== 'string') {
    throw new Error('subject is required and must be a string');
  }
  const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const payload = base64UrlEncode(
    JSON.stringify({ sub: subject, iat: now, exp: now + expiresInSec } satisfies ChatTokenPayload)
  );
  const signingInput = `${header}.${payload}`;
  return `${signingInput}.${signPart(signingInput, secret)}`;
};

/** Verify a token and return its subject. Throws on any failure. */
export const verifyChatToken = (token: string, secret: string = getSecret()): string => {
  if (!secret) {
    throw new Error('CHAT_JWT_SECRET is not configured');
  }
  const parts = typeof token === 'string' ? token.split('.') : [];
  if (parts.length !== 3) {
    throw new Error('malformed token');
  }
  const [header, payload, signature] = parts;
  const expected = signPart(`${header}.${payload}`, secret);
  const actual = Buffer.from(signature);
  const wanted = Buffer.from(expected);
  if (actual.length !== wanted.length || !timingSafeEqual(actual, wanted)) {
    throw new Error('invalid signature');
  }
  const decoded = JSON.parse(base64UrlDecode(payload).toString('utf-8')) as Partial<ChatTokenPayload>;
  if (!decoded.sub || typeof decoded.sub !== 'string') {
    throw new Error('missing subject');
  }
  if (typeof decoded.exp !== 'number' || decoded.exp * 1000 <= Date.now()) {
    throw new Error('expired token');
  }
  return decoded.sub;
};

export const requireConversationAuth = (req: ChatAuthRequest, res: Response, next: NextFunction) => {
  if (!getSecret()) {
    return res
      .status(401)
      .json({ success: false, error: { message: 'Conversation authentication is not configured', code: 401 } });
  }
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ') || header.length <= 'Bearer '.length) {
    return res
      .status(401)
      .json({ success: false, error: { message: 'Missing or malformed authorization header', code: 401 } });
  }
  try {
    req.chatSubject = verifyChatToken(header.slice('Bearer '.length));
    return next();
  } catch {
    return res
      .status(401)
      .json({ success: false, error: { message: 'Invalid or expired token', code: 401 } });
  }
};
