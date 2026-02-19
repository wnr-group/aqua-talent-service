const util = require('node:util');

const formatMeta = (meta = {}) => {
  if (!meta || Object.keys(meta).length === 0) {
    return '';
  }
  return util.inspect(meta, { depth: 4, colors: false, compact: true });
};

const logWithLevel = (level, message, meta) => {
  const timestamp = new Date().toISOString();
  const suffix = formatMeta(meta);
  const fullMessage = suffix ? `${message} ${suffix}` : message;

  switch (level) {
    case 'error':
      console.error(`[email][${timestamp}] ${fullMessage}`);
      break;
    case 'warn':
      console.warn(`[email][${timestamp}] ${fullMessage}`);
      break;
    default:
      console.info(`[email][${timestamp}] ${fullMessage}`);
  }
};

const logEmailSuccess = (message, meta = {}) => {
  logWithLevel('info', message, meta);
};

const logEmailFailure = (message, meta = {}) => {
  logWithLevel('error', message, meta);
};

const logEmailSkip = (message, meta = {}) => {
  logWithLevel('warn', message, meta);
};

module.exports = {
  logEmailSuccess,
  logEmailFailure,
  logEmailSkip
};
