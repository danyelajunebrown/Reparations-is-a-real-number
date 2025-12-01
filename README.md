# Reparations Is A Real Number: Document Upload Pipeline

## Overview

This project implements an enhanced document upload pipeline for processing historical documents related to reparations research. The pipeline provides robust file handling, advanced OCR processing, and asynchronous document management.

## Key Improvements

### 1. File Type Detection
- Uses magic number detection instead of relying on file extensions
- Supports multiple file types (PDF, JPEG, PNG, TIFF, HEIC)
- Prevents file corruption and security risks
- Provides fallback detection for unrecognized file types

### 2. Storage Adapter
- Migrated from ephemeral local storage to AWS S3
- Generates unique, sanitized file paths
- Supports multipart uploads for large files
- Provides detailed logging and error handling
- Fallback mechanism between local and cloud storage

### 3. OCR Processing
- Dual-service OCR strategy
  - Primary: Google Vision API (90-95% accuracy)
  - Fallback: Tesseract.js (60-80% accuracy)
- Confidence-based service selection
- Detailed logging of OCR processing
- Handles various document types and conditions

### 4. Asynchronous Upload
- Job queue for document processing
- Immediate API response with job tracking
- Separate queues for upload and OCR processing
- Retry mechanisms and error handling
- Status checking endpoint

## API Endpoints

### Document Upload
`POST /api/documents/upload`
- Supports files up to 100MB
- Returns immediate job ID for tracking
- Validates file type and metadata

### Upload Status
`GET /api/documents/upload-status/:jobId`
- Check status of document upload job
- Provides detailed processing information

## Configuration

### Environment Variables
```bash
# S3 Storage
S3_ENABLED=true
S3_BUCKET=reparations-documents
S3_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key

# OCR Services
GOOGLE_VISION_API_KEY=your_api_key
```

## Installation

```bash
# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your credentials

# Start development server
npm run dev
```

## Security Considerations
- File type validation
- Sanitized file paths
- Logging of all upload and processing events
- Configurable rate limiting
- Fallback mechanisms to prevent data loss

## Performance Optimization
- Asynchronous processing
- Streaming file uploads
- Multipart S3 uploads
- Confidence-based OCR service selection

## Future Improvements
- Add more file type support
- Implement advanced error recovery
- Enhance OCR confidence calculations
- Add more comprehensive testing

## Troubleshooting
- Check server logs for detailed error information
- Verify AWS S3 and Google Vision API credentials
- Ensure sufficient disk space and network connectivity

## Contributing
Please read our contribution guidelines before submitting pull requests.

## License
MIT License
