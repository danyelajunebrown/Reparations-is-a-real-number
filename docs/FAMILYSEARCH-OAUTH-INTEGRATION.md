# FamilySearch OAuth Integration Plan

**Created:** February 14, 2026  
**Status:** Phase 1 - Research Complete ✅

---

## Executive Summary

**THE GOOD NEWS:** FamilySearch provides a complete OAuth 2.0 API that allows secure, privacy-preserving ancestor tree access WITHOUT requiring users to share their credentials.

**Key Findings:**
- ✅ **OAuth 2.0 supported** - Users log in directly with FamilySearch (like "Sign in with Google")
- ✅ **Ancestry endpoint available** - Can retrieve up to 9 generations of ancestors
- ✅ **Full person data** - Names, birth/death dates, locations, parent relationships, FamilySearch IDs
- ✅ **OpenID Connect** - Can get user profile without separate API call
- ✅ **Zero credential sharing** - User credentials never touch our servers

---

## How It Works (User Perspective)

1. User visits our website
2. Clicks **"Connect FamilySearch"** button
3. Redirected to FamilySearch.org login page (official site)
4. User logs in with their FamilySearch credentials
5. FamilySearch shows permissions screen: "Reparations Platform wants to access your family tree"
6. User clicks "Allow"
7. Redirected back to our site with authorization code
8. Our backend exchanges code for access token (user doesn't see this)
9. We query their ancestor tree (up to 9 generations)
10. Check each ancestor against our enslaver database
11. Show results to user

**Privacy Model:**
- ✅ User credentials stay on FamilySearch servers only
- ✅ We receive a token (not their password)
- ✅ Token can be revoked anytime by user via FamilySearch settings
- ✅ Token expires automatically (refresh requires re-authentication)
- ✅ We only query what's needed (ancestor names/dates/IDs)

---

## Technical Architecture

### Phase 1: Developer Registration (Required First Step)

**Action Required:** Apply to FamilySearch Solutions Provider Program
- URL: https://www.familysearch.org/developers/
- Application includes:
  - Organization name: "Reparations ∈ ℝ Project"
  - App name: "Reparations Ancestor Tracer"
  - App type: Web
  - Redirect URI: `https://danyelajunebrown.github.io/Reparations-is-a-real-number/auth/familysearch/callback`
  - Purpose: Historical reparations research and documentation
  
**Approval Process:**
- Submit application
- FamilySearch reviews (may take days/weeks)
- Receive app key (client ID) and access to sandbox environment
- Develop and test in sandbox (uses test data)
- Apply for production access after testing
- Production approval requires "App Approval Considerations" review

**Timeline Estimate:**
- Application: 1 hour
- Approval wait: 1-3 weeks (possibly faster for non-commercial/research use)
- Development in sandbox: 1-2 weeks
- Production approval: additional 1-2 weeks

### Phase 2: Backend OAuth Implementation

**New Files to Create:**

1. **`src/api/routes/familysearch-auth.js`**
```javascript
// OAuth endpoints:
// GET /api/familysearch/auth/login - Redirect to FamilySearch OAuth
// GET /api/familysearch/auth/callback - Handle OAuth return
// POST /api/familysearch/auth/refresh - Refresh expired token
// GET /api/familysearch/auth/logout - Revoke token
```

2. **`src/services/familysearch/FamilySearchClient.js`**
```javascript
// API wrapper:
// - exchangeCodeForToken(authCode)
// - getAncestry(personId, generations)
// - getCurrentUser()
// - refreshToken(refreshToken)
```

3. **`src/services/familysearch/AncestorMatcher.js`**
```javascript
// Core logic:
// - Fetch ancestors from FamilySearch API
// - Match against our enslaver database
// - Calculate confidence scores
// - Return results with documentation
```

**Environment Variables Needed:**
```bash
FAMILYSEARCH_CLIENT_ID=<from app registration>
FAMILYSEARCH_CLIENT_SECRET=<from app registration>
FAMILYSEARCH_REDIRECT_URI=https://danyelajunebrown.github.io/Reparations-is-a-real-number/auth/familysearch/callback
FAMILYSEARCH_API_BASE_URL=https://api.familysearch.org
FAMILYSEARCH_AUTH_URL=https://ident.familysearch.org/cis-web/oauth2/v3/authorization
FAMILYSEARCH_TOKEN_URL=https://ident.familysearch.org/cis-web/oauth2/v3/token
```

### Phase 3: Frontend UI Implementation

**New UI Components:**

1. **Landing Page Section (index.html)**
```html
<!-- Add to hero section -->
<div class="ancestor-trace-card">
  <h2>Trace Your Ancestors</h2>
  <p>Connect your FamilySearch account to check your lineage for slaveholder connections.</p>
  <button onclick="connectFamilySearch()" class="btn-primary">
    Connect FamilySearch Account
  </button>
  <p class="privacy-note">🔒 Your credentials stay private. We only access your family tree.</p>
</div>
```

2. **Authentication Flow (js/app.js)**
```javascript
async function connectFamilySearch() {
  // 1. Call backend to get OAuth URL
  const response = await fetch('/api/familysearch/auth/login');
  const { authUrl } = await response.json();
  
  // 2. Open OAuth popup or redirect
  window.location.href = authUrl; // Or use popup
}

async function handleOAuthCallback() {
  // After redirect back from FamilySearch:
  const urlParams = new URLSearchParams(window.location.search);
  const code = urlParams.get('code');
  
  if (code) {
    // Exchange code for token via backend
    const response = await fetch('/api/familysearch/auth/callback', {
      method: 'POST',
      body: JSON.stringify({ code }),
      headers: { 'Content-Type': 'application/json' }
    });
    
    const { userId, accessToken } = await response.json();
    
    // Start ancestor trace
    startAncestorTrace(userId);
  }
}

async function startAncestorTrace(userId) {
  showLoadingModal('Climbing your family tree...');
  
  const response = await fetch('/api/familysearch/trace-ancestors', {
    method: 'POST',
    body: JSON.stringify({ userId, generations: 9 }),
    headers: { 'Content-Type': 'application/json' }
  });
  
  const results = await response.json();
  displayResults(results);
}
```

3. **Results Display Modal**
```html
<div class="ancestor-results-modal">
  <h2>Ancestor Trace Results</h2>
  
  <div class="stats-summary">
    <div class="stat">
      <strong>Ancestors Checked:</strong> <span id="ancestorsChecked">--</span>
    </div>
    <div class="stat">
      <strong>Slaveholder Matches:</strong> <span id="matchesFound">--</span>
    </div>
    <div class="stat">
      <strong>Generations Traced:</strong> <span id="generationsTraced">--</span>
    </div>
  </div>
  
  <div id="matchList">
    <!-- Match cards populated here -->
  </div>
  
  <button onclick="generateDAA()">Generate Debt Acknowledgement Agreement</button>
</div>
```

### Phase 4: API Integration Details

**FamilySearch API Endpoints We'll Use:**

1. **Authorization Endpoint**
```
GET https://ident.familysearch.org/cis-web/oauth2/v3/authorization
Parameters:
  - response_type=code
  - client_id={our_app_key}
  - redirect_uri={our_callback_url}
  - scope=openid profile
```

2. **Token Exchange**
```
POST https://ident.familysearch.org/cis-web/oauth2/v3/token
Body:
  - grant_type=authorization_code
  - code={auth_code_from_callback}
  - redirect_uri={same_as_before}
  - client_id={our_app_key}
  
Response:
  - access_token
  - token_type
  - id_token (if using OpenID Connect)
```

3. **Get Current User**
```
GET https://api.familysearch.org/platform/users/current
Headers:
  - Authorization: Bearer {access_token}
  
Response:
  - personId (their FamilySearch ID)
  - displayName
  - email (if scope granted)
```

4. **Get Ancestry (THE KEY ENDPOINT)**
```
GET https://api.familysearch.org/platform/tree/ancestry
Parameters:
  - person={personId}
  - generations={1-9}
  
Response:
{
  "persons": [
    {
      "id": "XXXX-XXX",
      "display": {
        "name": "John Smith",
        "birthDate": "1800",
        "birthPlace": "Virginia",
        "deathDate": "1870",
        "ascendancyNumber": "2" // Ahnen number for position
      }
    },
    ...
  ],
  "childAndParentsRelationships": [
    {
      "child": {"resourceId": "XXXX-XXX"},
      "parent1": {"resourceId": "YYYY-YYY"},
      "parent2": {"resourceId": "ZZZZ-ZZZ"}
    },
    ...
  ]
}
```

**Key Data Fields Available:**
- `id` - FamilySearch person ID (exactly what our current scraper looks for!)
- `display.name` - Full name
- `display.birthDate` - Birth year/date
- `display.birthPlace` - Birth location (city, county, state)
- `display.deathDate` - Death year/date
- `display.ascendancyNumber` - Ahnen number (genealogical position: 1=person, 2=father, 3=mother, 4=paternal grandfather, etc.)
- Parent relationships included

**Rate Limits:**
- Not explicitly documented in public docs
- Typically 60-120 requests per minute for authenticated users
- Will need to implement exponential backoff

---

## Implementation Phases

### **Phase 1: Registration & Setup** (Week 1)
- [ ] Apply to FamilySearch Solutions Provider Program
- [ ] Wait for approval and receive app key
- [ ] Set up sandbox environment
- [ ] Test OAuth flow in sandbox with test account

### **Phase 2: Backend Development** (Week 2)
- [ ] Create FamilySearchClient service
- [ ] Implement OAuth endpoints
- [ ] Create AncestorMatcher service
- [ ] Add session management for tokens
- [ ] Test with sandbox API

### **Phase 3: Frontend Development** (Week 3)
- [ ] Add "Connect FamilySearch" button to homepage
- [ ] Implement OAuth callback handler
- [ ] Build ancestor trace progress UI
- [ ] Create results display modal
- [ ] Add error handling and user feedback

### **Phase 4: Testing & Refinement** (Week 4)
- [ ] E2E testing with real FamilySearch accounts
- [ ] Performance optimization (caching, rate limiting)
- [ ] Privacy audit
- [ ] User experience improvements

### **Phase 5: Production Deployment** (Week 5-6)
- [ ] Apply for production API access
- [ ] Security review
- [ ] Deploy to production
- [ ] Monitor and fix issues

---

## Privacy & Security Considerations

### What We Store:
- ✅ FamilySearch person ID (for matching)
- ✅ Ancestor names and dates (for matching)
- ✅ Match results (for DAA generation)

### What We DON'T Store:
- ❌ User passwords (never see them)
- ❌ Access tokens (ephemeral, session only)
- ❌ Full family tree (only extract what's needed)
- ❌ Living relatives' data (focus on historical ancestors)

### Token Security:
- Store tokens server-side only (never in frontend localStorage)
- Use HTTP-only cookies for session management
- Implement CSRF protection
- Auto-expire tokens after 1 hour of inactivity
- Allow users to revoke access anytime

### User Controls:
- Clear opt-in consent screen
- Ability to disconnect FamilySearch account
- Delete all their data from our system
- View what data we have about them

---

## Comparison: API vs Browser Extension

| Feature | OAuth API | Browser Extension |
|---------|-----------|-------------------|
| **Privacy** | ✅ Excellent (standard OAuth) | ✅ Excellent (runs locally) |
| **Installation** | ✅ None needed | ❌ Requires install |
| **Cross-browser** | ✅ Works everywhere | ⚠️ Need Chrome & Firefox versions |
| **Maintenance** | ✅ Backend only | ❌ Update for each browser version |
| **Rate limits** | ⚠️ Subject to API limits | ✅ No limits (direct scraping) |
| **FamilySearch approval** | ⚠️ Requires app review | ❌ May violate ToS |
| **Reliability** | ✅ Stable API | ⚠️ Breaks when UI changes |
| **Development time** | 🕐 3-4 weeks | 🕐 2-3 weeks |
| **User experience** | ✅ Seamless | ⚠️ Extra step |

**Recommendation:** Start with OAuth API approach. It's cleaner, more maintainable, and respects FamilySearch's terms of service.

---

## Next Steps (Immediate Actions)

### Today:
1. ✅ Research FamilySearch API - COMPLETE
2. [ ] Draft application for Solutions Provider Program
3. [ ] Design UI mockups for OAuth flow

### This Week:
1. [ ] Submit FamilySearch developer application
2. [ ] Create backend API endpoint stubs
3. [ ] Set up test environment

### While Waiting for Approval:
1. [ ] Build UI components (can be done without API access)
2. [ ] Create mock data for testing UI
3. [ ] Write comprehensive tests
4. [ ] Document user flow

---

## Questions & Considerations

### Known Limitations:
- **9 generation max** - API limits to 9 generations (typically gets back to ~1700s)
- **Approval wait time** - Could be 1-3 weeks for initial approval
- **Living persons protection** - API may restrict access to recent relatives
- **Incomplete trees** - If user's tree is sparse, we find less

### Open Questions:
1. **Commercial use restrictions?** - FamilySearch may restrict commercial apps. We should clarify our non-profit, research-focused mission in application.
2. **Data retention policies?** - How long can we cache ancestor data? Need to check their ToS.
3. **Attribution requirements?** - Do we need to display "Powered by FamilySearch" branding?

### Fallback Plan:
If FamilySearch denies our application:
- **Plan B:** Build browser extension (local scraping, no API needed)
- **Plan C:** GEDCOM upload feature (user exports manually)
- **Plan D:** Partner with existing FamilySearch-approved genealogy app

---

## Cost Analysis

### FamilySearch API:
- ✅ **FREE** for approved developers
- No usage fees
- No per-request charges
- Only requirement: Follow their developer terms

### Alternative Costs (for comparison):
- Browser extension: Development time (~$5k if contracted)
- Ancestry API: ~$0.10 per API call (expensive at scale)
- Manual GEDCOM processing: Zero cost, lower conversion

**Budget Impact:** $0 if approved (just development time)

---

## Success Metrics

### Technical:
- API response time < 2 seconds per ancestor
- 99% OAuth flow success rate
- < 1% error rate on ancestor matching

### User Experience:
- < 30 seconds from "Connect" button to results
- 90%+ user satisfaction with privacy model
- 50%+ conversion rate (visitors → connected accounts)

### Impact:
- 100+ successful ancestor traces in first month
- 10+ DAA documents generated
- Zero credential-sharing incidents

---

**Status:** Ready to proceed with FamilySearch developer application.  
**Next Action:** Draft and submit application to Solutions Provider Program.  
**Timeline:** 4-6 weeks to production-ready integration.
