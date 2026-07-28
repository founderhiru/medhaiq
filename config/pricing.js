// config/pricing.js
//
// Single source of truth for the homepage Pricing section
// (views/partials/pricing-section.ejs + views/partials/pricing-card.ejs).
//
// Change a price, a feature, minutes, or CTA text here — never in the EJS.
//
// NOTE ON FORWARD-LOOKING FIELDS:
// creditPackId, approxInterviews, validityMonths, topUpEligible, displayOrder,
// and isFeatured are included now (per Phase 2 scope) even though the current
// card template does not render all of them yet. This lets top-up packs,
// promo badges, and reordering ship later as data-only changes.

const CURRENCY_SYMBOLS = {
  INR: '\u20B9', // ₹
  USD: '$',
  EUR: '\u20AC', // €
};

const plans = [
  {
    id: 'explorer',
    displayOrder: 1,
    isFeatured: false,
    creditPackId: null,
    colorKey: 'green',
    badge: { text: 'Always Free', icon: null },
    icon: '<circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>',
    title: 'Explorer',
    tagline: 'Discover MedhaIQ before you practice.',
    description: null,
    price: { INR: 0, USD: 0, EUR: 0 },
    priceSubtext: 'Forever Free',
    minutes: 30,
    approxInterviews: 1,
    validityMonths: null,
    validityLabel: null,
    topUpEligible: false,
    featuresLabel: 'Includes',
    featureGroups: [
      {
        header: null,
        items: [
          { text: 'Company Interview Library', bold: false },
          { text: 'Role Library', bold: false },
          { text: 'Sample Interview Reports', bold: false },
          { text: 'Resume + JD Upload', bold: false },
          { text: '30 Welcome AI Minutes', bold: true },
          { text: 'AI Interview Experience', bold: false },
        ],
      },
    ],
    infoBox: {
      icon: '<path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
      title: '30 Welcome AI Minutes',
      desc: 'Experience one complete AI interview with personalized feedback.',
    },
    cta: { text: 'Start Free', href: '/login' },
    footer: 'No credit card required',
  },
  {
    id: 'growth',
    displayOrder: 2,
    isFeatured: true,
    creditPackId: 'growth_120',
    colorKey: 'blue',
    badge: {
      text: 'Most Popular',
      icon: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
    },
    icon: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
    title: 'Growth',
    tagline: 'Practice. Improve. Progress.',
    description: 'Everything you need for your next career move.',
    price: { INR: 999, USD: 12, EUR: 11 },
    priceSubtext: '120 AI Minutes Included',
    minutes: 120,
    approxInterviews: 4,
    validityMonths: 12,
    validityLabel: 'Credits valid for 12 months',
    topUpEligible: true,
    featuresLabel: 'Includes',
    featureGroups: [
      {
        header: { text: 'AI Practice', icon: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>' },
        items: [
          { text: '120 AI Interview Minutes', bold: true },
          { text: 'Resume Intelligence', bold: false },
          { text: 'JD Intelligence', bold: false },
          { text: 'Adaptive AI Interviews', bold: false },
        ],
      },
      {
        header: { text: 'Insights', icon: '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>' },
        items: [
          { text: 'AI Interview Reports', bold: false },
          { text: 'Progress Dashboard', bold: false },
          { text: 'Interview History', bold: false },
        ],
      },
    ],
    infoBox: {
      icon: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
      title: 'Need more practice?',
      desc: 'Purchase additional AI Minutes anytime.',
    },
    cta: { text: 'Get Growth', href: '/login' },
    footer: 'Credits valid for 12 months',
  },
  {
    id: 'leadership',
    displayOrder: 3,
    isFeatured: false,
    creditPackId: 'leadership_300',
    colorKey: 'purple',
    badge: {
      text: 'Best Value',
      icon: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
    },
    icon: '<polygon points="12 2 19 21 12 17 5 21 12 2"/>',
    title: 'Leadership',
    tagline: 'Lead with confidence.',
    description: 'Advanced practice for experienced professionals & aspiring leaders.',
    price: { INR: 2999, USD: 39, EUR: 36 },
    priceSubtext: '300 AI Minutes Included',
    minutes: 300,
    approxInterviews: 10,
    validityMonths: 12,
    validityLabel: 'Credits valid for 12 months',
    topUpEligible: true,
    featuresLabel: 'Includes',
    featureGroups: [
      {
        header: { text: 'AI Practice', icon: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>' },
        items: [
          { text: 'Everything in Growth', bold: true },
          { text: '300 AI Interview Minutes', bold: true },
          { text: 'Leadership Personas', bold: false },
          { text: 'Advanced Follow-up Questions', bold: false },
          { text: 'Longer Practice Sessions', bold: false },
        ],
      },
      {
        header: { text: 'Support', icon: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>' },
        items: [
          { text: 'Priority Support', bold: false },
        ],
      },
    ],
    infoBox: {
      icon: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
      title: 'Need more practice?',
      desc: 'Purchase additional AI Minutes anytime.',
    },
    cta: { text: 'Get Leadership', href: '/login' },
    footer: 'Credits valid for 12 months',
  },
];

// Bottom value strip (also config-driven, since it references the same
// "no subscriptions / credits valid / top-up" facts as the plans above).
const valueStrip = [
  {
    icon: '<rect x="3" y="5" width="18" height="14" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="7" y1="15" x2="7.01" y2="15"/><line x1="11" y1="15" x2="13" y2="15"/>',
    title: 'No Subscriptions',
    desc: 'One-time credit packs.<br>100% flexible.',
  },
  {
    icon: '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
    title: 'Credits Valid for 12 Months',
    desc: 'Use your AI minutes<br>at your own pace.',
  },
  {
    icon: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/>',
    title: 'Secure &amp; Private',
    desc: 'Your data is 100%<br>protected.',
  },
  {
    icon: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
    title: 'Buy More Minutes Anytime',
    desc: 'Top up only when<br>needed.',
  },
];

const section = {
  eyebrow: 'PRICING',
  title: 'Choose the Right Plan for Your Career Journey',
  subtitle: 'Start free. Upgrade only when you need more AI interview minutes.<br>No subscriptions. No surprises.',
  currencies: ['INR', 'USD', 'EUR'],
  defaultCurrency: 'INR',
};

module.exports = {
  section,
  plans: plans.slice().sort((a, b) => a.displayOrder - b.displayOrder),
  valueStrip,
  currencySymbols: CURRENCY_SYMBOLS,
};
