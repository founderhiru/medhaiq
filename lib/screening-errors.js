// lib/screening-errors.js
//
// One error type for the whole Screening Copilot. `code` is a stable,
// machine-readable identifier (like the existing `reason` fields on the
// interview API); `message` is safe to show to the recruiter; `status` is the
// HTTP status the route layer should use. Never put resume text, JD text, or
// any candidate content into `message` or `details`.

class ScreeningError extends Error {
  constructor(code, status, message, details) {
    super(message);
    this.name = 'ScreeningError';
    this.code = code;
    this.status = status;
    if (details !== undefined) this.details = details;
  }
}

function isScreeningError(err) {
  return !!err && err.name === 'ScreeningError' && typeof err.code === 'string';
}

module.exports = { ScreeningError, isScreeningError };
