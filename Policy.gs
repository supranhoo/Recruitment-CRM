/**
 * Policy library and policy search (Admin > Policies; page "Policy search"). All policies live in one Drive folder.
 * The browser reads the file and cuts it into passages (section, page, text); the server stores them, builds the search
 * terms and ranks passages for a question (BM25, no AI). v162 finds and shows the passages only. Nothing here sends
 * policy text anywhere, and no recruitment data is ever stored in these sheets.
 */
const POLICY_FOLDER_NAME_ = 'Policies';
const POLICY_DOCS_ = { name: 'Policy_Docs', id: 'Doc_ID', prefix: 'POL-', width: 4 };
const POLICY_DOC_COLS_ = ['Doc_ID', 'Title', 'Version_Label', 'Effective_From', 'Status', 'File_ID', 'File_Name', 'Chars', 'Chunks', 'Text_Hash', 'Replaces', 'Note', 'Uploaded_By', 'Uploaded_At', 'Updated_By', 'Updated_At'];
const POLICY_CHUNK_COLS_ = ['Chunk_ID', 'Doc_ID', 'Seq', 'Section', 'Page', 'Text', 'Terms', 'Status'];
const POLICY_QUERY_COLS_ = ['Query_ID', 'Asked_By', 'Asked_At', 'Question', 'Outcome', 'Doc_IDs', 'Chunk_IDs', 'Answer', 'Tokens_In', 'Tokens_Out', 'Feedback'];
const POLICY_CHUNK_MIN_ = 20;
const POLICY_CHUNK_MAX_ = 1800;
const POLICY_PART_MAX_ = 40;
const POLICY_DOC_MAX_CHUNKS_ = 1500;
const POLICY_MIN_TEXT_ = 200;
const POLICY_Q_MAX_ = 500;
const POLICY_STOP_ = ('a an and are as at be been but by can could did do does for from had has have how i if in into is it its may me my no not of on or our shall should so than that the their them then there these they this to us was we were what when where which who whom why will with would you your ' +
  'about any all also am per via').split(/\s+/);
/** Words that mean the same thing for a question about HR policy. A question word also searches its partners. */
const POLICY_SYNONYMS_ = [['notice', 'resignation', 'relieving'], ['wfh', 'work from home', 'remote'], ['joining', 'doj', 'join'], ['backout', 'drop out', 'withdraw'],
  ['salary', 'ctc', 'compensation'], ['leave', 'absence'], ['probation', 'confirmation'], ['referral', 'refer'], ['tat', 'turnaround', 'turn around']];

function policyFolder_() {
  const s = settings_();
  if (s.POLICY_FOLDER_ID) {
    try { const f = DriveApp.getFolderById(s.POLICY_FOLDER_ID); if (!f.isTrashed()) return f; } catch (e) { }
  }
  if (!s.CV_FOLDER_ID) throw new Error('The documents folder is not set. Ask the admin to run setup().');
  const parent = DriveApp.getFolderById(s.CV_FOLDER_ID);
  const it = parent.getFoldersByName(POLICY_FOLDER_NAME_);
  const folder = it.hasNext() ? it.next() : parent.createFolder(POLICY_FOLDER_NAME_);
  setSetting_('POLICY_FOLDER_ID', folder.getId(), 'Single Drive folder for all policy documents. Add and replace policies in Admin > Policies.');
  return folder;
}

