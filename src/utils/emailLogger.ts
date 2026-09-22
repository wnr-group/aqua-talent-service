import util from 'node:util';

const formatMeta = (meta: Record<string, any> = {}): string => {
  if (!meta || Object.keys(meta).length === 0) {
    return '';
  }
  return util.inspect(meta, { depth: 4, colors: false, compact: true });
};

const logWithLevel = (level: 'error' | 'warn' | 'info', message: string, meta?: Record<string, any>) => {
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

const logEmailSuccess = (message: string, meta: Record<string, any> = {}) => {
  logWithLevel('info', message, meta);
};

const logEmailFailure = (message: string, meta: Record<string, any> = {}) => {
  logWithLevel('error', message, meta);
};

const logEmailSkip = (message: string, meta: Record<string, any> = {}) => {
  logWithLevel('warn', message, meta);
};

// `export =` (rather than `export default`) so require('../utils/emailLogger')
// in any remaining plain .js file gets these three functions directly,
// exactly matching the original module.exports shape.
export = {
  logEmailSuccess,
  logEmailFailure,
  logEmailSkip
};
