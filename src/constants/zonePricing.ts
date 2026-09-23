const DEFAULT_ZONES = [
  {
    name: 'Zone 1',
    description: 'Premium Shipping / Corporate Hubs',
    countries: ['USA', 'UK', 'Germany', 'Singapore', 'UAE']
  },
  {
    name: 'Zone 2',
    description: 'Growing Markets',
    countries: ['Canada', 'Japan', 'South Korea']
  },
  {
    name: 'Zone 3',
    description: 'Emerging Markets',
    countries: ['India', 'Brazil', 'Mexico', 'Vietnam', 'Indonesia']
  },
  {
    name: 'Zone 4',
    description: 'Niche / Optional Markets',
    countries: ['Norway', 'Denmark', 'Panama']
  }
];

const DEFAULT_PLAN_ZONE_ASSIGNMENTS: Record<string, string[]> = {
  'Starter': ['Zone 1', 'Zone 2'],
  'Pro': ['Zone 1', 'Zone 2', 'Zone 3'],
  'Premium': DEFAULT_ZONES.map((zone) => zone.name)
};

// `export =` (rather than `export default`) so require('../constants/zonePricing')
// in any remaining plain .js file gets these members directly, exactly
// matching the original module.exports shape.
export = {
  DEFAULT_ZONES,
  DEFAULT_PLAN_ZONE_ASSIGNMENTS
};
