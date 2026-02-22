const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');

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

// Password reset environment warnings
if (!process.env.ADMIN_EMAIL) {
  console.warn('[WARNING] ADMIN_EMAIL environment variable is not set. Admin password reset will not work.');
}
if (!process.env.FRONTEND_URL) {
  console.warn('[WARNING] FRONTEND_URL environment variable is not set. Password reset links will use default localhost URL.');
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

app.use(express.json());


app.use('/api/auth', authRoutes);
app.use('/api/company', companyRoutes);
app.use('/api/student', studentRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/services', serviceRoutes);
app.use('/api/companies', publicCompanyRoutes);
app.use('/api/media', mediaRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/', unsubscribeRoutes);

import('./routes/testMailRoutes.mjs')
  .then(({ default: testMailRouter }) => {
    app.use('/api', testMailRouter);
  })
  .catch((error) => {
    console.error('[test-mail] Failed to register test mail route', error);
  });

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    database:
      mongoose.connection.readyState === 1
        ? 'connected'
        : 'disconnected',
    databaseName: mongoose.connection.name,   
    databaseHost: mongoose.connection.host  
  });
});

module.exports = app;
