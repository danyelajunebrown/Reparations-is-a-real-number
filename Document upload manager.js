/**
 * Document Upload and Cloud Storage Manager
 * Handles document uploads, cloud storage, and attachment to slave owner records
 */

class DocumentUploadManager {
  constructor() {
    // Storage configuration
    this.storageProvider = 'ipfs'; // 'ipfs', 's3', or 'google-cloud'
    this.ipfsGateway = 'https://ipfs.io/ipfs/';
    
    // Document organization
    this.documents = new Map(); // documentId -> document metadata
    this.ownerDocuments = new Map(); // ownerName -> [documentIds]
    
    // Upload queue
    this.uploadQueue = [];
    this.uploading = false;
    
    // Supported file types
    this.supportedTypes = {
      'image/jpeg': { ext: '.jpg', category: 'image' },
      'image/png': { ext: '.png', category: 'image' },
      'image/gif': { ext: '.gif', category: 'image' },
      'application/pdf': { ext: '.pdf', category: 'document' },
      'application/msword': { ext: '.doc', category: 'document' },
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { ext: '.docx', category: 'document' },
      'text/plain': { ext: '.txt', category: 'text' },
      'text/csv': { ext: '.csv', category: 'data' }
    };
    
    this.nextDocId = 1;
  }
  
  /**
   * Initialize the upload manager
   */
  async initialize() {
    console.log('Document Upload Manager initialized');
    
    // Check for IPFS availability (using Infura or local node)
    if (this.storageProvider === 'ipfs') {
      try {
        // You can use Infura's IPFS API or run a local IPFS node
        this.ipfsEndpoint = 'https://ipfs.infura.io:5001/api/v0';
        console.log('Using IPFS via Infura');
      } catch (error) {
        console.warn('IPFS not available, using local storage fallback');
        this.storageProvider = 'local';
      }
    }
    
    return true;
  }
  
  /**
   * Upload a document file
   */
  async uploadDocument(file, metadata = {}) {
    // Validate file
    if (!this.isFileSupported(file)) {
      throw new Error(`Unsupported file type: ${file.type}`);
    }
    
    if (file.size > 50 * 1024 * 1024) { // 50MB limit
      throw new Error('File size exceeds 50MB limit');
    }
    
    console.log(`Uploading document: ${file.name}`);
    
    // Create document record
    const docId = `doc_${this.nextDocId++}_${Date.now()}`;
    
    const document = {
      id: docId,
      filename: file.name,
      originalName: file.name,
      fileType: file.type,
      fileSize: file.size,
      category: this.supportedTypes[file.type]?.category || 'other',
      uploadedAt: new Date().toISOString(),
      uploadedBy: metadata.uploadedBy || 'user',
      
      // Document metadata
      documentType: metadata.documentType || this.detectDocumentType(file.name),
      ownerName: metadata.ownerName || null,
      year: metadata.year || null,
      location: metadata.location || null,
      notes: metadata.notes || '',
      
      // Storage information
      storageProvider: this.storageProvider,
      storageUrl: null,
      storageHash: null,
      localPath: null,
      
      // Processing status
      status: 'uploading',
      ocrProcessed: false,
      verified: false,
      
      // Extracted data (will be filled by OCR/processing)
      extractedData: null
    };
    
    // Add to collection
    this.documents.set(docId, document);
    
    try {
      // Upload to storage
      const uploadResult = await this.uploadToStorage(file, docId);
      
      // Update document with storage info
      document.storageUrl = uploadResult.url;
      document.storageHash = uploadResult.hash;
      document.localPath = uploadResult.localPath;
      document.status = 'uploaded';
      
      // If owner specified, link document to owner
      if (metadata.ownerName) {
        this.attachDocumentToOwner(docId, metadata.ownerName);
      }
      
      console.log(`Document uploaded successfully: ${docId}`);
      
      return document;
      
    } catch (error) {
      document.status = 'failed';
      document.error = error.message;
      console.error('Upload failed:', error);
      throw error;
    }
  }
  
  /**
   * Upload file to configured storage provider
   */
  async uploadToStorage(file, docId) {
    switch (this.storageProvider) {
      case 'ipfs':
        return await this.uploadToIPFS(file, docId);
      case 's3':
        return await this.uploadToS3(file, docId);
      case 'google-cloud':
        return await this.uploadToGoogleCloud(file, docId);
      default:
        return await this.uploadToLocalStorage(file, docId);
    }
  }
  
