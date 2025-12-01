# OCR Enhancement & Quality Improvement Guide

## Overview

The Reparations Platform now includes advanced OCR quality improvement features that allow you to:

1. **Upload tombstone documents** (new document type)
2. **Provide precompleted OCR data** from external sources
3. **Include accompanying text** from websites or archives
4. **Automatically improve the system** by comparing OCR results

## New Features

### 1. Tombstone Document Type

Tombstones are now supported as a first-class document type. When uploading a tombstone photo or scan, select `tombstone` from the document type dropdown.

**Example use case:**
- Cemetery records
- Grave markers with enslaved person names
- Memorial inscriptions

### 2. Precompleted OCR Data

If you have already transcribed or OCR'd text from an external source (like Ancestry.com, FamilySearch, or archive transcriptions), you can provide this as **ground truth** for the system.

**How it works:**
1. Upload your document image as usual
2. Include the `precompletedOCR` field with the correct transcription
3. The system will:
   - Run its own OCR
   - Compare with your precompleted OCR
   - Calculate similarity score (0-100%)
   - **Automatically use the precompleted OCR if it's better**
   - Log discrepancies for training
   - Improve future OCR accuracy

**Benefits:**
- System learns from high-quality transcriptions
- Accumulates training data automatically
- Improves accuracy over time without manual intervention

### 3. Accompanying Text

Many historical documents come with contextual information from the website or archive where you found them (descriptions, metadata, related text).

**How it works:**
1. Copy the text from the website/archive page
2. Include it in the `accompanyingText` field
3. The system will:
   - Extract unique information not in the OCR
   - Correlate data between OCR and accompanying text
   - Store context for better historical understanding

**Example:**
- FamilySearch document descriptions
- Ancestry.com record details
- Archive.org metadata
- Museum catalog descriptions

## API Usage

### Enhanced `/api/upload-document` Endpoint

**New optional fields:**

```json
{
  "document": "[file upload]",
  "ownerName": "James Hopewell",
  "documentType": "tombstone",
  "birthYear": 1780,
  "deathYear": 1825,
  "location": "Maryland",

  // NEW FIELDS:
  "precompletedOCR": "Here lies John, enslaved by James Hopewell\nBorn 1795 - Died 1863\nFreed 1865",
  "ocrSource": "FamilySearch transcription",
  "accompanyingText": "This tombstone is located in the Historic African Cemetery in Baltimore. According to church records, John was one of 32 people enslaved by James Hopewell.",
  "textSource": "website"
}
```

### Response Format

When precompleted OCR is provided, the response includes comparison data:

```json
{
  "success": true,
  "documentId": "abc123",
  "result": {
    "stages": {
      "ocr": {
        "text": "Here lies John...",
        "source": "precompleted",
        "originalSystemText": "Here lies lohn..."
      }
    },
    "ocrComparison": {
      "similarity": 0.94,
      "quality": "good_with_improvements_needed",
      "recommendation": "use_precompleted_ocr",
      "discrepancyCount": 3
    },
    "textEnhancement": {
      "enhanced": true,
      "enhancedWords": ["church", "records", "Baltimore", "Historic", "African", "Cemetery"],
      "source": "website"
    }
  }
}
```

## Document Types

All supported document types (including new **tombstone**):

- `will` - Last will and testament
- `probate` - Probate court records
- `census` - Census records
- `slave_schedule` - Slave schedules from census
- `slave_manifest` - Ship manifests
- `estate_inventory` - Estate inventories
- `correspondence` - Letters and documents
- `deed` - Property deeds
- `ship_manifest` - Shipping records
- `sale_record` - Sale documentation
- **`tombstone`** - Cemetery grave markers ✨ NEW
- `other` - Other document types

## OCR Quality Tracking

### Database Schema

The system tracks OCR quality in the `ocr_comparisons` table:

```sql
-- View OCR performance by document type
SELECT * FROM ocr_performance_stats;

-- Recent comparisons
SELECT * FROM recent_ocr_comparisons LIMIT 10;
```

### Training Data

When system OCR doesn't match precompleted OCR (similarity < 95%), training data is automatically saved to:

```
./training_data/ocr_discrepancies/
  training_abc123_tombstone_1732140000000.json
  training_def456_will_1732140100000.json
  ...
```

Each training file contains:
- System OCR output
- Precompleted OCR (ground truth)
- Similarity score
- Detailed discrepancies
- Document metadata

## Frontend Integration

### HTML Form Example

```html
<form id="uploadForm" enctype="multipart/form-data">
  <label>Document Type:</label>
  <select name="documentType">
    <option value="will">Will</option>
    <option value="probate">Probate</option>
    <option value="census">Census</option>
    <option value="slave_schedule">Slave Schedule</option>
    <option value="tombstone">Tombstone</option> <!-- NEW -->
    <option value="other">Other</option>
  </select>

  <label>Document Image:</label>
  <input type="file" name="document" required>

  <label>Owner Name:</label>
  <input type="text" name="ownerName" required>

  <!-- NEW FIELDS -->
  <label>Precompleted OCR (optional):</label>
  <textarea name="precompletedOCR" rows="10" placeholder="If you already have a transcription..."></textarea>

  <label>OCR Source (optional):</label>
  <input type="text" name="ocrSource" placeholder="e.g., FamilySearch, Ancestry.com">

  <label>Accompanying Text (optional):</label>
  <textarea name="accompanyingText" rows="5" placeholder="Context from website or archive..."></textarea>

  <label>Text Source (optional):</label>
  <input type="text" name="textSource" placeholder="e.g., website, archive">

  <button type="submit">Upload</button>
</form>
```

