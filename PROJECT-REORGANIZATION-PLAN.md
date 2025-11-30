# Project Reorganization Plan

## 🚨 Current State Analysis

**Root Directory Files:** 100+ files (chaos!)

### Current Problems:
1. **100+ files in root** - Impossible to navigate
2. **Mixed concerns** - Frontend, backend, scripts, tests, docs all mixed
3. **Duplicate files** - index.html, index.html.backup, index.html.bak
4. **Unclear naming** - Files don't indicate purpose clearly
5. **No clear separation** - Scripts, services, utilities all together
6. **Test files scattered** - test-*.js files in root instead of tests/
7. **Migration files scattered** - SQL and JS migrations mixed everywhere
8. **Documentation sprawl** - 20+ .md files in root

---

## ✨ Proposed New Structure

```
reparations-is-a-real-number/
├── README.md                          # Main project documentation
├── package.json
├── .env.example
├── .gitignore
│
├── docs/                              # 📚 All documentation
│   ├── deployment/
│   │   ├── render-deployment.md
│   │   ├── s3-setup.md
│   │   └── deployment-troubleshooting.md
│   ├── development/
│   │   ├── cline-setup.md
│   │   ├── local-development.md
│   │   └── architecture.md
│   ├── features/
│   │   ├── genealogy-ai.md
│   │   ├── autonomous-research.md
│   │   ├── ocr-enhancement.md
│   │   └── tree-builder.md
│   └── guides/
│       ├── scraper-guide.md
│       ├── security-implementation.md
│       └── api-documentation.md
│
├── src/                               # 🎯 Source code (organized by feature)
│   ├── server.js                      # Main server entry point
│   ├── config/
│   │   └── index.js                   # Centralized configuration
│   │
│   ├── api/                           # API layer
│   │   ├── routes/
│   │   │   ├── documents.js
│   │   │   ├── research.js
│   │   │   ├── upload.js
│   │   │   ├── search.js
│   │   │   ├── beyond-kin.js
│   │   │   └── health.js
│   │   ├── controllers/
│   │   │   ├── DocumentController.js
│   │   │   ├── ResearchController.js
│   │   │   └── UploadController.js
│   │   └── middleware/
│   │       ├── auth.js
│   │       ├── validation.js
│   │       ├── rate-limit.js
│   │       └── error-handler.js
│   │
│   ├── services/                      # Business logic layer
│   │   ├── document/
│   │   │   ├── DocumentProcessor.js
│   │   │   ├── OCRService.js
│   │   │   └── StorageAdapter.js
│   │   ├── genealogy/
│   │   │   ├── FamilySearchIntegration.js
│   │   │   ├── DescendantCalculator.js
│   │   │   └── EntityManager.js
│   │   ├── research/
│   │   │   ├── NLPAssistant.js
│   │   │   ├── LLMAssistant.js
│   │   │   └── DocumentParser.js
│   │   ├── scraping/
│   │   │   ├── AutonomousOrchestrator.js
│   │   │   ├── WebScraper.js
│   │   │   └── BeyondKinScraper.js
│   │   └── reparations/
│   │       ├── ReparationsCalculator.js
│   │       └── DebtTracker.js
│   │
│   ├── database/                      # Database layer
│   │   ├── connection.js
│   │   ├── repositories/
│   │   │   ├── DocumentRepository.js
│   │   │   ├── IndividualRepository.js
│   │   │   └── EnslavedRepository.js
│   │   ├── models/
│   │   │   └── (Sequelize models if needed)
│   │   └── migrations/
│   │       ├── sql/
│   │       │   ├── 001_initial_schema.sql
│   │       │   ├── 002_enslaved_docs.sql
│   │       │   ├── 003_ocr_comparisons.sql
│   │       │   └── 004_beyond_kin_queue.sql
│   │       └── scripts/
│   │           ├── init-database.js
│   │           └── seed-data.js
│   │
│   └── utils/                         # Utilities
│       ├── logger.js
│       ├── validators.js
│       ├── formatters.js
│       └── helpers.js
│
├── scripts/                           # 🔧 Standalone scripts
│   ├── setup/
│   │   ├── setup-database.js
│   │   └── setup-s3.sh
│   ├── migrations/
│   │   ├── migrate-to-s3.js
│   │   └── upload-hopewell-pdfs.js
│   ├── data/
│   │   ├── import-dewolf-lineage.js
│   │   ├── csv-importer.js
│   │   └── seed-hopewell.js
│   ├── scrapers/
│   │   ├── continuous-scraper.js
│   │   ├── process-pending-urls.js
│   │   └── submit-civilwardc-urls.js
│   └── testing/
│       ├── check-database.js
│       └── verify-familysearch-ids.js
│
├── tests/                             # 🧪 All tests
│   ├── unit/
│   │   ├── services/
│   │   │   ├── DocumentProcessor.test.js
│   │   │   ├── OCRService.test.js
│   │   │   └── ReparationsCalculator.test.js
│   │   └── utils/
│   │       └── validators.test.js
│   ├── integration/
│   │   ├── api/
│   │   │   ├── documents.test.js
│   │   │   ├── search.test.js
│   │   │   └── upload.test.js
│   │   └── database/
│   │       └── repositories.test.js
│   └── e2e/
│       └── upload-workflow.test.js
│
├── frontend/                          # 🎨 Frontend assets
│   ├── public/
│   │   ├── index.html
│   │   ├── portal.html
│   │   ├── contribute.html
│   │   ├── carousel-enhancements.js
│   │   └── familysearch-integration.js
│   └── assets/
│       ├── css/
│       ├── images/
│       └── fonts/
│
├── contracts/                         # ⛓️ Blockchain smart contracts
│   ├── ReparationsLedger.sol
│   ├── ReparationsEscrow.sol
│   ├── Migrations.sol
│   ├── migrations/
│   │   ├── 1_initial_migration.js
│   │   ├── 2_deploy_contracts.js
│   │   └── 3_deploy_escrow.js
│   └── truffle-config.js
│
├── storage/                           # 💾 Local file storage
│   ├── documents/
│   ├── uploads/
│   └── temp/
│
├── data/                              # 📊 Data files
│   ├── training/
│   │   └── ocr_discrepancies/
│   ├── text_only/
│   └── scraped/
│
└── memory-bank/                       # 🧠 AI context (keep as-is)
    ├── activeContext.md
    ├── productContext.md
    ├── progress.md
    ├── projectbrief.md
    ├── systemPatterns.md
    └── techContext.md
```