  /**
   * Upload to IPFS (InterPlanetary File System)
   */
  async uploadToIPFS(file, docId) {
    const formData = new FormData();
    formData.append('file', file);
    
    try {
      // Using Infura's IPFS API (you'll need an API key)
      const response = await fetch(`${this.ipfsEndpoint}/add`, {
        method: 'POST',
        body: formData,
        headers: {
          // Add Infura auth if you have it
          // 'Authorization': 'Basic ' + btoa(projectId + ':' + projectSecret)
        }
      });
      
      if (!response.ok) {
        throw new Error('IPFS upload failed');
      }
      
      const data = await response.json();
      const hash = data.Hash;
      
      return {
        url: `${this.ipfsGateway}${hash}`,
        hash: hash,
        localPath: null
      };
      
    } catch (error) {
      console.error('IPFS upload error:', error);
      // Fallback to local storage
      return await this.uploadToLocalStorage(file, docId);
    }
  }
  
  /**
   * Upload to AWS S3 (requires AWS SDK)
   */
  async uploadToS3(file, docId) {
    // This requires AWS SDK to be loaded
    // For demo, we'll use a signed URL approach
    
    throw new Error('S3 upload not configured. Please set up AWS credentials.');
    
    // Example implementation:
    /*
    const AWS = window.AWS;
    const s3 = new AWS.S3({
      accessKeyId: 'YOUR_ACCESS_KEY',
      secretAccessKey: 'YOUR_SECRET_KEY',
      region: 'us-east-1'
    });
    
    const params = {
      Bucket: 'reparations-documents',
      Key: `documents/${docId}/${file.name}`,
      Body: file,
      ContentType: file.type
    };
    
    const result = await s3.upload(params).promise();
    
    return {
      url: result.Location,
      hash: result.ETag,
      localPath: result.Key
    };
    */
  }
  
  /**
   * Upload to Google Cloud Storage
   */
  async uploadToGoogleCloud(file, docId) {
    throw new Error('Google Cloud Storage not configured. Please set up GCS credentials.');
  }
  
