// ==UserScript==
// @name         Kobo 電子書雲端同步
// @namespace    https://github.com/Rennll/ebook-library-scripts
// @version      1.3.0
// @description  完整擷取 Kobo 書櫃並同步至個人 Cloudflare Worker
// @author       Re
// @match        https://www.kobo.com/tw/zh/library/books*
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/Rennll/ebook-library/main/kobo.user.js
// @updateURL    https://raw.githubusercontent.com/Rennll/ebook-library/main/kobo.user.js
// ==/UserScript==

(function () {
  'use strict';

  const SOURCE = 'kobo';
  const COOLDOWN_MS = 12 * 60 * 60 * 1000;
  const KEYS = {
    worker: 'ebookLibraryWorkerUrl',
    token: 'ebookLibraryDeviceToken',
    lastSync: 'ebookLibraryKoboLastSync',
  };

  const btn = makeButton('☁️ 同步 Kobo', 24);
  const settingsBtn = makeButton('⚙️ 同步設定', 82);
  document.body.append(btn, settingsBtn);

  let running = false;

  function makeButton(label, bottom) {
    const button = document.createElement('button');
    button.textContent = label;
    Object.assign(button.style, {
      position: 'fixed',
      bottom: bottom + 'px',
      right: '24px',
      zIndex: '99999',
      padding: '10px 16px',
      background: bottom === 24 ? '#176b87' : '#444',
      color: '#fff',
      border: 'none',
      borderRadius: '8px',
      fontSize: '14px',
      cursor: 'pointer',
      boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
    });
    return button;
  }

  settingsBtn.addEventListener('click', configure);
  btn.addEventListener('click', () => syncNow({ manual: true }));

  async function gmGet(key, fallback = null) {
    try {
      if (typeof GM_getValue === 'function') return await GM_getValue(key, fallback);
    } catch (error) {
      console.warn('[Kobo 同步] 讀取腳本設定失敗', error);
    }
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
    if (!/^https:\/\//i.test(worker)) {
      alert('Worker 網址必須以 https:// 開頭。');
      return;
    }

    const oldToken = await gmGet(KEYS.token, '');
    const token = prompt('請輸入這台設備的 device token。設定會保存在此瀏覽器的 Userscript 儲存區。', oldToken || '');
    if (token === null) return;
    if (!/^ebl_[a-f0-9]{64}$/i.test(token.trim())) {
      alert('Token 格式不正確。請確認是建立裝置時取得的完整 token。');
      return;
    }

    try {
      await gmSet(KEYS.worker, worker);
      await gmSet(KEYS.token, token.trim());
      alert('設定已儲存。此設定只存在目前瀏覽器的 Userscript 儲存區，不會寫入 GitHub。');
    } catch (error) {
      console.error('[Kobo 同步] 儲存設定失敗', error);
      alert(error.message || '儲存設定失敗。');
    }
  }

  async function getConfig() {
    const worker = await gmGet(KEYS.worker, '');
    const token = await gmGet(KEYS.token, '');
    if (!worker || !token) {
      alert('尚未設定 Worker 網址或 device token，請先按「同步設定」。');
      return null;
    }
    return { worker: worker.replace(/\/+$/, ''), token };
  }

  async function fetchPage(page) {
    let lastError;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetch(`/tw/zh/library/books?pageNumber=${page}`, {
          credentials: 'include',
          cache: 'no-store',
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.text();
      } catch (error) {
        lastError = error;
        if (attempt < 2) await sleep(1500 * (attempt + 1));
      }
    }
    throw lastError || new Error(`第 ${page} 頁讀取失敗`);
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function getPagination(doc) {
    const next = doc.querySelector('a.next[data-track-info]');
    if (!next) return { totalPages: 1, totalBooks: null, booksPerPage: null };

    let info;
    try {
      info = JSON.parse(next.dataset.trackInfo || '{}');
    } catch {
      throw new Error('無法解析 Kobo 分頁資訊，為避免不完整書單覆蓋雲端，已中止同步。');
    }

    const totalBooks = Number.parseInt(info.totalBooks, 10);
    const booksPerPage = Number.parseInt(info.booksDisplayed, 10);
    if (!Number.isFinite(totalBooks) || totalBooks <= 0 ||
        !Number.isFinite(booksPerPage) || booksPerPage <= 0) {
      throw new Error('Kobo 分頁資訊缺少有效的總書數或每頁書數，已中止同步。');
    }

    return {
      totalPages: Math.ceil(totalBooks / booksPerPage),
      totalBooks,
      booksPerPage,
    };
  }

  function parseBooks(doc) {
    const items = [...doc.querySelectorAll('li.item-wrapper.book')];
    if (!items.length) throw new Error('頁面沒有找到 Kobo 書籍項目，可能是登入逾時或頁面結構改變。');

    return items.map(li => {
      let trackInfo = {};
      try {
        trackInfo = JSON.parse(li.dataset.trackInfo || '{}');
      } catch {
        throw new Error('書籍項目的 track-info 格式錯誤，已中止同步。');
      }

      const title = String(trackInfo.title || li.querySelector('h2.title a')?.textContent || '').trim();
      const koboId = String(trackInfo.productId || '').trim();
      if (!title || !koboId) {
        throw new Error('有書籍缺少標題或 Kobo productId，已中止同步。');
      }

      const authors = [...li.querySelectorAll('.contributor-name')]
        .map(node => node.textContent.trim())
        .filter((value, index, array) => value && array.indexOf(value) === index);

      const href = li.querySelector('h2.title a')?.getAttribute('href') || '';
      const url = href
        ? (href.startsWith('http') ? href : new URL(href, 'https://www.kobo.com').href)
        : '';

      return {
        source: SOURCE,
        title,
        authors,
        series: li.querySelector('.series .product-sequence-field a')?.textContent.trim() || null,
        genre: li.querySelector('.genre.product-field')?.textContent.trim() || null,
        readStatus: trackInfo.readStatus || '',
        dateAdded: li.querySelector('.date-added')?.textContent.trim() || '',
        koboId,
        url,
      };
    });
  }

  async function collectSnapshot() {
    const parser = new DOMParser();
    const firstHtml = await fetchPage(1);
    const firstDoc = parser.parseFromString(firstHtml, 'text/html');
    const pagination = getPagination(firstDoc);
    const books = parseBooks(firstDoc);

    for (let page = 2; page <= pagination.totalPages; page++) {
      btn.textContent = `⏳ 擷取第 ${page}/${pagination.totalPages} 頁`;
      await sleep(700);
      const html = await fetchPage(page);
      const doc = parser.parseFromString(html, 'text/html');
      books.push(...parseBooks(doc));
    }

    const ids = new Set();
    for (const book of books) {
      if (ids.has(book.koboId)) throw new Error(`發現重複 Kobo ID：${book.koboId}，已中止同步。`);
      ids.add(book.koboId);
    }

    if (pagination.totalBooks !== null && books.length !== pagination.totalBooks) {
      throw new Error(`Kobo 顯示總書數為 ${pagination.totalBooks}，實際擷取 ${books.length} 本；數量不一致，已中止同步。`);
    }

    return books;
  }

  async function uploadSnapshot(config, books, allowEmpty) {
    const payload = {
      source: SOURCE,
      complete: true,
      books,
    };
    if (books.length === 0 && allowEmpty) payload.emptyConfirmed = true;

    const response = await fetch(config.worker + '/api/sync', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + config.token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    let result = {};
    try { result = await response.json(); } catch {}
    if (!response.ok) {
      throw new Error(result.error || `Worker 回應錯誤（HTTP ${response.status}）`);
    }
    return result;
  }

  async function syncNow({ manual = false, automatic = false } = {}) {
    if (running) return;
    running = true;
    btn.disabled = true;
    settingsBtn.disabled = true;
    const originalLabel = manual ? '☁️ 同步 Kobo' : '☁️ 同步 Kobo';

    try {
      const config = await getConfig();
      if (!config) return;

      if (automatic) {
        const lastSync = Number(await gmGet(KEYS.lastSync, 0));
        if (Date.now() - lastSync < COOLDOWN_MS) {
          console.log('[Kobo 同步] 尚未到下次自動同步時間，略過。');
          return;
        }
      }

      btn.textContent = '⏳ 正在檢查 Kobo 書櫃…';
      const books = await collectSnapshot();

      if (books.length === 0) {
        if (!manual || !confirm('Kobo 書櫃擷取結果為 0 本。這可能代表登入或頁面異常。\n\n只有在你確定書櫃真的為空時，才按「確定」將雲端 Kobo 書單清空。')) {
          throw new Error('空書單未經明確確認，不會上傳。');
        }
      }

      btn.textContent = `☁️ 上傳 ${books.length} 本…`;
      const result = await uploadSnapshot(config, books, manual);
      await gmSet(KEYS.lastSync, Date.now());
      console.log('[Kobo 同步] 完成', result);
      alert(`Kobo 同步完成：${result.bookCount} 本書。\n同步時間：${result.syncedAt}`);
    } catch (error) {
      console.error('[Kobo 同步] 失敗', error);
      alert('Kobo 同步未完成，雲端舊資料不會被更新。\n\n原因：' + (error.message || error));
    } finally {
      btn.textContent = originalLabel;
      btn.disabled = false;
      settingsBtn.disabled = false;
      running = false;
    }
  }

  // 進入書櫃頁時檢查冷卻時間；只有成功上傳後才更新時間戳。
  syncNow({ automatic: true });
})();
