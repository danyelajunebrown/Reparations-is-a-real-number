# Render Deployment Debugging Guide

## Current Status
- ✅ Build successful
- ✅ Service started
- ❌ Getting 502 errors (service crashed or unreachable)

---

## Step 1: Get Runtime Logs

1. Go to: https://dashboard.render.com
2. Click on **"reparations-platform"** service
3. Click **"Logs"** tab
4. Scroll to **AFTER** this line:
   ```
   ==> Your service is live 🎉
   ```
5. Look for **error messages** after that point

---

## Step 2: Common Issues to Look For

### Issue 1: Database Connection Error
**Look for:**
```
Error: connect ECONNREFUSED
error: password authentication failed
Connection terminated unexpectedly
```

**Fix:**
- Check `DATABASE_URL` is set in Render Environment tab
- Verify PostgreSQL service is running
- Check database password is correct

---

### Issue 2: Missing Environment Variables
**Look for:**
```
Error: Cannot read property 'x' of undefined
Missing required environment variable
```

**Required Variables:**
```
DATABASE_URL=postgresql://...
GOOGLE_VISION_API_KEY=your_key (optional)
NODE_ENV=production
PORT=(auto-set by Render)
```

**Optional for S3:**
```
S3_ENABLED=false (or true with credentials)
S3_BUCKET=your-bucket
S3_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-key
AWS_SECRET_ACCESS_KEY=your-secret
```

---

### Issue 3: Module/Dependency Errors
**Look for:**
```
Error: Cannot find module 'xxx'
MODULE_NOT_FOUND
```

**Fix:**
- Check `package.json` has all dependencies
- Run `npm install` locally to verify

---

### Issue 4: Port Binding Issues
**Look for:**
```
Error: listen EADDRINUSE
Port 3000 is already in use
```

**Fix:**
- Verify `server.js` uses `process.env.PORT`
- Should see: `const PORT = process.env.PORT || 3000;`

---

### Issue 5: Middleware Errors
**Look for:**
```
Error: Cannot find module './middleware/auth'
TypeError: middleware is not a function
```

**Fix:**
- Check all middleware files exist in repo
- Verify imports match file names

---

## Step 3: Quick Diagnostic Commands

Run these in Render Shell (if available):

```bash
# Check if server is running
ps aux | grep node

# Check port listening
netstat -tuln | grep 3000

# Check environment variables
env | grep DATABASE_URL
env | grep NODE_ENV

# Test database connection
node -e "require('./database').checkHealth().then(console.log)"
```

---

## Step 4: Temporary Fixes

### Option A: Disable New Features
Temporarily disable features to isolate the issue:

1. **Disable Authentication:**
   - In `server.js`, all `authenticate` middleware is already commented out

2. **Disable S3:**
   ```
   S3_ENABLED=false
   ```

3. **Simplify CORS:**
   - Remove `ALLOWED_ORIGINS` variable
   - Use default CORS in code

---

### Option B: Check Package.json
Ensure these dependencies are in `package.json`:

```json
{
  "dependencies": {
    "express": "^4.18.2",
    "pg": "^8.11.0",
    "multer": "^1.4.5-lts.1",
    "cors": "^2.8.5",
    "dotenv": "^16.0.3",
    "express-rate-limit": "^6.7.0",
    "bcrypt": "^5.1.0",
    "jsonwebtoken": "^9.0.0",
    "@aws-sdk/client-s3": "^3.0.0"
  }
}
```

---

## Step 5: Force Redeploy

If logs show no errors but service is still down:

1. **Manual Deploy:**
   - In Render dashboard
   - Click "Manual Deploy" → "Deploy latest commit"

2. **Clear Build Cache:**
   - Settings → "Clear build cache"
   - Then redeploy

---

## Step 6: Health Check Verification

Verify Render can reach your health endpoint:

1. **Check server.js has health endpoint:**
   ```javascript
   app.get('/health', asyncHandler(async (req, res) => {
     const dbHealth = await database.checkHealth();
     res.json({
       status: dbHealth.healthy ? 'ok' : 'degraded',
       timestamp: new Date().toISOString(),
       database: dbHealth.healthy ? 'connected' : 'disconnected'
     });
   }));
   ```

2. **Render Health Check Path:**
   - Settings → Health Check Path → `/health`
   - Make sure it's set correctly

---

## Step 7: Database Debugging

If database connection is the issue:

```javascript
// Test connection in init-database.js or server startup
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

pool.connect()
  .then(() => console.log('✅ Database connected'))
  .catch(err => {
    console.error('❌ Database connection failed:', err.message);
    console.error('Full error:', err);
  });
```

---

## Next Steps

1. **Copy the runtime logs** (everything after "service is live")
2. **Check environment variables** in Render dashboard
3. **Share any error messages** you find
4. **We'll fix the specific issue** together

---

## Quick Test

Try accessing these URLs and share what you get:

```
https://reparations-platform.onrender.com/
https://reparations-platform.onrender.com/health
```

If both return 502, the app is definitely crashed.
If the first one returns something, the health endpoint might be the issue.
