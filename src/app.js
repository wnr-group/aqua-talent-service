const express = require('express');
const cors = require('cors');
const { getSupabaseClient } = require('./lib/supabase/client');

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

app.use(express.json({
  verify: (req, res, buffer) => {
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

import('./routes/testMailRoutes.mjs')
  .then(({ default: testMailRouter }) => {
    app.use('/api', testMailRouter);
  })
  .catch((error) => {
    console.error('[test-mail] Failed to register test mail route', error);
  });

// Health check
app.get('/api/health', async (req, res) => {
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

module.exports = app;
