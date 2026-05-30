// ==UserScript==
// @name         Readmoo 電子書匯出
// @namespace    https://github.com/Rennll/ebook-library-scripts
// @version      1.0.0
// @description  匯出 Readmoo 電子書書單為標準 JSON 格式
// @author       Re
// @match        https://read.readmoo.com/*
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/Rennll/ebook-library-scripts/main/readmoo.user.js
// @updateURL    https://raw.githubusercontent.com/Rennll/ebook-library-scripts/main/readmoo.user.js
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
    background: '#e67e22',
    color: '#fff',
    border: 'none',
    borderRadius: '8px',
    fontSize: '14px',
    cursor: 'pointer',
    boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
  });
  document.body.appendChild(btn);

  btn.addEventListener('click', async () => {
    btn.textContent = '⏳ 抓取中...';
    btn.disabled = true;

    try {
      await run();
    } catch (e) {
      console.error('[Readmoo 匯出]', e);
      alert('匯出失敗，請開啟 Console 查看錯誤訊息。');
    } finally {
      btn.textContent = '📚 匯出書單';
      btn.disabled = false;
    }
  });

  async function run() {
    const books = [];

    document.querySelectorAll('.library-item').forEach(item => {
      const title = item.querySelector('.title')?.textContent.trim() || '';
      const author = item.querySelector('.author')?.textContent.trim() || '';

      const readerHref = item.querySelector('a.reader-link')?.getAttribute('href') || '';
      const readmooId = readerHref.split('/').filter(Boolean).pop() || '';

      const progressText = item.querySelector('.progress-row span')?.textContent.trim() || '';
      const percentMatch = progressText.match(/(\d+)%/);
      const readPercent = percentMatch ? parseInt(percentMatch[1], 10) : null;

      const readStatus = readPercent === 100 ? 'Finished'
        : readPercent > 0 ? 'InProgress'
        : 'ReadyToRead';

      books.push({
        source: 'readmoo',
        title,
        authors: author ? [author] : [],
        series: null,
        genre: null,
        readStatus,
        readPercent,
        dateAdded: '',
        lastReadTime: '',
        isbn: '',
        readmooId,
        url: `https://readmoo.com/book/${readmooId}`,
      });
    });

    const json = JSON.stringify(books, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `readmoo_library_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();

    console.log(`[Readmoo 匯出] 完成！共 ${books.length} 本書。`);
    console.table(books.slice(0, 5));
  }
})();
