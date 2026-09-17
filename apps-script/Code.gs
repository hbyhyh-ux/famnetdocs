/**
 * 팜넷 견적서·거래명세서 발행 원장
 * 구글 시트에 붙이는 Apps Script 웹앱
 *
 * 설치 순서는 함께 드린 '설치안내.md'를 참고하세요.
 */

/* ── 팀 공용 코드. 배포 전에 반드시 다른 값으로 바꾸세요 ── */
var TEAM_CODE = PropertiesService.getScriptProperties().getProperty('TEAM_CODE');

var SHEET_NAME = '발행기록';
var HEADERS = ['기록시각','문서번호','구분','발행일자','수신자','발행자','품목요약','총계','VAT','상세(JSON)','메모'];
var COL_JSON = 10;   // J열
var COL_MEMO = 11;   // K열

/* ───────── 진입점 ───────── */
function doPost(e) {
  var req;
  try { req = JSON.parse(e.postData.contents); }
  catch (err) { return out({ ok: false, error: '요청을 읽지 못했습니다' }); }

  if (!TEAM_CODE || req.code !== TEAM_CODE) return out({ ok: false, error: '팀 코드가 맞지 않습니다' });

  try {
    switch (req.action) {
      case 'ping':   return out({ ok: true });
      case 'issue':  return out(issueDoc(req.doc));
      case 'list':   return out({ ok: true, docs: listDocs() });
      case 'delete': return out(deleteDoc(req.no));
      case 'memo':   return out(saveMemo(req.no, req.note));
      case 'contacts':      return out({ ok: true, contacts: listContacts() });
      case 'contactSave':   return out(saveContact(req.contact));
      case 'contactDelete': return out(deleteContact(req.mgr));
      case 'seal':          return out(getCompanySeal());
      default:       return out({ ok: false, error: '알 수 없는 요청입니다' });
    }
  } catch (err) {
    return out({ ok: false, error: String(err) });
  }
}

function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('팜넷 문서발행 시스템')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/* ───────── 화면에서 직접 호출하는 함수 (google.script.run) ─────────
   같은 웹앱이 화면을 띄우므로 팀 코드나 URL 입력이 필요 없습니다. */
function uiPing()        { return { ok: true }; }
function uiIssue(doc)    { return issueDoc(doc); }
function uiList()        { return { ok: true, docs: listDocs() }; }
function uiDelete(no)    { return deleteDoc(no); }
function uiMemo(payload) { return saveMemo(payload.no, payload.note); }
function uiContacts()          { return { ok: true, contacts: listContacts() }; }
function uiContactSave(c)      { return saveContact(c); }
function uiContactDelete(mgr)  { return deleteContact(mgr); }
function uiSeal()              { return getCompanySeal(); }

function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ───────── 회사 공용 도장 ─────────
   스크립트 속성 SEAL_FILE_ID에 저장된 Google Drive 파일을 내려준다.
   인감 이미지 자체는 공개 GitHub 저장소에 넣지 않는다. */
function getCompanySeal() {
  var fileId = PropertiesService.getScriptProperties().getProperty('SEAL_FILE_ID');
  if (!fileId) return { ok: true, seal: '' };

  var cache = CacheService.getScriptCache();
  var cached = cache.get('company-seal-v1');
  if (cached) return { ok: true, seal: cached };

  var blob = DriveApp.getFileById(fileId).getBlob();
  var dataUri = 'data:' + (blob.getContentType() || 'image/png') + ';base64,' +
    Utilities.base64Encode(blob.getBytes());
  cache.put('company-seal-v1', dataUri, 3600);
  return { ok: true, seal: dataUri };
}

