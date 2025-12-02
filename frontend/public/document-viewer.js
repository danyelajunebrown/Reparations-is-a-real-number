/**
 * Document Viewer Module
 *
 * Robust document viewing using presigned URLs from the /access endpoint.
 * Includes comprehensive error handling and logging.
 */

class DocumentViewer {
  constructor() {
    this.currentDoc = null;
    this.accessData = null;
    this.isOpen = false;
    this.urlRefreshTimer = null;
  }

  /**
   * Open a document by ID
   * @param {string} documentId - The document ID to view
   */
  async open(documentId) {
    console.log('[DocumentViewer] Opening document:', documentId);
    this.showLoading();

    try {
      // Get access URLs from the new endpoint
      const response = await fetch(`${API_BASE_URL}/api/documents/${documentId}/access`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });

      const data = await response.json();
      console.log('[DocumentViewer] Access response:', data);

      if (!data.success) {
        this.showError(data.error, data.message, data.debugInfo);
        await this.logError({
          action: 'open_document',
          documentId,
          error: data.error,
          message: data.message,
          debugInfo: data.debugInfo
        });
        return;
      }

      this.accessData = data;
      this.currentDoc = documentId;
      this.isOpen = true;

      // Render the viewer with the document
      this.renderViewer(data);

      // Set up URL refresh if expiring (S3 presigned URLs)
      if (data.expiresIn) {
        this.scheduleUrlRefresh(documentId, data.expiresIn);
      }

    } catch (error) {
      console.error('[DocumentViewer] Error opening document:', error);
      this.showError('NETWORK_ERROR', error.message);
      await this.logError({
        action: 'open_document',
        documentId,
        error: 'NETWORK_ERROR',
        message: error.message
      });
    }
  }

  /**
   * Show loading state in the viewer
   */
  showLoading() {
    const modal = document.getElementById('documentViewerModal');
    const content = document.getElementById('documentViewerContent');

    if (modal) {
      modal.classList.add('active');
    }

    if (content) {
      content.innerHTML = `
        <div class="document-loading">
          <div class="loading-spinner"></div>
          <p>Loading document...</p>
        </div>
      `;
    }
  }

  /**
   * Render the document viewer with the fetched data
   * @param {Object} data - Access response data
   */
  renderViewer(data) {
    const modal = document.getElementById('documentViewerModal');
    const content = document.getElementById('documentViewerContent');
    const metaPanel = document.getElementById('documentViewerMeta');

    if (!modal || !content) {
      console.error('[DocumentViewer] Modal elements not found');
      return;
    }

    modal.classList.add('active');

    // Determine how to display based on mime type
    const mimeType = data.metadata?.mimeType || 'application/pdf';
    const viewUrl = data.viewUrl;

    // Clear and render content
    content.innerHTML = '';

    if (mimeType.includes('pdf')) {
      // PDF: Use iframe
      const iframe = document.createElement('iframe');
      iframe.src = viewUrl;
      iframe.className = 'document-frame pdf-frame';
      iframe.style.cssText = 'width: 100%; height: 100%; border: none;';

      iframe.onerror = () => {
        this.showError('LOAD_FAILED', 'Failed to load PDF document');
      };

      content.appendChild(iframe);

    } else if (mimeType.includes('image')) {
      // Image: Use img tag with zoom controls
      const img = document.createElement('img');
      img.src = viewUrl;
      img.className = 'document-image';
      img.alt = data.metadata?.filename || 'Document image';
      img.style.cssText = 'max-width: 100%; max-height: 100%; object-fit: contain;';

      img.onerror = () => {
        this.showError('LOAD_FAILED', 'Failed to load image');
      };

      content.appendChild(img);

    } else {
      // Unknown type: Try iframe as fallback
      const iframe = document.createElement('iframe');
      iframe.src = viewUrl;
      iframe.className = 'document-frame';
      iframe.style.cssText = 'width: 100%; height: 100%; border: none;';
      content.appendChild(iframe);
    }

    // Update metadata panel
    if (metaPanel) {
      metaPanel.innerHTML = `
        <div class="meta-item">
          <span class="meta-label">File:</span>
          <span class="meta-value">${data.metadata?.filename || 'Unknown'}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">Type:</span>
          <span class="meta-value">${data.metadata?.docType || 'Unknown'}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">Owner:</span>
          <span class="meta-value">${data.metadata?.ownerName || 'Unknown'}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">Size:</span>
          <span class="meta-value">${this.formatFileSize(data.metadata?.fileSize)}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">Storage:</span>
          <span class="meta-value">${data.storageType === 's3' ? 'Cloud (S3)' : 'Local'}</span>
        </div>
        ${data.expiresAt ? `
          <div class="meta-item meta-warning">
            <span class="meta-label">Link expires:</span>
            <span class="meta-value">${new Date(data.expiresAt).toLocaleTimeString()}</span>
          </div>
        ` : ''}
      `;
    }

    // Set up download button
    const downloadBtn = document.getElementById('documentDownloadBtn');
    if (downloadBtn) {
      downloadBtn.onclick = () => this.download();
    }
  }

  /**
   * Show error in the viewer
   * @param {string} errorCode - Error code
   * @param {string} message - Error message
   * @param {Object} debugInfo - Optional debug info
   */
  showError(errorCode, message, debugInfo = null) {
    const modal = document.getElementById('documentViewerModal');
    const content = document.getElementById('documentViewerContent');

    if (modal) {
      modal.classList.add('active');
    }

    if (content) {
      content.innerHTML = `
        <div class="document-error">
          <div class="error-icon">&#x26A0;</div>
          <h3>Unable to Load Document</h3>
          <p class="error-code"><strong>Error:</strong> ${errorCode}</p>
          <p class="error-message">${message}</p>
          ${debugInfo ? `
            <details class="error-debug">
              <summary>Technical Details</summary>
              <pre>${JSON.stringify(debugInfo, null, 2)}</pre>
            </details>
          ` : ''}
          <div class="error-actions">
            <button onclick="documentViewer.close()" class="btn-secondary">Close</button>
            <button onclick="documentViewer.retry()" class="btn-primary">Retry</button>
            <button onclick="documentViewer.reportIssue()" class="btn-link">Report Issue</button>
          </div>
        </div>
      `;
    }
  }

  /**
   * Download the current document
   */
  download() {
    if (!this.accessData?.downloadUrl) {
      console.error('[DocumentViewer] No download URL available');
      return;
    }

    console.log('[DocumentViewer] Downloading document');

    // Open download URL in new tab/trigger download
    window.open(this.accessData.downloadUrl, '_blank');
  }

  /**
   * Retry loading the current document
   */
  retry() {
    if (this.currentDoc) {
      this.open(this.currentDoc);
    }
  }

  /**
   * Close the viewer
   */
  close() {
    console.log('[DocumentViewer] Closing viewer');

    const modal = document.getElementById('documentViewerModal');
    if (modal) {
      modal.classList.remove('active');
    }

    // Clear URL refresh timer
    if (this.urlRefreshTimer) {
      clearTimeout(this.urlRefreshTimer);
      this.urlRefreshTimer = null;
    }

    // Clear iframe/content to stop any loading
    const content = document.getElementById('documentViewerContent');
    if (content) {
      content.innerHTML = '';
    }

    this.currentDoc = null;
    this.accessData = null;
    this.isOpen = false;
  }

  /**
   * Schedule URL refresh before expiration
   * @param {string} documentId - Document ID
   * @param {number} expiresIn - Seconds until expiration
   */
  scheduleUrlRefresh(documentId, expiresIn) {
    // Refresh 1 minute before expiration
    const refreshIn = (expiresIn - 60) * 1000;

    if (refreshIn > 0) {
      console.log(`[DocumentViewer] Will refresh URLs in ${Math.round(refreshIn / 1000)}s`);

      this.urlRefreshTimer = setTimeout(async () => {
        if (this.isOpen && this.currentDoc === documentId) {
          console.log('[DocumentViewer] Refreshing URLs');
          await this.open(documentId);
        }
      }, refreshIn);
    }
  }

  /**
   * Log error to the server
   * @param {Object} errorData - Error data to log
   */
  async logError(errorData) {
    try {
      await fetch(`${API_BASE_URL}/api/errors/log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'document-viewer',
          url: window.location.href,
          userAgent: navigator.userAgent,
          timestamp: new Date().toISOString(),
          ...errorData
        })
      });
    } catch (e) {
      console.error('[DocumentViewer] Failed to log error:', e);
    }
  }

  /**
   * Report an issue with the current document
   */
  reportIssue() {
    const docId = this.currentDoc || 'unknown';
    const error = this.accessData?.error || 'unknown';

    // Open GitHub issues page with pre-filled info
    const issueUrl = `https://github.com/anthropics/claude-code/issues/new?` +
      `title=Document%20Viewing%20Issue%20(${docId})&` +
      `body=${encodeURIComponent(`
## Document Viewing Issue

**Document ID:** ${docId}
**Error:** ${error}
**URL:** ${window.location.href}
**Time:** ${new Date().toISOString()}

### What happened?
[Please describe the issue]

### Expected behavior
[What should have happened]
      `.trim())}`;

    window.open(issueUrl, '_blank');
  }

  /**
   * Format file size for display
   * @param {number} bytes - File size in bytes
   * @returns {string} Formatted size
   */
  formatFileSize(bytes) {
    if (!bytes) return 'Unknown';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  }
}

// Create global instance
const documentViewer = new DocumentViewer();

// Global function for backwards compatibility
function viewDocument(documentId) {
  documentViewer.open(documentId);
}

function downloadDocument(documentId) {
  // Quick download without opening viewer
  fetch(`${API_BASE_URL}/api/documents/${documentId}/access?download=true`)
    .then(res => res.json())
    .then(data => {
      if (data.success && data.downloadUrl) {
        window.open(data.downloadUrl, '_blank');
      } else {
        console.error('Failed to get download URL:', data.error);
        alert('Failed to download document: ' + (data.message || 'Unknown error'));
      }
    })
    .catch(err => {
      console.error('Download error:', err);
      alert('Download failed: ' + err.message);
    });
}

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { DocumentViewer, documentViewer };
}
