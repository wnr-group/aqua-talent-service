import Razorpay from 'razorpay';

const MIN_RAZORPAY_SECRET_LENGTH = 20;

const RAZORPAY_CONFIG_ERROR_CODES = Object.freeze({
  MISSING_CREDENTIALS: 'RAZORPAY_MISSING_CREDENTIALS',
  INVALID_KEY_ID: 'RAZORPAY_INVALID_KEY_ID',
  INVALID_KEY_SECRET: 'RAZORPAY_INVALID_KEY_SECRET'
});

type RazorpayKeyMode = 'missing' | 'test' | 'live' | 'unknown';

interface RazorpayConfigError extends Error {
  code: string;
}

let razorpayInstance: Razorpay | null = null;

const createConfigError = (code: string, message: string): RazorpayConfigError => {
  const error = new Error(message) as RazorpayConfigError;
  error.code = code;
  return error;
};

const getRazorpayKeyMode = (keyId: string | null | undefined): RazorpayKeyMode => {
  if (!keyId) return 'missing';
  if (keyId.startsWith('rzp_test_')) return 'test';
  if (keyId.startsWith('rzp_live_')) return 'live';
  return 'unknown';
};

const getRazorpayCredentials = (): { keyId: string; keySecret: string; keyMode: RazorpayKeyMode } => {
  const keyId = process.env.RAZORPAY_KEY_ID?.trim() || '';
  const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim() || '';

  if (!keyId || !keySecret) {
    throw createConfigError(RAZORPAY_CONFIG_ERROR_CODES.MISSING_CREDENTIALS, 'Razorpay credentials are not configured');
  }

  const keyMode = getRazorpayKeyMode(keyId);

  if (keyMode === 'unknown') {
    throw createConfigError(
      RAZORPAY_CONFIG_ERROR_CODES.INVALID_KEY_ID,
      'Razorpay key ID format is invalid (must start with rzp_test_ or rzp_live_)'
    );
  }

  if (keySecret.length < MIN_RAZORPAY_SECRET_LENGTH) {
    throw createConfigError(RAZORPAY_CONFIG_ERROR_CODES.INVALID_KEY_SECRET, 'RAZORPAY_KEY_SECRET appears invalid or truncated');
  }

  return { keyId, keySecret, keyMode };
};

const getRazorpayClient = (): Razorpay => {
  if (razorpayInstance) {
    return razorpayInstance;
  }

  const { keyId, keySecret } = getRazorpayCredentials();

  razorpayInstance = new Razorpay({
    key_id: keyId,
    key_secret: keySecret
  });

  return razorpayInstance;
};

// `export =` so require('../config/razorpay') in any remaining plain .js
// file gets the same { getRazorpayClient, ... } shape as the original
// module.exports.
export = {
  getRazorpayClient,
  getRazorpayCredentials,
  getRazorpayKeyMode,
  RAZORPAY_CONFIG_ERROR_CODES
};