  /**
   * Fallback: Store using browser's local storage simulation
   * (In production, this should upload to a real server)
   */
  async uploadToLocalStorage(file, docId) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      
      reader.onload = (e) => {
        const dataUrl = e.target.result;
        
        // Store in localStorage (limited to ~5-10MB depending on browser)
        try {
          const storageKey = `doc_${docId}`;
          localStorage.setItem(storageKey, dataUrl);
          
          resolve({
            url: dataUrl,
            hash: this.generateHash(dataUrl),
            localPath: storageKey
          });
        } catch (error) {
          reject(new Error('Local storage full. Please use IPFS or cloud storage.'));
        }
      };
      
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  }
  
  /**
   * Attach document to a slave owner record
   */
  attachDocumentToOwner(documentId, ownerName) {
    if (!this.documents.has(documentId)) {
      throw new Error(`Document ${documentId} not found`);
    }
    
    if (!this.ownerDocuments.has(ownerName)) {
      this.ownerDocuments.set(ownerName, []);
    }
    
    const ownerDocs = this.ownerDocuments.get(ownerName);
    if (!ownerDocs.includes(documentId)) {
      ownerDocs.push(documentId);
    }
    
    // Update document metadata
    const document = this.documents.get(documentId);
    document.ownerName = ownerName;
    
    console.log(`Document ${documentId} attached to ${ownerName}`);
    
    return true;
  }
  
  /**
   * Detach document from owner
   */
  detachDocumentFromOwner(documentId, ownerName) {
    if (this.ownerDocuments.has(ownerName)) {
      const ownerDocs = this.ownerDocuments.get(ownerName);
      const index = ownerDocs.indexOf(documentId);
      if (index > -1) {
        ownerDocs.splice(index, 1);
      }
    }
    
    // Update document metadata
    const document = this.documents.get(documentId);
    if (document) {
      document.ownerName = null;
    }
    
    return true;
  }
  
  /**
   * Get all documents for an owner
   */
  getOwnerDocuments(ownerName) {
    const docIds = this.ownerDocuments.get(ownerName) || [];
    return docIds.map(id => this.documents.get(id)).filter(d => d);
  }
  
  /**
   * Get document by ID
   */
  getDocument(documentId) {
    return this.documents.get(documentId);
  }
  
  /**
   * Get all documents
   */
  getAllDocuments() {
    return Array.from(this.documents.values());
  }
  
  /**
   * Delete document
   */
  async deleteDocument(documentId) {
    const document = this.documents.get(documentId);
    if (!document) {
      throw new Error(`Document ${documentId} not found`);
    }
    
    // Remove from owner's documents
    if (document.ownerName) {
      this.detachDocumentFromOwner(documentId, document.ownerName);
    }
    
    // Remove from storage
    if (document.localPath && this.storageProvider === 'local') {
      localStorage.removeItem(document.localPath);
    }
    
    // Remove from collection
    this.documents.delete(documentId);
    
    console.log(`Document ${documentId} deleted`);
    return true;
  }
  
  /**
   * Detect document type from filename
   */
  detectDocumentType(filename) {
    const lower = filename.toLowerCase();
    
    if (lower.includes('will')) return 'will';
    if (lower.includes('probate')) return 'probate';
    if (lower.includes('census')) return 'census';
    if (lower.includes('slave schedule') || lower.includes('slave_schedule')) return 'slave_schedule';
    if (lower.includes('estate') || lower.includes('inventory')) return 'estate_inventory';
    if (lower.includes('deed')) return 'deed';
    if (lower.includes('tax')) return 'tax_record';
    if (lower.includes('baptism') || lower.includes('baptismal')) return 'baptismal';
    
    return 'unknown';
  }
  
  /**
   * Check if file type is supported
   */
  isFileSupported(file) {
    return this.supportedTypes.hasOwnProperty(file.type);
  }
  
  /**
   * Generate simple hash for content
   */
  generateHash(content) {
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
  }
  
  /**
   * Process document with OCR (if applicable)
   */
  async processWithOCR(documentId, ocrService) {
    const document = this.documents.get(documentId);
    if (!document) {
      throw new Error(`Document ${documentId} not found`);
    }
    
    if (document.category !== 'image' && document.fileType !== 'application/pdf') {
      console.log('Document type does not require OCR');
      return null;
    }
    
    console.log(`Processing document ${documentId} with OCR...`);
    
    try {
      const result = await ocrService.processDocumentImage(
        document.storageUrl,
        document.documentType
      );
      
      document.extractedData = result;
      document.ocrProcessed = true;
      
      console.log(`OCR complete for ${documentId}:`, result);
      
      return result;
      
    } catch (error) {
      console.error('OCR processing failed:', error);
      throw error;
    }
  }
  
  /**
   * Export document metadata for blockchain
   */
  exportForBlockchain(documentId) {
    const document = this.documents.get(documentId);
    if (!document) {
      throw new Error(`Document ${documentId} not found`);
    }
    
    return {
      documentId: document.id,
      documentType: document.documentType,
      filename: document.filename,
      storageHash: document.storageHash,
      storageUrl: document.storageUrl,
      uploadedAt: document.uploadedAt,
      ownerName: document.ownerName,
      year: document.year,
      location: document.location,
      verified: document.verified,
      extractedSlaveCount: document.extractedData?.slaveCount || 0
    };
  }
  
  /**
   * Get statistics
   */
  getStatistics() {
    const docs = Array.from(this.documents.values());
    
    return {
      totalDocuments: docs.length,
      byType: this.groupBy(docs, 'documentType'),
      byCategory: this.groupBy(docs, 'category'),
      byStatus: this.groupBy(docs, 'status'),
      totalSize: docs.reduce((sum, d) => sum + d.fileSize, 0),
      verified: docs.filter(d => d.verified).length,
      ocrProcessed: docs.filter(d => d.ocrProcessed).length,
      ownersWithDocuments: this.ownerDocuments.size
    };
  }
  
  /**
   * Helper: Group documents by field
   */
  groupBy(array, field) {
    return array.reduce((groups, item) => {
      const key = item[field] || 'unknown';
      groups[key] = (groups[key] || 0) + 1;
      return groups;
    }, {});
  }
  
  /**
   * Export all data
   */
  exportData() {
    return {
      documents: Array.from(this.documents.entries()),
      ownerDocuments: Array.from(this.ownerDocuments.entries()),
      statistics: this.getStatistics(),
      exportedAt: new Date().toISOString()
    };
  }
  
  /**
   * Import data (for backup/restore)
   */
  importData(data) {
    this.documents = new Map(data.documents);
    this.ownerDocuments = new Map(data.ownerDocuments);
    
    console.log('Data imported:', this.getStatistics());
    return true;
  }
}

// Export for different environments
if (typeof module !== 'undefined' && module.exports) {
  module.exports = DocumentUploadManager;
} else if (typeof window !== 'undefined') {
  window.DocumentUploadManager = DocumentUploadManager;
}
