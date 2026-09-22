import path from 'path';
import { config } from 'dotenv';

config({ path: path.resolve(__dirname, '../.env') });

// Fail fast at startup rather than at the first login/token-verify request -
// authController.ts and middleware/auth.ts both read this directly (not
// through src/config/jwt.ts) and cast it to string, so a missing secret would
// otherwise surface as a confusing 500 instead of an obvious boot failure.
if (!process.env.JWT_SECRET?.trim()) {
  throw new Error('JWT_SECRET is not configured');
}

// Last-resort safety net so a stray rejected promise or thrown error outside
// any request (a fire-and-forget async call, a bug in startup code) logs
// instead of taking the whole process down. Route-level errors never reach
// here - Express 5 forwards those to src/middleware/errorHandler.ts instead.
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});

process.on('uncaughtException', (error) => {
  console.error('[uncaughtException]', error);
});

const app = require('./app');

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
