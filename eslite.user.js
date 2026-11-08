// ==UserScript==
// @name         誠品電子書雲端同步
// @namespace    https://github.com/Rennll/ebook-library-scripts
// @version      1.1.0
// @description  完整擷取誠品書櫃並同步至個人 Cloudflare Worker
// @author       Re
// @match        https://ebook.eslite.com/bookshelf*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @connect      workers.dev
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';
  const SOURCE = 'eslite';
  const COOLDOWN_MS = 12 * 60 * 60 * 1000;
  const KEYS = { worker: 'ebookLibraryWorkerUrl', token: 'ebookLibraryDeviceToken', lastSync: 'ebookLibraryEsliteLastSync' };
  const btn = makeButton('☁️ 同步誠品', 24);
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
    catch (error) { console.warn('[誠品同步] 讀取設定失敗', error); }
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
    } catch (error) { console.error('[誠品同步] 儲存設定失敗', error); alert(error.message || '儲存設定失敗。'); }
  }
  async function getConfig(silent = false) {
    const worker = await gmGet(KEYS.worker, '');
    const token = await gmGet(KEYS.token, '');
    if (!worker || !token) { if (!silent) alert('尚未設定 Worker 網址或 device token，請先按「同步設定」。'); return null; }
    return { worker: worker.replace(/\/+$/, ''), token };
  }
  async function fetchPage(page) {
    let lastError;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetch('/bookshelf?page=' + page, { credentials: 'include', cache: 'no-store' });
        if (!response.ok) throw new Error('誠品書櫃頁面 HTTP ' + response.status);
        const html = await response.text();
        if (!html || !html.includes('<')) throw new Error('頁面內容為空或格式異常。');
        const doc = new DOMParser().parseFromString(html, 'text/html');
        if (!doc.querySelector('article.col')) throw new Error('頁面找不到書籍項目，可能已登出或頁面結構改變。');
        return doc;
      } catch (error) {
        lastError = error;
        if (attempt < 2) await sleep(1000 * (attempt + 1));
      }
    }
    throw lastError || new Error('第 ' + page + ' 頁讀取失敗');
  }
  function parsePage(doc, page, seenElements, seenReaders) {
    const articles = [...doc.querySelectorAll('article.col')];
    if (!articles.length) throw new Error('第 ' + page + ' 頁沒有書籍項目，已中止同步。');
    const books = [];
    for (const article of articles) {
      const linkEl = article.querySelector('a[href*="/online-reader/"]');
      if (!linkEl) throw new Error('第 ' + page + ' 頁有書籍缺少閱讀連結，已中止同步。');
      const href = linkEl.getAttribute('href') || '';
      const url = new URL(href, location.origin);
      const readerMatch = url.pathname.match(/\/online-reader\/(\d+)/);
      const readerPathId = readerMatch ? readerMatch[1] : '';
      const elementId = url.searchParams.get('elementId') || '';
      if (!readerPathId || !/^\d+$/.test(readerPathId)) throw new Error('有書籍缺少有效的閱讀頁 ID，已中止同步。');
      if (!elementId || !/^\d+$/.test(elementId)) throw new Error('有書籍缺少有效的誠品 elementId，已中止同步。');
      if (seenElements.has(elementId)) throw new Error('發現重複誠品 elementId：' + elementId + '，已中止同步。');
      if (seenReaders.has(readerPathId)) throw new Error('發現重複誠品閱讀頁 ID：' + readerPathId + '，已中止同步。');
      seenElements.add(elementId);
      seenReaders.add(readerPathId);

      const title = article.querySelector('h3 a')?.textContent.trim()
        || article.querySelector('img.thumbnail-m')?.getAttribute('title')?.trim() || '';
      if (!title) throw new Error('誠品 elementId ' + elementId + ' 缺少書名，已中止同步。');
      const author = article.querySelector('.info-others .text-truncate')?.textContent.trim() || '';
      const style = article.querySelector('.progress-bar')?.getAttribute('style') || '';
      const percentMatch = style.match(/width:\s*(\d+(?:\.\d+)?)%/);
      const readPercent = percentMatch ? Number(percentMatch[1]) : null;
      const readStatus = readPercent === 100 ? 'Finished' : readPercent > 0 ? 'InProgress' : 'ReadyToRead';
      const detailLink = article.querySelector('a[href*="www.eslite.com/product/"]');
      const detailUrl = detailLink ? new URL(detailLink.href).href : '';

      books.push({
        source: SOURCE, title, authors: author ? [author] : [],
        series: null, genre: null, readStatus, readPercent,
        dateAdded: '', lastReadTime: '', isbn: '',
        esliteElementId: elementId,
        esliteReaderId: readerPathId,
        esliteProductId: detailUrl ? detailUrl.split('/').filter(Boolean).pop() : '',
        url: url.href,
      });
    }
    return books;
  }
  async function collectSnapshot() {
    const firstDoc = await fetchPage(1);
    const select = firstDoc.querySelector('.page-select select');
    const totalPages = select ? select.options.length : 1;
    if (!Number.isInteger(totalPages) || totalPages < 1) throw new Error('無法判斷誠品書櫃總頁數，已中止同步。');
    const seenElements = new Set();
    const seenReaders = new Set();
    const books = parsePage(firstDoc, 1, seenElements, seenReaders);
    console.log('[誠品同步] 書櫃共 ' + totalPages + ' 頁。');
    for (let page = 2; page <= totalPages; page++) {
      btn.textContent = '⏳ 擷取第 ' + page + '/' + totalPages + ' 頁';
      await sleep(700);
      const doc = await fetchPage(page);
      books.push(...parsePage(doc, page, seenElements, seenReaders));
    }
    if (!books.length) throw new Error('誠品擷取結果為空，已中止同步。');
    console.log('[誠品同步] 完整擷取 ' + books.length + ' 本書。');
    return books;
  }
  function gmRequest(options) {
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest !== 'function') {
        reject(new Error('目前 Userscript 管理器未提供 GM_xmlhttpRequest，請確認使用 Violentmonkey。'));
        return;
      }
      GM_xmlhttpRequest({
        ...options, onload: resolve,
        onerror: () => reject(new Error('無法連線到 Cloudflare Worker，請確認 Worker 網址及 @connect 權限。')),
        ontimeout: () => reject(new Error('連線 Cloudflare Worker 逾時。')),
      });
    });
  }
  async function uploadSnapshot(config, books, allowEmpty) {
    const payload = { source: SOURCE, complete: true, books };
    if (books.length === 0 && allowEmpty) payload.emptyConfirmed = true;
    const response = await gmRequest({
      method: 'POST', url: config.worker + '/api/sync',
      headers: { 'Authorization': 'Bearer ' + config.token, 'Content-Type': 'application/json' },
      data: JSON.stringify(payload), timeout: 60000,
    });
    let result = {};
    try { result = JSON.parse(response.responseText || '{}'); } catch {}
    if (response.status < 200 || response.status >= 300) throw new Error(result.error || 'Worker 回應錯誤（HTTP ' + response.status + '）');
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
        if (!lastSync) { console.log('[誠品同步] 尚未完成首次手動同步，略過自動同步。'); return; }
        if (Date.now() - lastSync < COOLDOWN_MS) { console.log('[誠品同步] 尚未到下次自動同步時間，略過。'); return; }
      }
      btn.textContent = '⏳ 正在檢查誠品書櫃…';
      const books = await collectSnapshot();
      if (books.length === 0 && (!manual || !confirm('誠品書櫃擷取結果為 0 本。只有在你確定書櫃真的為空時，才按「確定」清空雲端書單。'))) {
        throw new Error('空書單未經明確確認，不會上傳。');
      }
      btn.textContent = '☁️ 上傳 ' + books.length + ' 本…';
      const result = await uploadSnapshot(config, books, manual);
      await gmSet(KEYS.lastSync, Date.now());
      console.log('[誠品同步] 完成', result);
      alert('誠品同步完成：' + result.bookCount + ' 本書。\n同步時間：' + result.syncedAt);
    } catch (error) {
      console.error('[誠品同步] 失敗', error);
      alert('誠品同步未完成，雲端舊資料不會被更新。\n\n原因：' + (error.message || error));
    } finally {
      btn.textContent = '☁️ 同步誠品'; btn.disabled = false; settingsBtn.disabled = false; running = false;
    }
  }
  settingsBtn.addEventListener('click', configure);
  btn.addEventListener('click', () => syncNow({ manual: true }));
  syncNow({ automatic: true });
})();
