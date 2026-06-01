// ==UserScript==
// @name         Google Play 圖書匯出
// @namespace    https://github.com/Rennll/ebook-library-scripts
// @version      2.3.1
// @description  匯出 Google Play 圖書書單為標準 JSON 格式（XHR 攔截）
// @author       Re
// @match        https://play.google.com/books*
// @run-at       document-start
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/Rennll/ebook-library-scripts/main/google_play.user.js
// @updateURL    https://raw.githubusercontent.com/Rennll/ebook-library-scripts/main/google_play.user.js
// ==/UserScript==

(function () {
  'use strict';

  let capturedData = null;

  // 修正 1：改用標準的 apply(this, arguments) 確保參數完整性
  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    if (url && url.includes('SyncUserLibrary')) {
      this.addEventListener('load', function () {
        try {
          const res = JSON.parse(this.responseText);
          // 修正 2：加入防禦性型態檢查，確保資料符合陣列結構
          if (Array.isArray(res) && Array.isArray(res[0])) {
            capturedData = res;
            console.log('[Google Play 匯出] 書單資料已攔截，共', capturedData[0].length, '本書');
            updateBtn();
          } else {
            console.warn('[Google Play 匯出] 攔截到的資料格式不符預期', res);
          }
        } catch (e) {
          console.error('[Google Play 匯出] 解析失敗', e);
        }
      });
    }
    return origOpen.apply(this, arguments);
  };

  function injectBtn() {
    // 防止重複注入按鈕
    if (document.getElementById('__gpb_export_btn__')) return;

    const btn = document.createElement('button');
    btn.id = '__gpb_export_btn__';
    btn.textContent = '⏳ 等待書單載入...';
    Object.assign(btn.style, {
      position: 'fixed',
      bottom: '24px',
      right: '24px',
      zIndex: '99999',
      padding: '10px 18px',
      background: '#27ae60',
      color: '#fff',
      border: 'none',
      borderRadius: '8px',
      fontSize: '14px',
      cursor: 'not-allowed',
      boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
      opacity: '0.7',
    });
    document.body.appendChild(btn);

    btn.addEventListener('click', () => {
      if (!capturedData) {
        alert('書單尚未載入，請重新整理頁面再試。');
        return;
      }
      try {
        exportBooks();
      } catch (e) {
        console.error('[Google Play 匯出] 匯出失敗:', e);
        alert('匯出失敗：' + e.message);
      }
    });

    // 如果在按鈕生成前，XHR 就已經先回應了，在此補辦更新
    if (capturedData) updateBtn();
  }

  function updateBtn() {
    const btn = document.getElementById('__gpb_export_btn__');
    // 修正 3：若按鈕尚未生成（DOM 尚未準備好），不跳過，等 DOM 載入後由 injectBtn 處理
    if (!btn) return;

    const count = capturedData && capturedData[0] ? capturedData[0].length : '?';
    btn.textContent = `📚 匯出書單（${count} 本）`;
    btn.style.cursor = 'pointer';
    btn.style.opacity = '1';
  }

  function exportBooks() {
    // 修正 4：防禦性檢查，確保 rawBooks 為陣列才能執行 map
    const rawBooks = capturedData && capturedData[0] ? capturedData[0] : [];
    if (rawBooks.length === 0) {
      alert('沒有可匯出的書單資料。');
      return;
    }

    const microToDate = (val) => {
      if (!val) return '';
      const ms = Math.floor(Number(val) / 1000);
      if (!ms || isNaN(ms)) return '';
      return new Date(ms).toISOString().slice(0, 10);
    };

    // 商業邏輯完全保留不變
    const normalized = rawBooks.map(book => {
      const googleBooksId = book[0] || '';
      const info = Array.isArray(book[1]) ? book[1] : [];
      const userInfo = Array.isArray(book[2]) ? book[2] : [];

      const title = info[0] || '';
      const authors = Array.isArray(info[1]) ? info[1].map(a => String(a).trim()).filter(Boolean) : [];
      const publisher = info[2] || null;
      const language = info[8] || null;
      const storeUrl = info[9] || (googleBooksId ? `https://play.google.com/store/books/details?id=${googleBooksId}` : '');

      let genre = null;
      if (Array.isArray(info[21]) && info[21].length > 0) {
        const firstPath = info[21][0];
        if (Array.isArray(firstPath) && firstPath.length > 0) {
          const innerPath = firstPath[0];
          if (Array.isArray(innerPath)) {
            genre = innerPath.join(' > ') || null;
          }
        }
      }

      const dateAdded = microToDate(userInfo[1]);
      const lastReadTime = microToDate(userInfo[7]);

      return {
        source: 'google_play_books',
        title,
        authors,
        series: null,
        genre,
        readStatus: null,
        readPercent: null,
        dateAdded,
        lastReadTime,
        isbn: '',
        googleBooksId,
        url: storeUrl,
        publisher: publisher || null,
        language: language || null,
      };
    });

    const json = JSON.stringify(normalized, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    const blobUrl = URL.createObjectURL(blob);

    a.href = blobUrl;
    a.download = `google_play_books_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); // 確保在各瀏覽器觸發 click 時的相容性
    a.click();

    // 修正 5：清理 DOM 與釋放記憶體
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);

    console.log(`[Google Play 匯出] 完成！共 ${normalized.length} 本書。`);
    console.table(normalized.slice(0, 5));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectBtn);
  } else {
    injectBtn();
  }
})();