// ==UserScript==
// @name         誠品電子書匯出
// @namespace    https://github.com/Rennll/ebook-library-scripts
// @version      1.0.0
// @description  匯出誠品電子書書單為標準 JSON 格式
// @author       Re
// @match        https://ebook.eslite.com/bookshelf*
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/Rennll/ebook-library-scripts/main/eslite.user.js
// @updateURL    https://raw.githubusercontent.com/Rennll/ebook-library-scripts/main/eslite.user.js
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
    background: '#2c3e50',
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
      console.error('[誠品匯出]', e);
      alert('匯出失敗，請開啟 Console 查看錯誤訊息。');
    } finally {
      btn.textContent = '📚 匯出書單';
      btn.disabled = false;
    }
  });

  async function run() {
    const delay = ms => new Promise(r => setTimeout(r, ms));
    const books = [];
    const seen = new Set();

    const parseHtml = (doc) => {
      doc.querySelectorAll('article.col').forEach(article => {
        const linkEl = article.querySelector('a[href*="productId"], a[href*="/online-reader/"]');
        if (!linkEl) return;

        const href = linkEl.getAttribute('href') || '';
        const productIdMatch = href.match(/productId=(\d+)/) || href.match(/\/online-reader\/(\d+)/);
        const elementIdMatch = href.match(/elementId=(\d+)/);
        const productId = productIdMatch?.[1] || '';
        const elementId = elementIdMatch?.[1] || '';

        if (seen.has(productId)) return;
        seen.add(productId);

        const title = article.querySelector('h3 a')?.textContent.trim()
          || article.querySelector('img.thumbnail-m')?.getAttribute('title')?.trim()
          || '';
        const author = article.querySelector('.info-others .text-truncate')?.textContent.trim() || '';

        const progressStyle = article.querySelector('.progress-bar')?.getAttribute('style') || '';
        const percentMatch = progressStyle.match(/width:\s*(\d+)%/);
        const readPercent = percentMatch ? parseInt(percentMatch[1], 10) : null;
        const readStatus = readPercent === 100 ? 'Finished'
          : readPercent > 0 ? 'InProgress' : 'ReadyToRead';

        const esliteHref = article.querySelector('a[href*="eslite.com/product"]')?.getAttribute('href') || '';
        const esliteProductId = esliteHref.split('/').filter(Boolean).pop() || '';

        books.push({
          source: 'eslite',
          title,
          authors: author ? [author] : [],
          series: null,
          genre: null,
          readStatus,
          readPercent,
          dateAdded: '',
          lastReadTime: '',
          isbn: '',
          esliteProductId,
          pubuProductId: productId,
          pubuElementId: elementId,
          url: esliteHref || `https://www.pubu.com.tw/ebook/${productId}`,
        });
      });
    };

    const firstRes = await fetch('/bookshelf?page=1', { credentials: 'include' });
    const firstHtml = await firstRes.text();
    const firstDoc = new DOMParser().parseFromString(firstHtml, 'text/html');

    const totalPages = firstDoc.querySelector('.page-select select')?.options.length || 1;
    console.log(`[誠品匯出] 共 ${totalPages} 頁`);
    parseHtml(firstDoc);

    for (let page = 2; page <= totalPages; page++) {
      btn.textContent = `⏳ 第 ${page} / ${totalPages} 頁...`;
      console.log(`[誠品匯出] 抓取第 ${page} 頁...`);
      const res = await fetch(`/bookshelf?page=${page}`, { credentials: 'include' });
      const html = await res.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      parseHtml(doc);
      await delay(800);
    }

    const json = JSON.stringify(books, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `eslite_library_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();

    console.log(`[誠品匯出] 完成！共 ${books.length} 本書。`);
    console.table(books.slice(0, 5));
  }
})();
