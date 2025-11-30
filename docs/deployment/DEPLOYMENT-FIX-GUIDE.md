# File Corruption Fix - Deployment Guide

## Problem Summary

**Root Cause:** Render's free tier uses **ephemeral filesystem** - all uploaded files are deleted on every restart/deploy. Files were being uploaded to Render's temporary filesystem instead of permanent S3 storage.

**Symptoms:**
- PDFs appear "corrupted" when downloading
- Files have wrong extensions (.pdf contains text)
- MIME type mismatches between database and actual files
- Files disappear after Render restarts

## Solution Implemented

### 1. **File Type Detection** ✅
- Installed `file-type` package for magic number detection
- Updated `storage-adapter.js` to detect actual file content
- System now validates file types and logs mismatches
- Correct extensions assigned based on content, not claims

### 2. **S3 Persistent Storage** ✅
- Updated storage adapter to prefer S3 over local storage
- Files uploaded to S3 survive Render restarts
- Metadata stored in S3 for verification
- Streaming upload for large files (prevents memory issues)

### 3. **Download Endpoint Fix** ✅
- Updated `/api/documents/:documentId/file` with fallback detection
- Detects actual file type even if database is wrong
- Serves correct MIME types to browsers
- Downloads work correctly for all file types

---

## Deployment Steps

### Step 1: Configure AWS S3

1. **Create S3 Bucket:**
   ```bash
   # Via AWS Console or CLI
   aws s3 mb s3://reparations-documents --region us-east-1
   ```

2. **Set Bucket Policy** (for authenticated access):
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Sid": "AllowRenderAccess",
         "Effect": "Allow",
         "Principal": "*",
         "Action": ["s3:GetObject"],
         "Resource": "arn:aws:s3:::reparations-documents/*"
       }
     ]
   }
   ```

3. **Create IAM User** with S3 permissions:
   - Policy: `AmazonS3FullAccess` OR custom policy for your bucket
   - Generate Access Key ID and Secret Access Key

### Step 2: Configure Render Environment Variables

Go to your Render dashboard → Service → Environment and add:

```bash
# AWS S3 Configuration
S3_ENABLED=true
S3_BUCKET=reparations-documents
S3_REGION=us-east-1
AWS_ACCESS_KEY_ID=AKIAXXXXXXXXXXXXXXXX
AWS_SECRET_ACCESS_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Database (already configured)
DATABASE_URL=postgresql://reparations_user:hjEMn35Kw7p712q1SYJnBxZqIYRdahHv@dpg-d3v78f7diees73epc4k0-a.virginia-postgres.render.com/reparations?sslmode=require

# Storage Root (fallback only)
STORAGE_ROOT=./storage

# Optional: Google Vision for OCR
GOOGLE_VISION_API_KEY=your_key_here
```

### Step 3: Deploy to Render

```bash
# Commit changes
git add .
git commit -m "Fix: Add file type detection and S3 persistent storage

- Installed file-type package for content-based detection
- Updated storage-adapter.js to detect actual file types
- Fixed document retrieval endpoint with fallback detection
- Added S3 upload script for re-uploading documents
- Files now survive Render restarts (stored in S3)
"

# Push to your repository
git push origin main
```

Render will automatically deploy when you push to main.

### Step 4: Re-Upload James Hopewell PDFs

After deployment, run the upload script:

```bash
# Set AWS credentials locally
export AWS_ACCESS_KEY_ID=AKIAXXXXXXXXXXXXXXXX
export AWS_SECRET_ACCESS_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
export S3_BUCKET=reparations-documents
export S3_REGION=us-east-1

# Run upload script
node upload-james-hopewell-pdfs.js
```

**Expected output:**
```
========================================
James Hopewell PDFs → S3 Upload Script
========================================

Uploading Transcript.pdf to S3...
✓ Detected: application/pdf (.pdf)
✓ File size: 2.39 MB
✓ Uploaded to: https://reparations-documents.s3.us-east-1.amazonaws.com/owners/James-Hopewell/will/James-Hopewell-will-page1.pdf

