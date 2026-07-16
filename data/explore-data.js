// Placeholder content for the /explore page (Section 2 of the "Explore
// MedhaIQ" spec). These are static arrays for this sprint only — no DB,
// no Supabase. Shape mirrors what a future `companies` / `roles` /
// `articles` table query would return, so swapping this require() for a
// db/explore.js query later shouldn't require view/partial changes.

const companies = [
  {
    id: 1,
    slug: 'amazon',
    name: 'Amazon',
    subtitle: 'Bar Raiser & Leadership Principles loops',
    logo: 'A',
    featured: true,
    comingSoon: false,
    stat: null, // e.g. "8 Interview Rounds" — leave null until real per-company data is confirmed
  },
  {
    id: 2,
    slug: 'microsoft',
    name: 'Microsoft',
    subtitle: 'Growth mindset & system design focus',
    logo: 'M',
    featured: true,
    comingSoon: false,
    stat: null,
  },
  {
    id: 3,
    slug: 'tcs',
    name: 'TCS',
    subtitle: 'GCC-style structured interview rounds',
    logo: 'T',
    featured: false,
    comingSoon: true,
    stat: null,
  },
];

const roles = [
  {
    id: 1,
    slug: 'software-engineer',
    title: 'Software Engineer',
    category: 'Engineering',
    competencies: ['DSA', 'System Design', 'Debugging'],
    featured: true,
  },
  {
    id: 2,
    slug: 'product-manager',
    title: 'Product Manager',
    category: 'Product',
    competencies: ['Prioritization', 'Metrics', 'Stakeholder Mgmt'],
    featured: true,
  },
  {
    id: 3,
    slug: 'business-analyst',
    title: 'Business Analyst',
    category: 'Business',
    competencies: ['Requirements', 'Data Storytelling'],
    featured: false,
  },
  {
    id: 4,
    slug: 'data-analyst',
    title: 'Data Analyst',
    category: 'Data',
    competencies: ['SQL', 'Statistics', 'Dashboards'],
    featured: false,
  },
];

const articles = [
  {
    id: 1,
    slug: 'star-method',
    title: 'STAR Method',
    excerpt: 'Structure any behavioral answer so it lands with evidence, not adjectives.',
    readingTime: '4 min read',
    category: 'Behavioral',
  },
  {
    id: 2,
    slug: 'gcc-interviews',
    title: 'Preparing for GCC Interviews',
    excerpt: 'What global capability center loops actually test for, round by round.',
    readingTime: '6 min read',
    category: 'Company-Specific',
  },
  {
    id: 3,
    slug: 'tell-me-about-yourself',
    title: 'Tell Me About Yourself',
    excerpt: "Turn the most-asked opener into a 60-second pitch that earns the next question.",
    readingTime: '3 min read',
    category: 'Behavioral',
  },
];

module.exports = { companies, roles, articles };