---

## 📋 File Mapping (What Goes Where)

### Root → docs/deployment/
- DEPLOYMENT-FIX-GUIDE.md → docs/deployment/fix-guide.md
- DEPLOYMENT-GUIDE.md → docs/deployment/guide.md
- DEPLOYMENT-INSTRUCTIONS.md → docs/deployment/instructions.md
- RENDER_DEBUG_GUIDE.md → docs/deployment/debug-guide.md
- S3_SETUP_GUIDE.md → docs/deployment/s3-setup.md
- S3-MIGRATION-GUIDE.md → docs/deployment/s3-migration.md

### Root → docs/development/
- CLINE-SETUP-GUIDE.md → docs/development/cline-setup.md
- REFACTORING.md → docs/development/refactoring.md
- CLAUDE.md → docs/development/claude-context.md

### Root → docs/features/
- GENEALOGY-AI-ROADMAP.md → docs/features/genealogy-ai.md
- AUTONOMOUS-RESEARCH-AGENT.md → docs/features/autonomous-research.md
- AUTO-LINEAGE-TRACING.md → docs/features/auto-lineage-tracing.md
- OCR-ENHANCEMENT-GUIDE.md → docs/features/ocr-enhancement.md
- TREE-BUILDER-GUIDE.md → docs/features/tree-builder.md
- CONTINUOUS-SCRAPING-SYSTEM.md → docs/features/continuous-scraping.md

### Root → docs/guides/
- SCRAPER-GUIDE.md → docs/guides/scraper.md
- GENEALOGY-SETUP.md → docs/guides/genealogy-setup.md
- SECURITY-IMPLEMENTATION.md → docs/guides/security.md
- QUICK-START-SCRAPING.md → docs/guides/quick-start-scraping.md
- TERMS-OF-SERVICE-RESEARCH.md → docs/guides/terms-of-service.md

