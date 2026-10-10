/**
 * Voice webhook receiver for the BFCL Recruitment CRM (ADR-048).
 *
 * A SEPARATE, tiny Apps Script project. The voice provider POSTs each call's result here; this script checks the secret in the
 * address, then appends ONE row to the "Voice_Inbox" sheet of the CRM's spreadsheet. It has no screens, reads nothing from the
 * CRM and returns nothing but "ok". The CRM reads the inbox and records each result on its call.
 *
 * Script properties (Project settings > Script properties), never in the code:
 *   WEBHOOK_SECRET  a long random string; the provider's webhook address is  <web app url>?key=<WEBHOOK_SECRET>
 *   SHEET_ID        the id of the CRM spreadsheet (the long id in its address)
 */
var INBOX_ = 'Voice_Inbox';
var INBOX_COLS_ = ['Received_At', 'Attempt_ID', 'Event_Key', 'Payload', 'Processed_At', 'Result'];
var MAX_CELL_ = 45000;

function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
/** Compares two strings in constant time, so the secret cannot be guessed one character at a time. */
function same_(a, b) {
  a = String(a || ''); b = String(b || '');
  var d = a.length ^ b.length;
  for (var i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0;
}

function doGet() { return ContentService.createTextOutput('ok'); }

function doPost(e) {
  var props = PropertiesService.getScriptProperties();
  var secret = props.getProperty('WEBHOOK_SECRET'), sheetId = props.getProperty('SHEET_ID');
  if (!secret || secret.length < 20 || !sheetId) return out_({ ok: false, error: 'not set up' });
  if (!e || !e.parameter || !same_(e.parameter.key, secret)) return out_({ ok: false });
  var raw = e.postData && e.postData.contents ? String(e.postData.contents) : '';
  var p;
  try { p = JSON.parse(raw); } catch (err) { return out_({ ok: false, error: 'not json' }); }
  if (!p || !p.attempt_id) return out_({ ok: false, error: 'no attempt_id' });
  // A cell holds about 50,000 characters: drop the end of a very long transcript rather than lose the result.
  var text = JSON.stringify(p);
  if (text.length > MAX_CELL_ && Array.isArray(p.interaction_transcript)) {
    while (text.length > MAX_CELL_ && p.interaction_transcript.length) { p.interaction_transcript.pop(); text = JSON.stringify(p); }
  }
  if (text.length > MAX_CELL_) text = text.slice(0, MAX_CELL_);
  var key = String(p.attempt_id) + ':' + (p.retry_attempt || 0) + ':' + String(p.status || p.completion_status || '');
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var ss = SpreadsheetApp.openById(sheetId), sh = ss.getSheetByName(INBOX_);
    if (!sh) {
      sh = ss.insertSheet(INBOX_);
      sh.getRange(1, 1, 1, INBOX_COLS_.length).setValues([INBOX_COLS_]).setFontWeight('bold');
      sh.setFrozenRows(1);
    }
    var last = sh.getLastRow();
    if (last > 1) {   // providers retry: skip a result that is already in the last 200 rows
      var from = Math.max(2, last - 199), keys = sh.getRange(from, 3, last - from + 1, 1).getValues();
      for (var i = 0; i < keys.length; i++) if (String(keys[i][0]) === key) return out_({ ok: true, duplicate: true });
    }
    sh.appendRow([new Date(), String(p.attempt_id), key, text, '', '']);
  } finally { lock.releaseLock(); }
  return out_({ ok: true });
}
