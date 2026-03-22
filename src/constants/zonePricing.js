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

const DEFAULT_PLAN_ZONE_ASSIGNMENTS = {
  'Starter': ['Zone 1', 'Zone 2'],
  'Pro': ['Zone 1', 'Zone 2', 'Zone 3'],
  'Premium': DEFAULT_ZONES.map((zone) => zone.name)
};

module.exports = {
  DEFAULT_ZONES,
  DEFAULT_PLAN_ZONE_ASSIGNMENTS
};