// Phase 2F-A — renders the before/after turn-by-turn comparison table from
// two JSON files produced by scripts/benchmark-prompt-cache.js.
//
// USAGE:
//   node scripts/compare-cache-benchmark.js before.json after.json
const fs = require('fs');

const [beforePath, afterPath] = process.argv.slice(2);
if (!beforePath || !afterPath) {
  console.error('Usage: node scripts/compare-cache-benchmark.js before.json after.json');
  process.exit(1);
}

const before = JSON.parse(fs.readFileSync(beforePath, 'utf8'));
const after = JSON.parse(fs.readFileSync(afterPath, 'utf8'));

console.log(`\nModel: ${after.model}`);
console.log('\n--- Turn-by-turn comparison ---\n');
console.log('Turn | Input(before) | Input(after) | CacheWrite(after) | CacheRead(after) | Latency(before) | Latency(after) | Cost(before) | Cost(after)');
console.log('-'.repeat(140));

const n = Math.max(before.turns.length, after.turns.length);
for (let i = 0; i < n; i++) {
  const b = before.turns[i] || {};
  const a = after.turns[i] || {};
  console.log(
    `${(a.turn || b.turn || `Q${i + 1}`).padEnd(4)} | ` +
    `${String(b.input_tokens ?? '-').padEnd(14)} | ` +
    `${String(a.input_tokens ?? '-').padEnd(13)} | ` +
    `${String(a.cache_creation_input_tokens ?? '-').padEnd(18)} | ` +
    `${String(a.cache_read_input_tokens ?? '-').padEnd(17)} | ` +
    `${String(b.latency_ms ?? '-').padEnd(16)} | ` +
    `${String(a.latency_ms ?? '-').padEnd(15)} | ` +
    `$${(b.estimated_cost_usd ?? 0).toFixed(6).padEnd(12)} | ` +
    `$${(a.estimated_cost_usd ?? 0).toFixed(6)}`
  );
}

const beforeTotal = before.total_estimated_cost_usd;
const afterTotal = after.total_estimated_cost_usd;
const savingsPct = beforeTotal > 0 ? ((beforeTotal - afterTotal) / beforeTotal) * 100 : 0;

console.log('\n--- Summary (this run only — not an average, sum across the exact turns above) ---');
console.log(`Total cost, caching disabled : $${beforeTotal.toFixed(6)}`);
console.log(`Total cost, caching enabled  : $${afterTotal.toFixed(6)}`);
console.log(`Estimated savings this run    : ${savingsPct.toFixed(1)}%`);
console.log('\nNote: cache_read_input_tokens > 0 on Q2+ confirms the cache boundary is actually');
console.log('being hit — if every "after" row shows cache_read=0, the split isn\'t working and');
console.log('should be debugged before trusting the cost numbers above.');
