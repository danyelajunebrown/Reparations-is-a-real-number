-- OCR Comparison and Training Tables
-- Add to your database initialization

-- Table to store OCR comparison results
CREATE TABLE IF NOT EXISTS ocr_comparisons (
  id SERIAL PRIMARY KEY,
  document_type VARCHAR(50),
  similarity_score DECIMAL(5,4), -- 0.0000 to 1.0000
  quality_assessment VARCHAR(50), -- 'excellent', 'good_with_improvements_needed', 'poor_needs_training'
  recommendation VARCHAR(50), -- 'use_system_ocr', 'use_precompleted_ocr'
  system_word_count INTEGER,
  precompleted_word_count INTEGER,
  discrepancy_count INTEGER,
  comparison_data JSONB, -- Full comparison details
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_ocr_comparisons_document_type ON ocr_comparisons(document_type);
CREATE INDEX IF NOT EXISTS idx_ocr_comparisons_similarity ON ocr_comparisons(similarity_score);
CREATE INDEX IF NOT EXISTS idx_ocr_comparisons_quality ON ocr_comparisons(quality_assessment);
CREATE INDEX IF NOT EXISTS idx_ocr_comparisons_created_at ON ocr_comparisons(created_at);

-- View for OCR performance statistics
CREATE OR REPLACE VIEW ocr_performance_stats AS
SELECT
  document_type,
  COUNT(*) as total_comparisons,
  AVG(similarity_score) as avg_similarity,
  MIN(similarity_score) as min_similarity,
  MAX(similarity_score) as max_similarity,
  COUNT(CASE WHEN quality_assessment = 'excellent' THEN 1 END) as excellent_count,
  COUNT(CASE WHEN quality_assessment = 'good_with_improvements_needed' THEN 1 END) as good_count,
  COUNT(CASE WHEN quality_assessment = 'poor_needs_training' THEN 1 END) as poor_count,
  AVG(discrepancy_count) as avg_discrepancies
FROM ocr_comparisons
GROUP BY document_type
ORDER BY total_comparisons DESC;

-- View for recent OCR comparison trends
CREATE OR REPLACE VIEW recent_ocr_comparisons AS
SELECT
  id,
  document_type,
  similarity_score,
  quality_assessment,
  recommendation,
  discrepancy_count,
  created_at
FROM ocr_comparisons
ORDER BY created_at DESC
LIMIT 100;

COMMENT ON TABLE ocr_comparisons IS 'Stores comparisons between system OCR and precompleted OCR for quality tracking and training';
COMMENT ON VIEW ocr_performance_stats IS 'Aggregated statistics on OCR performance by document type';
COMMENT ON VIEW recent_ocr_comparisons IS 'Most recent 100 OCR comparisons for monitoring';
