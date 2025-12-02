# Document Viewer Architecture Overhaul Plan

## Executive Summary

The current document viewing system has multiple cascading failures preventing S3-stored documents from being viewed on the frontend. This plan proposes a complete overhaul that eliminates the root causes and implements robust error tracking.

---

## Root Causes of Current Failures

### 1. Path Storage Mismatch
- **Problem**: Database stores local paths (`storage/owners/...`) but files are in S3
- **Impact**: Every download attempt fails to find files

### 2. Mixed AWS SDK Versions
- **Problem**: S3StorageAdapter uses SDK v3, but documents.js uses SDK v2
- **Impact**: Inconsistent behavior, potential authentication issues

### 3. Flawed Path Detection Logic
- **Problem**: Code assumes paths starting with `/` are local, others are S3
- **Impact**: S3 keys like `owners/james-hopewell/...` incorrectly trigger local file checks

### 4. No Presigned URL Support
- **Problem**: Direct S3 streaming requires public bucket or correct IAM setup
- **Impact**: 403/500 errors when trying to stream from private bucket

### 5. Error Swallowing
- **Problem**: Errors occur mid-stream after headers are sent
- **Impact**: Client receives truncated response, unclear error messages

---

## New Architecture Design

### Core Principle: Presigned URLs

Instead of streaming files through the backend, generate presigned URLs that:
- Allow direct browser access to S3
- Expire after a configurable time (e.g., 15 minutes)
- Work regardless of bucket ACL settings
- Reduce server load

### New Endpoint Structure

```
GET /api/documents/:id/access
  -> Returns { viewUrl, downloadUrl, expiresAt, metadata }

GET /api/documents/:id/file (legacy - redirects to presigned URL)
```

### Database Schema Addition

```sql
ALTER TABLE documents ADD COLUMN IF NOT EXISTS storage_type VARCHAR(20) DEFAULT 'local';
-- Values: 'local', 's3', 'ipfs'

ALTER TABLE documents ADD COLUMN IF NOT EXISTS s3_key VARCHAR(500);
-- Stores the actual S3 object key, separate from legacy file_path
```

---

## Implementation Plan

### Phase 1: Backend Fixes (Critical)

#### 1.1 Unified S3 Service
Create a single S3 service using consistent SDK v3:

```javascript
// src/services/storage/S3Service.js
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

class S3Service {
  constructor() {
    this.client = new S3Client({
      region: config.storage.s3.region,
      credentials: {
        accessKeyId: config.storage.s3.accessKeyId,
        secretAccessKey: config.storage.s3.secretAccessKey
      }
    });
    this.bucket = config.storage.s3.bucket;
  }

  async getPresignedUrl(key, expiresIn = 900, disposition = 'inline') {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ResponseContentDisposition: disposition === 'download'
        ? `attachment; filename="${path.basename(key)}"`
        : 'inline'
    });

    return getSignedUrl(this.client, command, { expiresIn });
  }

  async objectExists(key) {
    try {
      await this.client.send(new HeadObjectCommand({
        Bucket: this.bucket,
        Key: key
      }));
      return true;
    } catch (err) {
      if (err.name === 'NotFound') return false;
      throw err;
    }
  }
}
```

#### 1.2 New Document Access Endpoint

```javascript
// GET /api/documents/:id/access
router.get('/:documentId/access', asyncHandler(async (req, res) => {
  const { documentId } = req.params;
  const download = req.query.download === 'true';

  const doc = await DocumentService.getDocumentById(documentId);
  if (!doc) {
    return res.status(404).json({
      success: false,
      error: 'DOCUMENT_NOT_FOUND',
      message: 'Document not found',
      documentId
    });
  }

  // Determine storage type and get appropriate URL
  const storageType = doc.storage_type || determineStorageType(doc);

  if (storageType === 's3') {
    const s3Key = doc.s3_key || doc.file_path;

    // Verify object exists before generating URL
    const exists = await s3Service.objectExists(s3Key);
    if (!exists) {
      // Log error for debugging
      await ErrorLogger.log({
        type: 'S3_OBJECT_NOT_FOUND',
        documentId,
        s3Key,
        bucket: config.storage.s3.bucket,
        timestamp: new Date().toISOString()
      });

      return res.status(404).json({
        success: false,
        error: 'FILE_NOT_IN_S3',
        message: 'Document file not found in storage',
        documentId,
        debugInfo: { s3Key, bucket: config.storage.s3.bucket }
      });
    }

    const viewUrl = await s3Service.getPresignedUrl(s3Key, 900, 'inline');
    const downloadUrl = await s3Service.getPresignedUrl(s3Key, 900, 'download');

    return res.json({
      success: true,
      documentId,
      storageType: 's3',
      viewUrl,
      downloadUrl,
      expiresIn: 900,
      expiresAt: new Date(Date.now() + 900000).toISOString(),
      metadata: {
        filename: doc.filename,
        mimeType: doc.mime_type,
        fileSize: doc.file_size,
        ownerName: doc.owner_name,
        docType: doc.doc_type
      }
    });
  }

  // Local file fallback
  const localPath = path.resolve(doc.file_path || doc.relative_path);
  if (!fs.existsSync(localPath)) {
    await ErrorLogger.log({
      type: 'LOCAL_FILE_NOT_FOUND',
      documentId,
      localPath,
      timestamp: new Date().toISOString()
    });

    return res.status(404).json({
      success: false,
      error: 'LOCAL_FILE_NOT_FOUND',
      message: 'Document file not found on server',
      documentId
    });
  }

  // For local files, return a URL to the streaming endpoint
  return res.json({
    success: true,
    documentId,
    storageType: 'local',
    viewUrl: `/api/documents/${documentId}/stream`,
    downloadUrl: `/api/documents/${documentId}/stream?download=true`,
    expiresIn: null,
    expiresAt: null,
    metadata: {
      filename: doc.filename,
      mimeType: doc.mime_type,
      fileSize: doc.file_size,
      ownerName: doc.owner_name,
      docType: doc.doc_type
    }
  });
}));
```

