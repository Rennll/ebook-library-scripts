// ==UserScript==
// @name         Kobo 電子書匯出
// @namespace    https://github.com/Rennll/ebook-library-scripts
// @version      1.0.3
// @description  匯出 Kobo 電子書書單為標準 JSON 格式
// @author       Re
// @match        https://www.kobo.com/tw/zh/library/books*
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/Rennll/ebook-library-scripts/main/kobo.user.js
// @updateURL    https://raw.githubusercontent.com/Rennll/ebook-library-scripts/main/kobo.user.js
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
    background: '#1d6fa4',
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
      console.error('[Kobo 匯出]', e);
      alert('匯出失敗，請開啟 Console 查看錯誤訊息。');
    } finally {
      btn.textContent = '📚 匯出書單';
      btn.disabled = false;
    }
  });

  async function run() {
    const delay = ms => new Promise(r => setTimeout(r, ms));
    const books = [];

    const parseDoc = (doc) => {
      doc.querySelectorAll('li.item-wrapper.book').forEach(li => {
        const trackInfo = (() => {
          try { return JSON.parse(li.dataset.trackInfo); } catch { return {}; }
        })();

        const title = trackInfo.title
          || li.querySelector('h2.title a')?.textContent.trim()
          || '';

        const authors = [...li.querySelectorAll('.contributor-name')]
          .map(a => a.textContent.trim())
          .filter((v, i, arr) => arr.indexOf(v) === i);

        const koboUrl = li.querySelector('h2.title a')?.getAttribute('href') || '';
        const fullUrl = koboUrl.startsWith('http')
          ? koboUrl
          : `https://www.kobo.com${koboUrl}`;

        const dateAdded = li.querySelector('.date-added')?.textContent.trim() || '';
        const readStatus = trackInfo.readStatus || '';
        const series = li.querySelector('.series .product-sequence-field a')?.textContent.trim() || '';
        const genre = li.querySelector('.genre.product-field')?.textContent.trim() || '';
        const koboId = trackInfo.productId || '';

        books.push({
          source: 'kobo',
          title,
          authors,
          series: series || null,
          genre: genre || null,
          readStatus,
          dateAdded,
          koboId,
          url: fullUrl,
        });
      });
    };

    // 第一頁直接解析目前頁面
    parseDoc(document);

    const getTotalPages = () => {
      const finalLink = document.querySelector('.page-link.final');
      if (finalLink) {
        const n = parseInt(finalLink.textContent.trim(), 10);
       if (!isNaN(n)) return n;
      }
      return 1;
    };

    const totalPages = getTotalPages();
    console.log(`[Kobo 匯出] 共 ${totalPages} 頁`);

    for (let page = 2; page <= totalPages; page++) {
      btn.textContent = `⏳ 第 ${page} / ${totalPages} 頁...`;
      console.log(`[Kobo 匯出] 抓取第 ${page} 頁...`);
      const res = await fetch(`/tw/zh/library/books?pageNumber=${page}`, {
        credentials: 'include',
      });
      const html = await res.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      parseDoc(doc);
      await delay(800);
    }

    const json = JSON.stringify(books, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `kobo_library_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();

    console.log(`[Kobo 匯出] 完成！共 ${books.length} 本書。`);
    console.table(books.slice(0, 5));
  }
})();
