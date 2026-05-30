// ==UserScript==
// @name         博客來電子書匯出
// @namespace    https://github.com/Rennll/ebook-library-scripts
// @version      1.0.1
// @description  匯出博客來電子書書單為標準 JSON 格式
// @author       Re
// @match        https://viewer-ebook.books.com.tw/*
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/Rennll/ebook-library-scripts/main/books_com_tw.user.js
// @updateURL    https://raw.githubusercontent.com/Rennll/ebook-library-scripts/main/books_com_tw.user.js
// ==/UserScript==

(function () {
  'use strict';

  // --- 浮動按鈕 ---
  const btn = document.createElement('button');
  btn.textContent = '📚 匯出書單';
  Object.assign(btn.style, {
    position: 'fixed',
    bottom: '24px',
    right: '24px',
    zIndex: '99999',
    padding: '10px 18px',
    background: '#c0392b',
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
      console.error('[博客來匯出]', e);
      alert('匯出失敗，請開啟 Console 查看錯誤訊息。');
    } finally {
      btn.textContent = '📚 匯出書單';
      btn.disabled = false;
    }
  });

  // --- 主邏輯 ---
  async function run() {
    const delay = ms => new Promise(r => setTimeout(r, ms));
    const BASE_URL = 'https://appapi-ebook.books.com.tw/V1.7/CMSAPIApp/ReadList';
    const PAGE_SIZE = 40;
    const books = [];

    const fetchPage = async (offset) => {
      const body = new URLSearchParams({
        offset,
        page_size: PAGE_SIZE,
        sort_order: 'ReadTimeDesc',
        last_updated_time: '1900-01-01T00:00:00+08:00',
        eplanid: 'all',
        is_buyout: '',
        listname: '["all","trial"]',
        cat: 'all',
      });

      const res = await fetch(BASE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'Accept': 'application/json, text/javascript, */*; q=0.01',
        },
        credentials: 'include',
        body: body.toString(),
      });

      return res.json();
    };

    // 第一批，順便取得總筆數
    console.log('[博客來匯出] 抓取第 1 批...');
    const first = await fetchPage(0);
    const total = first.total_records;
    console.log(`[博客來匯出] 共 ${total} 本書`);
    first.records.forEach(r => books.push(r));

    const totalPages = Math.ceil(total / PAGE_SIZE);
    for (let page = 1; page < totalPages; page++) {
      const offset = page * PAGE_SIZE;
      btn.textContent = `⏳ 第 ${page + 1} / ${totalPages} 批...`;
      console.log(`[博客來匯出] 抓取第 ${page + 1} 批（offset ${offset}）...`);
      const data = await fetchPage(offset);
      data.records.forEach(r => books.push(r));
      await delay(600);
    }

    // 轉換成統一格式
    const normalized = books.map(r => {
      const info = r.item_info;
      return {
        source: 'books_com_tw',
        title: info.c_title || '',
        authors: info.author ? info.author.split(/[,，、]/).map(s => s.trim()) : [],
        series: null,
        genre: info.category || null,
        readStatus: info.percent === 100 ? 'Finished' : info.percent > 0 ? 'InProgress' : 'ReadyToRead',
        readPercent: info.percent ?? null,
        dateAdded: info.auth_time ? info.auth_time.slice(0, 10) : '',
        lastReadTime: info.last_read_time ? info.last_read_time.slice(0, 10) : '',
        isbn: info.isbn || '',
        booksId: info.item || '',
        url: `https://www.books.com.tw/products/${info.item}`,
      };
    });

    // 下載 JSON
    const json = JSON.stringify(normalized, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `books_com_tw_library_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();

    console.log(`[博客來匯出] 完成！共 ${normalized.length} 本書。`);
    console.table(normalized.slice(0, 5));
  }
})();