function policySchema_() {
  const fresh = function (name) { return !ss_().getSheetByName(name); };
  const nd = fresh(POLICY_DOCS_.name), nc = fresh('Policy_Chunks'), nq = fresh('Policy_Queries');
  addSheet_(POLICY_DOCS_.name, POLICY_DOC_COLS_);
  addSheet_('Policy_Chunks', POLICY_CHUNK_COLS_);
  addSheet_('Policy_Queries', POLICY_QUERY_COLS_);
  const plain = function (name, cols, headers) {
    const sh = ss_().getSheetByName(name);
    cols.forEach(function (c) { sh.getRange(2, headers.indexOf(c) + 1, Math.max(1, sh.getMaxRows() - 1), 1).setNumberFormat('@'); });
  };
  try {
    if (nc) plain('Policy_Chunks', ['Section', 'Text', 'Terms'], POLICY_CHUNK_COLS_);
    if (nq) plain('Policy_Queries', ['Question'], POLICY_QUERY_COLS_);
    if (nd) plain(POLICY_DOCS_.name, ['Title', 'Version_Label', 'Note'], POLICY_DOC_COLS_);
  } catch (e) { }
}

/* ---------------------------------------------------------------- words (pure) ------------------------------------------------- */

/** One word reduced to a root, the same way for policy text and for questions. */
function policyStem_(w) {
  w = String(w).toLowerCase();
  if (w.length <= 3 || /^\d/.test(w)) return w;
  if (/ies$/.test(w) && w.length > 4) return w.slice(0, -3) + 'y';
  if (/sses$/.test(w)) return w.slice(0, -2);
  if (/(ing)$/.test(w) && w.length > 5) return w.slice(0, -3);
  if (/(ed)$/.test(w) && w.length > 4) return w.slice(0, -2);
  if (/ly$/.test(w) && w.length > 5) return w.slice(0, -2);
  if (/s$/.test(w) && !/(ss|us|is)$/.test(w)) return w.slice(0, -1);
  return w;
}
/** Search roots of a text, stop words removed. Clause numbers such as 9.5 stay whole. Duplicates are kept (they carry the frequency). */
function policyTokens_(text) {
  const out = [];
  (String(text == null ? '' : text).toLowerCase().match(/[a-z0-9]+(?:\.[0-9]+)*/g) || []).forEach(function (w) {
    if (w.length < 2 && !/^\d$/.test(w)) return;
    if (POLICY_STOP_.indexOf(w) >= 0) return;
    out.push(policyStem_(w));
  });
  return out;
}
/** Parses the optional Setting POLICY_SYNONYMS: "notice=resignation,relieving; wfh=work from home". Returns lists of partner words. */
function policySynonymLists_(settingText) {
  const lists = POLICY_SYNONYMS_.map(function (l) { return l.slice(); });
  String(settingText || '').split(';').forEach(function (g) {
    const p = g.split('='); if (p.length !== 2) return;
    const l = [p[0]].concat(p[1].split(',')).map(function (x) { return x.trim().toLowerCase(); }).filter(Boolean);
    if (l.length > 1) lists.push(l);
  });
  return lists;
}
/** Query roots with weights: the asked word counts 1, a synonym counts 0.6. */
function policyQueryTerms_(question, synLists) {
  const q = String(question || '').toLowerCase(), terms = {};
  policyTokens_(q).forEach(function (t) { terms[t] = 1; });
  (synLists || []).forEach(function (list) {
    const hit = list.some(function (w) { return new RegExp('(^|[^a-z0-9])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z0-9]|$)').test(q); });
    if (!hit) return;
    list.forEach(function (w) { policyTokens_(w).forEach(function (t) { if (!terms[t]) terms[t] = 0.6; }); });
  });
  return terms;
}

/**
 * Ranks passages for a question. chunks: [{id, terms:'root root …', section}] (terms keep duplicates). Returns the best first:
 * [{id, score, matched}]. BM25 over the roots, plus a bonus when a root appears in the section label. No model, no network.
 */
