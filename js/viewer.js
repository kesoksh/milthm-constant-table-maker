// js/viewer.js — 只读渲染层：Viewer.renderPage（预览与导出 PNG 共用）
  // 定数显示通用规则（新定数卡片与套用预览共用）：
  // ≤1 位小数的数值保留 1 位；≥2 位小数的数值（如 15.75）与带标记/多值字符串（如 3.25*）
  // 视为多指定数，原样输出
  function fmtChartConstant(c) {
    if (c === null || c === undefined || c === '') return '';
    if (typeof c === 'number') {
      if (!isFinite(c)) return '';
      return Math.abs(c * 10 - Math.round(c * 10)) < 1e-9 ? c.toFixed(1) : c.toFixed(2);
    }
    return String(c);
  }
  const Viewer = (function () {
    function getDiffClass(diff) {
      const map = { CB: 'diff-cb', DZ: 'diff-dz', SK: 'diff-sk', CL: 'diff-cl', SP: 'diff-sp' };
      return map[diff] || 'diff-cb';
    }
    function esc(s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
      }[c]));
    }
    function isUpperRange(range) {
      if (!range) return false;
      const m = String(range).match(/\.(\d)/);
      if (!m) return false;
      return parseInt(m[1], 10) >= 5;
    }
    function getSongTag(song) {
      if (!song) return '';
      if (song.tag !== undefined && song.tag !== null) return song.tag;
      if (song.name === 'Dogbite') return 'D';
      if (song.name === 'Chartreuse Green') return 'C';
      if (song.name === 'Psyched Fevereiro') return 'P';
      return '';
    }
    function renderPage(page, chartData, jacketMap, imgResolver) {
      if (!page) return '';
      const resolve = (fn) => {
        if (!fn) return '';
        if (imgResolver) { const r = imgResolver(fn); return r || fn; }
        return fn;
      };
      const isSpecial = page.type === 'special';
      const isNewConst = page.type === 'newconst';
      let sectionsHTML = '';
      if (isSpecial) {
        const songsHTML = (page.songs || []).map((song, songIdx) => {
          const filename = song.filename || (jacketMap && jacketMap[song.name]) || '';
          const src = resolve(filename);
          const diffClass = getDiffClass(song.difficulty);
          const constantText = (typeof song.constant === 'number' ? song.constant : 0).toFixed(2);
          const tagText = getSongTag(song);
          const songTag = tagText ? `<div class="special-tag">${esc(tagText)}</div>` : '';
          const imgTag = src ? `<img src="${esc(src)}" alt="${esc(song.name)}" loading="lazy" onerror="this.style.display='none'">` : '';
          return `<div class="special-row"><div class="special-jacket" data-jump="s:${songIdx}" title="点击定位到编辑器">${imgTag}</div><div class="special-info"><div class="special-song-name">${esc(song.name)}</div><div class="special-badges-row"><div class="special-diff-badge ${diffClass}">${esc(song.difficulty)}</div>${songTag}</div></div><div class="special-constant-pill"><span class="text">${constantText}</span></div></div>`;
        }).join('');
        sectionsHTML = `<div class="special-title"><div class="main">${esc(page.title || '')}</div><div class="sub">${esc(page.subtitle || '')}</div></div><div class="special-songs">${songsHTML}</div>`;
      } else if (isNewConst) {
        // 新定数页：曲绘 + 曲名 + 各难度定数的卡片列表
        const songsHTML = (page.songs || []).map((song, songIdx) => {
          const filename = song.filename || (jacketMap && jacketMap[song.name]) || '';
          const src = resolve(filename);
          const imgTag = src ? `<img src="${esc(src)}" alt="${esc(song.name)}" loading="lazy" onerror="this.style.display='none'">` : '';
          const chips = (song.diffs || []).map(d => {
            const c = fmtChartConstant(d.constant);
            const tag = d.tag ? `<span class="nc-tag">${esc(d.tag)}</span>` : '';
            return `<span class="nc-chip"><span class="badge-select-btn ${getDiffClass(d.difficulty)}">${esc(d.difficulty)}</span>${tag}<span class="nc-const">${c}</span></span>`;
          }).join('');
          return `<div class="nc-card"><div class="nc-jacket" data-jump="c:${songIdx}" title="点击定位到编辑器">${imgTag}</div><div class="nc-info"><div class="nc-name">${esc(song.name)}</div><div class="nc-diffrow">${chips}</div></div></div>`;
        }).join('');
        const titleBlock = (page.title || page.subtitle)
          ? `<div class="special-title"><div class="main">${esc(page.title || '')}</div><div class="sub">${esc(page.subtitle || '')}</div></div>` : '';
        sectionsHTML = titleBlock + `<div class="nc-list">${songsHTML}</div>`;
      } else {
        sectionsHTML = (page.sections || []).map((section, secIdx) => {
          const isUpper = isUpperRange(section.range);
          const barClass = isUpper ? 'bar-5' : 'bar-0';
          const rowsHTML = (section.decimals || []).map((dg, decIdx) => {
            const jacketsHTML = (dg.songs || []).map((song, songIdx) => {
              const filename = song.filename || (jacketMap && jacketMap[song.name]) || '';
              const src = resolve(filename);
              const diffClass = getDiffClass(song.difficulty);
              const tagText = getSongTag(song);
              const songTag = tagText ? `<div class="song-tag">${esc(tagText)}</div>` : '';
              if (src) {
                return `<div class="jacket" data-jump="n:${secIdx}:${decIdx}:${songIdx}" title="点击定位到编辑器"><img src="${esc(src)}" alt="${esc(song.name)}" loading="lazy" onerror="this.style.display='none'"><div class="diff-badge ${diffClass}">${esc(song.difficulty)}</div>${songTag}</div>`;
              }
              return `<div class="jacket" data-jump="n:${secIdx}:${decIdx}:${songIdx}" title="点击定位到编辑器" style="background:#30313b;display:flex;align-items:center;justify-content:center;font-size:8px;color:rgba(255,255,255,0.2);">${esc((song.name || '').slice(0, 4))}</div>`;
            }).join('');
            const ratingText = dg.decimal !== null && dg.decimal !== undefined ? `<span class="text c-${dg.decimal}">${esc(page.integer)}.${dg.decimal}</span>` : '';
            return `<div class="chart-row"><div class="rating-pill">${ratingText}</div><div class="jackets-box">${jacketsHTML}</div></div>`;
          }).join('');
          return `<div class="section-title"><div class="bar ${barClass}"></div><span class="text">${esc(section.range)}</span><div class="line"></div></div>${rowsHTML}`;
        }).join('');
      }
      const bgImage = resolve(page.bgImage || '');
      const milthmIcon = 'res/logo.png';
      const bigRatingHTML = (isSpecial || isNewConst) ? '' : `<div class="big-rating"><span class="num">${esc(page.integer)}</span></div>`;
      return `<div class="page${(isSpecial || isNewConst) ? ' special-page' : ''}"><div class="bg-layer"><img src="${esc(bgImage)}" alt="" onerror="this.style.display='none'"></div><div class="content"><div class="header"><div class="game-icon"><img src="${esc(milthmIcon)}" alt="Milthm" onerror="this.style.display='none'"></div><div class="header-text"><div class="logo-line"><span class="game-name">Milthm</span><span class="table-name">Chart Constant Table</span></div></div><span class="version-tag">Ver ${esc(chartData.version)}</span></div>${bigRatingHTML}${sectionsHTML}<div class="footer"><span class="credit">Made by KesoKsh. Special thanks: mkzi_nya, xyh5033 and so on.</span><span class="disclaimer">"Milthm Constant Table" is an unofficial project and has no affiliation with Milthm, Morizero, or IteraCoda.</span><span class="disclaimer">The images and constant resources come from the Milthm game itself.</span></div></div></div>`;
    }
    return { renderPage, isUpperRange };
  })();
