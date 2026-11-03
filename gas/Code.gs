/**
 * ナオブロック投稿サイト（post.naoblock.jp）の受け口
 *
 * スプレッドシート 1 枚に、1 作品 1 行で置く（作品データもセルに直接）。
 * ゲームのランキング用 GAS とは別のプロジェクト・別のシートにする（壊れても巻き込まない）。
 *
 * 読む（誰でも・GET）
 *   ?action=list[&limit=24&offset=0]   新しい順の一覧（作品データなし・サムネつき）
 *   ?action=get&id=12                   1 作品（作品データつき）
 *   どちらも &callback=関数名 を付けると JSONP で返す（3D 組立ガイドやメインサイトから読むため）
 *
 * 書く（LINE ログインが必要・POST・本文は JSON 文字列。text/plain で送る）
 *   { action:'post',   idToken, name, author, comment, data, thumb }
 *   { action:'delete', idToken, id }
 *   { action:'mine',   idToken }        自分の作品（作品データつき。保存＝バックアップ用）
 *
 * 管理者が消すとき：シートを開いて「公開」の列を FALSE にする（一覧にも 1 件取得にも出なくなる）
 *
 * 初めて使うとき：
 *   1. 新しいスプレッドシートを作る →［拡張機能］→［Apps Script］にこのファイルを丸ごと貼る
 *   2. 関数 setup を 1 回実行する（シートと見出しができる。権限の確認が出たら許可）
 *   3. ［デプロイ］→［新しいデプロイ］→ 種類「ウェブアプリ」、実行ユーザー「自分」、アクセス「全員」
 *   4. 出てきた URL（…/exec）を、投稿サイトの config.js の GAS_URL に入れる
 */

const LINE_CHANNEL_ID = '2012312496';   // LINE ログインチャネル「naoblock 3D」（LIFF はこの中に作る）
const SHEET = '作品';
const COLS = ['作品番号', '作品名', '作者', '投稿日', '作品データ', 'パーツ数', '段数', '横', '奥行き', '高さ', 'ひとこと', 'サムネ', '公開', 'LINEユーザーID', '規格'];
const SPEC = 1;   // 作品データの規格（形を変えたら上げる）

// 上限（ミニナノくらいまで）
const LIMIT = {
  parts: 200,        // パーツ数
  dataChars: 30000,  // 作品データの文字数
  thumbChars: 40000, // サムネ（data:image/png;base64,…）の文字数
  size: 40,          // 横・奥行き・高さ
  name: 30, author: 20, comment: 100,
  perUser: 50,       // 1 人が公開できる作品の数
  perDay: 10,        // 1 人が 1 日に投稿できる数
};
// 使える色（3D 組立ガイドの upload.js と同じ）
const COLORS = ['black', 'red', 'pink', 'skin', 'white', 'yellow', 'brown', 'gray', 'purple', 'orange', 'green', 'blue', 'navy', 'lightblue',
  'darkgray', 'lightgray', 'peach', 'beige', 'yelloworange', 'lightgreen', 'clear'];

function setup() {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(SHEET) || ss.insertSheet(SHEET);
  sh.getRange(1, 1, 1, COLS.length).setValues([COLS]).setFontWeight('bold');
  sh.setFrozenRows(1);
  // 「公開」の列は、投稿のたびにその行だけチェックボックスにする（列ごとだと空行も「使用中」になり、行の追加位置がずれる）
}

// ---- 入口 ----
function doGet(e) {
  const p = e.parameter || {};
  let res;
  try {
    if (p.action === 'get') res = getOne_(Number(p.id));
    else res = list_(Number(p.limit) || 24, Number(p.offset) || 0);
  } catch (err) { res = { ok: false, error: String(err.message || err) }; }
  return out_(res, p.callback);
}

function doPost(e) {
  let res;
  try {
    const b = JSON.parse(e.postData.contents);
    const user = verify_(b.idToken);
    if (b.action === 'post') res = post_(user, b);
    else if (b.action === 'delete') res = remove_(user, Number(b.id));
    else if (b.action === 'mine') res = mine_(user);
    else throw new Error('action が違います');
  } catch (err) { res = { ok: false, error: String(err.message || err) }; }
  return out_(res);
}