function policyRank_(qTerms, chunks, titleOf) {
  const N = chunks.length; if (!N) return [];
  const docs = chunks.map(function (c) { const t = String(c.terms || '').split(' ').filter(Boolean), tf = {}; t.forEach(function (w) { tf[w] = (tf[w] || 0) + 1; }); return { c: c, tf: tf, len: t.length }; });
  const avg = docs.reduce(function (s, d) { return s + d.len; }, 0) / N || 1, df = {};
  Object.keys(qTerms).forEach(function (t) { df[t] = docs.filter(function (d) { return d.tf[t]; }).length; });
  const k1 = 1.5, b = 0.75;
  return docs.map(function (d) {
    let score = 0, matched = 0;
    const sec = policyTokens_(d.c.section || '');
    Object.keys(qTerms).forEach(function (t) {
      const f = d.tf[t] || 0; if (!f) { if (sec.indexOf(t) >= 0) { score += 0.5 * qTerms[t]; matched++; } return; }
      matched += /^\d+\.\d+/.test(t) ? 2 : 1;
      const idf = Math.log(1 + (N - df[t] + 0.5) / (df[t] + 0.5));
      score += qTerms[t] * idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + b * d.len / avg)));
      if (sec.indexOf(t) >= 0) score += 0.8 * qTerms[t];
    });
    return { id: d.c.id, score: Math.round(score * 100) / 100, matched: matched };
  }).filter(function (r) { return r.score > 0; }).sort(function (a, b2) { return b2.score - a.score; });
}
/** The "not covered" gate: enough of the question's own words must be found, with a good enough score. */
function policyGate_(ranked, qTerms, minScore) {
  const asked = Object.keys(qTerms).filter(function (t) { return qTerms[t] === 1; }).length;
  if (!asked) return { ok: false, why: 'Write the question with a few words from the policy.' };
  if (!ranked.length) return { ok: false, why: 'No passage in the policy documents matches.' };
  const best = ranked[0], need = Math.min(2, asked);
  if (best.matched < need) return { ok: false, why: 'Only one word of the question was found, which is too little to be sure.' };
  if (best.score < minScore) return { ok: false, why: 'The closest passage does not match well enough.' };
  return { ok: true, why: '' };
}
/** A question must not carry a mobile number or an e-mail address (policy search takes no personal data). */
function policyQuestionCheck_(q) {
  const s = String(q == null ? '' : q).trim();
  if (s.length < 5) throw new Error('Write the question in a few words.');
  if (s.length > POLICY_Q_MAX_) throw new Error('Keep the question under ' + POLICY_Q_MAX_ + ' characters.');
  if (/@/.test(s) || /(?<!\d)(?:\+?91[\s-]?)?[6-9](?:[\s-]?\d){9}(?!\d)/.test(s)) throw new Error('Do not type a phone number or e-mail address. Ask about the rule, not about a person.');
  return s;
}

/* ---------------------------------------------------------------- reading the library ---------------------------------------------- */

function policyVer_() { return PropertiesService.getScriptProperties().getProperty('POLICY_VER') || '0'; }
function policyBump_() { PropertiesService.getScriptProperties().setProperty('POLICY_VER', String(Date.now())); }

function policyDocs_() {
  return readTable_(POLICY_DOCS_.name, true).rows.map(function (r) {
    return { id: String(r.Doc_ID), title: String(r.Title || ''), version: String(r.Version_Label || ''), eff: ymd_(r.Effective_From), status: String(r.Status || ''), fileId: String(r.File_ID || ''),
      fileName: String(r.File_Name || ''), chars: Number(r.Chars) || 0, chunks: Number(r.Chunks) || 0, replaces: String(r.Replaces || ''), note: String(r.Note || ''),
      by: String(r.Uploaded_By || ''), at: r.Uploaded_At instanceof Date ? fmt_(r.Uploaded_At, TZ, 'd MMM yyyy, HH:mm') : '' };
  }).sort(function (a, b) { return a.id < b.id ? 1 : -1; });
}

