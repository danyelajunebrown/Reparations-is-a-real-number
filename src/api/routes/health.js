const express = require('express');
const router = express.Router();
const OCRProcessor = require('../../services/document/OCRProcessor');
const logger = require('../../utils/logger');

/**
 * Health Check Endpoint
 * Provides comprehensive system health status
 */
router.get('/health', async (req, res) => {
    try {
        const healthStatus = {
            timestamp: new Date().toISOString(),
            status: 'healthy',
            services: {},
            dependencies: {},
            database: 'unknown',
            storage: 'unknown'
        };

        // Check OCR services
        try {
            const ocrProcessor = new OCRProcessor();
            healthStatus.services.ocr = {
                googleVisionAvailable: ocrProcessor.googleVisionAvailable,
                tesseractAvailable: true, // Tesseract.js is always available
                puppeteerAvailable: !!require('puppeteer'),
                playwrightAvailable: !!require('playwright')
            };
        } catch (error) {
            healthStatus.services.ocr = {
                error: error.message,
                available: false
            };
        }

        // Check database connection
        try {
            const db = require('../../database/connection');
            await db.query('SELECT 1');
            healthStatus.database = 'connected';
        } catch (error) {
            healthStatus.database = `disconnected: ${error.message}`;
        }

        // Check storage
        try {
            const fs = require('fs');
            const storagePath = './storage';
            if (fs.existsSync(storagePath)) {
                healthStatus.storage = 'available';
            } else {
                healthStatus.storage = 'unavailable';
            }
        } catch (error) {
            healthStatus.storage = `error: ${error.message}`;
        }

        // Check environment variables
        healthStatus.environment = {
            nodeEnv: process.env.NODE_ENV || 'development',
            googleVisionKey: !!process.env.GOOGLE_VISION_API_KEY,
            databaseUrl: !!process.env.DATABASE_URL,
            s3Enabled: process.env.S3_ENABLED === 'true'
        };

        res.json({
            success: true,
            health: healthStatus
        });

    } catch (error) {
        logger.error('Health check failed', { error: error.message });
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * OCR Capabilities Endpoint
 * Reports available OCR services and their status
 */
router.get('/capabilities', async (req, res) => {
    try {
        const ocrProcessor = new OCRProcessor();
        const capabilities = {
            ocrProcessor: !!ocrProcessor,
            googleVision: ocrProcessor.googleVisionAvailable,
            tesseract: true, // Tesseract.js is always available
            puppeteer: !!require('puppeteer'),
            playwright: !!require('playwright'),
            browserAutomation: !!require('puppeteer') || !!require('playwright')
        };

        // Add detailed service info
        if (capabilities.googleVision) {
            capabilities.googleVisionDetails = {
                status: 'available',
                message: 'Google Vision API is configured and available'
            };
        } else {
            capabilities.googleVisionDetails = {
                status: 'unavailable',
                message: 'Google Vision API is not configured or failed to initialize',
                recommendation: 'Set GOOGLE_VISION_API_KEY environment variable or configure service account credentials'
            };
        }

        res.json({
            success: true,
            capabilities,
            message: capabilities.browserAutomation
                ? 'Full extraction capabilities available'
                : 'Limited extraction capabilities - browser automation not available'
        });

    } catch (error) {
        logger.error('Capabilities check failed', { error: error.message });
        res.status(500).json({
            success: false,
            error: error.message,
            capabilities: {
                ocrProcessor: false,
                googleVision: false,
                tesseract: true,
                puppeteer: false,
                playwright: false,
                browserAutomation: false
            }
        });
    }
});

module.exports = router;