### Root → docs/status/
- IMPLEMENTATION-COMPLETE.md → docs/status/implementation-complete.md
- IMPLEMENTATION-STATUS.md → docs/status/implementation-status.md
- ENHANCEMENT-SUMMARY.md → docs/status/enhancement-summary.md

### Root → src/services/document/
- enhanced-document-processor.js → src/services/document/DocumentProcessor.js
- ocr-service.js → src/services/document/OCRService.js
- storage-adapter.js → src/services/document/StorageAdapter.js
- ocr-comparison-trainer.js → src/services/document/OCRComparisonTrainer.js

### Root → src/services/genealogy/
- descendant-calculator.js → src/services/genealogy/DescendantCalculator.js
- individual-entity-manager.js → src/services/genealogy/EntityManager.js
- enslaved-individual-manager.js → src/services/genealogy/EnslavedManager.js
- entity-deduplicator.js → src/services/genealogy/EntityDeduplicator.js
- familysearch-integration.js → src/services/genealogy/FamilySearchIntegration.js
- ancestry-integration.js → src/services/genealogy/AncestryIntegration.js
- descendant-tree-builder.js → src/services/genealogy/TreeBuilder.js

### Root → src/services/research/
- free-nlp-assistant.js → src/services/research/NLPAssistant.js
- llm-conversational-assistant.js → src/services/research/LLMAssistant.js
- historical-document-parser.js → src/services/research/DocumentParser.js
- genealogy-entity-extractor.js → src/services/research/EntityExtractor.js
- llm-page-analyzer.js → src/services/research/PageAnalyzer.js

### Root → src/services/scraping/
- autonomous-research-orchestrator.js → src/services/scraping/Orchestrator.js
- autonomous-web-scraper.js → src/services/scraping/WebScraper.js
- beyond-kin-scraper.js → src/services/scraping/BeyondKinScraper.js
- multi-source-scraper.js → src/services/scraping/MultiSourceScraper.js

### Root → src/services/reparations/
- reparations-calculator.js → src/services/reparations/Calculator.js
- debt-tracker.js → src/services/reparations/DebtTracker.js

### Root → src/utils/
- database-utils.js → src/utils/database-helpers.js
- confidence-scorer.js → src/utils/confidence-scorer.js
- citation-tracker.js → src/utils/citation-tracker.js
- evidence-manager.js → src/utils/evidence-manager.js
- review-queue.js → src/utils/review-queue.js

### Root → src/database/
- database.js → src/database/connection.js
- database-schemas.js → src/database/schemas.js

### Root → src/database/migrations/sql/
- database-schema-enslaved-documents.sql → src/database/migrations/sql/001_enslaved_documents.sql
- database-schema-enslaved-metadata.sql → src/database/migrations/sql/002_enslaved_metadata.sql
- database-schema-ocr-comparisons.sql → src/database/migrations/sql/003_ocr_comparisons.sql
- create-scraping-tables.sql → src/database/migrations/sql/004_scraping_tables.sql
- init-unconfirmed-persons-schema.sql → src/database/migrations/sql/005_unconfirmed_persons.sql

### Root → src/database/migrations/scripts/
- init-database.js → src/database/migrations/scripts/init-database.js
- init-enslaved-documents-schema.js → src/database/migrations/scripts/init-enslaved-docs.js
- init-enslaved-metadata-schema.js → src/database/migrations/scripts/init-enslaved-meta.js
- init-ocr-comparisons-schema.js → src/database/migrations/scripts/init-ocr-comparisons.js

### Root → scripts/migrations/
- migrate-to-s3.js → scripts/migrations/migrate-to-s3.js
- migrate-local-to-s3.js → scripts/migrations/migrate-local-to-s3.js
- upload-james-hopewell-pdfs.js → scripts/migrations/upload-hopewell-pdfs.js
- delete-scraped-from-s3.js → scripts/migrations/delete-scraped-from-s3.js
- download-from-s3.js → scripts/migrations/download-from-s3.js
- upload-scraped-to-s3.js → scripts/migrations/upload-scraped-to-s3.js