/** The search index of live passages: cached by library version. Only roots and labels are cached; text is read for the few that win. */
function policyIndex_() {
  const key = 'POLICY_IDX_' + policyVer_(), got = cacheBigGet_(key);
  if (got) { try { return JSON.parse(got); } catch (e) { } }
  const live = {}; policyDocs_().forEach(function (d) { if (d.status === 'Active') live[d.id] = true; });
  const idx = readTable_('Policy_Chunks', true).rows.filter(function (c) { return String(c.Status) === 'Active' && live[String(c.Doc_ID)]; })
    .map(function (c) { return { id: String(c.Chunk_ID), doc: String(c.Doc_ID), section: String(c.Section || ''), page: Number(c.Page) || 0, terms: String(c.Terms || '') }; });
  const s = JSON.stringify(idx);
  if (s.length < 3500000) cacheBigPut_(key, s, 21600);
  return idx;
}

function policyAsk_(u) { if (!can_(u, 'policy_ask')) throw new Error('You do not have access to the policy search.'); }
function policyManage_(u) { if (!can_(u, 'policy_manage')) throw new Error('Only the Head of HR or the admin can manage the policy documents.'); }

/* ---------------------------------------------------------------- Admin: add, replace, withdraw ----------------------------------- */

function apiPolicyList() {
  const u = currentUser_(); ensureSchema_(); policyManage_(u);
  const folder = policyFolder_(), q = readTable_('Policy_Queries', true).rows;
  const miss = q.filter(function (r) { return String(r.Outcome) === 'Not covered'; }).slice(-30).reverse().map(function (r) { return { q: String(r.Question || ''), by: String(r.Asked_By || ''), at: r.Asked_At instanceof Date ? fmt_(r.Asked_At, TZ, 'd MMM yyyy') : '' }; });
  return { folderUrl: folder.getUrl(), docs: policyDocs_().map(function (d) { d.url = d.fileId ? 'https://drive.google.com/file/d/' + d.fileId + '/view' : ''; return d; }), notCovered: miss, asked: q.length };
}

