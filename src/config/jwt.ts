const secret = process.env.JWT_SECRET?.trim();

if (!secret) {
  throw new Error('JWT_SECRET is not configured');
}

// `export =` (rather than `export default`) so require('../config/jwt') in
// any remaining plain .js file gets { secret, expiresIn } directly, exactly
// matching the original module.exports shape.
export = {
  secret,
  expiresIn: '24h'
};