### JavaScript Example

```javascript
async function uploadDocument() {
  const formData = new FormData();
  formData.append('document', fileInput.files[0]);
  formData.append('ownerName', 'James Hopewell');
  formData.append('documentType', 'tombstone');
  formData.append('location', 'Maryland');

  // Optional enhancement fields
  formData.append('precompletedOCR', document.getElementById('precompletedOCR').value);
  formData.append('ocrSource', 'FamilySearch');
  formData.append('accompanyingText', document.getElementById('contextText').value);
  formData.append('textSource', 'website');

  const response = await fetch('https://your-api.com/api/upload-document', {
    method: 'POST',
    body: formData
  });

  const result = await response.json();

  if (result.ocrComparison) {
    console.log(`OCR Quality: ${result.ocrComparison.quality}`);
    console.log(`Similarity: ${(result.ocrComparison.similarity * 100).toFixed(1)}%`);
  }
}
```

## Setup Instructions

### 1. Initialize OCR Comparison Schema

After running the standard database initialization, add OCR tracking:

```bash
node init-ocr-comparisons-schema.js
```

This creates:
- `ocr_comparisons` table
- `ocr_performance_stats` view
- `recent_ocr_comparisons` view

### 2. Create Training Data Directory

The system automatically creates `./training_data/ocr_discrepancies/` on first use, but you can pre-create it:

```bash
mkdir -p training_data/ocr_discrepancies
```

### 3. Verify Installation

Check that the OCR trainer is initialized in your server logs:

```
✓ OCR training storage initialized
```

## System Behavior

### OCR Comparison Logic

When both system OCR and precompleted OCR exist:

1. **Similarity ≥ 95%**: "Excellent" - Use system OCR (it's good!)
2. **Similarity 80-94%**: "Good with improvements needed" - Use precompleted OCR, save training data
3. **Similarity < 80%**: "Poor, needs training" - Use precompleted OCR, prioritize for training

### Automatic Training

- Discrepancies are automatically logged
- Training data accumulates over time
- No manual intervention needed
- System learns from high-quality examples

### Data Privacy

- Training data is stored locally (not sent to external services)
- Contains only OCR text (no personal user data)
- Can be deleted anytime by removing files from `./training_data/`

## Monitoring OCR Quality

### View Statistics

```sql
-- Overall OCR performance
SELECT
  document_type,
  total_comparisons,
  avg_similarity,
  excellent_count,
  poor_count
FROM ocr_performance_stats;
```

### Recent Trends

```sql
-- Last 20 comparisons
SELECT
  document_type,
  similarity_score,
  quality_assessment,
  created_at
FROM recent_ocr_comparisons
LIMIT 20;
```

### Training Data Count

```bash
ls -la training_data/ocr_discrepancies/ | wc -l
```

## Best Practices

### 1. Providing Precompleted OCR

✅ **Do:**
- Use accurate transcriptions from trusted sources
- Include the source name in `ocrSource` field
- Preserve original formatting when possible
- Include full text (don't truncate)

❌ **Don't:**
- Use auto-generated OCR from untrusted sources as "precompleted"
- Modify historical spellings to modern conventions
- Include your own interpretations

### 2. Accompanying Text

✅ **Do:**
- Include contextual descriptions from archives
- Add website metadata that provides historical context
- Keep original source URLs in the text
- Include dates, locations, relationships mentioned

❌ **Don't:**
- Include unrelated web page text (navigation, ads)
- Mix multiple unrelated documents
- Add your own commentary without marking it

### 3. Tombstone Documents

✅ **Do:**
- Take clear, well-lit photos
- Include the full inscription
- Note the cemetery location in the `location` field
- Include any readable dates
- Add cemetery/church records as accompanying text

❌ **Don't:**
- Upload low-quality, blurry images
- Crop out important context (dates, locations)
- Skip the location information

## Troubleshooting

### OCR Comparison Not Running

**Symptom:** Upload succeeds but no `ocrComparison` in response

**Causes:**
1. `precompletedOCR` field was empty or null
2. System OCR failed (no comparison possible)
3. OCR trainer not initialized

**Solution:**
- Check server logs for OCR trainer initialization
- Ensure `precompletedOCR` field has content
- Verify database connection (comparisons are logged)

### Training Data Not Saved

**Symptom:** Comparisons happen but no files in `training_data/`

**Causes:**
1. Similarity too high (≥95% - no training needed)
2. File system permissions
3. Directory doesn't exist

**Solution:**
```bash
# Check permissions
ls -la training_data/

# Create directory if needed
mkdir -p training_data/ocr_discrepancies
chmod 755 training_data
```

### Database Table Missing

**Symptom:** Error: `relation "ocr_comparisons" does not exist`

**Solution:**
```bash
node init-ocr-comparisons-schema.js
```

## Future Enhancements

Planned improvements:

- [ ] Machine learning model training from accumulated data
- [ ] Automatic pattern recognition for common OCR errors
- [ ] Document-type-specific OCR optimization
- [ ] Confidence scoring for individual words
- [ ] Real-time OCR quality feedback to users
- [ ] Export training data for external ML tools

## Support

For issues or questions:
- Check server logs for detailed error messages
- Review the `ocr_comparisons` table for quality trends
- Examine training data files for specific discrepancies

## License

Part of the Reparations Platform
