/**
 * One-time: builds the database Google Sheet from the migrated data in Data.gs
 * (DATA_B64 = gzip + base64 of every tab). Run importDatabase(), then setup().
 * After a successful import you can delete Data.gs.
 */
function importDatabase() {
  if (PropertiesService.getScriptProperties().getProperty('DB_ID')) {
    throw new Error('A database was already imported (Script Properties → DB_ID). Delete that property first to import again.');
  }
  const json = Utilities.ungzip(Utilities.newBlob(Utilities.base64Decode(DATA_B64), 'application/x-gzip')).getDataAsString('UTF-8');
  const data = JSON.parse(json);
  const ss = SpreadsheetApp.create('BFCL Recruitment CRM - Database');
  const first = ss.getSheets()[0];
  data.order.forEach(function (name, i) {
    const rows = data.sheets[name];
    const width = rows[0].length;
    const values = rows.map(function (r) {
      const out = [];
      for (let j = 0; j < width; j++) out.push(importValue_(r[j]));
      return out;
    });
    const sh = i === 0 ? first.setName(name) : ss.insertSheet(name);
    if (sh.getMaxRows() < values.length + 1) sh.insertRowsAfter(sh.getMaxRows(), values.length + 1 - sh.getMaxRows());
    if (sh.getMaxColumns() < width) sh.insertColumnsAfter(sh.getMaxColumns(), width - sh.getMaxColumns());
    for (let j = 0; j < width; j++) {
      let textOnly = true, any = false;
      for (let k = 1; k < values.length; k++) {
        const v = values[k][j];
        if (v === '') continue;
        any = true;
        if (typeof v !== 'string') { textOnly = false; break; }
      }
      if (any && textOnly) sh.getRange(2, j + 1, values.length, 1).setNumberFormat('@');
    }
    sh.getRange(1, 1, values.length, width).setValues(values);
    const extraCols = sh.getMaxColumns() - width;
    if (extraCols > 0) sh.deleteColumns(width + 1, extraCols);
    const extraRows = sh.getMaxRows() - Math.max(values.length, 1) - 50;
    if (extraRows > 0) sh.deleteRows(values.length + 51, extraRows);
    sh.getRange(1, 1, 1, width).setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#1F3A5F');
    sh.setFrozenRows(1);
    sh.getDataRange().setFontFamily('Arial');
  });
  PropertiesService.getScriptProperties().setProperty('DB_ID', ss.getId());
  Logger.log('Database created: ' + ss.getUrl());
  return ss.getUrl();
}

function importValue_(v) {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string') return v;
  const m = v.match(/^D:(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2}))?$/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  if (/^[=+@]/.test(v)) return "'" + v;
  if (/^-\D/.test(v)) return "'" + v;
  return v;
}
