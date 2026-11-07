// ==UserScript==
// @name         博客來電子書雲端同步
// @namespace    https://github.com/Rennll/ebook-library-scripts
// @version      1.1.1
// @description  完整擷取博客來書櫃並同步至個人 Cloudflare Worker
// @author       Re
// @match        https://viewer-ebook.books.com.tw/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @connect      workers.dev
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';
  const SOURCE = 'books_com_tw';
  const COOLDOWN_MS = 12 * 60 * 60 * 1000;
  const BASE_URL = 'https://appapi-ebook.books.com.tw/V1.7/CMSAPIApp/ReadList';
  const PAGE_SIZE = 40;
  const KEYS = { worker: 'ebookLibraryWorkerUrl', token: 'ebookLibraryDeviceToken', lastSync: 'ebookLibraryBooksComTwLastSync' };
  const btn = makeButton('☁️ 同步博客來', 24);
  const settingsBtn = makeButton('⚙️ 同步設定', 82);
  document.body.append(btn, settingsBtn);
  let running = false;

  function makeButton(label, bottom) {
    const button = document.createElement('button');
    button.textContent = label;
    Object.assign(button.style, {
      position: 'fixed', bottom: bottom + 'px', right: '24px', zIndex: '99999',
      padding: '10px 16px', background: bottom === 24 ? '#176b87' : '#444',
      color: '#fff', border: 'none', borderRadius: '8px', fontSize: '14px',
      cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
    });
    return button;
  }
  function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
  async function gmGet(key, fallback = null) {
    try { if (typeof GM_getValue === 'function') return await GM_getValue(key, fallback); }
    catch (error) { console.warn('[博客來同步] 讀取設定失敗', error); }
    return fallback;
  }
  async function gmSet(key, value) {
    if (typeof GM_setValue !== 'function') throw new Error('目前 Userscript 管理器未提供 GM_setValue，請確認使用 Violentmonkey。');
    await GM_setValue(key, value);
  }
  async function configure() {
    const oldWorker = await gmGet(KEYS.worker, '');
    const workerInput = prompt('請輸入 Cloudflare Worker 網址（https:// 開頭，不含結尾斜線）', oldWorker || '');
    if (workerInput === null) return;
    const worker = workerInput.trim().replace(/\/+$/, '');
    if (!/^https:\/\//i.test(worker)) { alert('Worker 網址必須以 https:// 開頭。'); return; }
    const oldToken = await gmGet(KEYS.token, '');
    const tokenInput = prompt('請輸入這台設備的 device token。設定只保存在此瀏覽器的 Userscript 儲存區。', oldToken || '');
    if (tokenInput === null) return;
    const token = tokenInput.trim();
    if (!/^ebl_[a-f0-9]{64}$/i.test(token)) { alert('Token 格式不正確，請確認是建立裝置時取得的完整 token。'); return; }
    try {
      await gmSet(KEYS.worker, worker);
      await gmSet(KEYS.token, token);
      alert('設定已儲存，只存在目前瀏覽器的 Userscript 儲存區，不會寫入 GitHub。');
    } catch (error) { console.error('[博客來同步] 儲存設定失敗', error); alert(error.message || '儲存設定失敗。'); }
  }
  async function getConfig(silent = false) {
    const worker = await gmGet(KEYS.worker, '');
    const token = await gmGet(KEYS.token, '');
    if (!worker || !token) { if (!silent) alert('尚未設定 Worker 網址或 device token，請先按「同步設定」。'); return null; }
    return { worker: worker.replace(/\/+$/, ''), token };
  }
  async function fetchPage(offset) {
    let lastError;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const body = new URLSearchParams({
          offset: String(offset), page_size: String(PAGE_SIZE), sort_order: 'ReadTimeDesc',
          last_updated_time: '1900-01-01T00:00:00+08:00', eplanid: 'all',
          is_buyout: '', listname: '["all","trial"]', cat: 'all',
        });
        const response = await fetch(BASE_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'Accept': 'application/json, text/javascript, */*; q=0.01' },
          credentials: 'include', cache: 'no-store', body: body.toString(),
        });
        if (!response.ok) throw new Error('API HTTP ' + response.status);
        const data = await response.json();
        if (!data || !Array.isArray(data.records) || !Number.isInteger(Number(data.total_records)) || Number(data.total_records) < 0) {
          throw new Error('博客來 API 回傳格式不符預期，可能已改版。');
        }
        return { ...data, total_records: Number(data.total_records) };
      } catch (error) {
        lastError = error;
        if (attempt < 2) await sleep(1200 * (attempt + 1));
      }
    }
    throw lastError || new Error('offset ' + offset + ' 讀取失敗');
  }
  function normalizeRecord(record) {
    const info = record && record.item_info;
    if (!info || typeof info !== 'object') throw new Error('有書籍缺少 item_info，為避免不完整同步已中止。');
    const title = String(info.c_title || '').trim();
    const booksId = String(info.item || '').trim();
    if (!title || !booksId) throw new Error('有書籍缺少標題或博客來商品 ID，為避免不完整同步已中止。');
    const percent = Number(info.percent);
    return {
      source: SOURCE, title,
      authors: info.author ? String(info.author).split(/[,，、]/).map(s => s.trim()).filter(Boolean) : [],
      series: null, genre: info.category || null,
      readStatus: percent === 100 ? 'Finished' : percent > 0 ? 'InProgress' : 'ReadyToRead',
      readPercent: Number.isFinite(percent) ? percent : null,
      dateAdded: info.auth_time ? String(info.auth_time).slice(0, 10) : '',
      lastReadTime: info.last_read_time ? String(info.last_read_time).slice(0, 10) : '',
      isbn: String(info.isbn || ''), booksId,
      url: 'https://www.books.com.tw/products/' + encodeURIComponent(booksId),
    };
  }
  async function collectSnapshot() {
    const first = await fetchPage(0);
    const total = first.total_records;
    const totalPages = Math.ceil(total / PAGE_SIZE);
    const records = [...first.records];
    const firstExpected = Math.min(total, PAGE_SIZE);
    if (records.length !== firstExpected) throw new Error('博客來第一批筆數不符預期，已中止同步。');
    console.log('[博客來同步] API 顯示共 ' + total + ' 本，預計 ' + totalPages + ' 批。');
    for (let page = 1; page < totalPages; page++) {
      const offset = page * PAGE_SIZE;
      btn.textContent = '⏳ 擷取第 ' + (page + 1) + '/' + totalPages + ' 批';
      await sleep(600);
      const data = await fetchPage(offset);
      const expected = Math.min(PAGE_SIZE, total - offset);
      if (data.total_records !== total || data.records.length !== expected) {
        throw new Error('第 ' + (page + 1) + ' 批筆數或總數不一致（預期 ' + expected + ' 筆，實際 ' + data.records.length + ' 筆），已中止同步。');
      }
      records.push(...data.records);
    }
    if (records.length !== total) throw new Error('博客來顯示 ' + total + ' 本，實際擷取 ' + records.length + ' 本，數量不一致，已中止同步。');
    const books = records.map(normalizeRecord);
    const ids = new Set();
    for (const book of books) {
      if (ids.has(book.booksId)) throw new Error('發現重複博客來商品 ID：' + book.booksId + '，已中止同步。');
      ids.add(book.booksId);
    }
    return books;
  }
  function gmRequest(options) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest !== 'function') {
        reject(new Error('目前 Userscript 管理器未提供 GM_xmlhttpRequest，請確認使用 Violentmonkey。'));
        return;
      }
      GM_xmlhttpRequest({
        ...options,
        onload: resolve,
        onerror: () => reject(new Error('無法連線到 Cloudflare Worker，請確認 Worker 網址及 Violentmonkey 的 @connect 權限。')),
        ontimeout: () => reject(new Error('連線 Cloudflare Worker 逾時。')),
      });
    });
  }

  async function uploadSnapshot(config, books, allowEmpty) {
    const payload = { source: SOURCE, complete: true, books };
    if (books.length === 0 && allowEmpty) payload.emptyConfirmed = true;
    const response = await gmRequest({
      method: 'POST',
      url: config.worker + '/api/sync',
      headers: {
        'Authorization': 'Bearer ' + config.token,
        'Content-Type': 'application/json',
      },
      data: JSON.stringify(payload),
      timeout: 60000,
    });
    let result = {};
    try { result = JSON.parse(response.responseText || '{}'); } catch {}
    if (response.status < 200 || response.status >= 300) {
      throw new Error(result.error || 'Worker 回應錯誤（HTTP ' + response.status + '）');
    }
    return result;
  }
  async function syncNow({ manual = false, automatic = false } = {}) {
    if (running) return;
    running = true; btn.disabled = true; settingsBtn.disabled = true;
    try {
      const config = await getConfig(automatic);
      if (!config) return;
      if (automatic) {
        const lastSync = Number(await gmGet(KEYS.lastSync, 0));
        if (!lastSync) { console.log('[博客來同步] 尚未完成首次手動同步，略過自動同步。'); return; }
        if (Date.now() - lastSync < COOLDOWN_MS) { console.log('[博客來同步] 尚未到下次自動同步時間，略過。'); return; }
      }
      btn.textContent = '⏳ 正在檢查博客來書櫃…';
      const books = await collectSnapshot();
      if (books.length === 0 && (!manual || !confirm('博客來 API 回傳 0 本書。只有在你確定書櫃真的為空時，才按「確定」清空雲端博客來書單。'))) {
        throw new Error('空書單未經明確確認，不會上傳。');
      }
      btn.textContent = '☁️ 上傳 ' + books.length + ' 本…';
      const result = await uploadSnapshot(config, books, manual);
      await gmSet(KEYS.lastSync, Date.now());
      console.log('[博客來同步] 完成', result);
      alert('博客來同步完成：' + result.bookCount + ' 本書。\n同步時間：' + result.syncedAt);
    } catch (error) {
      console.error('[博客來同步] 失敗', error);
      alert('博客來同步未完成，雲端舊資料不會被更新。\n\n原因：' + (error.message || error));
    } finally {
      btn.textContent = '☁️ 同步博客來'; btn.disabled = false; settingsBtn.disabled = false; running = false;
    }
  }
  settingsBtn.addEventListener('click', configure);
  btn.addEventListener('click', () => syncNow({ manual: true }));
  syncNow({ automatic: true });
})();
