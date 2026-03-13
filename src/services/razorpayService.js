const {
  getRazorpayClient,
  getRazorpayCredentialDiagnostics,
  getRazorpayCredentials,
  getRazorpayKeyMode,
  logRazorpayDebug,
  RAZORPAY_CONFIG_ERROR_CODES,
  validateRazorpayEnvironment
} = require('../config/razorpay');

const getRazorpayInstance = () => getRazorpayClient();

module.exports = {
  getRazorpayInstance,
  getRazorpayCredentialDiagnostics,
  getRazorpayCredentials,
  getRazorpayKeyMode,
  logRazorpayDebug,
  RAZORPAY_CONFIG_ERROR_CODES,
  validateRazorpayEnvironment
};
