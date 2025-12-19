/**
 * Shared utilities and services for contribute routes
 */

const multer = require('multer');
const ContributionSession = require('../../../services/contribution/ContributionSession');
const OwnerPromotion = require('../../../services/contribution/OwnerPromotion');
const SourceClassifier = require('../../../services/SourceClassifier');
const SourceAnalyzer = require('../../../services/SourceAnalyzer');
const FamilySearchCatalogProcessor = require('../../../services/FamilySearchCatalogProcessor');
const UniversalRouter = require('../../../services/UniversalRouter');

// Initialize classifiers and analyzers
const sourceClassifier = new SourceClassifier();

// Services (initialized with database connection)
let contributionService = null;
let promotionService = null;
let sourceAnalyzer = null;

// Configure multer for file uploads
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB max per file
        files: 20
    },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only image files are allowed'), false);
        }
    }
});

// Simple in-memory cache for stats (5 minute TTL)
const statsCache = {
    data: null,
    timestamp: 0,
    ttl: 5 * 60 * 1000
};

/**
 * Initialize services with database connection
 */
function initializeService(database, extractionWorker = null) {
    contributionService = new ContributionSession(database, extractionWorker);
    promotionService = new OwnerPromotion(database);
    sourceAnalyzer = new SourceAnalyzer(database);
}

/**
 * Get initialized services
 */
function getServices() {
    return {
        contributionService,
        promotionService,
        sourceClassifier,
        sourceAnalyzer,
        FamilySearchCatalogProcessor,
        UniversalRouter
    };
}

module.exports = {
    upload,
    statsCache,
    initializeService,
    getServices
};
