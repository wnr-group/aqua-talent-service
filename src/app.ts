import express, { Request, Response } from 'express';
import cors from 'cors';
import { getSupabaseClient } from './lib/supabase/client';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';

const app = express();

const authRoutes = require('./routes/authRoutes');
const companyRoutes = require('./routes/companyRoutes');
const studentRoutes = require('./routes/studentRoutes');
const adminRoutes = require('./routes/adminRoutes');
const serviceRoutes = require('./routes/serviceRoutes');
const publicCompanyRoutes = require('./routes/publicCompanyRoutes');
const unsubscribeRoutes = require('./routes/unsubscribeRoutes');
const mediaRoutes = require('./routes/mediaRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const paymentController = require('./controllers/paymentController');

// Password reset environment warnings
if (!process.env.ADMIN_EMAIL) {
  console.warn('[WARNING] ADMIN_EMAIL environment variable is not set. Admin password reset will not work.');
}
if (!process.env.FRONTEND_URL && !process.env.FRONTEND_BASE_URL && !process.env.APP_BASE_URL) {
  console.warn('[WARNING] FRONTEND_URL/FRONTEND_BASE_URL/APP_BASE_URL environment variables are not set. Password reset links will use default localhost URL.');
}

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim())
  : [];

app.use(cors({
  origin: allowedOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

type RawBodyRequest = Request & { rawBody?: string };

app.use(express.json({
  verify: (req: RawBodyRequest, res: Response, buffer: Buffer) => {
    if (!buffer?.length) {
      return;
    }

    if (
      req.originalUrl === '/api/webhooks/razorpay'
      || req.originalUrl === '/api/payments/webhooks/razorpay'
    ) {
      req.rawBody = buffer.toString('utf8');
    }
  }
}));


app.use('/api/auth', authRoutes);
app.use('/api/company', companyRoutes);
app.use('/api/student', studentRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/services', serviceRoutes);
app.use('/api/companies', publicCompanyRoutes);
app.use('/api/media', mediaRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/payments', paymentRoutes);
app.post('/api/webhooks/razorpay', paymentController.handleWebhook);
app.get('/api/geo-location', paymentController.getGeoLocation);
app.use('/', unsubscribeRoutes);

// Health check
app.get('/api/health', async (req: Request, res: Response) => {
  let database = 'disconnected';

  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase.from('users').select('id', { count: 'exact', head: true });
    database = error ? 'disconnected' : 'connected';
  } catch {
    database = 'disconnected';
  }

  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    database,
    databaseName: 'postgres',
    databaseHost: process.env.SUPABASE_URL ? new URL(process.env.SUPABASE_URL).host : null
  });
});

// testMailRoutes.mjs is intentionally native ESM (see routes conversion
// commit) and isn't part of the tsc program, so it has no type declarations.
// notFoundHandler/errorHandler are registered in this same chain (success or
// failure) rather than synchronously above, so they can never shadow the
// route this async import is still in the middle of registering.
// @ts-expect-error - TS7016: no declaration file for this dynamic import target
import('./routes/testMailRoutes.mjs')
  .then(({ default: testMailRouter }: any) => {
    app.use('/api', testMailRouter);
  })
  .catch((error: unknown) => {
    console.error('[test-mail] Failed to register test mail route', error);
  })
  .finally(() => {
    // Must stay last: unmatched-route handler, then the error-handling
    // middleware (arity 4 is what makes Express treat it as one).
    app.use(notFoundHandler);
    app.use(errorHandler);
  });

// `export =` (rather than `export default`) so require('./app') in
// server.js gets the app instance directly, exactly matching the
// original module.exports shape.
export = app;
