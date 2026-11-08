// ==UserScript==
// @name         Readmoo 電子書雲端同步
// @namespace    https://github.com/Rennll/ebook-library-scripts
// @version      1.1.0
// @description  完整載入 Readmoo 書櫃並同步至個人 Cloudflare Worker
// @author       Re
// @match        https://read.readmoo.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @connect      workers.dev
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const SOURCE = 'readmoo';
  const COOLDOWN_MS = 12 * 60 * 60 * 1000;
  const KEYS = {
    worker: 'ebookLibraryWorkerUrl',
    token: 'ebookLibraryDeviceToken',
    lastSync: 'ebookLibraryReadmooLastSync',
  };

  const btn = makeButton('☁️ 同步 Readmoo', 24);
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
    try {
      if (typeof GM_getValue === 'function') return await GM_getValue(key, fallback);
    } catch (error) { console.warn('[Readmoo 同步] 讀取設定失敗', error); }
    return fallback;
  }

  async function gmSet(key, value) {
    if (typeof GM_setValue !== 'function') {
      throw new Error('目前 Userscript 管理器未提供 GM_setValue，請確認使用 Violentmonkey。');
    }
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
    } catch (error) { console.error('[Readmoo 同步] 儲存設定失敗', error); alert(error.message || '儲存設定失敗。'); }
  }

  async function getConfig(silent = false) {
    const worker = await gmGet(KEYS.worker, '');
    const token = await gmGet(KEYS.token, '');
    if (!worker || !token) {
      if (!silent) alert('尚未設定 Worker 網址或 device token，請先按「同步設定」。');
      return null;
    }
    return { worker: worker.replace(/\/+$/, ''), token };
  }

  async function collectSnapshot() {
    let stableRounds = 0;
    let previousCount = -1;
    let previousHeight = -1;
    let finalCount = 0;

    // Readmoo uses lazy loading: scroll to the bottom until both item count
    // and document height remain unchanged for several rounds.
    for (let step = 1; step <= 30; step++) {
      window.scrollTo(0, document.documentElement.scrollHeight);
      await sleep(1000);

      const count = document.querySelectorAll('.library-item').length;
      const height = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
      finalCount = count;

      btn.textContent = '⏳ 載入書櫃中… ' + count + ' 本';
      console.log('[Readmoo 同步] 捲動 ' + step + '/30：' + count + ' 本，頁面高度 ' + height);

      if (count === previousCount && height === previousHeight) stableRounds++;
      else stableRounds = 0;

      previousCount = count;
      previousHeight = height;

      if (stableRounds >= 3) break;
      if (step === 30) throw new Error('捲動載入 30 次後書櫃仍未穩定，為避免不完整同步已中止。');
    }

    await sleep(500);
    const items = [...document.querySelectorAll('.library-item')];
    if (items.length !== finalCount || items.length === 0) {
      throw new Error('書櫃載入後數量發生變化或為 0，已中止同步。');
    }

    const books = items.map((item, index) => {
      const title = item.querySelector('.title')?.textContent.trim() || '';
      const author = item.querySelector('.author')?.textContent.trim() || '';
      const privacyId = item.querySelector('.privacy')?.id || '';
      const readmooId = privacyId.replace(/^privacy-/, '');
      const progressBar = item.querySelector('.progress-bar');
      const widthText = progressBar?.style.width || '';
      const percentMatch = widthText.match(/([\d.]+)%/);
      const readPercent = percentMatch ? Math.max(0, Math.min(100, Math.round(Number(percentMatch[1])))) : null;
      const statusText = item.querySelector('.menu-status button')?.textContent.trim() || '';
      const readStatus = /已完成|完成|Finished/i.test(statusText) || readPercent === 100 ? 'Finished'
        : readPercent > 0 || /閱讀中|進行中|InProgress/i.test(statusText) ? 'InProgress'
        : 'ReadyToRead';

      if (!title || !/^\d+$/.test(readmooId)) {
        throw new Error('第 ' + (index + 1) + ' 本書缺少標題或有效的 Readmoo 書櫃 ID，已中止同步。');
      }

      return {
        source: SOURCE, title,
        authors: author ? [author] : [],
        series: null, genre: null,
        readStatus, readPercent,
        dateAdded: '', lastReadTime: '', isbn: '',
        readmooId,
        url: 'https://read.readmoo.com/#/library',
      };
    });

    const ids = new Set();
    for (const book of books) {
      if (ids.has(book.readmooId)) {
        throw new Error('發現重複 Readmoo 書櫃 ID：' + book.readmooId + '，已中止同步。');
      }
      ids.add(book.readmooId);
    }

    if (books.some(book => !book.title)) throw new Error('有書籍缺少標題，已中止同步。');
    console.log('[Readmoo 同步] 完整擷取成功：' + books.length + ' 本。');
    console.table(books.slice(0, 5));
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
    running = true;
    btn.disabled = true;
    settingsBtn.disabled = true;
    try {
      const config = await getConfig(automatic);
      if (!config) return;

      if (automatic) {
        const lastSync = Number(await gmGet(KEYS.lastSync, 0));
        if (!lastSync) {
          console.log('[Readmoo 同步] 尚未完成首次手動同步，略過自動同步。');
          return;
        }
        if (Date.now() - lastSync < COOLDOWN_MS) {
          console.log('[Readmoo 同步] 尚未到下次自動同步時間，略過。');
          return;
        }
      }

      btn.textContent = '⏳ 正在檢查 Readmoo 書櫃…';
      const books = await collectSnapshot();
      if (books.length === 0 && (!manual || !confirm('Readmoo 書櫃回傳 0 本書。只有在你確定書櫃真的為空時，才按「確定」清空雲端書單。'))) {
        throw new Error('空書單未經明確確認，不會上傳。');
      }

      btn.textContent = '☁️ 上傳 ' + books.length + ' 本…';
      const result = await uploadSnapshot(config, books, manual);
      await gmSet(KEYS.lastSync, Date.now());
      console.log('[Readmoo 同步] 完成', result);
      alert('Readmoo 同步完成：' + result.bookCount + ' 本書。\n同步時間：' + result.syncedAt);
    } catch (error) {
      console.error('[Readmoo 同步] 失敗', error);
      alert('Readmoo 同步未完成，雲端舊資料不會被更新。\n\n原因：' + (error.message || error));
    } finally {
      btn.textContent = '☁️ 同步 Readmoo';
      btn.disabled = false;
      settingsBtn.disabled = false;
      running = false;
    }
  }

  settingsBtn.addEventListener('click', configure);
  btn.addEventListener('click', () => syncNow({ manual: true }));
  syncNow({ automatic: true });
})();
