// config/plans.js
const MAX_SESSION_MINUTES = 25;

const PLAN_CONFIG = {
  free: {
    unlimited: false,
    interview: {
      includedMinutes: 50,   // Temporary launch value — revisit with pricing decision
      maxSessionMinutes: MAX_SESSION_MINUTES,
    },
  },
  pro: {
    unlimited: true,
    interview: {
      includedMinutes: null,
      maxSessionMinutes: MAX_SESSION_MINUTES,
    },
  },
};

const DEFAULT_TIER = 'free';

module.exports = { PLAN_CONFIG, MAX_SESSION_MINUTES, DEFAULT_TIER };
