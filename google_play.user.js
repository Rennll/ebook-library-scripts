// ==UserScript==
// @name         Google Play 圖書匯出
// @namespace    https://github.com/Rennll/ebook-library-scripts
// @version      1.0.0
// @description  匯出 Google Play 圖書書單為標準 JSON 格式（自動捲動載入所有書目）
// @author       Re
// @match        https://play.google.com/books*
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/Rennll/ebook-library-scripts/main/google_play.user.js
// @updateURL    https://raw.githubusercontent.com/Rennll/ebook-library-scripts/main/google_play.user.js
// ==/UserScript==

(function () {
  'use strict';

  const btn = document.createElement('button');
  btn.textContent = '📚 匯出書單';
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
    cursor: 'pointer',
    boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
  });
  document.body.appendChild(btn);

  btn.addEventListener('click', async () => {
    btn.textContent = '⏳ 捲動載入中...';
    btn.disabled = true;

    try {
      await run();
    } catch (e) {
      console.error('[Google Play 匯出]', e);
      alert('匯出失敗，請開啟 Console 查看錯誤訊息。');
    } finally {
      btn.textContent = '📚 匯出書單';
      btn.disabled = false;
    }
  });

  async function scrollToLoadAll() {
    const delay = ms => new Promise(r => setTimeout(r, ms));
    const SCROLL_PAUSE = 1200; // 每次捲動後等待渲染的時間（ms）
    const MAX_ATTEMPTS = 60;   // 最多捲動次數，防止無限迴圈

    let prevCount = 0;
    let stableRounds = 0;

    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      window.scrollTo(0, document.body.scrollHeight);
      await delay(SCROLL_PAUSE);

      const current = document.querySelectorAll('gpb-library-card').length;
      console.log(`[Google Play 匯出] 已載入 ${current} 本...`);

      if (current === prevCount) {
        stableRounds++;
        if (stableRounds >= 3) {
          // 連續三次數量不變，確認已全部載入
          console.log('[Google Play 匯出] 書單載入完成');
          break;
        }
      } else {
        stableRounds = 0;
      }

      prevCount = current;
    }
  }

  async function run() {
    await scrollToLoadAll();

    const books = [];

    document.querySelectorAll('gpb-library-card').forEach(card => {
      const titleEl = card.querySelector('a.title');
      const authorEl = card.querySelector('a.author');
      const linkEl = card.querySelector('a.card-link');

      const title = titleEl?.textContent.trim() || '';
      const author = authorEl?.textContent.trim() || '';
      const href = linkEl?.getAttribute('href') || '';
      const googleId = new URL(href, 'https://play.google.com').searchParams.get('id') || '';

      books.push({
        source: 'google_play_books',
        title,
        authors: author ? [author] : [],
        series: null,
        genre: null,
        readStatus: null,
        readPercent: null,
        dateAdded: '',
        lastReadTime: '',
        isbn: '',
        googleBooksId: googleId,
        url: href,
      });
    });

    const json = JSON.stringify(books, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `google_play_books_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();

    console.log(`[Google Play 匯出] 完成！共 ${books.length} 本書。`);
    console.table(books.slice(0, 5));
  }
})();
