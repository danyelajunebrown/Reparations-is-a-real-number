#!/bin/bash
# Fix ALL remaining broken imports in src/ directory

echo "Fixing all remaining broken imports in src/..."

# Fix DocumentParser.js - llm-conversational-assistant
if [ -f "src/services/research/DocumentParser.js" ]; then
  sed -i.bak "s|require('./llm-conversational-assistant')|require('./LLMAssistant')|g" src/services/research/DocumentParser.js
  echo "✓ Fixed DocumentParser.js"
fi

# Find and fix any other broken imports automatically
# Search for require statements in src/ that reference old paths
grep -r "require.*enhanced-document-processor" src/ --include="*.js" -l | while read file; do
  sed -i.bak "s|enhanced-document-processor|services/document/DocumentProcessor|g" "$file"
  echo "✓ Fixed $file (enhanced-document-processor)"
done

grep -r "require.*storage-adapter" src/ --include="*.js" -l | while read file; do
  sed -i.bak "s|storage-adapter|services/document/StorageAdapter|g" "$file"  
  echo "✓ Fixed $file (storage-adapter)"
done

grep -r "require.*individual-entity-manager" src/ --include="*.js" -l | while read file; do
  sed -i.bak "s|individual-entity-manager|services/genealogy/EntityManager|g" "$file"
  echo "✓ Fixed $file (individual-entity-manager)"
done

# Clean up backup files
find src/ -name "*.bak" -delete

echo ""
echo "✅ All src/ imports fixed!"
