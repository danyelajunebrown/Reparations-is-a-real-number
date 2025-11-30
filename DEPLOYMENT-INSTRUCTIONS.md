# Render Deployment Instructions - Nov 30, 2025

## 🚨 Critical Fix Applied: Dual Server Architecture Issue

### Problem Identified
Your project had **two different servers** and Render was deploying the wrong one:
- **Legacy `server.js`** (1,200+ lines) - Full-featured with ALL API endpoints ✅
- **New `src/server.js`** (150 lines) - Minimal refactored version (incomplete) ❌

The `package.json` was configured to start `index.js`, which loaded the incomplete `src/server.js`.

### Solution Applied
Changed `package.json` line 7:
```json
"start": "node server.js"  // Was: "node index.js"
```

---

## 📝 Deployment Steps

### 1. Commit the Fix
```bash
git add package.json memory-bank/activeContext.md DEPLOYMENT-INSTRUCTIONS.md
git commit -m "Fix Render deployment: Switch to legacy server.js

- Changed package.json start script to use server.js instead of index.js
- Ensures all API endpoints are available (upload, search, llm-query, beyond-kin)
- Fixes frontend media asset loading
- Updated memory bank with deployment fix details"
git push origin main
```

### 2. Monitor Render Deployment
1. Go to: https://dashboard.render.com
2. Click on **"reparations-platform"** service
3. You should see a new deployment starting automatically
4. Click **"Logs"** tab to monitor progress

**Expected Deploy Timeline:**
- Build: ~2-3 minutes
- Start: ~30 seconds
- Total: ~3-4 minutes

### 3. Verify Deployment Success

#### A. Health Check
```bash
curl https://reparations-platform.onrender.com/health
```

**Expected Response:**
```json
{
  "status": "ok",
  "timestamp": "2025-11-30T...",
  "database": "connected",
  "environment": "production"
}
```

#### B. API Endpoints Check
Test critical endpoints:
```bash
# Document search
curl "https://reparations-platform.onrender.com/api/search-documents?query=Hopewell"

# Carousel data
curl https://reparations-platform.onrender.com/api/carousel-data

# Beyond Kin queue
curl https://reparations-platform.onrender.com/api/beyond-kin/pending
```

#### C. Frontend Integration
1. Open: https://danyelajunebrown.github.io (your frontend)
2. Check browser console for errors
3. Test document search functionality
4. Verify carousel loads data
5. Test research assistant chat

---

## 🎨 Frontend Media Assets - Verification

### Static Files Being Served
With `server.js`, these paths are now accessible:

1. **`/frontend/public/carousel-enhancements.js`**
   - URL: https://reparations-platform.onrender.com/frontend/public/carousel-enhancements.js
   - Referenced in `index.html` line 10

2. **Root HTML files:**
   - `/index.html` - Main dashboard
   - `/portal.html` - Reparations portal
   - `/contribute.html` - Research contribution page

3. **Document files via API:**
   - `/api/documents/:id/file` - View/download documents
   - Serves from S3 or local storage

### Testing Media Assets
```bash
# Test carousel enhancements script
curl https://reparations-platform.onrender.com/frontend/public/carousel-enhancements.js

# Test main page
curl https://reparations-platform.onrender.com/index.html
```

---

## 🔍 Troubleshooting

### If Deployment Fails
1. **Check Render logs** for error messages
2. **Common issues:**
   - Missing environment variables
   - Database connection failure
   - Port binding issues

### If API Endpoints Return 404
- Verify `server.js` is being used (not `src/server.js`)
- Check deployment logs for "🚀 REPARATIONS PLATFORM SERVER STARTED"
- Ensure no `index.js` redirect in logs

### If Frontend Can't Connect
1. **Check CORS:** Frontend origin should be allowed
2. **Verify API_BASE_URL** in frontend code
3. **Test with curl** first to isolate frontend vs backend issues

### Cold Start Issues
- Render free tier sleeps after 15 minutes of inactivity
- First request after sleep takes 30-60 seconds
- Frontend has built-in retry logic for this

---

## ✅ Success Criteria

Deployment is successful when:
- ✅ Health endpoint returns `"status": "ok"`
- ✅ Database shows `"connected"`
- ✅ `/api/search-documents` returns results
- ✅ `/frontend/public/carousel-enhancements.js` loads (200 OK)
- ✅ Frontend can search documents
- ✅ Document viewer can load PDFs

---

## 🚀 Post-Deployment Testing Checklist

### Backend Tests
- [ ] Health check responds
- [ ] Database connection verified
- [ ] Document upload works
- [ ] Document retrieval works (S3)
- [ ] Search functionality working
- [ ] LLM research assistant responds
- [ ] Beyond Kin queue loads

### Frontend Tests
- [ ] Page loads without errors
- [ ] Carousel displays data
- [ ] Document search returns results
- [ ] Document viewer opens PDFs
- [ ] Upload form works
- [ ] Research assistant chat functional

### Integration Tests
- [ ] Frontend → Backend API calls succeed
- [ ] CORS allows frontend origin
- [ ] Static assets (carousel-enhancements.js) load
- [ ] Document download works
- [ ] Multi-page upload functional

---

## 📊 Monitoring Dashboard

### Key Metrics to Watch
1. **Response Time:** Should be <500ms (after cold start)
2. **Error Rate:** Should be 0%
3. **Database Connections:** Should stay connected
4. **S3 Operations:** Document retrieval should work

### Render Dashboard
- URL: https://dashboard.render.com
- Service: reparations-platform (srv-d4j61k24d50c73e3sv8g)
- Check: Deployment history, logs, metrics

---

## 🔮 Long-term Architecture Plan

### Current State (After This Fix)
- Using `server.js` (legacy, full-featured)
- All endpoints operational
- Frontend fully functional

### Future Migration Path
1. **Phase 1:** Keep using `server.js` in production (DONE ✅)
2. **Phase 2:** Complete `src/server.js` refactoring (add missing routes)
3. **Phase 3:** Add comprehensive tests
4. **Phase 4:** Deploy both versions, use feature flags
5. **Phase 5:** Gradual traffic migration
6. **Phase 6:** Full cutover to `src/server.js`

**Timeline:** 2-3 months for complete migration

---

## 📞 Support

If issues persist:
1. Check memory-bank/activeContext.md for latest context
2. Review Render deployment logs
3. Test individual API endpoints with curl
4. Verify environment variables in Render dashboard
5. Check database connectivity

---

**Last Updated:** November 30, 2025  
**Status:** Fix Applied - Awaiting Commit & Deploy  
**Next Action:** Commit changes and push to GitHub