/* ───────── 시트 준비 ───────── */
function getSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(HEADERS);
    sh.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold').setBackground('#1b2028').setFontColor('#ffffff');
    sh.setFrozenRows(1);
    sh.setColumnWidth(2, 150);
    sh.setColumnWidth(5, 160);
    sh.setColumnWidth(7, 260);
    sh.setColumnWidth(COL_MEMO, 320);
    sh.hideColumns(COL_JSON);
  } else if (sh.getLastColumn() < COL_MEMO) {
    // 이전 버전으로 만들어진 시트에 메모 열을 덧붙인다
    sh.getRange(1, COL_MEMO).setValue('메모')
      .setFontWeight('bold').setBackground('#1b2028').setFontColor('#ffffff');
    sh.setColumnWidth(COL_MEMO, 320);
  }
  return sh;
}

/* ───────── 발행: 채번은 잠금 구간 안에서만 ───────── */
function issueDoc(doc) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { ok: false, error: '다른 발행이 처리 중입니다. 잠시 뒤 다시 시도해 주세요' };

  try {
    var sh = getSheet();
    var prefix = prefixFor(doc.kind) + String(doc.date).replace(/-/g, '');

    // 같은 구분·같은 날짜의 마지막 번호를 찾아 이어붙인다
    var last = 0;
    var values = sh.getDataRange().getValues();
    for (var i = 1; i < values.length; i++) {
      var no = String(values[i][1]);
      if (no.indexOf(prefix + '-') === 0) {
        var n = parseInt(no.slice(prefix.length + 1), 10);
        if (!isNaN(n) && n > last) last = n;
      }
    }
    var docNo = prefix + '-' + ('00' + (last + 1)).slice(-3);

    var summary;
    if (doc.kind === 'cert') {
      summary = (doc.cert && doc.cert.item) ? doc.cert.item : '-';
    } else if (doc.kind === 'service' || doc.kind === 'purchase') {
      summary = (doc.contract && doc.contract.subject) ? doc.contract.subject : '-';
    } else {
      var named = (doc.rows || []).filter(function (r) { return r.name; });
      summary = named.length
        ? named[0].name + (named.length > 1 ? ' 외 ' + (named.length - 1) + '건' : '')
        : '-';
    }

    doc.no = docNo;
    sh.appendRow([
      new Date(),
      docNo,
      kindLabel(doc.kind),
      doc.date,
      doc.kind === 'cert' ? ((doc.cert && doc.cert.buyer && doc.cert.buyer.name) || '') : (doc.client || ''),
      doc.issuer || '',
      summary,
      doc.grand == null ? '' : doc.grand,
      (doc.kind === 'cert' || doc.kind === 'order') ? '' :
        ((doc.kind === 'service' || doc.kind === 'purchase') ? vatLabel((doc.contract && doc.contract.vat) || 'incl') : vatLabel(doc.vat)),
      JSON.stringify(doc),
      ''
    ]);

    return { ok: true, no: docNo };
  } finally {
    lock.releaseLock();
  }
}

function prefixFor(kind) {
  if (kind === 'quote') return 'Q-';
  if (kind === 'invoice') return 'T-';
  if (kind === 'order') return 'B-';
  if (kind === 'service') return 'S-';
  if (kind === 'purchase') return 'P-';
  return 'C-';
}
function kindLabel(kind) {
  if (kind === 'quote') return '견적서';
  if (kind === 'invoice') return '거래명세서';
  if (kind === 'order') return '발주서';
  if (kind === 'service') return '용역계약서';
  if (kind === 'purchase') return '물품구매계약서';
  return '원산지증명서';
}
function vatLabel(v) {
  if (v === 'excl') return '별도';
  if (v === 'exempt') return '면세';
  if (v === 'zero') return '영세율';
  return '포함';
}

/* ───────── 조회: 최신 200건 ───────── */
function listDocs() {
  var sh = getSheet();
  var rows = sh.getDataRange().getValues();
  var docs = [];
  for (var i = rows.length - 1; i > 0 && docs.length < 200; i--) {
    try {
      var d = JSON.parse(rows[i][COL_JSON - 1]);
      d.no = rows[i][1];
      d.note = rows[i][COL_MEMO - 1] || '';
      docs.push(d);
    } catch (e) { /* 손상된 행은 건너뛴다 */ }
  }
  return docs;
}

