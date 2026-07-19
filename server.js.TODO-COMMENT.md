# server.js — 1 edit

Branch: `founder-dashboard-staging`

Just adds a comment above the existing `GET /founder` route — no behavior
change at all. Purely documents the future optimization for whenever real
traffic makes it worth doing.

### FIND:
```js
app.get('/founder', requireFounderPage, async (req, res) => {
```

### REPLACE with:
```js
// TODO(founder-dashboard-aggregation): once MedhaIQ has real user traffic,
// consider moving this to a single backend aggregation function/service
// instead of 7 independent calls. The Promise.all already gets most of the
// latency win (wall-clock time ~ the slowest single query, not the sum of
// all 7), so this isn't about speed — it's about (1) fewer connections
// grabbed from the pool per dashboard view once founders and real users
// are both competing for it, (2) a natural place to cache the KPI/beta
// numbers for 30-60s instead of re-querying on every view (the template
// already has a `lastRefreshed` timestamp, implying periodic-refresh was
// the original intent, not live-per-request data), and (3) per-section
// graceful degradation instead of one failed query 500ing the whole page
// via error-boundary.ejs. Not blocking launch on this — noted per founder
// decision, not urgent.
app.get('/founder', requireFounderPage, async (req, res) => {
```
