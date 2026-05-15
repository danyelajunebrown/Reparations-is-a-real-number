# Feature Request: Public-Facing Will Document Ingestion for Genealogical Research

## Summary

As a genealogical researcher, I need to upload historical will documents (like the Henry Weaver will from DC Archives) directly through the public frontend so that:
1. The document is stored in S3
2. The data is parsed and extracted
3. All connected person profiles are automatically updated with the new information

## Current State

### ✅ What's Already Working
- **Backend API**: `POST /api/wills/ingest` endpoint exists and is fully functional
  - Accepts PDF uploads up to 25MB
  - Stores documents in S3 at `wills/{testator-slug}/{uuid}.pdf`
  - Creates `person_documents` records
  - Creates `will_extractions` records (graceful degradation if M048 not applied)
  - **No authentication required** - already public-facing

- **Frontend Route**: `/contribute/will` is already configured in `App.jsx`
- **Navigation**: "Contribute" menu item already exists in the header
- **SubmitWillPage Component**: Complete document ingestion form with:
  - PDF file upload
  - Testator name, year, location, archive source fields
  - ErrorBoundary for error handling
  - Success screen with next steps

### ❌ What's Missing
The frontend component exists but there's a **disconnect between what's built and what researchers need**:

1. **Discovery Issue**: Researchers don't know the `/contribute/will` page exists
   - No prominent call-to-action on the homepage or search pages
   - No documentation about how to contribute documents

2. **Trust Issue**: Researchers may not understand what happens after upload
   - No clear explanation of the OCR + extraction process
   - No visibility into when/how their data will be used
   - No feedback loop showing how their contribution helped others

3. **Workflow Issue**: The current flow ends at "upload successful"
   - No guidance on what to do next
   - No way to track the extraction progress
   - No way to see the results of their contribution

## Proposed Solution

### Phase 1: Immediate Improvements (Low Hanging Fruit)

1. **Add Prominent CTAs**
   - Add a "Contribute a Document" card to the homepage section cards
   - Add a banner to search results pages when no relevant documents are found
   - Add a footer link in the document viewer

2. **Improve SubmitWillPage UX**
   - Add clear explanation of what happens after upload
   - Add progress tracking for OCR/extraction
   - Add example documents to show what works well
   - Add a "What happens next?" section

3. **Add Documentation**
   - Create a `/contribute` page that explains the process
   - Add guidelines for what makes a good document
   - Add examples of successful contributions

### Phase 2: Enhanced Features

1. **Contributor Recognition**
   - Add "Contributed by [Name]" to document viewer
   - Create a contributor leaderboard/hall of fame
   - Send email notifications when their document helps connect people

2. **Progress Tracking**
   - Add `/contribute/status` page to track extraction progress
   - Add webhook notifications when extraction completes
   - Add "View Results" button when extraction is done

3. **Community Features**
   - Add comment system on documents
   - Add "Help Identify" feature for unnamed people in documents
   - Add connection suggestions based on contributed documents

## Technical Implementation

### Backend Status: ✅ COMPLETE
The backend API (`/api/wills/ingest`) is fully functional and ready for public use. No changes needed.

### Frontend Status: ✅ MOSTLY COMPLETE
The `SubmitWillPage` component exists and works, but needs UX improvements:

```javascript
// Current route in App.jsx - NO CHANGES NEEDED
<Route path="/contribute/will" element={<SubmitWillPage />} />
```

### Database Schema: ✅ COMPLETE
All necessary tables exist:
- `person_documents` - stores S3 references
- `will_extractions` - tracks extraction status and results
- `enslaved_individuals` - populated by extraction
- `canonical_persons` - linked by extraction
- `person_relationships_verified` - created by extraction

## Testing Framework

A comprehensive testing framework has been implemented to ensure data quality:

### ✅ Created Test Files
- `tests/fixtures/wills/george-biscoe-1859-ground-truth.json`
- `tests/fixtures/wills/henry-weaver-1884-ground-truth.json`
- `tests/fixtures/wills/mary-ann-weaver-1883-ground-truth.json`

### ✅ Implemented Tests
- **OCR Accuracy** (`tests/unit/test-ocr-accuracy.js`)
- **Extractor Schema Validation** (`tests/unit/test-extractor-schema.js`)
- **Extraction Fidelity** (`tests/integration/test-extraction-fidelity.js`)
- **Database Write Verification** (`tests/integration/test-fanout-writes.js`)
- **Frontend Smoke Test** (`tests/e2e/test-frontend-display.md`)

## Security Considerations

The current implementation is appropriately secure for a research project of this scale:

- ✅ File type validation (PDF only)
- ✅ File size limits (25MB)
- ✅ S3 storage with proper access controls
- ✅ No authentication required (appropriate for academic research)
- ✅ Graceful error handling

## Success Metrics

1. **Upload Volume**: Track number of documents uploaded per week
2. **Extraction Success Rate**: Monitor OCR + extraction completion rate
3. **Connection Rate**: Measure how many uploads result in new person connections
4. **User Engagement**: Track return visits and contribution frequency

## Next Steps

1. **Immediate**: Add prominent CTAs to guide researchers to the upload page
2. **Short-term**: Improve SubmitWillPage UX with better explanations and progress tracking
3. **Medium-term**: Implement contributor recognition and community features
4. **Long-term**: Build advanced features like collaborative annotation and AI-assisted connection suggestions

## Related Issues

- #TODO: Add issue number for Phase 1 improvements
- #TODO: Add issue number for Phase 2 enhancements
- #TODO: Add issue number for testing framework

## Acceptance Criteria

- [ ] Researchers can easily find the document upload page from the homepage
- [ ] Upload process clearly explains what will happen with the document
- [ ] Contributors receive feedback when their document helps make connections
- [ ] System maintains high data quality through comprehensive testing
- [ ] Process remains accessible without requiring authentication or approval