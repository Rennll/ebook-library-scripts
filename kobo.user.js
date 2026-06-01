// ==UserScript==
// @name         Kobo 電子書匯出
// @namespace    https://github.com/Rennll/ebook-library-scripts
// @version      1.2.1
// @description  匯出 Kobo 電子書書單為標準 JSON 格式（修正命名錯誤與動態分頁）
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
      console.error('[Kobo 匯出] 嚴重錯誤:', e);
      alert('匯出過程中發生嚴重錯誤，請開啟 Console 查看。');
    } finally {
      btn.textContent = '📚 匯出書單';
      btn.disabled = false;
    }
  });

  async function run() {
    const delay = ms => new Promise(r => setTimeout(r, ms));
    const books = [];
    const parser = new DOMParser();

    const parseDoc = (doc) => {
      const items = doc.querySelectorAll('li.item-wrapper.book');
      if (items.length === 0) return false;

      items.forEach(li => {
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
      return true;
    };

// 透過 next 按鈕的 track-info 精確計算總頁數
    const parseTotalPages = (doc) => {
      const nextBtn = doc.querySelector('a.next[data-track-info]');
      if (!nextBtn) return 1; // 如果找不到下一頁按鈕，代表只有 1 頁

      try {
        const trackInfo = JSON.parse(nextBtn.dataset.trackInfo);
        const totalBooks = parseInt(trackInfo.totalBooks, 10);
        const booksDisplayed = parseInt(trackInfo.booksDisplayed, 10);

        if (!isNaN(totalBooks) && !isNaN(booksDisplayed) && booksDisplayed > 0) {
          const pages = Math.ceil(totalBooks / booksDisplayed);
          console.log(`[Kobo 匯出] 偵測到總書籍數: ${totalBooks}, 每頁顯示: ${booksDisplayed}, 計算總頁數: ${pages}`);
          return pages;
        }
      } catch (e) {
        console.error('[Kobo 匯出] 解析分頁 JSON 失敗，嘗試後備方案', e);
      }

      // 後備方案：如果 JSON 解析失敗，嘗試從 href 抓取 pageNumber
      const match = nextBtn.getAttribute('href')?.match(/pageNumber=(\d+)/);
      return match ? parseInt(match[1], 10) : 1;
    };

    const fetchPageWithRetry = async (page, retries = 2) => {
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          const res = await fetch(`/tw/zh/library/books?pageNumber=${page}`, {
            credentials: 'include',
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return await res.text();
        } catch (err) {
          if (attempt === retries) throw err;
          console.warn(`[Kobo 匯出] 第 ${page} 頁失敗，2秒後重試...`, err);
          await delay(2000);
        }
      }
    };

    // --- 開始執行抓取 ---
    let totalPages = 1; 
    const failedPages = [];

    for (let page = 1; page <= totalPages; page++) {
      btn.textContent = `⏳ 第 ${page} / ${totalPages} 頁...`;
      console.log(`[Kobo 匯出] 抓取第 ${page} 頁...`);
      
      try {
        const html = await fetchPageWithRetry(page);
        const doc = parser.parseFromString(html, 'text/html');
        
        // 解析書籍資料
        const hasBooks = parseDoc(doc);
        
        // 修正處：精確調用已定義的 parseTotalPages 函式
        if (page === 1) {
          totalPages = parseTotalPages(doc);
          console.log(`[Kobo 匯出] 成功從第一頁解析出總頁數：${totalPages} 頁`);
        }

        if (!hasBooks) {
          console.warn(`[Kobo 匯出] 第 ${page} 頁未發現書籍資訊。`);
        }
      } catch (pageError) {
        console.error(`[Kobo 匯出] 第 ${page} 頁請求失敗。`, pageError);
        failedPages.push(page);
      }
      
      await delay(800);
    }

    // --- 匯出邏輯 ---
    if (books.length === 0) {
      alert('未抓取到任何書籍資料。');
      return;
    }

    const json = JSON.stringify(books, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    const downloadUrl = URL.createObjectURL(blob);
    a.href = downloadUrl;
    a.download = `kobo_library_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(downloadUrl);

    console.log(`[Kobo 匯出] 完成！共 ${books.length} 本書。`);
    if (failedPages.length > 0) {
      alert(`匯出完成，但第 ${failedPages.join(', ')} 頁抓取失敗。`);
    }
    console.table(books.slice(0, 5));
  }
})();