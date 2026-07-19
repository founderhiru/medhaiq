// config/plans.js
const MAX_SESSION_MINUTES = 25;

const PLAN_CONFIG = {
  free: {
    includedMinutes: 50,   // Temporary launch value — revisit with pricing decision
    unlimited: false
  },
  pro: {
    includedMinutes: null,
    unlimited: true
  }
};

module.exports = { PLAN_CONFIG, MAX_SESSION_MINUTES };