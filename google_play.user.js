// ==UserScript==
// @name         Google Play 圖書雲端同步
// @namespace    https://github.com/Rennll/ebook-library-scripts
// @version      3.0.0
// @description  完整擷取 Google Play 圖書書櫃並同步至 Cloudflare Worker
// @author       Re
// @match        https://play.google.com/books*
// @run-at       document-start
// @inject-into  page
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @connect      workers.dev
// ==/UserScript==

(function () {
  'use strict';
  const SOURCE = 'google_play_books';
  const COOLDOWN_MS = 12 * 60 * 60 * 1000;
  const KEYS = { worker: 'ebookLibraryWorkerUrl', token: 'ebookLibraryDeviceToken', lastSync: 'ebookLibraryGooglePlayLastSync' };
  let capturedBooks = null, captureError = null, waiters = [], running = false, btn, settingsBtn, requestCount = 0;

  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    if (typeof url === 'string' && url.includes('SyncUserLibrary')) {
      requestCount++;
      this.addEventListener('load', () => {
        try {
          if (this.status < 200 || this.status >= 300) throw new Error('SyncUserLibrary HTTP ' + this.status);
          const response = JSON.parse(this.responseText);
          if (!Array.isArray(response) || !Array.isArray(response[0])) throw new Error('SyncUserLibrary 回應格式與預期不同。');
          capturedBooks = response[0];
          captureError = null;
          console.log('[Google Play 同步] 已攔截書櫃資料：' + capturedBooks.length + ' 本；請求數 ' + requestCount);
          waiters.forEach(w => { clearTimeout(w.timer); w.resolve(capturedBooks); });
          waiters = [];
          updateButton();
        } catch (error) {
          captureError = error;
          console.error('[Google Play 同步] 讀取書櫃回應失敗', error);
          waiters.forEach(w => { clearTimeout(w.timer); w.reject(error); });
          waiters = [];
        }
      });
    }
    return originalOpen.apply(this, arguments);
  };

  function makeButton(label, bottom, primary) {
    const b = document.createElement('button');
    b.textContent = label;
    Object.assign(b.style, { position: 'fixed', bottom: bottom + 'px', right: '24px', zIndex: '99999', padding: '10px 16px', background: primary ? '#176b87' : '#444', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '14px', cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,0.25)' });
    return b;
  }
  function injectButtons() {
    if (document.getElementById('__gpb_sync_btn__')) return;
    btn = makeButton('☁️ 同步 Google Play 圖書', 24, true);
    settingsBtn = makeButton('⚙️ 同步設定', 82, false);
    btn.id = '__gpb_sync_btn__'; settingsBtn.id = '__gpb_sync_settings_btn__';
    document.body.append(btn, settingsBtn);
    btn.addEventListener('click', () => syncNow({ manual: true }));
    settingsBtn.addEventListener('click', configure);
    updateButton();
    syncNow({ automatic: true });
  }
  function updateButton() { if (btn && capturedBooks) btn.textContent = '☁️ 同步 Google Play 圖書（' + capturedBooks.length + ' 本）'; }
  async function gmGet(key, fallback = null) {
    try { if (typeof GM_getValue === 'function') return await GM_getValue(key, fallback); } catch (e) { console.warn('[Google Play 同步] 讀取設定失敗', e); }
    return fallback;
  }
  async function gmSet(key, value) {
    if (typeof GM_setValue !== 'function') throw new Error('目前 Userscript 管理器未提供 GM_setValue，請確認使用 Violentmonkey。');
    await GM_setValue(key, value);
  }
  async function configure() {
    const oldWorker = await gmGet(KEYS.worker, '');
    const input = prompt('請輸入 Cloudflare Worker 網址（https:// 開頭，不含結尾斜線）', oldWorker || '');
    if (input === null) return;
    const worker = input.trim().replace(/\/+$/, '');
    if (!/^https:\/\//i.test(worker)) { alert('Worker 網址必須以 https:// 開頭。'); return; }
    const oldToken = await gmGet(KEYS.token, '');
    const tokenInput = prompt('請輸入這台設備的 device token。設定只保存在此瀏覽器的 Userscript 儲存區。', oldToken || '');
    if (tokenInput === null) return;
    const token = tokenInput.trim();
    if (!/^ebl_[a-f0-9]{64}$/i.test(token)) { alert('Token 格式不正確，請確認是建立裝置時取得的完整 token。'); return; }
    try {
      await gmSet(KEYS.worker, worker); await gmSet(KEYS.token, token);
      alert('設定已儲存，只存在目前瀏覽器的 Userscript 儲存區，不會寫入 GitHub。');
    } catch (e) { console.error('[Google Play 同步] 儲存設定失敗', e); alert(e.message || '儲存設定失敗。'); }
  }
  async function getConfig(silent = false) {
    const worker = await gmGet(KEYS.worker, ''), token = await gmGet(KEYS.token, '');
    if (!worker || !token) { if (!silent) alert('尚未設定 Worker 網址或 device token，請先按「同步設定」。'); return null; }
    return { worker: worker.replace(/\/+$/, ''), token };
  }
  function waitForCapture(timeoutMs = 30000) {
    if (capturedBooks) return Promise.resolve(capturedBooks);
    if (captureError) return Promise.reject(captureError);
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject, timer: null };
      waiter.timer = setTimeout(() => {
        waiters = waiters.filter(w => w !== waiter);
        reject(new Error('等待 Google Play 書櫃資料逾時。請重新整理頁面，等書櫃載入後再同步。'));
      }, timeoutMs);
      waiters.push(waiter);
    });
  }
  function normalizeBooks(rawBooks) {
    if (!Array.isArray(rawBooks) || rawBooks.length === 0) throw new Error('沒有取得書籍資料；為避免空快照清除雲端書單，已中止同步。');
    const books = rawBooks.map((book, i) => {
      if (!Array.isArray(book)) throw new Error('第 ' + (i + 1) + ' 筆資料格式錯誤。');
      const id = String(book[0] || '').trim(), info = Array.isArray(book[1]) ? book[1] : [], user = Array.isArray(book[2]) ? book[2] : [];
      const title = String(info[0] || '').trim();
      if (!id || !title) throw new Error('第 ' + (i + 1) + ' 本缺少 Google Books ID 或書名，已中止同步。');
      const toDate = value => { if (!value) return ''; const ms = Math.floor(Number(value) / 1000); return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString().slice(0, 10) : ''; };
      const authors = Array.isArray(info[1]) ? info[1].map(a => String(a).trim()).filter(Boolean) : [];
      let genre = null;
      if (Array.isArray(info[21]) && Array.isArray(info[21][0]) && Array.isArray(info[21][0][0])) genre = info[21][0][0].join(' > ') || null;
      return { source: SOURCE, title, authors, series: null, genre, readStatus: null, readPercent: null, dateAdded: toDate(user[1]), lastReadTime: toDate(user[7]), isbn: '', googleBooksId: id, url: info[9] || 'https://play.google.com/store/books/details?id=' + encodeURIComponent(id), publisher: info[2] || null, language: info[8] || null };
    });
    const ids = new Set();
    for (const book of books) { if (ids.has(book.googleBooksId)) throw new Error('發現重複 Google Books ID：' + book.googleBooksId + '，已中止同步。'); ids.add(book.googleBooksId); }
    console.log('[Google Play 同步] 完整性檢查通過：' + books.length + ' 本，標題與 ID 均完整且 ID 無重複。');
    console.table(books.slice(0, 5));
    return books;
  }
  function gmRequest(options) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest !== 'function') return reject(new Error('目前 Userscript 管理器未提供 GM_xmlhttpRequest，請確認使用 Violentmonkey。'));
      GM_xmlhttpRequest({ ...options, onload: resolve, onerror: () => reject(new Error('無法連線到 Cloudflare Worker，請確認 Worker 網址及 Violentmonkey 的 @connect 權限。')), ontimeout: () => reject(new Error('連線 Cloudflare Worker 逾時。')) });
    });
  }
  async function upload(config, books) {
    const response = await gmRequest({ method: 'POST', url: config.worker + '/api/sync', headers: { Authorization: 'Bearer ' + config.token, 'Content-Type': 'application/json' }, data: JSON.stringify({ source: SOURCE, complete: true, books }), timeout: 60000 });
    let result = {}; try { result = JSON.parse(response.responseText || '{}'); } catch {}
    if (response.status < 200 || response.status >= 300) throw new Error(result.error || 'Worker 回應錯誤（HTTP ' + response.status + '）');
    return result;
  }
  async function syncNow({ manual = false, automatic = false } = {}) {
    if (running || !btn) return;
    running = true; btn.disabled = true; settingsBtn.disabled = true;
    try {
      const config = await getConfig(automatic); if (!config) return;
      if (automatic) {
        const last = Number(await gmGet(KEYS.lastSync, 0));
        if (!last) { console.log('[Google Play 同步] 尚未完成首次手動同步，略過自動同步。'); return; }
        if (Date.now() - last < COOLDOWN_MS) { console.log('[Google Play 同步] 尚未到下次自動同步時間，略過。'); return; }
      }
      btn.textContent = '⏳ 等待 Google Play 書櫃資料…';
      const books = normalizeBooks(await waitForCapture());
      btn.textContent = '☁️ 上傳 ' + books.length + ' 本…';
      const result = await upload(config, books);
      await gmSet(KEYS.lastSync, Date.now());
      console.log('[Google Play 同步] 完成', result);
      alert('Google Play 圖書同步完成：' + result.bookCount + ' 本書。\n同步時間：' + result.syncedAt);
    } catch (e) {
      console.error('[Google Play 同步] 失敗', e);
      alert('Google Play 圖書同步未完成，雲端舊資料不會被更新。\n\n原因：' + (e.message || e));
    } finally {
      btn.textContent = capturedBooks ? '☁️ 同步 Google Play 圖書（' + capturedBooks.length + ' 本）' : '☁️ 同步 Google Play 圖書';
      btn.disabled = false; settingsBtn.disabled = false; running = false;
    }
  }
  if (document.body) injectButtons();
  else document.addEventListener('DOMContentLoaded', injectButtons, { once: true });
})();