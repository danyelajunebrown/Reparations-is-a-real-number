/**
 * Probate image OCR — now a thin delegate to the multi-provider VISION ROUTER
 * (`src/services/vision/vision-router.js`, issue #142). Kept at this path + signature so every existing
 * consumer (OCRService, probate-extractor, reextract-hand-uploaded-wills) upgrades transparently from
 * Gemini-only to the router (Qwen-VL primary + uncapped → Gemini → gpt-4o).
 *
 * The original module hard-called Gemini 2.5 Flash directly, built when Cloud Vision's key was
 * suspended. That's now just ONE provider inside the router. This file only owns the probate-tuned
 * default prompt; the transport, provider cascade, and 429 handling live in the router.
 *
 * transcribeImage(imageBuffer, { mimeType, prompt }) -> string   (verbatim transcription, '' on empty)
 */

const { transcribeImage: routerTranscribe, VISION_MODEL } = require('../vision/vision-router');

// Probate-tuned default (18th/19th-c. cursive wills/inventories/accounts). Callers that need a
// different task (e.g. slave-schedule per-owner counting) pass their own `prompt`.
const OCR_PROMPT =
  'You are transcribing a scanned page of an 18th/19th-century U.S. probate ' +
  'record (will, inventory, or estate account) written in cursive. Transcribe ' +
  'ALL legible text VERBATIM, preserving names, dollar amounts, and dates ' +
  'exactly as written. Do not summarize, translate, or modernize spelling. ' +
  'If a word is illegible, write [illegible]. If the page is rotated or sideways, ' +
  'still transcribe it. Output ONLY the transcribed text, no commentary.';

async function transcribeImage(imageBuffer, { mimeType = 'image/png', prompt = OCR_PROMPT } = {}) {
  return routerTranscribe(imageBuffer, { mimeType, prompt, maxTokens: 8192 });
}

// GEMINI_OCR_MODEL kept for backward-compat callers that log it; now reports the router's active model.
module.exports = { transcribeImage, GEMINI_OCR_MODEL: VISION_MODEL, OCR_PROMPT };
