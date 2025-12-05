/**
 * ExtractionWorker - OCR Processing Service
 *
 * This service handles the actual OCR extraction process:
 * 1. Download PDF from source URL
 * 2. Run OCR using Google Cloud Vision
 * 3. Parse OCR text into structured rows based on column definitions
 * 4. Save results to database
 * 5. Update extraction job status
 */

const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const OCRProcessor = require('../document/OCRProcessor');
const logger = require('../../utils/logger');

class ExtractionWorker {
    /**
     * Constructor
     * @param {Object} database - Database connection
     */
    constructor(database) {
        this.db = database;
        this.ocrProcessor = new OCRProcessor();
    }

    /**
     * Main method to process an extraction job
     * @param {string} extractionId - The extraction job ID
     */
    async processExtraction(extractionId) {
        try {
            // Update status to processing
            await this.updateExtractionStatus(extractionId, 'processing', { progress: 10 });

            // Get extraction job details
            const jobResult = await this.db.query(`
                SELECT ej.*, cs.content_structure, cs.source_metadata
                FROM extraction_jobs ej
                JOIN contribution_sessions cs ON ej.session_id = cs.session_id
                WHERE ej.extraction_id = $1
            `, [extractionId]);

            if (jobResult.rows.length === 0) {
                throw new Error('Extraction job not found');
            }

            const job = jobResult.rows[0];
            const contentUrl = job.content_url;
            const contentStructure = job.content_structure;
            const columns = contentStructure?.columns || [];

            // Update progress
            await this.updateExtractionStatus(extractionId, 'processing', { progress: 20 });

            // Download PDF
            const pdfBuffer = await this.downloadPdf(contentUrl);
            await this.updateExtractionStatus(extractionId, 'processing', { progress: 40 });

            // Run OCR
            const ocrResults = await this.runOCR(pdfBuffer);
            await this.updateExtractionStatus(extractionId, 'processing', { progress: 60 });

            // Parse OCR text into rows
            const parsedRows = await this.parseOCRtoRows(ocrResults.text, columns);
            await this.updateExtractionStatus(extractionId, 'processing', { progress: 80 });

            // Calculate average confidence
            const avgConfidence = parsedRows.length > 0
                ? parsedRows.reduce((sum, row) => sum + row.confidence, 0) / parsedRows.length
                : 0;

            // Update job with results
            await this.db.query(`
                UPDATE extraction_jobs
                SET
                    status = 'completed',
                    progress = 100,
                    raw_ocr_text = $1,
                    parsed_rows = $2,
                    row_count = $3,
                    avg_confidence = $4,
                    completed_at = NOW()
                WHERE extraction_id = $5
            `, [
                ocrResults.text,
                JSON.stringify(parsedRows),
                parsedRows.length,
                parseFloat(avgConfidence.toFixed(2)),
                extractionId
            ]);

            logger.operation('Extraction completed successfully', {
                extractionId,
                rowCount: parsedRows.length,
                avgConfidence: avgConfidence.toFixed(2)
            });

            return {
                success: true,
                extractionId,
                rowCount: parsedRows.length,
                avgConfidence,
                status: 'completed'
            };

        } catch (error) {
            logger.error('Extraction failed', {
                extractionId,
                error: error.message,
                stack: error.stack
            });

            // Update job status to failed
            await this.updateExtractionStatus(extractionId, 'failed', {
                error_message: error.message
            });

            return {
                success: false,
                extractionId,
                error: error.message,
                status: 'failed'
            };
        }
    }

    /**
     * Download PDF from URL
     * @param {string} url - URL to download PDF from
     * @returns {Promise<Buffer>} PDF buffer
     */
    async downloadPdf(url) {
        try {
            const response = await axios.get(url, {
                responseType: 'arraybuffer',
                timeout: 60000,
                headers: {
                    'User-Agent': 'Reparations Research Bot (Historical Genealogy Research)'
                }
            });

            if (response.status !== 200) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            return Buffer.from(response.data, 'binary');

        } catch (error) {
            logger.error('PDF download failed', {
                url,
                error: error.message
            });
            throw new Error(`Failed to download PDF: ${error.message}`);
        }
    }