/** Begins an upload. The file is saved to the policy folder; the passages follow in parts. */
function apiPolicyStart(meta) {
  const u = currentUser_(); ensureSchema_(); policyManage_(u);
  meta = meta || {};
  const title = clean_(String(meta.title || '')).trim().slice(0, 120), version = clean_(String(meta.version || '')).trim().slice(0, 30), note = clean_(String(meta.note || '')).trim().slice(0, 300);
  if (title.length < 3) throw new Error('Give the policy a title.');
  const eff = ymd_(meta.eff); if (!eff) throw new Error('Pick the date the policy takes effect.');
  if (eff > ymd_(new Date())) throw new Error('Pick today or an earlier date. A policy goes live as soon as it is added.');
  const chars = Number(meta.chars) || 0;
  if (chars < POLICY_MIN_TEXT_) throw new Error('Almost no text could be read from this file (' + chars + ' characters). If it is a scan, try a clearer copy or a Word file.');
  const replaces = String(meta.replaces || '');
  if (replaces && !policyDocs_().some(function (d) { return d.id === replaces && d.status === 'Active'; })) throw new Error('The policy to replace was not found or is no longer active.');
  let fileId = '', fileName = String(meta.fileName || '').slice(0, 150);
  if (meta.base64) {
    if (DOC_TYPES.indexOf(String(meta.mime)) < 0) throw new Error('Attach the file as PDF or Word.');
    const ext = (fileName.match(/\.[a-z0-9]+$/i) || [''])[0], safe = (title + ' ' + version).replace(/[\\/:*?"<>|]/g, '-').trim().slice(0, 120) + ' - ' + fmt_(new Date(), TZ, 'yyyyMMdd-HHmm') + ext;
    const file = policyFolder_().createFile(Utilities.newBlob(Utilities.base64Decode(meta.base64), String(meta.mime), safe));
    fileId = file.getId(); fileName = safe;
  }
  const rec = insert_(POLICY_DOCS_, { Title: title, Version_Label: version, Effective_From: parseYmd_(eff), Status: 'Indexing', File_ID: fileId, File_Name: fileName, Chars: chars, Chunks: 0,
    Text_Hash: String(meta.hash || '').slice(0, 64), Replaces: replaces, Note: note, Uploaded_By: u.email, Uploaded_At: new Date() }, u);
  return { docId: rec.Doc_ID };
}

function policyChunkRows_(docId, title, seqStart, chunks) {
  return chunks.map(function (c, i) {
    const text = clean_(String(c.text == null ? '' : c.text)).replace(/\s+/g, ' ').trim(), section = clean_(String(c.section || '')).trim().slice(0, 60);
    if (text.length < POLICY_CHUNK_MIN_ || text.length > POLICY_CHUNK_MAX_) throw new Error('A passage has ' + text.length + ' characters; it must be ' + POLICY_CHUNK_MIN_ + ' to ' + POLICY_CHUNK_MAX_ + '.');
    const page = Math.max(0, Math.min(2000, Math.round(Number(c.page) || 0))), seq = seqStart + i;
    const terms = policyTokens_(title + ' ' + section + ' ' + text).join(' ');
    return [docId + '-C' + ('0000' + seq).slice(-4), docId, seq, section, page, text, terms, 'Indexing'];
  });
}

/** One batch of passages. Held as Indexing until Finish. */
function apiPolicyPart(docId, seqStart, chunks) {
  const u = currentUser_(); policyManage_(u);
  chunks = chunks || [];
  if (!chunks.length || chunks.length > POLICY_PART_MAX_) throw new Error('Send between 1 and ' + POLICY_PART_MAX_ + ' passages at a time.');
  seqStart = Math.max(1, Math.round(Number(seqStart) || 1));
  if (seqStart + chunks.length - 1 > POLICY_DOC_MAX_CHUNKS_) throw new Error('This policy has too many passages (limit ' + POLICY_DOC_MAX_CHUNKS_ + ').');
  return withLock_(function () {
    const d = readTable_(POLICY_DOCS_.name, true).rows.filter(function (r) { return String(r.Doc_ID) === String(docId); })[0];
    if (!d || String(d.Status) !== 'Indexing') throw new Error('This upload is not open. Start again.');
    if (String(d.Uploaded_By).toLowerCase() !== u.email.toLowerCase()) throw new Error('Another person started this upload.');
    const rows = policyChunkRows_(String(docId), String(d.Title), seqStart, chunks);
    const sh = sheet_('Policy_Chunks');
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, POLICY_CHUNK_COLS_.length).setValues(rows);
    return { written: rows.length };
  });
}

/** Makes the new policy live and retires the one it replaces. Nothing is deleted. */
function apiPolicyFinish(docId) {
  const u = currentUser_(); policyManage_(u);
  const result = withLock_(function () {
    const docs = readTable_(POLICY_DOCS_.name, true), d = docs.rows.filter(function (r) { return String(r.Doc_ID) === String(docId); })[0];
    if (!d || String(d.Status) !== 'Indexing') throw new Error('This upload is not open. Start again.');
    const ch = readTable_('Policy_Chunks', true), mine = ch.rows.filter(function (c) { return String(c.Doc_ID) === String(docId); });
    if (!mine.length) throw new Error('No passages were received. Start again.');
    const sc = ch.headers.indexOf('Status') + 1, replaces = String(d.Replaces || '');
    mine.forEach(function (c) { ch.sheet.getRange(c._row, sc).setValue('Active'); });
    if (replaces) ch.rows.filter(function (c) { return String(c.Doc_ID) === replaces && String(c.Status) === 'Active'; }).forEach(function (c) { ch.sheet.getRange(c._row, sc).setValue('Superseded'); });
    dropStale_('Policy_Chunks');
    return { n: mine.length, replaces: replaces };
  });
  update_(POLICY_DOCS_, docId, { Status: 'Active', Chunks: result.n }, u);
  if (result.replaces) update_(POLICY_DOCS_, result.replaces, { Status: 'Superseded' }, u);
  policyBump_();
  return { chunks: result.n };
}

function apiPolicyWithdraw(docId, reason) {
  const u = currentUser_(); ensureSchema_(); policyManage_(u);
  reason = clean_(String(reason || '')).trim();
  if (reason.length < 10) throw new Error('Say why this policy is withdrawn, in at least 10 characters.');
  const d = policyDocs_().filter(function (x) { return x.id === String(docId); })[0];
  if (!d) throw new Error('That policy was not found.');
  if (d.status === 'Withdrawn') return { ok: true };
  withLock_(function () {
    const ch = readTable_('Policy_Chunks', true), sc = ch.headers.indexOf('Status') + 1;
    ch.rows.filter(function (c) { return String(c.Doc_ID) === String(docId) && ['Active', 'Indexing'].indexOf(String(c.Status)) >= 0; }).forEach(function (c) { ch.sheet.getRange(c._row, sc).setValue('Withdrawn'); });
    dropStale_('Policy_Chunks');
  });
  update_(POLICY_DOCS_, docId, { Status: 'Withdrawn', Note: (d.note ? d.note + ' | ' : '') + 'Withdrawn: ' + reason.slice(0, 200) }, u);
  policyBump_();
  return { ok: true };
}

/* ---------------------------------------------------------------- search (everyone signed in) ------------------------------------- */

function policyLog_(u, question, outcome, docIds, chunkIds) {
  try {
    withLock_(function () {
      const sh = sheet_('Policy_Queries'), n = Math.max(0, sh.getLastRow() - 1) + 1;
      sh.getRange(sh.getLastRow() + 1, 1, 1, POLICY_QUERY_COLS_.length).setValues([['PQ-' + ('00000' + n).slice(-5), u.email, new Date(), clean_(question), outcome, docIds.join(','), chunkIds.join(','), '', '', '', '']]);
    });
  } catch (e) { }
}

/** Passages that answer a question, best first, or a plain "not covered". No AI is used. */
function apiPolicySearch(question) {
  const u = currentUser_(); ensureSchema_(); policyAsk_(u);
  const q = policyQuestionCheck_(question), s = settings_();
  const minScore = Number(s.POLICY_MIN_SCORE) || 1.5, topK = Math.max(1, Math.min(10, Number(s.POLICY_TOP_K) || 6));
  const idx = policyIndex_();
  if (!idx.length) return { state: 'empty', why: 'No policy has been added yet. Ask the Head of HR or the admin to add one in Admin > Policies.', passages: [] };
  const qTerms = policyQueryTerms_(q, policySynonymLists_(s.POLICY_SYNONYMS)), ranked = policyRank_(qTerms, idx), gate = policyGate_(ranked, qTerms, minScore);
  if (!gate.ok) { policyLog_(u, q, 'Not covered', [], []); return { state: 'none', why: gate.why + ' The policy documents do not cover this. Ask HR.', passages: [] }; }
  const top = ranked.slice(0, topK), ids = {}; top.forEach(function (r) { ids[r.id] = r; });
  const docs = {}; policyDocs_().forEach(function (d) { docs[d.id] = d; });
  const passages = readTable_('Policy_Chunks').rows.filter(function (c) { return ids[String(c.Chunk_ID)]; }).map(function (c) {
    const d = docs[String(c.Doc_ID)] || {}, r = ids[String(c.Chunk_ID)];
    return { chunk: String(c.Chunk_ID), doc: String(c.Doc_ID), title: d.title || '', version: d.version || '', eff: d.eff || '', section: String(c.Section || ''), page: Number(c.Page) || 0, text: String(c.Text || ''), score: r.score, matched: r.matched };
  }).sort(function (a, b) { return b.score - a.score; });
  policyLog_(u, q, 'Searched', passages.map(function (p) { return p.doc; }).filter(function (x, i, a) { return a.indexOf(x) === i; }), passages.map(function (p) { return p.chunk; }));
  return { state: 'found', passages: passages, words: Object.keys(qTerms).length };
}
