const DEFAULT_ZONES = [
  {
    name: 'Zone 1 - Premium Markets',
    description: 'Premium hiring markets with the highest competition and salary bands.',
    countries: ['USA', 'UK', 'Germany', 'Singapore', 'UAE']
  },
  {
    name: 'Zone 2 - Growing Markets',
    description: 'Growing hiring markets with strong demand for international talent.',
    countries: ['Canada', 'Japan', 'South Korea']
  },
  {
    name: 'Zone 3 - Emerging Markets',
    description: 'Emerging hiring markets with expanding tech and startup ecosystems.',
    countries: ['India', 'Brazil', 'Mexico', 'Vietnam', 'Indonesia']
  },
  {
    name: 'Zone 4 - Niche Markets',
    description: 'Smaller or niche hiring markets with specialized opportunities.',
    countries: ['Norway', 'Denmark', 'Panama']
  }
];

const DEFAULT_PLAN_ZONE_ASSIGNMENTS = {
  'Starter Plan': ['Zone 1 - Premium Markets', 'Zone 2 - Growing Markets'],
  'Pro Plan': ['Zone 1 - Premium Markets', 'Zone 2 - Growing Markets', 'Zone 3 - Emerging Markets'],
  'Premium Plan': DEFAULT_ZONES.map((zone) => zone.name)
};

module.exports = {
  DEFAULT_ZONES,
  DEFAULT_PLAN_ZONE_ASSIGNMENTS
};