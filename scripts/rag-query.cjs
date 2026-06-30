#!/usr/bin/env node
// Phase-2b CLI: grounded RAG query over the doc_ocr corpus. node scripts/rag-query.cjs "question"
require('dotenv').config();
const { Pool } = require('pg');
const RagService = require('../src/services/rag/RagService');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
(async () => {
  const q = process.argv.slice(2).join(' ') || 'enslaved people named in an 1860 slave schedule';
  const rag = new RagService(pool);
  try {
    const r = await rag.query(q, { k: 6 });
    console.log('Q:', q);
    console.log('A:', r.answer);
    console.log('citations:', r.citations.map(c => 'doc#' + c.document_id).join(', ') || '(none)');
    console.log('retrieved:', r.retrieved.map(x => 'doc#' + x.document_id + '(' + (+x.similarity).toFixed(2) + ')').join(', '));
    console.log('provider:', r.provider);
  } catch (e) { console.error('RAG ERR:', e.message); }
  finally { await pool.end(); }
})();
