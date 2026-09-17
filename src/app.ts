import express, { Request, Response, NextFunction } from 'express';
import dotenv from 'dotenv';
import { logger } from './utils/logger';
import leadRoutes from './routes/leadRoutes';
import vapiWebhookRoutes from './routes/vapiWebhookRoutes';
import knowledgeRoutes from './routes/knowledgeRoutes';
import { handleCustomLlmChatCompletions } from './controllers/vapiCustomLlmController';
import { handleVapiToolCalls } from './controllers/vapiToolController';
import qualificationRoutes from './routes/qualificationRoutes';
import calendarRoutes from './routes/calendarRoutes';
import followupRoutes from './routes/followupRoutes';
import callRoutes from './routes/callRoutes';
import agentRoutes from './routes/agentRoutes';
import conversationRoutes from './routes/conversationRoutes';
import crmRoutes from './routes/crmRoutes';
import whatsappRoutes from './routes/whatsappRoutes';
import n8nRoutes from './routes/n8nRoutes';
import settingsRoutes from './routes/settingsRoutes';

// Load environment variables
dotenv.config({ path: '.env' });

const app = express();
app.use(express.json());

// Minimal development-safe CORS for the local frontend.
// Allows only the configured frontend origin(s) (no wildcard, so credentials
// remain possible). No routes, controllers, or logic touched.
// Dev defaults cover both Vite (5173) and the alternate frontend port (3001).
// Configure via FRONTEND_ORIGIN (single) and/or FRONTEND_ORIGINS (comma-separated).
// In production (NODE_ENV=production) only explicitly configured origins are
// allowed — dev defaults are dropped to keep production safe.
const DEFAULT_DEV_ORIGINS = ['http://localhost:5173', 'http://localhost:3001'];
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

// Custom LLM OpenAI-compatible endpoint for Vapi
app.post('/api/v1/vapi/custom-llm/chat/completions', handleCustomLlmChatCompletions);
app.post('/api/v1/vapi/custom-llm/chat/completions/custom-tool', handleVapiToolCalls);

// API routes (versioned)
app.use('/api/v1/leads', leadRoutes);
app.use('/api/v1/webhooks/vapi', vapiWebhookRoutes);
app.use('/api/v1/knowledge', knowledgeRoutes);
app.use('/api/v1/qualifications', qualificationRoutes);
app.use('/api/v1/calendar', calendarRoutes);
app.use('/api/v1/followups', followupRoutes);
app.use('/api/v1/calls', callRoutes);
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

// Export app for testing or external usage
export default app;

// Start server only when this file is executed directly
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    logger.info(`Server listening on port ${PORT}`);
  });
}
