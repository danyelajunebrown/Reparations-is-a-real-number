# S3 Storage Setup Guide for Reparations Platform

## Why S3?
- **Render free tier has ephemeral storage** - files are deleted when server restarts
- **S3 provides permanent storage** - documents persist indefinitely
- **Scalable** - handles unlimited documents
- **Cost-effective** - AWS Free Tier includes 5GB for 12 months

---

## Step 1: Create AWS S3 Bucket

### 1.1 Sign in to AWS Console
1. Go to: https://console.aws.amazon.com/s3/
2. Sign in (or create free AWS account)

### 1.2 Create Bucket
1. Click **"Create bucket"**
2. **Bucket name**: `reparations-documents-{random}`
   - Example: `reparations-documents-prod-2024`
   - Must be globally unique
   - Use lowercase, numbers, hyphens only
3. **Region**: Choose closest to your users
   - US East (N. Virginia) - `us-east-1` (recommended)
   - US West (Oregon) - `us-west-2`
4. **Object Ownership**: ACLs disabled (recommended)
5. **Block Public Access**: KEEP ALL CHECKED ✅
   - We'll use signed URLs for secure access
6. **Bucket Versioning**: Enable (optional - helps recover deleted files)
7. **Default encryption**: Enable with SSE-S3
8. Click **"Create bucket"**

---

## Step 2: Create IAM User with S3 Access

### 2.1 Create IAM User
1. Go to: https://console.aws.amazon.com/iam/
2. Click **"Users"** → **"Create user"**
3. **User name**: `reparations-platform-s3`
4. Click **"Next"**

### 2.2 Set Permissions
1. Select **"Attach policies directly"**
2. Search for and select: **"AmazonS3FullAccess"**
   - (For production, use custom policy with limited access - see below)
3. Click **"Next"** → **"Create user"**

### 2.3 Create Access Keys
1. Click on the newly created user
2. Go to **"Security credentials"** tab
3. Scroll to **"Access keys"**
4. Click **"Create access key"**
5. Select **"Application running outside AWS"**
6. Click **"Next"** → **"Create access key"**
7. **IMPORTANT**: Copy and save:
   - **Access Key ID**: `AKIAXXXXXXXXXXXXXXXX`
   - **Secret Access Key**: `xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`
   - You won't be able to see the secret again!

---

## Step 3: Configure Environment Variables

### 3.1 Local Development (.env file)

Create or update `.env` file in your project root:

```bash
# Database (existing)
DATABASE_URL=postgresql://user:pass@host:port/dbname

# Google Vision API (existing)
GOOGLE_VISION_API_KEY=your_key_here

# AWS S3 Configuration (NEW)
S3_ENABLED=true
S3_BUCKET=reparations-documents-prod-2024
S3_REGION=us-east-1
AWS_ACCESS_KEY_ID=AKIAXXXXXXXXXXXXXXXX
AWS_SECRET_ACCESS_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Storage fallback (optional - local backup)
STORAGE_ROOT=./storage

# Server
PORT=3000
NODE_ENV=development
```

### 3.2 Render Deployment

In Render Dashboard (https://dashboard.render.com):

1. Go to your **reparations-platform** service
2. Click **"Environment"** tab
3. Add these environment variables:

```
S3_ENABLED = true
S3_BUCKET = reparations-documents-prod-2024
S3_REGION = us-east-1
AWS_ACCESS_KEY_ID = AKIAXXXXXXXXXXXXXXXX
AWS_SECRET_ACCESS_KEY = xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

4. Click **"Save Changes"**
5. Render will automatically redeploy

---

## Step 4: Update config.js (Already Done!)

Your `config.js` already supports S3! It reads from environment variables:

```javascript
storage: {
  root: process.env.STORAGE_ROOT || './storage',
  s3: {
    enabled: process.env.S3_ENABLED === 'true',
    bucket: process.env.S3_BUCKET,
    region: process.env.S3_REGION || 'us-east-1'
  }
}
```

---

## Step 5: Test S3 Upload

### 5.1 Test Locally
```bash
# Set S3 environment variables in .env
S3_ENABLED=true
S3_BUCKET=your-bucket-name
S3_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-key
AWS_SECRET_ACCESS_KEY=your-secret

# Restart server
npm start

# Upload a test document via the UI
# Check server logs for "S3 upload successful"
```

### 5.2 Verify in AWS Console
1. Go to S3 Console: https://console.aws.amazon.com/s3/
2. Click on your bucket
3. Navigate to: `owners/{ownerName}/{docType}/`
4. You should see uploaded files!

---

## Security Best Practices

### Custom IAM Policy (Recommended for Production)

Instead of `AmazonS3FullAccess`, create a custom policy:

1. Go to IAM → Policies → Create policy
2. Use this JSON:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:DeleteObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::reparations-documents-prod-2024",
        "arn:aws:s3:::reparations-documents-prod-2024/*"
      ]
    }
  ]
}
```

3. Name it: `ReparationsPlatformS3Policy`
4. Attach to your IAM user

### Enable Server-Side Encryption
Already enabled if you selected SSE-S3 during bucket creation.

### Enable Versioning
Protects against accidental deletions - you can recover previous versions.

---

## Troubleshooting

### Error: "Access Denied"
- Check IAM user has correct permissions
- Verify bucket name matches exactly
- Ensure AWS credentials are correct

### Error: "Bucket does not exist"
- Check bucket name spelling
- Verify region matches (us-east-1, us-west-2, etc.)

### Files not appearing in S3
- Check server logs for errors
- Verify `S3_ENABLED=true` in environment
- Check AWS credentials are set correctly

### Local fallback
If S3 upload fails, the system automatically falls back to local storage:
```
console.error('S3 upload failed, falling back to local:', err);
```

---

## Cost Estimate

**AWS Free Tier (First 12 months):**
- 5 GB storage
- 20,000 GET requests
- 2,000 PUT requests

**After Free Tier:**
- Storage: ~$0.023/GB/month
- PUT requests: $0.005 per 1,000 requests
- GET requests: $0.0004 per 1,000 requests

**Example**: 1,000 documents (1GB total) = **~$0.02/month**

---

## Next Steps

1. ✅ Create S3 bucket
2. ✅ Create IAM user and access keys
3. ✅ Add environment variables to `.env`
4. ✅ Test local upload
5. ✅ Add environment variables to Render
6. ✅ Test production upload

**After setup, all uploaded documents will be stored in S3 and persist forever!**
