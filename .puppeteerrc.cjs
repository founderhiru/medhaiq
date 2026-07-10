const { join } = require('path');

module.exports = {
  // Store Chrome inside the project folder itself, not the default
  // $HOME/.cache — Render only carries the project folder over from
  // the build step into the running container, so anything downloaded
  // outside of it (like the default cache location) disappears by the
  // time the app actually starts.
  cacheDirectory: join(__dirname, '.cache', 'puppeteer'),
};