#### 1.3 Error Logging System

```javascript
// src/services/ErrorLogger.js
const fs = require('fs').promises;
const path = require('path');

class ErrorLogger {
  static logFile = path.join(process.cwd(), 'logs', 'document-errors.json');

  static async log(errorData) {
    const entry = {
      id: `err_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      ...errorData,
      environment: process.env.NODE_ENV,
      serverTime: new Date().toISOString()
    };

    // Log to console
    console.error('[DOC_ERROR]', JSON.stringify(entry));

    // Append to file (for debugging)
    try {
      await fs.mkdir(path.dirname(this.logFile), { recursive: true });
      let logs = [];
      try {
        const existing = await fs.readFile(this.logFile, 'utf8');
        logs = JSON.parse(existing);
      } catch {}
      logs.push(entry);
      // Keep last 1000 errors
      if (logs.length > 1000) logs = logs.slice(-1000);
      await fs.writeFile(this.logFile, JSON.stringify(logs, null, 2));
    } catch (writeErr) {
      console.error('[ERROR_LOGGER] Failed to write log file:', writeErr);
    }

    // Could also send to external service (Sentry, etc.)
    if (process.env.SENTRY_DSN) {
      // Sentry.captureException(new Error(errorData.message || errorData.type));
    }

    return entry.id;
  }

  static async getRecentErrors(limit = 50) {
    try {
      const data = await fs.readFile(this.logFile, 'utf8');
      const logs = JSON.parse(data);
      return logs.slice(-limit);
    } catch {
      return [];
    }
  }
}

module.exports = ErrorLogger;
```

---

### Phase 2: Frontend Overhaul

#### 2.1 Remove Carousel Animation (Temporary)

Replace the rotating 3D carousel with a simple, reliable grid view:

```html
<!-- Replace widget-forest with a simple document grid -->
<div class="widget-documents" id="documentGridWidget">
  <div class="widget-header">
    <h2>Document Archive</h2>
    <div class="search-box">
      <input type="text" id="docSearchInput" placeholder="Search by owner name...">
      <button onclick="searchDocuments()">Search</button>
    </div>
  </div>
  <div class="document-grid" id="documentGrid">
    <!-- Documents loaded here -->
  </div>
</div>
```

#### 2.2 New Document Viewer Component

```javascript
// document-viewer.js
class DocumentViewer {
  constructor() {
    this.currentDoc = null;
    this.accessData = null;
  }

  async open(documentId) {
    this.showLoading();

    try {
      // Get access URLs from new endpoint
      const response = await fetch(`${API_BASE_URL}/api/documents/${documentId}/access`);
      const data = await response.json();

      if (!data.success) {
        this.showError(data.error, data.message, data.debugInfo);
        await this.logFrontendError({
          action: 'view_document',
          documentId,
          error: data.error,
          message: data.message
        });
        return;
      }

      this.accessData = data;
      this.currentDoc = data.metadata;

      // Open document in viewer
      this.renderViewer(data);

    } catch (error) {
      this.showError('NETWORK_ERROR', error.message);
      await this.logFrontendError({
        action: 'view_document',
        documentId,
        error: 'NETWORK_ERROR',
        message: error.message
      });
    }
  }

  renderViewer(data) {
    const modal = document.getElementById('documentViewerModal');
    const iframe = document.getElementById('documentFrame');
    const downloadBtn = document.getElementById('downloadBtn');

    // Set iframe source to presigned URL
    iframe.src = data.viewUrl;

    // Set download button
    downloadBtn.onclick = () => window.open(data.downloadUrl, '_blank');

    // Update metadata display
    document.getElementById('viewerDocType').textContent = data.metadata.docType;
    document.getElementById('viewerOwnerName').textContent = data.metadata.ownerName;
    document.getElementById('viewerFilename').textContent = data.metadata.filename;

    // Show expiration warning if applicable
    if (data.expiresAt) {
      const expiresAt = new Date(data.expiresAt);
      document.getElementById('expirationWarning').textContent =
        `Link expires at ${expiresAt.toLocaleTimeString()}`;
    }

    modal.classList.add('active');
  }

