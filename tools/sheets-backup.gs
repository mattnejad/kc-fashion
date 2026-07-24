/**
 * Kinsey Cathers Fashion — Google Sheets backup receiver
 * =====================================================
 * Keeps a Google Sheet mirroring the app, as a human-readable redundancy.
 *
 * SETUP (one time, ~5 minutes):
 *  1. Open the Google Sheet you want the backup written into.
 *  2. Extensions → Apps Script. Delete whatever is in the editor.
 *  3. Paste this entire file in.
 *  4. Replace PASTE_TOKEN_HERE below with the token shown in the app
 *     (☰ menu → Google Sheets backup).
 *  5. Deploy → New deployment → type "Web app".
 *       Execute as:      Me
 *       Who has access:  Anyone
 *     (“Anyone” means anyone with the unguessable URL — the token below is
 *      what actually authorises writes. Nobody can read your sheet with it.)
 *  6. Authorise when prompted, then copy the Web app URL.
 *  7. Paste that URL into the app (same menu screen) and hit "Test & save".
 *
 * The app then rewrites these tabs on every change: Purchases, Payments,
 * Hours, Clients, Sales Associates, Shipments — plus a "Backup Info" tab
 * with the timestamp of the last sync.
 *
 * NOTE: photos and receipt images are NOT included. A Sheets cell holds at
 * most 50,000 characters and an image is far larger. Use the app's
 * ☰ menu → Export backup (.json) for a copy that includes images.
 */

var SHARED_TOKEN = 'PASTE_TOKEN_HERE';

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    if (!SHARED_TOKEN || SHARED_TOKEN === 'PASTE_TOKEN_HERE') {
      return json({ ok: false, error: 'Set SHARED_TOKEN in the script first.' });
    }
    if (body.token !== SHARED_TOKEN) {
      return json({ ok: false, error: 'Bad token' });
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheets = body.sheets || {};
    Object.keys(sheets).forEach(function (name) {
      writeSheet(ss, name, sheets[name].headers || [], sheets[name].rows || []);
    });

    var info = ss.getSheetByName('Backup Info') || ss.insertSheet('Backup Info');
    info.clear();
    info.getRange(1, 1, 4, 2).setValues([
      ['Last backup', new Date()],
      ['Source', 'Kinsey Cathers Fashion app'],
      ['Tabs written', Object.keys(sheets).join(', ')],
      ['Note', 'Photos and receipts are not included (Sheets cell size limit). Use the app\'s JSON export for those.']
    ]);
    info.getRange(1, 1, 4, 1).setFontWeight('bold');
    info.autoResizeColumns(1, 2);

    return json({ ok: true, at: new Date().toISOString() });
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

/** Lets the app verify the URL is live before saving it. */
function doGet() {
  return json({ ok: true, ping: true });
}

function writeSheet(ss, name, headers, rows) {
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  sh.clear();
  if (!headers.length) return;

  var data = [headers].concat(rows);
  var width = headers.length;
  var normalized = data.map(function (r) {
    var row = (r || []).slice(0, width);
    while (row.length < width) row.push('');
    return row.map(function (c) { return (c === null || c === undefined) ? '' : c; });
  });

  sh.getRange(1, 1, normalized.length, width).setValues(normalized);
  sh.getRange(1, 1, 1, width).setFontWeight('bold');
  sh.setFrozenRows(1);
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
