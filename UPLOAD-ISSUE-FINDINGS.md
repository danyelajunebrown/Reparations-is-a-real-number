# James Hopewell Upload Issue Findings

## Current Situation

1. **Wrong server is running**: The legacy `server.js` is running, NOT the new `src/server.js` with enhanced upload pipeline
   - Evidence: `/api/documents/upload` endpoint doesn't exist (returns 404)
   - The old `/api/upload-document` endpoint works but uses old storage system

2. **Database connection failing**: 
   - Error: "role 'user' does not exist"
   - The `.env` file has generic credentials: `postgresql://user:password@localhost:5432/reparations`
   - Need actual PostgreSQL credentials

3. **File storage issues**:
   - File was stored locally at `storage/owners/James-Hopewell/will/James-Hopewell-will-1764565877326.pdf`
   - File is a valid PDF (2.4MB, PDF version 1.3)
   - But it was NOT uploaded to S3 as intended because legacy server doesn't use S3

4. **The new enhanced pipeline is NOT being used**:
   - No Bull job queue processing
   - No FileTypeDetector validation
   - No S3 streaming upload
   - Using old local storage system

## Root Cause

The enhanced document upload pipeline we created is not actually running. The server is using the legacy code path which:
- Stores files locally (ephemeral on Render)
- Doesn't have the new validation features
- Can't use the new async processing

## Solution Steps

1. **Fix database credentials in .env**:
   ```bash
   # Replace with your actual PostgreSQL credentials
   DATABASE_URL=postgresql://[actual_username]:[actual_password]@localhost:5432/reparations
   
   # Or use individual variables:
   POSTGRES_HOST=localhost
   POSTGRES_DB=reparations
   POSTGRES_USER=[actual_username]
   POSTGRES_PASSWORD=[actual_password]
   ```

2. **Stop the legacy server and start the new one**:
   ```bash
   # Stop current server (Ctrl+C or kill the process)
   # Then run:
   node src/server.js
   ```

3. **Install and start Redis** (required for Bull queues):
   ```bash
   brew install redis
   brew services start redis
   ```

4. **Re-upload the James Hopewell will using new endpoint**:
   ```bash
   curl -X POST http://localhost:3000/api/documents/upload \
     -F "document=@/Users/danyelabrown/Downloads/Transcript.pdf" \
     -F "ownerName=James Hopewell" \
     -F "documentType=will"
   ```

5. **Check upload status with job ID**:
   ```bash
   curl http://localhost:3000/api/documents/upload-status/[jobId]
   ```

## Why The Current System Is Failing

1. **Local storage**: Files are stored in `./storage` which gets wiped on Render deployments
2. **No file validation**: The old system doesn't verify file content matches type
3. **Synchronous processing**: OCR blocks the API response
4. **Database errors prevent retrieval**: Even if file exists, DB errors break the download

## Verification

Once the new server is running with proper credentials:

1. Upload should return a job ID immediately
2. File should appear in S3 bucket `reparations-them`
3. Database should have proper file_path pointing to S3
4. Download should work without corruption