  showError(errorCode, message, debugInfo = null) {
    const errorHtml = `
      <div class="document-error">
        <h3>Unable to Load Document</h3>
        <p><strong>Error:</strong> ${errorCode}</p>
        <p>${message}</p>
        ${debugInfo ? `
          <details>
            <summary>Debug Info</summary>
            <pre>${JSON.stringify(debugInfo, null, 2)}</pre>
          </details>
        ` : ''}
        <button onclick="documentViewer.close()">Close</button>
        <button onclick="documentViewer.reportIssue()">Report Issue</button>
      </div>
    `;
    document.getElementById('documentContent').innerHTML = errorHtml;
    document.getElementById('documentViewerModal').classList.add('active');
  }

  async logFrontendError(errorData) {
    try {
      await fetch(`${API_BASE_URL}/api/errors/log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'frontend',
          userAgent: navigator.userAgent,
          url: window.location.href,
          timestamp: new Date().toISOString(),
          ...errorData
        })
      });
    } catch (e) {
      console.error('Failed to log error to server:', e);
    }
  }

  close() {
    document.getElementById('documentViewerModal').classList.remove('active');
    document.getElementById('documentFrame').src = '';
    this.currentDoc = null;
    this.accessData = null;
  }
}

const documentViewer = new DocumentViewer();
```

---

### Phase 3: Data Migration

#### 3.1 Migration Script

```javascript
// scripts/migrate-document-paths.js
async function migrateDocumentPaths() {
  const docs = await db.query('SELECT * FROM documents');

  for (const doc of docs.rows) {
    let storageType = 'local';
    let s3Key = null;

    // Detect if path looks like an S3 key
    const filePath = doc.file_path || doc.relative_path;
    if (filePath && !filePath.startsWith('/') && !filePath.startsWith('./')) {
      // Likely an S3 key (e.g., "owners/james-hopewell/...")
      storageType = 's3';
      s3Key = filePath;

      // Verify it exists in S3
      const exists = await s3Service.objectExists(s3Key);
      if (!exists) {
        console.warn(`Document ${doc.document_id}: S3 key not found: ${s3Key}`);
        storageType = 'missing';
      }
    } else if (filePath) {
      // Local path
      const localPath = path.resolve(filePath);
      if (!fs.existsSync(localPath)) {
        console.warn(`Document ${doc.document_id}: Local file not found: ${localPath}`);
        storageType = 'missing';
      }
    }

    await db.query(`
      UPDATE documents
      SET storage_type = $1, s3_key = $2
      WHERE document_id = $3
    `, [storageType, s3Key, doc.document_id]);

    console.log(`Migrated ${doc.document_id}: ${storageType}`);
  }
}
```

---

### Phase 4: Error Dashboard (Admin)

#### 4.1 Error Viewing Endpoint

```javascript
// GET /api/admin/errors
router.get('/admin/errors', authenticate, asyncHandler(async (req, res) => {
  const errors = await ErrorLogger.getRecentErrors(100);

  // Group by error type
  const byType = {};
  errors.forEach(err => {
    const type = err.type || 'UNKNOWN';
    if (!byType[type]) byType[type] = [];
    byType[type].push(err);
  });

  res.json({
    success: true,
    totalErrors: errors.length,
    byType,
    errors
  });
}));
```

---

## Implementation Checklist

### Backend (Priority: Critical)
- [ ] Create `src/services/storage/S3Service.js` with presigned URL support
- [ ] Create `src/services/ErrorLogger.js` for robust error tracking
- [ ] Add `GET /api/documents/:id/access` endpoint
- [ ] Add `POST /api/errors/log` endpoint for frontend errors
- [ ] Update database schema with `storage_type` and `s3_key` columns
- [ ] Run migration script to categorize existing documents

### Frontend (Priority: High)
- [ ] Replace 3D carousel with simple grid (temporary)
- [ ] Create new `document-viewer.js` module
- [ ] Update `loadDocument()` to use new `/access` endpoint
- [ ] Add error display with debug info
- [ ] Add "Report Issue" button for users

### Testing (Priority: High)
- [ ] Test viewing S3 documents with presigned URLs
- [ ] Test local file fallback
- [ ] Test error logging for missing files
- [ ] Test expiration of presigned URLs
- [ ] Test download functionality

### Monitoring (Priority: Medium)
- [ ] Add error dashboard at `/admin/errors`
- [ ] Set up alerts for high error rates
- [ ] Create weekly error digest

---

## Rollback Plan

If issues arise:
1. Keep the old `/api/documents/:id/file` endpoint active
2. Add feature flag to switch between old and new viewers
3. Database changes are additive (no data loss)

---

## Success Metrics

1. **Document View Success Rate**: Target 99%+
2. **Error Visibility**: 100% of errors logged with context
3. **User Feedback**: Reduced "document not loading" reports
4. **Performance**: Presigned URLs reduce server load by ~80%
