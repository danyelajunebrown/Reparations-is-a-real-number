#!/bin/bash
# Fix all broken imports after reorganization

echo "Fixing broken imports in reorganized files..."

# Fix src/services/document/DocumentProcessor.js
if [ -f "src/services/document/DocumentProcessor.js" ]; then
  sed -i.bak "s|require('./storage-adapter')|require('./StorageAdapter')|g" src/services/document/DocumentProcessor.js
  sed -i.bak "s|require('./ocr-service')|require('./OCRService')|g" src/services/document/DocumentProcessor.js
  echo "✓ Fixed DocumentProcessor.js"
fi

# Fix src/services/research/LLMAssistant.js  
if [ -f "src/services/research/LLMAssistant.js" ]; then
  sed -i.bak "s|require('./individual-entity-manager')|require('../genealogy/EntityManager')|g" src/services/research/LLMAssistant.js
  sed -i.bak "s|require('./database')|require('../../database')|g" src/services/research/LLMAssistant.js
  echo "✓ Fixed LLMAssistant.js"
fi

# Fix src/server.js
if [ -f "src/server.js" ]; then
  sed -i.bak "s|require('../enhanced-document-processor')|require('../services/document/DocumentProcessor')|g" src/server.js
  sed -i.bak "s|require('../storage-adapter')|require('../services/document/StorageAdapter')|g" src/server.js
  echo "✓ Fixed src/server.js"
fi

# Fix src/utils/evidence-manager.js
if [ -f "src/utils/evidence-manager.js" ]; then
  sed -i.bak "s|require('./storage-adapter')|require('../services/document/StorageAdapter')|g" src/utils/evidence-manager.js
  echo "✓ Fixed evidence-manager.js"
fi

# Fix scripts that require services
if [ -f "scripts/scrapers/continuous-scraper.js" ]; then
  sed -i.bak "s|require('./autonomous-research-orchestrator')|require('../../src/services/scraping/Orchestrator')|g" scripts/scrapers/continuous-scraper.js
  echo "✓ Fixed continuous-scraper.js"
fi

if [ -f "scripts/scrapers/process-pending-urls.js" ]; then
  sed -i.bak "s|require('./autonomous-research-orchestrator')|require('../../src/services/scraping/Orchestrator')|g" scripts/scrapers/process-pending-urls.js
  echo "✓ Fixed process-pending-urls.js"
fi

if [ -f "scripts/testing/demo-adjua-dwolf.js" ]; then
  sed -i.bak "s|require('./individual-entity-manager')|require('../../src/services/genealogy/EntityManager')|g" scripts/testing/demo-adjua-dwolf.js
  echo "✓ Fixed demo-adjua-dwolf.js"
fi

if [ -f "scripts/testing/train-parser.js" ]; then
  sed -i.bak "s|require('./historical-document-parser')|require('../../src/services/research/DocumentParser')|g" scripts/testing/train-parser.js
  sed -i.bak "s|require('./evidence-manager')|require('../../src/utils/evidence-manager')|g" scripts/testing/train-parser.js
  echo "✓ Fixed train-parser.js"
fi

# Remove backup files
rm -f src/services/document/*.bak
rm -f src/services/research/*.bak
rm -f src/*.bak
rm -f src/utils/*.bak
rm -f scripts/scrapers/*.bak
rm -f scripts/testing/*.bak

echo ""
echo "✅ All imports fixed!"
echo "Next: git add . && git commit && git push"