### Root → scripts/data/
- import-dewolf-lineage.js → scripts/data/import-dewolf-lineage.js
- csv-importer.js → scripts/data/csv-importer.js
- csv-genealogy-importer.js → scripts/data/csv-genealogy-importer.js
- add-james-hopewell-descendants.js → scripts/data/add-hopewell-descendants.js

### Root → scripts/scrapers/
- continuous-scraper.js → scripts/scrapers/continuous-scraper.js
- process-pending-urls.js → scripts/scrapers/process-pending-urls.js
- submit-civilwardc-urls.js → scripts/scrapers/submit-civilwardc-urls.js

### Root → scripts/testing/
- check-database.js → scripts/testing/check-database.js
- verify-familysearch-ids.js → scripts/testing/verify-familysearch-ids.js
- demo-adjua-dwolf.js → scripts/testing/demo-adjua-dwolf.js

### Root → scripts/reprocessing/
- reprocess-all-documents.js → scripts/reprocessing/reprocess-all-documents.js
- extract-pdf-text.js → scripts/reprocessing/extract-pdf-text.js
- train-parser.js → scripts/reprocessing/train-parser.js

### Root → tests/integration/
- test-*.js files → tests/integration/ (organized by feature)

### Root → frontend/public/
- index.html → frontend/public/index.html (keep)
- portal.html → frontend/public/portal.html (keep)
- contribute.html → frontend/public/contribute.html (keep)
- familysearch-callback.html → frontend/public/familysearch-callback.html
- merkle-demo.html → frontend/public/demos/merkle-demo.html
- document manager.html → frontend/public/document-manager.html

### Files to DELETE (duplicates/backups):
- index.html.backup
- index.html.bak
- app.js (duplicate of server.js?)
- .migration (unused)
- continuous-scraper.log (should be in logs/)
- server.log (should be in logs/)
- scraping_test.rtf (test file)
- james-hopewell-from-s3.pdf (test file - move to data/)
- eng.traineddata (OCR training data - move to data/)

---

## 🔄 Migration Steps

### Phase 1: Create New Directory Structure
1. Create all new directories
2. Keep old files in place

### Phase 2: Move Documentation
1. Move all .md files to docs/
2. Test documentation links

### Phase 3: Move Source Code
1. Move services to src/services/
2. Update all imports
3. Test after each major move

### Phase 4: Move Scripts
1. Move scripts to scripts/
2. Update package.json scripts
3. Test scripts still work

### Phase 5: Move Tests
1. Move test files to tests/
2. Configure test runner paths
3. Run all tests

### Phase 6: Cleanup
1. Delete duplicates
2. Delete backups
3. Update .gitignore
4. Update README

---

## 📝 Configuration Updates Needed

### package.json scripts:
```json
{
  "scripts": {
    "start": "node src/server.js",
    "dev": "nodemon src/server.js",
    "init-db": "node src/database/migrations/scripts/init-database.js",
    "migrate": "node scripts/migrations/migrate-to-s3.js",
    "scraper": "node scripts/scrapers/continuous-scraper.js",
    "test": "jest tests/",
    "test:unit": "jest tests/unit/",
    "test:integration": "jest tests/integration/"
  }
}
```

### Import path examples:
```javascript
// Before
const DocumentProcessor = require('./enhanced-document-processor');

// After
const DocumentProcessor = require('./services/document/DocumentProcessor');
```

---

## ✅ Benefits of This Organization

1. **Clear separation of concerns** - Each directory has one purpose
2. **Easier navigation** - Find files by feature/function
3. **Better scalability** - Easy to add new features
4. **Improved testing** - Tests mirror source structure
5. **Cleaner root** - Only essential config files
6. **Documentation hub** - All docs in one place
7. **Better onboarding** - New developers understand structure quickly

---

## 🚀 Execution Plan

Will execute in phases to minimize breakage:
1. Create new directory structure ✅
2. Move documentation (no imports to update)
3. Move and update one service at a time
4. Update server.js imports incrementally
5. Move scripts and update package.json
6. Move tests last
7. Final cleanup and verification

---

**Status:** Ready to execute
**Estimated time:** 30-45 minutes
**Risk level:** Medium (will test incrementally)
