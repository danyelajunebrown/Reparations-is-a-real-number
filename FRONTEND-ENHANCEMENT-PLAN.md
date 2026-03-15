# Frontend Enhancement Plan

## Current Issues Identified

### 1. Performance Issues (1.5-1.9s response times)
- **Root Cause**: Search endpoint creates a NEW database Pool on every request (contribute.js:198-200)
- **Impact**: Slow search, timeouts, unreliable data display
- **Fix**: Use shared connection pool, add caching

### 2. Missing Interactive Dashboard
- **Root Cause**: No charting library (Chart.js/D3.js) included in dashboard.html
- **Impact**: No visual data displays despite comment references to "bar chart"
- **Fix**: Add Chart.js and implement actual charts

### 3. Debt River Animation May Not Be Visible
- **Status**: Code exists, CSS exists, initialization in app.js - should work
- **Potential Issue**: z-index conflicts or container positioning
- **Fix**: Verify visibility, adjust z-index if needed

### 4. Features Not Working
- **Panels timeout** due to slow API responses
- **Data not displaying** due to connection issues
- **Search unreliable** due to per-request connection creation

---

## Fix Priority Order

### PHASE 1: Critical Performance Fixes (Immediate)
1. Fix search endpoint to use shared connection pool
2. Add 5-minute caching for stats endpoint
3. Add database indexes for common queries

### PHASE 2: Dashboard Charts (Today)
1. Add Chart.js CDN to dashboard.html
2. Implement source breakdown bar chart
3. Implement activity timeline chart
4. Implement data quality pie chart

### PHASE 3: UI Polish (Today)
1. Verify Debt River animation visibility
2. Fix any z-index issues
3. Add loading states to slow operations

### PHASE 4: Testing & Verification
1. Test all panels open/close
2. Test search with various queries
3. Test people browser pagination
4. Test document viewer
5. Test chat assistant

---

## Technical Details

### Database Connection Fix
```javascript
// BEFORE (BAD - creates new pool every request):
const pool = new Pool({ connectionString, ssl: {...} });

// AFTER (GOOD - use shared pool):
const { pool } = require('../../database/connection');
```

### Charts to Add
1. **Source Breakdown** - Horizontal bar chart (FamilySearch, Civil War DC, etc.)
2. **Activity Timeline** - Line chart of records added per day
3. **Data Quality** - Donut chart (clean vs needs review vs garbage)
4. **Person Types** - Pie chart (enslaved vs slaveholder vs unknown)

### Stats Caching
```javascript
// Add to contribute.js stats endpoint
let statsCache = { data: null, timestamp: 0, ttl: 300000 }; // 5 min

if (Date.now() - statsCache.timestamp < statsCache.ttl) {
    return res.json(statsCache.data);
}
```

---

## Verification Checklist

### Search
- [ ] Search for "James" returns results in <1s
- [ ] Search for "Brown" returns results
- [ ] Search for partial names works
- [ ] Empty search handled gracefully

### Panels
- [ ] Documents panel opens and lists documents
- [ ] People panel opens with filters working
- [ ] Formula panel shows reparations calculation
- [ ] Chat panel accepts input and responds
- [ ] Upload panel shows file dropzone
- [ ] Quality panel shows issues with fix buttons
- [ ] Progress panel shows extraction jobs

### Dashboard
- [ ] Charts render with real data
- [ ] Auto-refresh toggle works
- [ ] Data quality tab shows issues
- [ ] Add names form works

### Visual
- [ ] Debt River animation visible and flowing
- [ ] Search bar responsive
- [ ] Bottom nav all buttons work
- [ ] Person modal displays correctly
