// Tiny test harness (the repo's other tests are plain node scripts).
const results = { pass: 0, fail: 0, failures: [] };
let section = '';
function group(name) { section = name; console.log(`\n── ${name}`); }
async function t(name, fn) {
  try { await fn(); results.pass += 1; console.log(`  ✓ ${name}`); }
  catch (e) { results.fail += 1; results.failures.push(`${section} :: ${name} :: ${e && e.message}`); console.log(`  ✗ ${name}\n      ${e && e.message}`); }
}
function finish(label) {
  console.log(`\n${label}: ${results.pass} passed, ${results.fail} failed`);
  if (results.fail) { results.failures.forEach((f) => console.log('  FAIL ' + f)); process.exitCode = 1; }
}
module.exports = { t, group, finish, results };
