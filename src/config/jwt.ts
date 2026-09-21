// `export =` (rather than `export default`) so require('../config/jwt') in
// any remaining plain .js file gets { secret, expiresIn } directly, exactly
// matching the original module.exports shape.
export = {
  secret: process.env.JWT_SECRET,
  expiresIn: '24h'
};