function out_(obj, callback) {
  const json = JSON.stringify(obj);
  if (callback && /^[A-Za-z_$][\w$.]{0,40}$/.test(callback)) {
    return ContentService.createTextOutput(`${callback}(${json});`).setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}

// ---- LINE で本人を確かめる（ブラウザから来たユーザー ID は信じない。ID トークンを LINE に問い合わせる）----
function verify_(idToken) {
  if (!idToken) throw new Error('LINE ログインが必要です');
  const r = UrlFetchApp.fetch('https://api.line.me/oauth2/v2.1/verify', {
    method: 'post', payload: { id_token: idToken, client_id: LINE_CHANNEL_ID }, muteHttpExceptions: true,
  });
  if (r.getResponseCode() !== 200) throw new Error('LINE ログインの期限が切れました。もう一度ログインしてください');
  const j = JSON.parse(r.getContentText());
  if (!j.sub) throw new Error('LINE ログインを確かめられませんでした');
  return { id: j.sub, name: j.name || '' };
}

// ---- シートの読み書き ----
function sheet_() { return SpreadsheetApp.getActive().getSheetByName(SHEET); }
function rows_() {
  const sh = sheet_(), n = sh.getLastRow() - 1;
  if (n < 1) return [];
  return sh.getRange(2, 1, n, COLS.length).getValues().map((v, i) => ({ row: i + 2, v }));
}
const C = Object.fromEntries(COLS.map((c, i) => [c, i]));
const card_ = v => ({
  id: v[C['作品番号']], name: String(v[C['作品名']]), author: String(v[C['作者']]),
  date: Utilities.formatDate(new Date(v[C['投稿日']]), 'Asia/Tokyo', 'yyyy-MM-dd'),
  parts: v[C['パーツ数']], layers: v[C['段数']], W: v[C['横']], D: v[C['奥行き']], H: v[C['高さ']],
  comment: String(v[C['ひとこと']]), thumb: String(v[C['サムネ']]),
});
const isPublic_ = v => v[C['公開']] === true;

function list_(limit, offset) {
  limit = Math.max(1, Math.min(limit, 48));
  const pub = rows_().filter(r => isPublic_(r.v)).reverse();   // 新しい順
  return { ok: true, total: pub.length, works: pub.slice(offset, offset + limit).map(r => card_(r.v)) };
}

function getOne_(id) {
  const r = rows_().find(r => r.v[C['作品番号']] === id && isPublic_(r.v));
  if (!r) return { ok: false, error: 'この作品は見つかりません（削除されたか、非公開です）' };
  return { ok: true, work: Object.assign(card_(r.v), { data: JSON.parse(r.v[C['作品データ']]) }) };
}

function mine_(user) {
  const mine = rows_().filter(r => r.v[C['LINEユーザーID']] === user.id).reverse();
  return { ok: true, works: mine.map(r => Object.assign(card_(r.v), { public: isPublic_(r.v), data: JSON.parse(r.v[C['作品データ']]) })) };
}

function post_(user, b) {
  const text = s => String(s == null ? '' : s).replace(/[\u0000-\u001f<>]/g, '').trim();
  const name = text(b.name).slice(0, LIMIT.name), author = text(b.author).slice(0, LIMIT.author), comment = text(b.comment).slice(0, LIMIT.comment);
  if (!name) throw new Error('作品名を入れてください');
  if (!author) throw new Error('作者名を入れてください');
  const d = checkData_(b.data);
  const thumb = String(b.thumb || '');
  if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(thumb)) throw new Error('サムネの形が違います');
  if (thumb.length > LIMIT.thumbChars) throw new Error(`サムネが大きすぎます（${thumb.length}文字／上限 ${LIMIT.thumbChars}文字）`);

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const all = rows_();
    const mine = all.filter(r => r.v[C['LINEユーザーID']] === user.id);
    if (mine.filter(r => isPublic_(r.v)).length >= LIMIT.perUser) throw new Error(`公開できる作品は1人${LIMIT.perUser}個までです`);
    const today = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd');
    if (mine.filter(r => Utilities.formatDate(new Date(r.v[C['投稿日']]), 'Asia/Tokyo', 'yyyy-MM-dd') === today).length >= LIMIT.perDay) throw new Error(`投稿は1日${LIMIT.perDay}個までです。また明日どうぞ`);
    const id = all.reduce((m, r) => Math.max(m, Number(r.v[C['作品番号']]) || 0), 0) + 1;
    const row = [];
    row[C['作品番号']] = id; row[C['作品名']] = name; row[C['作者']] = author; row[C['投稿日']] = new Date();
    row[C['作品データ']] = d.json; row[C['パーツ数']] = d.parts; row[C['段数']] = d.H; row[C['横']] = d.W; row[C['奥行き']] = d.D; row[C['高さ']] = d.H;
    row[C['ひとこと']] = comment; row[C['サムネ']] = thumb; row[C['公開']] = true; row[C['LINEユーザーID']] = user.id; row[C['規格']] = SPEC;
    const sh = sheet_();
    sh.appendRow(row);
    sh.getRange(sh.getLastRow(), C['公開'] + 1).insertCheckboxes().check();
    return { ok: true, id };
  } finally { lock.releaseLock(); }
}

