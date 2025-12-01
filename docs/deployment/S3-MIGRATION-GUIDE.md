# S3 Migration Guide

## Why Migrate to S3?

Render's filesystem is **ephemeral** - files are deleted on every deployment. This means:
- ❌ Uploaded documents disappear after each deploy
- ❌ No persistent storage for historical records
- ✅ S3 provides permanent, reliable storage

## Prerequisites

- AWS Account
- Access to Render Dashboard
- Node.js installed locally (for migration script)

## Step 1: Create S3 Bucket

1. Go to [AWS S3 Console](https://console.aws.amazon.com/s3/)
2. Click "Create bucket"
3. **Bucket name:** `reparations-documents` (or your preferred name)
4. **Region:** `us-east-1` (or your preferred region)
5. **Block Public Access:**
   - **Uncheck** "Block all public access" if you want public URLs
   - OR keep it checked and use presigned URLs (more secure)
6. **Versioning:** Enable (recommended for backup)
7. **Encryption:** Enable (recommended)
8. Click "Create bucket"

## Step 2: Create IAM User

1. Go to [AWS IAM Console](https://console.aws.amazon.com/iam/)
2. Click "Users" → "Add users"
3. **Username:** `reparations-app`
4. **Access type:** Programmatic access
5. **Permissions:** Attach existing policy → `AmazonS3FullAccess`
   - OR create custom policy (more secure):
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
           "arn:aws:s3:::reparations-documents",
           "arn:aws:s3:::reparations-documents/*"
         ]
       }
     ]
   }
   ```
6. Click "Create user"
7. **SAVE THE CREDENTIALS:**
   - Access Key ID: `AKIA...`
   - Secret Access Key: `wJa...` (only shown once!)

## Step 3: Configure Render Environment

1. Go to [Render Dashboard](https://dashboard.render.com/)
2. Select your service
3. Go to "Environment" tab
4. Add these environment variables:

```bash
S3_ENABLED=true
S3_BUCKET=reparations-documents
S3_REGION=us-east-1
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=wJa...
```

5. Click "Save Changes"
6. Render will automatically redeploy

## Step 4: Migrate Existing Files (Optional)

If you have local files that need to be migrated to S3:

1. **Set environment variables locally:**
   ```bash
   export S3_ENABLED=true
   export S3_BUCKET=reparations-documents
   export S3_REGION=us-east-1
   export AWS_ACCESS_KEY_ID=AKIA...
   export AWS_SECRET_ACCESS_KEY=wJa...
   export DATABASE_URL=postgresql://...
   ```

2. **Run migration script:**
   ```bash
   node migrate-to-s3.js
   ```

3. **Review output:**
   ```
   📊 Migration Summary:
     ✅ Migrated: 15
     ⚠️  Skipped: 0
     ❌ Failed: 0
   ```

## Step 5: Test Upload

1. Go to your site
2. Upload a test document
3. Check S3 bucket - file should appear
4. Try viewing the document - should work

## S3 Bucket Structure

Files are stored with this structure:
```
reparations-documents/
└── owners/
    └── James-Hopewell/
        └── will/
            └── James-Hopewell-will-1764042132994.pdf
```

## Troubleshooting

### Error: "Access Denied"
- Check IAM user has correct permissions
- Verify AWS credentials are correct
- Check bucket policy allows your IAM user

### Error: "Bucket does not exist"
- Verify S3_BUCKET name matches exactly
- Check S3_REGION is correct

### Files not appearing in S3
- Check S3_ENABLED=true in Render environment
- View Render logs for errors
- Verify AWS credentials are set correctly

### Document viewing returns 404
- Check file was uploaded to S3
- Verify file_path in database points to S3 URL
- Check bucket permissions allow reading

## Cost Estimate

S3 costs (us-east-1):
- **Storage:** $0.023 per GB/month
- **Requests:** $0.005 per 1,000 PUT, $0.0004 per 1,000 GET
- **Data Transfer:** Free ingress, $0.09/GB egress

**Example:** 1,000 documents (1 GB total):
- Storage: ~$0.02/month
- Requests (1,000 uploads + 10,000 views): ~$0.01/month
- **Total: ~$0.03/month** 💰

## Next Steps

After S3 is configured:
1. ✅ All new uploads go to S3 automatically
2. ✅ Files persist across Render deployments
3. ✅ Can enable versioning for backup
4. ✅ Can implement lifecycle policies for archiving

## Support

If you encounter issues:
1. Check Render logs: `View Logs` in dashboard
2. Check S3 bucket: AWS Console → S3
3. Verify environment variables are set correctly
4. Test with a small file first
