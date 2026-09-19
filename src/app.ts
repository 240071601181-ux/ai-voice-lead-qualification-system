// Central env bootstrap MUST stay the first import: it loads .env before
// any other module (routes, controllers, config) consumes process.env.
import './config/env';
import express, { Request, Response, NextFunction } from 'express';
import { logger } from './utils/logger';
import { getEnvDiagnostics } from './config/env';
import leadRoutes from './routes/leadRoutes';
import knowledgeRoutes from './routes/knowledgeRoutes';
import qualificationRoutes from './routes/qualificationRoutes';
import calendarRoutes from './routes/calendarRoutes';
import followupRoutes from './routes/followupRoutes';
import agentRoutes from './routes/agentRoutes';
import authRoutes from './routes/authRoutes';
import conversationRoutes from './routes/conversationRoutes';
import crmRoutes from './routes/crmRoutes';
import whatsappRoutes from './routes/whatsappRoutes';
import n8nRoutes from './routes/n8nRoutes';
import settingsRoutes from './routes/settingsRoutes';

const app = express();
app.use(express.json());

// Minimal development-safe CORS for the local frontend.
// Allows only the configured frontend origin(s) (no wildcard, so credentials
// remain possible). No routes, controllers, or logic touched.
// Dev defaults cover the fixed local frontend (3000), the alternate frontend
// port (3001), and Vite SPA mode (5173).
// Configure via FRONTEND_ORIGIN (single) and/or FRONTEND_ORIGINS (comma-separated).
// In production (NODE_ENV=production) only explicitly configured origins are
// allowed — dev defaults are dropped to keep production safe.
export const DEFAULT_DEV_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:5173',
];
function resolveAllowedOrigins(): string[] {
  const raw = [process.env.FRONTEND_ORIGIN, process.env.FRONTEND_ORIGINS]
    .filter(Boolean)
    .join(',')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (raw.length > 0) return Array.from(new Set(raw));
  if (process.env.NODE_ENV === 'production') return [];
  return DEFAULT_DEV_ORIGINS;
}
const ALLOWED_ORIGINS = resolveAllowedOrigins();
app.use((req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin as string | undefined;
  const allowed = origin ? ALLOWED_ORIGINS.includes(origin) : false;
  if (allowed && origin) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Credentials', 'true');
  }
  res.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  // Required now that the frontend sends its session with API requests
  // (fetch credentials: "include"). Origin stays allowlisted (no wildcard).
  res.header('Vary', 'Origin');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});



// Simple health check
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API routes (versioned)
//
// Phase 14 — legacy voice/Vapi retired: /api/v1/calls (outbound voice),
// /api/v1/vapi/* (custom LLM + tool callbacks), and /api/v1/webhooks/vapi
// are removed. Historical call rows remain readable through the retained
// callRepository.findCallById compatibility read; the calls table is NOT
// dropped (see docs/architecture.md).
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/leads', leadRoutes);
app.use('/api/v1/knowledge', knowledgeRoutes);
app.use('/api/v1/qualifications', qualificationRoutes);
app.use('/api/v1/calendar', calendarRoutes);
app.use('/api/v1/followups', followupRoutes);
app.use('/api/v1/agent', agentRoutes);
app.use('/api/v1/conversations', conversationRoutes);
app.use('/api/v1/crm', crmRoutes);
app.use('/api/v1/whatsapp', whatsappRoutes);
app.use('/api/v1/n8n', n8nRoutes);
app.use('/api/v1/settings', settingsRoutes);

// Centralized error handling middleware
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  logger.error('Unhandled error', { error: err });
  const status = err.status || 500;
  const message = err.message || 'Internal Server Error';
  res.status(status).json({ success: false, error: { message, code: status } });
});

// Fixed local-development backend port. The value comes from backend .env
// (PORT); the compiled default is 4000 so a missing PORT can never fall back
// to the frontend's port 3000.
export const DEFAULT_BACKEND_PORT = 4000;

export function resolveBackendPort(): number {
  const raw = process.env.PORT;
  const parsed = Number(raw);
  if (raw !== undefined && raw !== '' && Number.isInteger(parsed) && parsed > 0) {
    return parsed;
  }
  return DEFAULT_BACKEND_PORT;
}

// Export app for testing or external usage
export default app;

// Start server only when this file is executed directly
if (require.main === module) {
  const PORT = resolveBackendPort();
  app.listen(PORT, () => {
    logger.info(`Server listening on port ${PORT}`);
    // Safe runtime environment diagnostics: names/status only, never values.
    const diag = getEnvDiagnostics();
    logger.info('Environment diagnostics', { ...diag });
    logger.info(`AUTH_JWT_SECRET = ${diag.authJwtSecret}`);
    if (diag.dotenvError) {
      logger.warn(`dotenv: ${diag.dotenvError}`);
    }
    if (diag.inheritedAuthJwtPresent) {
      logger.info(
        `Inherited process.env.AUTH_JWT_SECRET existed before dotenv (wasBlank=${diag.inheritedAuthJwtWasBlank}); ` +
          '.env does not override real environment variables'
      );
    }
    // Visibility for the most common local misconfiguration: auth endpoints
    // fail closed (500) without this server-only secret. Name only, never value.
    if (diag.authJwtSecret === 'MISSING') {
      logger.warn('AUTH_JWT_SECRET is not set: POST /api/v1/auth/* will fail closed until it is configured');
    }
  });
}
