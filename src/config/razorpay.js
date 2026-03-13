const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');
const Razorpay = require('razorpay');

const ENV_FILE_PATH = path.resolve(process.cwd(), '.env');

dotenv.config({ path: ENV_FILE_PATH });

const MIN_RAZORPAY_SECRET_LENGTH = 20;
const RAZORPAY_CONFIG_ERROR_CODES = Object.freeze({
  MISSING_CREDENTIALS: 'RAZORPAY_MISSING_CREDENTIALS',
  INVALID_KEY_ID: 'RAZORPAY_INVALID_KEY_ID',
  INVALID_KEY_SECRET: 'RAZORPAY_INVALID_KEY_SECRET'
});

let razorpayInstance = null;
let razorpayInstanceSignature = null;

const normalizeEnvValue = (value) => {
  if (typeof value !== 'string') {
    return '';
  }

  const withoutBom = value.replace(/^\uFEFF/, '');
  const trimmed = withoutBom.trim();

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }

  return trimmed;
};

const logRawSecretDiagnostics = () => {
  if (process.env.LOG_RAZORPAY_DEBUG !== 'true') {
    return;
  }

  console.log({
    keySecretRaw: process.env.RAZORPAY_KEY_SECRET,
    keySecretLength: process.env.RAZORPAY_KEY_SECRET?.length,
    envFilePath: ENV_FILE_PATH
  });
};

const getEnvFileDiagnostics = () => {
  const envPath = ENV_FILE_PATH;

  if (!fs.existsSync(envPath)) {
    return {
      envFilePresent: false
    };
  }

  const rawFile = fs.readFileSync(envPath, 'utf8');
  const lines = rawFile.split(/\r?\n/);

  const buildLineDiagnostics = (name) => {
    const lineIndex = lines.findIndex((line) => line.match(new RegExp(`^\\s*${name}\\s*=`)));

    if (lineIndex === -1) {
      return {
        present: false
      };
    }

    const rawLine = lines[lineIndex];
    const rawValue = rawLine.replace(/^\s*[^=]+=/, '');
    const trimmedValue = rawValue.trim();
    const hasWrappingQuotes = (
      (trimmedValue.startsWith('"') && trimmedValue.endsWith('"'))
      || (trimmedValue.startsWith("'") && trimmedValue.endsWith("'"))
    );

    return {
      present: true,
      line: lineIndex + 1,
      rawLength: rawValue.length,
      trimmedLength: trimmedValue.length,
      hasWrappingQuotes,
      hasInlineComment: rawValue.includes('#'),
      hasTrailingWhitespace: /\s+$/.test(rawValue),
      hasUtf8Bom: rawLine.charCodeAt(0) === 0xFEFF
    };
  };

  return {
    envFilePresent: true,
    keyId: buildLineDiagnostics('RAZORPAY_KEY_ID'),
    keySecret: buildLineDiagnostics('RAZORPAY_KEY_SECRET')
  };
};

const createRazorpayConfigError = (code, message) => {
  const error = new Error(message);
  error.code = code;
  return error;
};

const getRazorpayKeyMode = (keyId) => {
  if (keyId.startsWith('rzp_test_')) {
    return 'test';
  }

  if (keyId.startsWith('rzp_live_')) {
    return 'live';
  }

  return 'unknown';
};

const logRazorpayDebug = (message, metadata = {}) => {
  if (process.env.LOG_RAZORPAY_DEBUG !== 'true') {
    return;
  }

  console.info(`[Razorpay] ${message}`, metadata);
};

const readRazorpayCredentials = () => {
  logRawSecretDiagnostics();

  const keyId = normalizeEnvValue(process.env.RAZORPAY_KEY_ID);
  const keySecret = process.env.RAZORPAY_KEY_SECRET?.trim();

  return {
    keyId,
    keySecret: normalizeEnvValue(keySecret)
  };
};

const getRazorpayCredentialDiagnostics = () => {
  const { keyId, keySecret } = readRazorpayCredentials();
  const envFileDiagnostics = getEnvFileDiagnostics();

  return {
    keyIdPresent: Boolean(keyId),
    keyIdLength: keyId.length,
    keySecretPresent: Boolean(keySecret),
    keySecretLength: keySecret.length,
    keyMode: keyId ? getRazorpayKeyMode(keyId) : 'missing',
    envFile: envFileDiagnostics
  };
};

const validateRazorpayEnvironment = () => {
  const { keyId, keySecret } = readRazorpayCredentials();

  if (!keyId || !keySecret) {
    throw createRazorpayConfigError(
      RAZORPAY_CONFIG_ERROR_CODES.MISSING_CREDENTIALS,
      'Razorpay credentials are not configured'
    );
  }

  const keyMode = getRazorpayKeyMode(keyId);

  if (keyMode === 'unknown') {
    throw createRazorpayConfigError(
      RAZORPAY_CONFIG_ERROR_CODES.INVALID_KEY_ID,
      'Razorpay key ID format is invalid'
    );
  }

  if (!keySecret || keySecret.length < MIN_RAZORPAY_SECRET_LENGTH) {
    throw createRazorpayConfigError(
      RAZORPAY_CONFIG_ERROR_CODES.INVALID_KEY_SECRET,
      'RAZORPAY_KEY_SECRET appears invalid or truncated'
    );
  }

  return {
    keyId,
    keySecret,
    keyMode
  };
};

const getRazorpayCredentials = () => {
  return validateRazorpayEnvironment();
};

const getRazorpayClient = () => {
  const { keyId, keySecret, keyMode } = getRazorpayCredentials();
  const instanceSignature = `${keyId}:${keySecret}`;

  if (razorpayInstance && razorpayInstanceSignature === instanceSignature) {
    return razorpayInstance;
  }

  logRazorpayDebug('Initializing client', {
    keyIdPresent: Boolean(keyId),
    keySecretPresent: Boolean(keySecret),
    keyMode
  });

  razorpayInstance = new Razorpay({
    key_id: keyId,
    key_secret: keySecret
  });
  razorpayInstanceSignature = instanceSignature;

  return razorpayInstance;
};

module.exports = {
  getRazorpayClient,
  getRazorpayCredentialDiagnostics,
  getRazorpayCredentials,
  getRazorpayKeyMode,
  logRazorpayDebug,
  RAZORPAY_CONFIG_ERROR_CODES,
  validateRazorpayEnvironment
};