/* ───────── 삭제: 문서번호 기준 ───────── */
function deleteDoc(no) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { ok: false, error: '잠시 뒤 다시 시도해 주세요' };
  try {
    var sh = getSheet();
    var rows = sh.getDataRange().getValues();
    for (var i = rows.length - 1; i > 0; i--) {
      if (String(rows[i][1]) === String(no)) {
        sh.deleteRow(i + 1);
        return { ok: true };
      }
    }
    return { ok: false, error: '해당 문서번호를 찾지 못했습니다' };
  } finally {
    lock.releaseLock();
  }
}

/* ───────── 메모 저장: 문서번호 기준 ───────── */
function saveMemo(no, note) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { ok: false, error: '잠시 뒤 다시 시도해 주세요' };
  try {
    var sh = getSheet();
    var rows = sh.getDataRange().getValues();
    for (var i = rows.length - 1; i > 0; i--) {
      if (String(rows[i][1]) === String(no)) {
        sh.getRange(i + 1, COL_MEMO).setValue(note || '');
        return { ok: true };
      }
    }
    return { ok: false, error: '해당 문서번호를 찾지 못했습니다' };
  } finally {
    lock.releaseLock();
  }
}

/* ═════════ 담당자 명부 ═════════
   담당자·전화번호·이메일을 팀 공용으로 관리한다.
   '담당자' 시트에 저장되며 누가 저장하든 전원이 같은 목록을 본다. */
var CONTACT_SHEET = '담당자';
var CONTACT_HEADERS = ['담당자', '전화번호', '이메일', '수정시각'];

function getContactSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(CONTACT_SHEET);
  if (!sh) {
    sh = ss.insertSheet(CONTACT_SHEET);
    sh.appendRow(CONTACT_HEADERS);
    sh.getRange(1, 1, 1, CONTACT_HEADERS.length)
      .setFontWeight('bold').setBackground('#1b2028').setFontColor('#ffffff');
    sh.setFrozenRows(1);
    sh.setColumnWidth(1, 140);
    sh.setColumnWidth(2, 140);
    sh.setColumnWidth(3, 220);
    sh.setColumnWidth(4, 160);
  }
  return sh;
}

function listContacts() {
  var sh = getContactSheet();
  var rows = sh.getDataRange().getValues();
  var out = [];
  for (var i = 1; i < rows.length; i++) {
    var mgr = String(rows[i][0] || '').trim();
    if (!mgr) continue;
    out.push({ mgr: mgr, tel: String(rows[i][1] || ''), mail: String(rows[i][2] || '') });
  }
  out.sort(function (a, b) { return a.mgr.localeCompare(b.mgr, 'ko'); });
  return out;
}

function saveContact(c) {
  if (!c || !String(c.mgr || '').trim()) return { ok: false, error: '담당자 이름이 없습니다' };
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { ok: false, error: '잠시 뒤 다시 시도해 주세요' };
  try {
    var sh = getContactSheet();
    var mgr = String(c.mgr).trim();
    var rows = sh.getDataRange().getValues();
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][0]).trim() === mgr) {           // 있으면 갱신
        sh.getRange(i + 1, 1, 1, 4).setValues([[mgr, c.tel || '', c.mail || '', new Date()]]);
        return { ok: true, updated: true };
      }
    }
    sh.appendRow([mgr, c.tel || '', c.mail || '', new Date()]);
    return { ok: true, updated: false };
  } finally {
    lock.releaseLock();
  }
}

function deleteContact(mgr) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { ok: false, error: '잠시 뒤 다시 시도해 주세요' };
  try {
    var sh = getContactSheet();
    var rows = sh.getDataRange().getValues();
    for (var i = rows.length - 1; i > 0; i--) {
      if (String(rows[i][0]).trim() === String(mgr).trim()) {
        sh.deleteRow(i + 1);
        return { ok: true };
      }
    }
    return { ok: false, error: '해당 담당자를 찾지 못했습니다' };
  } finally {
    lock.releaseLock();
  }
}