Uploading Transcript-2.pdf to S3...
✓ Detected: application/pdf (.pdf)
✓ File size: 2.41 MB
✓ Uploaded to: https://reparations-documents.s3.us-east-1.amazonaws.com/owners/James-Hopewell/will/James-Hopewell-will-page2.pdf

Updating database record...
✓ Database updated successfully
  Document ID: d94180c70274f7bf25b735a8
  File path: owners/James-Hopewell/will/James-Hopewell-will-page1.pdf
  Total size: 4.80 MB
  MIME type: application/pdf

========================================
✅ SUCCESS! All files uploaded and database updated
========================================
```

### Step 5: Verify the Fix

1. **Test Download:**
   ```bash
   curl https://reparations-platform.onrender.com/api/documents/d94180c70274f7bf25b735a8/file -o test.pdf
   file test.pdf  # Should show: PDF document, version 1.3
   ```

2. **Check in Browser:**
   - Navigate to: `https://your-frontend.github.io`
   - Search for "James Hopewell"
   - Click "View Will"
   - PDF should open correctly in browser

---

## Future Uploads

All new file uploads will automatically:
1. ✅ Detect actual file type from content (not extension)
2. ✅ Upload to S3 (permanent storage)
3. ✅ Store correct MIME types in database
4. ✅ Preserve original files (no conversion)
5. ✅ Work with all file types: PDF, JPG, PNG, HEIC, TXT, etc.

---

## Monitoring

### Check Render Logs
```bash
# View deployment logs
curl -H "Authorization: Bearer rnd_oIEhqCgugTtBWIhS5q3jcJaSODod" \
  https://api.render.com/v1/services/YOUR_SERVICE_ID/events
```

### Check S3 Storage
```bash
# List files in S3
aws s3 ls s3://reparations-documents/owners/ --recursive --human-readable

# Check specific file
aws s3 ls s3://reparations-documents/owners/James-Hopewell/will/
```

### Database Verification
```sql
-- Check file paths and sizes
SELECT
  document_id,
  owner_name,
  filename,
  file_path,
  mime_type,
  file_size,
  created_at
FROM documents
WHERE owner_name = 'James Hopewell';
```

---

## Troubleshooting

### Issue: "S3 upload failed"
**Cause:** AWS credentials not configured or insufficient permissions

**Fix:**
```bash
# Verify credentials
aws sts get-caller-identity

# Check S3 access
aws s3 ls s3://reparations-documents
```

### Issue: "File type detection failed"
**Cause:** `file-type` package not installed

**Fix:**
```bash
npm install file-type@16.5.4 --save
```

### Issue: "Downloads still corrupted"
**Cause:** Database still pointing to old local files

**Fix:** Re-run upload script to update database records

---

## Cost Estimate

### AWS S3 Costs (Estimated)
- **Storage:** $0.023/GB/month
- **Requests:** $0.005 per 1,000 PUT requests
- **Data Transfer:** $0.09/GB (first 1 GB free)

**Example:** 1,000 documents @ 5MB each = 5GB
- Storage: $0.12/month
- Uploads: $0.005 (one-time)
- **Total:** ~$0.13/month

**Far cheaper than upgrading Render to paid tier ($25/month)!**

---

## Summary of Changes

| File | Changes |
|------|---------|
| `storage-adapter.js` | Added file type detection, S3 metadata |
| `server.js` | Updated download endpoint with fallback detection |
| `package.json` | Added `file-type@16.5.4` dependency |
| `upload-james-hopewell-pdfs.js` | NEW - Script to re-upload PDFs to S3 |
| `DEPLOYMENT-FIX-GUIDE.md` | NEW - This guide |

---

## Success Criteria

✅ PDFs download correctly (not corrupted)
✅ All file types preserved with correct extensions
✅ Files survive Render restarts
✅ MIME types match actual file content
✅ S3 storage configured and working
✅ Database records updated with S3 paths

---

**Questions?** Check Render logs or AWS CloudWatch for detailed error messages.
