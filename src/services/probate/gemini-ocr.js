/**
 * Gemini-vision OCR for probate document images — a FREE alternative to Google
 * Cloud Vision (whose API key was suspended). Uses the existing GEMINI_API_KEY
 * (the same key the probate-llm-extractor router uses). Gemini 2.5 Flash is
 * vision-capable and transcribes document-page images directly.
 *
 * Free-tier note: request-limited (not token-limited), so one call per page is
 * fine at this volume. 1700s/1800s cursive is genuinely hard — expect partial
 * transcriptions, same ceiling as Cloud Vision on the county corpus.
 *
 * transcribeImage(pngBuffer) -> string   (verbatim transcription, '' on empty)
 */

const GEMINI_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
const GEMINI_OCR_MODEL = process.env.GEMINI_OCR_MODEL || 'gemini-2.5-flash';

const OCR_PROMPT =
  'You are transcribing a scanned page of an 18th/19th-century U.S. probate ' +
  'record (will, inventory, or estate account) written in cursive. Transcribe ' +
  'ALL legible text VERBATIM, preserving names, dollar amounts, and dates ' +
  'exactly as written. Do not summarize, translate, or modernize spelling. ' +
  'If a word is illegible, write [illegible]. If the page is rotated or sideways, ' +
  'still transcribe it. Output ONLY the transcribed text, no commentary.';

async function transcribeImage(pngBuffer, { mimeType = 'image/png' } = {}) {
  if (!GEMINI_KEY) throw new Error('GEMINI_API_KEY not set — cannot Gemini-OCR');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_OCR_MODEL}:generateContent?key=${GEMINI_KEY}`;
  const body = {
    contents: [{
      parts: [
        { text: OCR_PROMPT },
        { inline_data: { mime_type: mimeType, data: pngBuffer.toString('base64') } },
      ],
    }],
    // Gemini 2.5 is a thinking model — disable reasoning so it doesn't burn the
    // token budget / truncate a long transcription.
    generationConfig: { temperature: 0, maxOutputTokens: 8192, thinkingConfig: { thinkingBudget: 0 } },
  };
  // gemini-2.5-flash free tier is RPM-limited (~10/min). A 429 means "wait out
  // the minute" — back off in ~15s steps up to ~5 tries so a burst recovers
  // rather than failing the page.
  let lastErr;
  const MAX = 5;
  for (let attempt = 0; attempt < MAX; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: AbortSignal.timeout(120000),
      });
      if (!res.ok) {
        const txt = (await res.text()).slice(0, 200);
        if (res.status === 429) { lastErr = new Error(`gemini 429: ${txt}`); await new Promise(r => setTimeout(r, 16000 * (attempt + 1))); continue; }
        if (res.status >= 500) { lastErr = new Error(`gemini ${res.status}`); await new Promise(r => setTimeout(r, 3000 * (attempt + 1))); continue; }
        throw new Error(`gemini ${res.status}: ${txt}`);
      }
      const data = await res.json();
      const parts = data.candidates?.[0]?.content?.parts || [];
      return parts.map(p => p.text || '').join('').trim();
    } catch (e) { lastErr = e; if (attempt < MAX - 1) await new Promise(r => setTimeout(r, 4000 * (attempt + 1))); }
  }
  throw lastErr || new Error('gemini OCR failed');
}

module.exports = { transcribeImage, GEMINI_OCR_MODEL };
