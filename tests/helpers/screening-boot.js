// Boots the REAL server.js with the fake AI installed. Test-only.
require('./screening-fake-ai').install(require);
require('../../server.js');
