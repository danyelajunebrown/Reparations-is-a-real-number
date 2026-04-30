/**
 * Google Apps Script — Reparations Intake Form webhook
 *
 * Forwards each Form submission to https://reparations-platform.onrender.com/api/intake/submit
 * with the X-Webhook-Secret header. Bound to the SPREADSHEET (not the
 * Form) so the trigger event carries `e.values` as a positional array
 * matching the sheet's column order — required because the form has
 * multiple columns literally titled "Full legal name" and header-text
 * keying collapses the duplicates.
 *
 * Deploy steps:
 *   1. Open the spreadsheet that collects the form's responses
 *      (Form editor → Responses tab → spreadsheet icon → opens the linked sheet)
 *   2. In that spreadsheet: Extensions → Apps Script
 *   3. Replace any existing Code.gs contents with this file's contents
 *   4. Tools → Project settings → Script properties → ADD:
 *        INTAKE_WEBHOOK_SECRET = <the secret from .env>
 *      (Adding it as a Script Property keeps it out of the source code
 *       and survives any future code edits.)
 *   5. Triggers (left sidebar clock icon) → Add Trigger:
 *        Function:        forwardToWebhook
 *        Event source:    From spreadsheet
 *        Event type:      On form submit
 *      Save. (You'll be prompted to authorize — accept.)
 *   6. Test: open Run menu → forwardToWebhook (it'll fail because
 *      there's no event, but the test below covers it).
 *   7. Real test: submit one form response. Watch Apps Script Executions
 *      tab — should show success. Confirm in DB that participants table
 *      gained one row with intake_source='google_form_webhook'.
 *
 * If the column layout changes: this script doesn't need updating —
 * src/api/routes/intake.js FORM_COLUMNS is the source of truth. We just
 * forward the positional array.
 */

const ENDPOINT = 'https://reparations-platform.onrender.com/api/intake/submit';

// Reads the per-script secret. Set via Apps Script UI → Project Settings →
// Script Properties. Avoids ever putting the secret into the source.
function getSecret_() {
  const s = PropertiesService.getScriptProperties().getProperty('INTAKE_WEBHOOK_SECRET');
  if (!s) throw new Error('INTAKE_WEBHOOK_SECRET script property not set. See deploy step 4.');
  return s;
}

/**
 * Trigger function — invoked on each form submit.
 *
 * @param {Object} e — The "On form submit" event object from a spreadsheet-bound trigger.
 *   e.values is the positional array of all column values for the new row,
 *   indexed identically to the sheet header row.
 *   e.range is the Range that was inserted.
 *   e.namedValues is keyed by header text (unreliable when headers repeat).
 */
function forwardToWebhook(e) {
  if (!e || !e.values) {
    Logger.log('forwardToWebhook called without e.values — likely manual run, not real submit');
    return;
  }

  const payload = {
    values: e.values,
    submitted_at: new Date().toISOString(),
    source: 'google_apps_script_v1',
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'X-Webhook-Secret': getSecret_(),
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,  // we want to see non-2xx responses, not throw
  };

  let response;
  try {
    response = UrlFetchApp.fetch(ENDPOINT, options);
  } catch (err) {
    Logger.log('Network error: ' + err);
    // Re-throw so Apps Script logs it as a failed execution and the user
    // gets an email if they configured trigger failure notifications.
    throw err;
  }

  const code = response.getResponseCode();
  const body = response.getContentText();
  Logger.log('Webhook response: HTTP ' + code + ' — ' + body.slice(0, 500));

  if (code < 200 || code >= 300) {
    throw new Error('Webhook returned non-2xx: HTTP ' + code + ' — ' + body.slice(0, 200));
  }
}

/**
 * One-shot manual replay tool — useful for back-filling earlier form
 * responses that arrived BEFORE the trigger was deployed.
 *
 * Run: Apps Script editor → Run menu → replayAllResponses.
 *
 * Iterates every row in the Form Responses sheet (skipping the header
 * row) and POSTs each one to the webhook. The endpoint is idempotent —
 * it suppresses duplicates by full_name + email + intake_source —
 * so re-running this is safe even after partial success.
 */
function replayAllResponses() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) {
    Logger.log('No data rows to replay');
    return;
  }
  const headers = data[0];
  Logger.log('Header row has ' + headers.length + ' columns; will replay ' + (data.length - 1) + ' submissions');

  let ok = 0, fail = 0;
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    try {
      forwardToWebhook({ values: row });
      ok++;
    } catch (err) {
      fail++;
      Logger.log('Row ' + (i + 1) + ' failed: ' + err);
    }
    // Throttle: ~1 req/sec to stay nice to the endpoint
    Utilities.sleep(1000);
  }
  Logger.log('Replay done: ok=' + ok + ' fail=' + fail);
}

/**
 * Diagnostic helper — runs a no-data POST to confirm the endpoint
 * answers and the secret is correct. Apps Script editor → Run menu →
 * pingWebhook.
 *
 * Expected: "HTTP 400 — full_name required" (because we sent no values).
 * That tells us auth passed and routing works.
 */
function pingWebhook() {
  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: { 'X-Webhook-Secret': getSecret_() },
    payload: JSON.stringify({ values: [] }),
    muteHttpExceptions: true,
  };
  const r = UrlFetchApp.fetch(ENDPOINT, options);
  Logger.log('Ping: HTTP ' + r.getResponseCode() + ' — ' + r.getContentText());
}