function remove_(user, id) {
  const r = rows_().find(r => r.v[C['作品番号']] === id);
  if (!r || r.v[C['LINEユーザーID']] !== user.id) throw new Error('この作品は削除できません（投稿した本人だけが削除できます）');
  sheet_().deleteRow(r.row);
  return { ok: true };
}

// ---- 作品データの検査（ブラウザでも同じ検査をしているが、ここでもう一度。すり抜け防止）----
// 形：{ name, H, W, D, aspect, palette, bricks: [{ y, shape, col, cells: [[x,y,z],...] }] }
function checkData_(data) {
  const fail = m => { throw new Error(m); };
  if (!data || typeof data !== 'object' || !Array.isArray(data.bricks)) fail('作品データの形が違います（3D 組立ガイドで保存したファイルを選んでください）');
  const bricks = data.bricks;
  if (!bricks.length) fail('パーツが 1 個もありません');
  if (bricks.length > LIMIT.parts) fail(`パーツが多すぎます（${bricks.length}個／上限 ${LIMIT.parts}個）。ミニナノくらいの大きさまで投稿できます`);
  const isInt = n => Number.isInteger(n) && n >= 0 && n < LIMIT.size;
  const clean = bricks.map((b, i) => {
    const where = `${i + 1}個目のパーツ`;
    if (typeof b.shape !== 'string' || !/^[a-z0-9]{1,16}$/.test(b.shape)) fail(`${where}の形が違います`);
    if (COLORS.indexOf(b.col) < 0) fail(`${where}の色「${b.col}」は使えません`);
    if (!Array.isArray(b.cells) || !b.cells.length || b.cells.length > 16) fail(`${where}のマスが違います`);
    b.cells.forEach(c => { if (!Array.isArray(c) || c.length !== 3 || !c.every(isInt)) fail(`${where}の位置が違います（どれも 0〜${LIMIT.size - 1}）`); });
    const o = { y: b.cells[0][1], shape: b.shape, col: b.col, cells: b.cells.map(c => c.slice(0, 3)) };
    if (b.recolor) o.recolor = 1;
    return o;
  });
  const cells = clean.flatMap(b => b.cells);
  const W = Math.max(...cells.map(c => c[0])) + 1, H = Math.max(...cells.map(c => c[1])) + 1, D = Math.max(...cells.map(c => c[2])) + 1;
  const palette = {};
  clean.forEach(b => { palette[b.col] = true; });
  const json = JSON.stringify({ H, W, D, aspect: 1.0, colors: Object.keys(palette), bricks: clean });
  if (json.length > LIMIT.dataChars) fail(`作品データが大きすぎます（${json.length}文字／上限 ${LIMIT.dataChars}文字）`);
  return { json, parts: clean.length, W, H, D };
}