    /**
     * Run OCR on PDF buffer
     * @param {Buffer} pdfBuffer - PDF buffer to process
     * @returns {Promise<Object>} OCR results
     */
    async runOCR(pdfBuffer) {
        try {
            // Create file object for OCR processor
            const file = {
                buffer: pdfBuffer,
                originalname: 'document.pdf',
                mimetype: 'application/pdf'
            };

            // Process with OCR
            const results = await this.ocrProcessor.process(file);

            if (!results.text || results.text.trim().length === 0) {
                throw new Error('OCR returned empty text');
            }

            logger.operation('OCR processing completed', {
                service: results.service,
                confidence: results.confidence,
                textLength: results.text.length
            });

            return results;

        } catch (error) {
            logger.error('OCR processing failed', {
                error: error.message
            });
            throw new Error(`OCR processing failed: ${error.message}`);
        }
    }

    /**
     * Parse OCR text into structured rows based on column definitions
     * @param {string} ocrText - Raw OCR text
     * @param {Array} columns - Column definitions
     * @returns {Promise<Array>} Parsed rows
     */
    async parseOCRtoRows(ocrText, columns) {
        try {
            if (!ocrText || ocrText.trim().length === 0) {
                return [];
            }

            if (!columns || columns.length === 0) {
                logger.warn('No columns defined for parsing');
                return [];
            }

            // Split text into lines
            const lines = ocrText.split('\n')
                .map(line => line.trim())
                .filter(line => line.length > 0);

            const parsedRows = [];

            // Parse each line into columns
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];

                // Skip header lines that match column headers exactly
                const headerMatch = columns.some(col =>
                    line.includes(col.headerExact || col.headerGuess || '')
                );

                if (headerMatch && i === 0) {
                    continue; // Skip header row
                }

                // Parse line into columns
                const row = this.parseLineToColumns(line, columns);

                if (row && Object.keys(row.columns).length > 0) {
                    parsedRows.push(row);
                }
            }

            logger.operation('OCR text parsed into rows', {
                lineCount: lines.length,
                parsedRowCount: parsedRows.length,
                columnCount: columns.length
            });

            return parsedRows;

        } catch (error) {
            logger.error('Failed to parse OCR text to rows', {
                error: error.message
            });
            throw new Error(`Failed to parse OCR text: ${error.message}`);
        }
    }

    /**
     * Parse a single line into column values
     * @param {string} line - Text line
     * @param {Array} columns - Column definitions
     * @returns {Object} Parsed row
     */
    parseLineToColumns(line, columns) {
        const row = {
            rowIndex: 0, // Will be set by caller
            columns: {},
            confidence: 0.85, // Default confidence
            rawText: line
        };

        // Simple parsing: split by whitespace and assign to columns
        const values = line.split(/\s{2,}/) // Split by 2+ spaces
            .map(v => v.trim())
            .filter(v => v.length > 0);

        // Assign values to columns based on position
        for (let i = 0; i < Math.min(values.length, columns.length); i++) {
            const column = columns[i];
            const value = values[i];

            if (column && value) {
                const headerName = column.headerExact || column.headerGuess || `Column ${column.position}`;
                row.columns[headerName] = value;
            }
        }

        // Calculate confidence based on line completeness
        const filledColumns = Object.keys(row.columns).length;
        const totalColumns = columns.length;
        row.confidence = filledColumns / totalColumns;

        return row;
    }

    /**
     * Update extraction job status
     * @param {string} extractionId - Extraction job ID
     * @param {string} status - New status
     * @param {Object} data - Additional data to update
     */
    async updateExtractionStatus(extractionId, status, data = {}) {
        try {
            const updateData = {
                status
            };

            // Add additional data
            if (data.progress !== undefined) {
                updateData.progress = data.progress;
            }
            if (data.error_message) {
                updateData.error_message = data.error_message;
            }

            // Build query
            const fields = [];
            const values = [];
            let paramIndex = 1;

            for (const [key, value] of Object.entries(updateData)) {
                fields.push(`${key} = $${paramIndex}`);
                values.push(value);
                paramIndex++;
            }

            values.push(extractionId);

            const query = `
                UPDATE extraction_jobs
                SET ${fields.join(', ')}
                WHERE extraction_id = $${paramIndex}
            `;

            await this.db.query(query, values);

            logger.debug('Extraction status updated', {
                extractionId,
                status,
                data
            });

        } catch (error) {
            logger.error('Failed to update extraction status', {
                extractionId,
                status,
                error: error.message
            });
            throw new Error(`Failed to update status: ${error.message}`);
        }
    }
}

module.exports = ExtractionWorker;
