// js/main.js — 编辑器主逻辑（页面/区块/小数行/新定数/搜索体检/快照），入口 init() 见文件末尾
  const state = {
    data: { game: 'Milthm', version: '1.0', pages: [] },
    jacketMap: {},
    currentPageIndex: 0,
    undoStack: [],
    redoStack: [],
    maxHistory: 50,
    autoSaveTimer: null,
    isDirty: false,
    lastSaveTime: null
  };
  let localImages = {};
  let localThumbs = {};
  let _thumbPromises = {};
  let selectedSongs = new Set();

  function deepClone(o) { return JSON.parse(JSON.stringify(o)); }
  function getDiffClass(d) { const m = { CB: 'diff-cb', DZ: 'diff-dz', SK: 'diff-sk', CL: 'diff-cl', SP: 'diff-sp' }; return m[d] || 'diff-cb'; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  const THUMB_SIZE = 320;
  const THUMB_QUALITY = 0.72;

  function generateThumbnail(dataUrl) {
    return new Promise(resolve => {
      if (!dataUrl || !dataUrl.startsWith('data:image')) { resolve(dataUrl); return; }
      const img = new Image();
      img.onload = () => {
        try {
          const iw = img.naturalWidth || 1;
          const ih = img.naturalHeight || 1;
          const scale = Math.min(1, THUMB_SIZE / Math.max(iw, ih));
          const w = Math.max(1, Math.round(iw * scale));
          const h = Math.max(1, Math.round(ih * scale));
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', THUMB_QUALITY));
        } catch (e) { resolve(dataUrl); }
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  }

  // 资源路径解析：裸文件名 → res/illustration/<文件名>
  // 已经是路径（含 '/'）或远程/内联资源（data:/blob:/http）的值原样返回，
  // 因此旧版保存的「仅文件名」数据无需迁移。
  // 曲绘清单（由 tools/gen-manifest.ps1 生成，列出 res/illustration 下全部曲绘）：
  // 静态站点无法列目录，选择器靠它浏览/搜索所有曲绘；文件缺失时回退为空数组，行为等同旧版
  const ILLUSTRATION_MANIFEST = (typeof window !== 'undefined' && Array.isArray(window.ILLUSTRATION_MANIFEST)) ? window.ILLUSTRATION_MANIFEST : [];
  const MANIFEST_NAME = {};
  ILLUSTRATION_MANIFEST.forEach(e => { if (e && e.file) MANIFEST_NAME[e.file] = e.name || ''; });

  const ILLUSTRATION_DIR = 'res/illustration/';
  function resolveAssetUrl(filename) {
    if (!filename) return '';
    if (/^(data:|blob:|https?:|\/\/)/i.test(filename)) return filename;
    if (filename.indexOf('/') !== -1) return filename;
    return ILLUSTRATION_DIR + filename;
  }

  function getThumbOrFull(filename) {
    if (!filename) return '';
    if (localThumbs[filename]) return localThumbs[filename];
    return localImages[filename] || resolveAssetUrl(filename);
  }

  function ensureThumbFor(filename) {
    if (!filename) return Promise.resolve();
    if (localThumbs[filename]) return Promise.resolve();
    if (_thumbPromises[filename]) return _thumbPromises[filename];
    const full = localImages[filename];
    if (!full || !full.startsWith('data:image')) return Promise.resolve();
    _thumbPromises[filename] = generateThumbnail(full).then(thumb => {
      localThumbs[filename] = thumb;
      delete _thumbPromises[filename];
      return thumb;
    });
    return _thumbPromises[filename];
  }

  function ensureAllThumbs() {
    const names = Object.keys(localImages).filter(n => !localThumbs[n]);
    if (!names.length) return;
    let i = 0;
    function next() {
      if (i >= names.length) return;
      ensureThumbFor(names[i++]).then(() => next());
    }
    next();
  }

  function extractSongName(filename) {
    if (!filename) return '';
    // 支持带目录的文件名（如 res/illustration/xxx.png）：先取文件基名
    let name = String(filename).split(/[\\/]/).pop();
    name = name.replace(/\.(png|jpg|jpeg|gif|webp|bmp)$/i, '');
    name = name.replace(/^\(.*?Artwork\)/i, '').trim();
    const lastDashIdx = name.lastIndexOf(' - ');
    if (lastDashIdx > 0) name = name.substring(0, lastDashIdx).trim();
    return name.trim();
  }
  function getSongTagDisplay(song) {
    if (!song) return '';
    if (song.tag !== undefined && song.tag !== null) return song.tag;
    if (song.name === 'Dogbite') return 'D';
    if (song.name === 'Chartreuse Green') return 'C';
    if (song.name === 'Psyched Fevereiro') return 'P';
    return '';
  }
  function applyFilenameToSong(song, filename) {
    const oldName = song.name;
    song.filename = filename;
    const autoName = extractSongName(filename);
    if (autoName) {
      song.name = autoName;
      if (state.jacketMap[oldName] && oldName !== song.name) delete state.jacketMap[oldName];
      state.jacketMap[song.name] = filename;
    } else if (song.name) {
      state.jacketMap[song.name] = filename;
    }
    return autoName;
  }

  let toastTimer = null;
  function toast(msg, type) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = 'toast show' + (type ? ' ' + type : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = 'toast'; }, 2200);
  }
  function setStatus(text, cls) {
    const el = document.getElementById('footer-status');
    if (!el) return;
    el.textContent = text;
    el.className = 'save-status' + (cls ? ' ' + cls : '');
  }
  function updateSaveTime() {
    const el = document.getElementById('footer-save-time');
    if (!el) return;
    if (state.lastSaveTime) {
      const d = new Date(state.lastSaveTime);
      const pad = n => n < 10 ? '0' + n : n;
      el.textContent = '上次保存: ' + d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
    } else { el.textContent = '尚未保存'; }
  }
  function syncVersionInput() {
    const el = document.getElementById('version-input');
    if (el) el.value = state.data.version || '1.0';
  }

  function updateBatchBar() {
    const bar = document.getElementById('batch-bar');
    const cnt = document.getElementById('batch-count');
    if (!bar || !cnt) return;
    if (selectedSongs.size > 0) { bar.classList.add('active'); cnt.textContent = '已选 ' + selectedSongs.size + ' 首'; }
    else { bar.classList.remove('active'); }
  }
  function clearSelection() {
    selectedSongs.clear();
    document.querySelectorAll('.song-card.selected, .special-song-row.selected').forEach(el => el.classList.remove('selected'));
    updateBatchBar();
  }
  function batchDelete() {
    if (selectedSongs.size === 0) return;
    if (!confirm('确定删除选中的 ' + selectedSongs.size + ' 首歌曲？')) return;
    pushHistory();
    let count = 0;
    state.data.pages.forEach(page => {
      if (page.type === 'special') {
        if (page.songs) for (let i = page.songs.length - 1; i >= 0; i--) {
          if (selectedSongs.has(page.songs[i])) { page.songs.splice(i, 1); count++; }
        }
      } else {
        (page.sections || []).forEach(sec => (sec.decimals || []).forEach(dg => {
          if (dg.songs) for (let i = dg.songs.length - 1; i >= 0; i--) {
            if (selectedSongs.has(dg.songs[i])) { dg.songs.splice(i, 1); count++; }
          }
        }));
      }
    });
    selectedSongs.clear();
    renderAll();
    toast('已删除 ' + count + ' 首歌曲', 'success');
  }
  function batchSetBadge() {
    if (selectedSongs.size === 0) return;
    const count = selectedSongs.size;
    pickBadge(function (newDiff) {
      pushHistory();
      selectedSongs.forEach(song => { song.difficulty = newDiff; });
      renderEditor(); renderPreview();
      toast('已更新 ' + count + ' 首歌曲的角标为 ' + newDiff, 'success');
    });
  }

  function pushHistory() {
    state.undoStack.push(deepClone(state.data));
    if (state.undoStack.length > state.maxHistory) state.undoStack.shift();
    state.redoStack = [];
    updateHistoryButtons();
    markDirty();
  }
  // 与 pushHistory 相同，但压入调用方预先克隆的快照：
  // 用于「先修改、后判断有无变化」的规范化操作，避免无变化时污染撤销栈
  function commitHistory(snapshot) {
    state.undoStack.push(snapshot);
    if (state.undoStack.length > state.maxHistory) state.undoStack.shift();
    state.redoStack = [];
    updateHistoryButtons();
    markDirty();
  }
  function undo() {
    if (!state.undoStack.length) return;
    state.redoStack.push(deepClone(state.data));
    state.data = state.undoStack.pop();
    if (state.currentPageIndex >= state.data.pages.length) state.currentPageIndex = Math.max(0, state.data.pages.length - 1);
    selectedSongs.clear();
    renderAll(); updateHistoryButtons(); markDirty();
  }
  function redo() {
    if (!state.redoStack.length) return;
    state.undoStack.push(deepClone(state.data));
    state.data = state.redoStack.pop();
    if (state.currentPageIndex >= state.data.pages.length) state.currentPageIndex = Math.max(0, state.data.pages.length - 1);
    selectedSongs.clear();
    renderAll(); updateHistoryButtons(); markDirty();
  }
  function updateHistoryButtons() {
    document.getElementById('btn-undo').disabled = !state.undoStack.length;
    document.getElementById('btn-redo').disabled = !state.redoStack.length;
  }
  function markDirty() {
    state.isDirty = true;
    setStatus('未保存', 'dirty');
    clearTimeout(state.autoSaveTimer);
    state.autoSaveTimer = setTimeout(() => doSave(true), 1200);
  }
  function doSave(silent) {
    const ts = Storage.save(state.data, state.jacketMap, localImages, localThumbs);
    Storage.saveBlobs(localImages, localThumbs); // 异步写 IndexedDB，失败由其内部回退
    if (ts) {
      state.isDirty = false;
      state.lastSaveTime = ts;
      setStatus('已保存', 'saved');
      updateSaveTime();
      if (!silent) { createSnapshot('手动保存'); toast('已保存到本地存储', 'success'); }
    } else if (!silent) { toast('保存失败', 'error'); }
  }

  // ===== 快照：数据结构 + jacketMap 的检查点，不含曲绘图片 =====
  function createSnapshot(reason) {
    const payload = JSON.stringify({ data: state.data, jacketMap: state.jacketMap });
    const list = Storage.loadSnapshots();
    if (list[0] && JSON.stringify({ data: list[0].data, jacketMap: list[0].jacketMap }) === payload) return true;
    list.unshift({
      at: Date.now(), reason: reason || '',
      data: deepClone(state.data), jacketMap: deepClone(state.jacketMap)
    });
    while (list.length > Storage.SNAP_MAX) list.pop();
    return Storage.saveSnapshots(list);
  }
  function renderSnapshotList() {
    const box = document.getElementById('snapshot-list');
    if (!box) return;
    const list = Storage.loadSnapshots();
    box.innerHTML = list.length ? '' : '<div class="audit-empty">暂无快照</div>';
    list.forEach((snap, idx) => {
      const row = document.createElement('div');
      row.className = 'snapshot-row';
      const d = new Date(snap.at);
      const pad = n => n < 10 ? '0' + n : n;
      const time = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
        ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
      const pageCount = (snap.data && snap.data.pages) ? snap.data.pages.length : 0;
      row.innerHTML = '<span class="time">' + time + '</span><span class="why">' + esc(snap.reason || '') +
        '</span><span class="cnt">' + pageCount + ' 页</span><span class="acts">' +
        '<button class="restore">恢复</button><button class="del">删除</button></span>';
      row.querySelector('.restore').onclick = () => restoreSnapshot(idx);
      row.querySelector('.del').onclick = () => {
        if (!confirm('删除该快照？')) return;
        const l = Storage.loadSnapshots();
        l.splice(idx, 1);
        Storage.saveSnapshots(l);
        renderSnapshotList();
      };
      box.appendChild(row);
    });
  }
  function openSnapshots() {
    renderSnapshotList();
    document.getElementById('modal-snapshot').classList.add('active');
  }
  function restoreSnapshot(idx) {
    const snap = Storage.loadSnapshots()[idx];
    if (!snap || !snap.data) { toast('快照无效', 'error'); return; }
    if (!confirm('恢复到该快照？当前数据会先存入快照。')) return;
    createSnapshot('恢复前');
    pushHistory();
    state.data = deepClone(snap.data);
    state.jacketMap = deepClone(snap.jacketMap || {});
    state.currentPageIndex = 0;
    selectedSongs.clear();
    invalidatePreview();
    renderAll();
    doSave(true);
    toast('已恢复快照', 'success');
    renderSnapshotList();
  }

  let dragSrcPageIdx = null;
  function renderSidebar() {
    const el = document.getElementById('page-list');
    el.innerHTML = '';
    state.data.pages.forEach((page, idx) => {
      const item = document.createElement('div');
      const isNC = page.type === 'newconst';
      item.className = 'page-item' + (idx === state.currentPageIndex ? ' active' : '') + (page.type === 'special' ? ' special' : (isNC ? ' nc' : ''));
      item.draggable = true;
      item.dataset.idx = idx;
      const label = page.type === 'special' ? (page.title || 'SP') : (isNC ? (page.title || 'NC') : page.integer);
      const tag = page.type === 'special' ? '特殊' : (isNC ? '新定数' : ((page.sections || []).length + ' 区块'));
      item.innerHTML = `<span class="page-label">${esc(label)}</span><span class="tag">${tag}</span><button class="page-del" draggable="false" title="删除该页面">×</button>`;
      item.addEventListener('click', () => { state.currentPageIndex = idx; renderAll(); });
      item.querySelector('.page-del').addEventListener('click', (e) => {
        e.stopPropagation();
        if (!confirm('确定删除该页面？')) return;
        pushHistory();
        state.data.pages.splice(idx, 1);
        if (state.currentPageIndex > idx) state.currentPageIndex--;
        else if (state.currentPageIndex === idx) {
          if (state.currentPageIndex >= state.data.pages.length) state.currentPageIndex = Math.max(0, state.data.pages.length - 1);
        }
        renderAll(); toast('已删除页面', 'success');
      });
      item.addEventListener('dragstart', (e) => {
        dragSrcPageIdx = idx;
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', 'page:' + idx); } catch (err) {}
        item.classList.add('dragging');
      });
      item.addEventListener('dragend', () => { item.classList.remove('dragging'); dragSrcPageIdx = null; });
      item.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; item.classList.add('drag-over'); });
      item.addEventListener('dragleave', () => item.classList.remove('drag-over'));
      item.addEventListener('drop', (e) => {
        e.preventDefault(); item.classList.remove('drag-over');
        if (dragSrcPageIdx === null || dragSrcPageIdx === idx) return;
        pushHistory();
        const [moved] = state.data.pages.splice(dragSrcPageIdx, 1);
        state.data.pages.splice(idx, 0, moved);
        state.currentPageIndex = idx;
        renderAll(); toast('已调整页面顺序', 'success');
      });
      el.appendChild(item);
    });

    const addBtn = document.createElement('button');
    addBtn.className = 'add-btn';
    addBtn.textContent = '+ 添加页面';
    addBtn.addEventListener('click', addNewPage);
    el.appendChild(addBtn);

    const addSpecialBtn = document.createElement('button');
    addSpecialBtn.className = 'add-btn special-btn';
    addSpecialBtn.textContent = '+ 特殊页面';
    addSpecialBtn.addEventListener('click', addNewSpecialPage);
    el.appendChild(addSpecialBtn);

    const addNcBtn = document.createElement('button');
    addNcBtn.className = 'add-btn nc-btn';
    addNcBtn.textContent = '+ 新定数页';
    addNcBtn.addEventListener('click', addNewConstPage);
    el.appendChild(addNcBtn);
  }

  function renderEditor() {
    const panel = document.getElementById('editor-panel');
    const page = state.data.pages[state.currentPageIndex];
    if (!page) {
      panel.innerHTML = '<div class="empty-hint"><strong>暂无数据</strong><br>点击左侧「+ 添加页面」「+ 特殊页面」或「+ 新定数页」开始构建<br>或点击「导入 JSON」载入现有数据</div>';
      return;
    }
    if (page.type === 'special') renderSpecialEditor(panel, page);
    else if (page.type === 'newconst') renderNewconstEditor(panel, page);
    else renderNormalEditor(panel, page);
    updateBatchBar();
  }

  function bgPreviewHtml(bgImage) {
    if (!bgImage) return '<span>无</span>';
    const src = getThumbOrFull(bgImage);
    return `<img src="${esc(src)}" alt="" loading="lazy" onerror="this.style.display='none';this.parentNode.innerHTML='<span>无</span>'">`;
  }

  function renderNormalEditor(panel, page) {
    panel.innerHTML = '';
    const info = document.createElement('div');
    info.className = 'page-info';
    info.innerHTML = `
      <label>整数</label>
      <input type="text" class="int-input" value="${esc(page.integer)}" id="input-int">
      <label>背景图</label>
      <div class="bg-preview" id="bg-preview" title="${esc(page.bgImage || '')}">${bgPreviewHtml(page.bgImage)}</div>
      <button class="btn" id="btn-pick-bg">选择</button>
    `;
    panel.appendChild(info);
    document.getElementById('input-int').addEventListener('change', function () {
      pushHistory(); page.integer = this.value; renderSidebar(); renderPreview();
    });
    document.getElementById('btn-pick-bg').addEventListener('click', () => {
      pickImage(function (filename) {
        pushHistory(); page.bgImage = filename;
        const prev = document.getElementById('bg-preview');
        if (prev) { prev.innerHTML = bgPreviewHtml(filename); prev.title = filename; }
        renderPreview();
        toast('已更新背景图', 'success');
      });
    });
    (page.sections || []).forEach((section, secIdx) => { panel.appendChild(buildSection(page, section, secIdx)); });
    const addSec = document.createElement('button');
    addSec.className = 'add-section-btn';
    addSec.textContent = '+ 添加区块';
    addSec.addEventListener('click', () => {
      pushHistory();
      page.sections = page.sections || [];
      page.sections.push({ range: page.integer + '.0-' + page.integer + '.4', decimals: [] });
      renderEditor(); renderPreview();
    });
    panel.appendChild(addSec);
  }

  // ===== 曲目拖拽移动：跨行 / 跨区块 / 跨页 / 普通页⇄特殊页 =====
  let dragSrcSong = null; // { song, fromSpecial, pageIdx, secIdx, decIdx, songIdx }
  function getSrcSongArray(src) {
    const page = state.data.pages[src.pageIdx];
    if (!page) return null;
    if (src.fromSpecial) return page.songs || null;
    const sec = (page.sections || [])[src.secIdx];
    if (!sec) return null;
    const dg = (sec.decimals || [])[src.decIdx];
    return dg ? (dg.songs || null) : null;
  }
  function validateMoveSrc(src) {
    const arr = getSrcSongArray(src);
    if (arr && arr[src.songIdx] === src.song) return true;
    toast('移动失败：数据已变化', 'error');
    return false;
  }
  // 移入普通小数行：insertIdx 为该行内插入位置
  function moveSongToRow(src, pageIdx, secIdx, decIdx, insertIdx) {
    const page = state.data.pages[pageIdx];
    const sec = page && (page.sections || [])[secIdx];
    const dg = sec && (sec.decimals || [])[decIdx];
    if (!dg) { toast('移动失败：目标行不存在', 'error'); return false; }
    if (!validateMoveSrc(src)) return false;
    pushHistory();
    const song = getSrcSongArray(src).splice(src.songIdx, 1)[0];
    dg.songs = dg.songs || [];
    // 同一行内移动：移除导致的下标偏移
    if (src.pageIdx === pageIdx && src.secIdx === secIdx && src.decIdx === decIdx && insertIdx > src.songIdx) insertIdx--;
    insertIdx = Math.max(0, Math.min(insertIdx, dg.songs.length));
    dg.songs.splice(insertIdx, 0, song);
    return true;
  }
  // 移入特殊页：insertIdx 为 songs 内位置；源为普通行时按原定数补算常数
  function moveSongToSpecial(src, pageIdx, insertIdx) {
    const target = state.data.pages[pageIdx];
    if (!target || target.type !== 'special') { toast('移动失败：目标不是特殊页', 'error'); return false; }
    if (!validateMoveSrc(src)) return false;
    pushHistory();
    const song = getSrcSongArray(src).splice(src.songIdx, 1)[0];
    target.songs = target.songs || [];
    insertIdx = Math.max(0, Math.min(insertIdx, target.songs.length));
    if (!src.fromSpecial && typeof song.constant !== 'number') {
      const sp = state.data.pages[src.pageIdx];
      const sec = sp && (sp.sections || [])[src.secIdx];
      const dg = sec && (sec.decimals || [])[src.decIdx];
      const N = sp ? String(sp.integer == null ? '' : sp.integer).trim() : '';
      if (dg && /^\d+$/.test(N) && typeof dg.decimal === 'number') song.constant = Number(N + '.' + dg.decimal);
    }
    target.songs.splice(insertIdx, 0, song);
    return true;
  }

  // ===== 页面级 0–9 小数行规范化 =====
  // 表格规范（依据导出的正式数据）：每页两个区块
  //   上区块 N.5-N.9，行降序 [9,8,7,6,5]
  //   下区块 N.0-N.4，行降序 [4,3,2,1,0]
  // range 是自由文本，这里用正则分类：首个小数位 >=5 → upper，否则 → lower；匹配不上（如 Unknown）不动
  function classifyRange(range) {
    const m = String(range == null ? '' : range).match(/(\d+)\.(\d)\s*[-~–—]\s*(\d+)\.(\d)/);
    if (!m) return null;
    return parseInt(m[2], 10) >= 5 ? 'upper' : 'lower';
  }

  function addDecimalRowsBulk(page) {
    const raw = String(page.integer == null ? '' : page.integer).trim();
    const mInt = raw.match(/^\d+/);
    if (!mInt) { toast('请先设置本页整数', 'error'); return; }
    const N = mInt[0];
    page.sections = page.sections || [];
    // 先取快照（pushHistory 是先克隆后修改，本操作必须先改后判，故自行快照 + commitHistory）
    const snapshot = deepClone(state.data);

    let createdSections = 0, filledRows = 0, movedRows = 0;

    // 1) 定位/创建两个目标区块；adopted 区块 range 与规范不符时改写
    let secU = page.sections.find(s => classifyRange(s.range) === 'upper');
    let secL = page.sections.find(s => classifyRange(s.range) === 'lower');
    const upperRange = N + '.5-' + N + '.9';
    const lowerRange = N + '.0-' + N + '.4';
    if (!secU) {
      secU = { range: upperRange, decimals: [] };
      page.sections.splice(secL ? page.sections.indexOf(secL) : page.sections.length, 0, secU);
      createdSections++;
    } else if (secU.range !== upperRange) {
      secU.range = upperRange;
    }
    if (!secL) {
      secL = { range: lowerRange, decimals: [] };
      page.sections.splice(page.sections.indexOf(secU) + 1, 0, secL);
      createdSections++;
    } else if (secL.range !== lowerRange) {
      secL.range = lowerRange;
    }
    secU.decimals = secU.decimals || [];
    secL.decimals = secL.decimals || [];

    // 2) 把放错位置的小数行搬到目标区块（搬原对象，曲目引用不丢）；null 行原地不动
    page.sections.forEach(sec => {
      if (sec === secU || sec === secL || !sec.decimals) return;
      for (let i = sec.decimals.length - 1; i >= 0; i--) {
        const d = sec.decimals[i].decimal;
        if (typeof d !== 'number' || isNaN(d)) continue;
        const [row] = sec.decimals.splice(i, 1);
        (d >= 5 ? secU : secL).decimals.push(row);
        movedRows++;
      }
    });
    [secU, secL].forEach(sec => {
      for (let i = sec.decimals.length - 1; i >= 0; i--) {
        const d = sec.decimals[i].decimal;
        if (typeof d !== 'number' || isNaN(d)) continue;
        const target = d >= 5 ? secU : secL;
        if (target === sec) continue;
        const [row] = sec.decimals.splice(i, 1);
        target.decimals.push(row);
        movedRows++;
      }
    });

    // 3) 补齐缺失行（按降序位置插入）
    [[secU, [9, 8, 7, 6, 5]], [secL, [4, 3, 2, 1, 0]]].forEach(pair => {
      const sec = pair[0], want = pair[1];
      const have = new Set(sec.decimals.map(dg => (typeof dg.decimal === 'number' && !isNaN(dg.decimal)) ? dg.decimal : NaN));
      want.filter(d => !have.has(d)).forEach(d => {
        let idx = sec.decimals.findIndex(dg => typeof dg.decimal === 'number' && !isNaN(dg.decimal) && dg.decimal < d);
        if (idx === -1) idx = sec.decimals.length;
        sec.decimals.splice(idx, 0, { decimal: d, songs: [] });
        filledRows++;
      });
    });

    // 4) 两个目标区块降序排列（数值行在前、null 行置尾）；Array#sort 稳定，null 行相对顺序不变
    [secU, secL].forEach(sec => {
      sec.decimals.sort((a, b) => {
        const av = (typeof a.decimal === 'number' && !isNaN(a.decimal)) ? a.decimal : null;
        const bv = (typeof b.decimal === 'number' && !isNaN(b.decimal)) ? b.decimal : null;
        if (av === null && bv === null) return 0;
        if (av === null) return 1;
        if (bv === null) return -1;
        return bv - av;
      });
    });

    // 5) 无变化 → 不进撤销栈（幂等）；有变化 → 提交快照
    if (JSON.stringify(snapshot) === JSON.stringify(state.data)) {
      toast('0–9 小数行已齐全');
      return;
    }
    commitHistory(snapshot);
    renderEditor(); renderPreview();
    const parts = [];
    if (createdSections) parts.push('新建 ' + createdSections + ' 个区块');
    if (filledRows) parts.push('补齐 ' + filledRows + ' 行');
    if (movedRows) parts.push('归位 ' + movedRows + ' 行');
    if (!parts.length) parts.push('已修正区块范围');
    toast(parts.join('、'), 'success');
  }

  function buildSection(page, section, secIdx) {
    const block = document.createElement('div');
    block.className = 'section-block';
    block.dataset.secIdx = secIdx;
    const header = document.createElement('div');
    header.className = 'section-header';
    header.innerHTML = `<div class="bar"></div><input type="text" class="range-input" value="${esc(section.range)}"><div class="actions"><button class="bulk" title="补齐本页 0–9：自动生成 .5–.9 与 .0–.4 两个区块">+0–9</button><button class="danger delete" title="删除该区块">×</button></div>`;
    block.appendChild(header);
    header.querySelector('.range-input').addEventListener('change', function () { pushHistory(); section.range = this.value; renderPreview(); });
    header.querySelector('.bulk').addEventListener('click', () => addDecimalRowsBulk(page));
    header.querySelector('.delete').addEventListener('click', () => {
      if (!confirm('确定删除该区块？')) return;
      pushHistory(); page.sections.splice(secIdx, 1); renderEditor(); renderPreview();
      toast('已删除区块', 'success');
    });
    (section.decimals || []).forEach((dg, decIdx) => { block.appendChild(buildDecimalRow(page, section, dg, secIdx, decIdx)); });
    const addDec = document.createElement('button');
    addDec.className = 'add-decimal-btn';
    addDec.textContent = '+ 添加小数行';
    addDec.addEventListener('click', () => {
      pushHistory();
      section.decimals = section.decimals || [];
      section.decimals.push({ decimal: 0, songs: [] });
      renderEditor(); renderPreview();
    });
    block.appendChild(addDec);
    return block;
  }

  function buildDecimalRow(page, section, dg, secIdx, decIdx) {
    const row = document.createElement('div');
    row.className = 'decimal-row';
    row.dataset.secIdx = secIdx; row.dataset.decIdx = decIdx;
    const label = document.createElement('div');
    label.className = 'decimal-label';
    if (dg.decimal !== null && dg.decimal !== undefined) label.classList.add('c-' + dg.decimal);
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.textContent = '.';
    if (dg.decimal === null || dg.decimal === undefined) dot.classList.add('hidden');
    label.appendChild(dot);
    const decInput = document.createElement('input');
    decInput.type = 'text';
    decInput.value = dg.decimal !== null && dg.decimal !== undefined ? dg.decimal : '';
    decInput.placeholder = '-';
    decInput.addEventListener('change', function () {
      pushHistory();
      const v = this.value.trim();
      dg.decimal = v === '' ? null : parseInt(v, 10);
      if (isNaN(dg.decimal) && v !== '') dg.decimal = null;
      renderEditor(); renderPreview();
    });
    label.appendChild(decInput);
    row.appendChild(label);
    row.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; row.classList.add('drag-over'); });
    row.addEventListener('dragleave', (e) => { if (!row.contains(e.relatedTarget)) row.classList.remove('drag-over'); });
    row.addEventListener('drop', (e) => {
      e.preventDefault(); row.classList.remove('drag-over');
      try {
        const d = JSON.parse(e.dataTransfer.getData('text/plain'));
        if (d.type === 'song') {
          if (!dragSrcSong) return;
          const songsEl = row.querySelector('.songs');
          const cards = songsEl ? Array.from(songsEl.querySelectorAll('.song-card')) : [];
          let idx = cards.length;
          for (let i = 0; i < cards.length; i++) {
            const r = cards[i].getBoundingClientRect();
            if (e.clientX < r.left + r.width / 2) { idx = i; break; }
          }
          if (moveSongToRow(dragSrcSong, state.currentPageIndex, secIdx, decIdx, idx)) {
            renderAll();
            toast('已移动曲目', 'success');
          }
          return;
        }
      } catch (err) {}
    });
    const songs = document.createElement('div');
    songs.className = 'songs';
    (dg.songs || []).forEach((song, songIdx) => { songs.appendChild(buildSongCard(song, secIdx, decIdx, songIdx)); });
    const addSong = document.createElement('button');
    addSong.className = 'add-song-btn';
    addSong.textContent = '+';
    addSong.addEventListener('click', () => { pushHistory(); dg.songs = dg.songs || []; dg.songs.push({ name: '新曲目', difficulty: 'CB', filename: '' }); renderEditor(); renderPreview(); });
    songs.appendChild(addSong);
    row.appendChild(songs);
    const delBtn = document.createElement('button');
    delBtn.className = 'decimal-del';
    delBtn.textContent = '×';
    delBtn.title = '删除该小数行';
    delBtn.addEventListener('click', () => {
      if (!confirm('确定删除该小数行？')) return;
      pushHistory(); section.decimals.splice(decIdx, 1); renderEditor(); renderPreview();
      toast('已删除小数行', 'success');
    });
    row.appendChild(delBtn);
    return row;
  }

  function buildSongCard(song, secIdx, decIdx, songIdx) {
    const card = document.createElement('div');
    card.className = 'song-card';
    card.dataset.songIdx = songIdx;
    if (selectedSongs.has(song)) card.classList.add('selected');

    const imgWrap = document.createElement('div');
    imgWrap.className = 'song-img';
    imgWrap.draggable = true; // 曲绘区作为拖拽把手，下方输入框/按钮不受影响
    imgWrap.addEventListener('dragstart', (e) => {
      e.dataTransfer.effectAllowed = 'move';
      dragSrcSong = { song, fromSpecial: false, pageIdx: state.currentPageIndex, secIdx, decIdx, songIdx };
      try { e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'song' })); } catch (err) {}
      card.classList.add('dragging');
    });
    imgWrap.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      dragSrcSong = null;
      document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    });
    const src = song.filename ? getThumbOrFull(song.filename) : '';
    if (src) {
      const img = document.createElement('img');
      img.src = src; img.alt = song.name; img.loading = 'lazy';
      img.onerror = function () { this.style.display = 'none'; const ph = document.createElement('div'); ph.className = 'ph'; ph.textContent = (song.name || '').slice(0, 6); imgWrap.appendChild(ph); };
      imgWrap.appendChild(img);
    } else {
      const ph = document.createElement('div'); ph.className = 'ph'; ph.textContent = (song.name || '').slice(0, 6); imgWrap.appendChild(ph);
    }
    const badge = document.createElement('div');
    badge.className = 'badge ' + getDiffClass(song.difficulty);
    badge.textContent = song.difficulty;
    badge.title = '点击修改角标';
    badge.addEventListener('click', (e) => {
      e.stopPropagation();
      pickBadge(function (d) { pushHistory(); song.difficulty = d; renderEditor(); renderPreview(); toast('已更新角标', 'success'); });
    });
    imgWrap.appendChild(badge);

    const displayTag = getSongTagDisplay(song);
    if (displayTag) {
      const tagEl = document.createElement('div');
      tagEl.className = 'song-tag';
      tagEl.textContent = displayTag;
      tagEl.title = '点击修改标签';
      tagEl.addEventListener('click', (e) => {
        e.stopPropagation();
        pickTag(displayTag, function (newTag) {
          pushHistory();
          song.tag = newTag;
          renderEditor(); renderPreview();
          toast(newTag ? '已设置标签: ' + newTag : '已移除标签', 'success');
        });
      });
      imgWrap.appendChild(tagEl);
    }

    imgWrap.addEventListener('click', () => {
      if (selectedSongs.has(song)) { selectedSongs.delete(song); card.classList.remove('selected'); }
      else { selectedSongs.add(song); card.classList.add('selected'); }
      updateBatchBar();
    });

    card.appendChild(imgWrap);

    const actions = document.createElement('div');
    actions.className = 'actions';
    actions.innerHTML = `<button class="pick-img" title="选择曲绘">图</button><button class="pick-tag" title="特殊标签">签</button><button class="danger del" title="删除">删</button>`;
    actions.querySelector('.pick-img').addEventListener('click', () => {
      pickImage(function (filename) {
        pushHistory();
        const autoName = applyFilenameToSong(song, filename);
        renderEditor(); renderPreview();
        toast('已更新曲绘' + (autoName ? ' · 曲名: ' + autoName : ''), 'success');
      });
    });
    actions.querySelector('.pick-tag').addEventListener('click', () => {
      pickTag(getSongTagDisplay(song), function (newTag) {
        pushHistory();
        song.tag = newTag;
        renderEditor(); renderPreview();
        toast(newTag ? '已设置标签: ' + newTag : '已移除标签', 'success');
      });
    });
    actions.querySelector('.del').addEventListener('click', () => {
      pushHistory();
      selectedSongs.delete(song);
      const grp = state.data.pages[state.currentPageIndex].sections[secIdx].decimals[decIdx];
      grp.songs.splice(songIdx, 1);
      renderEditor(); renderPreview();
    });
    card.appendChild(actions);

    const nameInput = document.createElement('input');
    nameInput.className = 'name-input';
    nameInput.value = song.name;
    nameInput.placeholder = '曲名';
    nameInput.addEventListener('change', function () {
      pushHistory();
      const oldName = song.name;
      song.name = this.value;
      if (state.jacketMap[oldName] && oldName !== song.name) { state.jacketMap[song.name] = state.jacketMap[oldName]; delete state.jacketMap[oldName]; }
      renderPreview();
    });
    card.appendChild(nameInput);
    return card;
  }

  function renderSpecialEditor(panel, page) {
    panel.innerHTML = '';
    const info = document.createElement('div');
    info.className = 'page-info';
    info.innerHTML = `
      <label>标题</label>
      <input type="text" value="${esc(page.title || '')}" id="sp-title">
      <label>副标题</label>
      <input type="text" value="${esc(page.subtitle || '')}" id="sp-subtitle">
      <label>背景图</label>
      <div class="bg-preview" id="bg-preview" title="${esc(page.bgImage || '')}">${bgPreviewHtml(page.bgImage)}</div>
      <button class="btn" id="sp-pick-bg">选择</button>
    `;
    panel.appendChild(info);
    document.getElementById('sp-title').addEventListener('change', function () { pushHistory(); page.title = this.value; renderSidebar(); renderPreview(); });
    document.getElementById('sp-subtitle').addEventListener('change', function () { pushHistory(); page.subtitle = this.value; renderPreview(); });
    document.getElementById('sp-pick-bg').addEventListener('click', () => {
      pickImage(function (filename) {
        pushHistory(); page.bgImage = filename;
        const prev = document.getElementById('bg-preview');
        if (prev) { prev.innerHTML = bgPreviewHtml(filename); prev.title = filename; }
        renderPreview();
      });
    });
    (page.songs || []).forEach((song, idx) => { panel.appendChild(buildSpecialRow(page, song, idx)); });
    const addBtn = document.createElement('button');
    addBtn.className = 'add-section-btn';
    addBtn.textContent = '+ 添加特殊歌曲';
    addBtn.addEventListener('click', () => { pushHistory(); page.songs = page.songs || []; page.songs.push({ name: '新曲目', difficulty: 'CL', constant: 1.0, filename: '' }); renderEditor(); renderPreview(); });
    panel.appendChild(addBtn);
  }

  function buildSpecialRow(page, song, idx) {
    const row = document.createElement('div');
    row.className = 'special-song-row';
    row.dataset.songIdx = idx;
    if (selectedSongs.has(song)) row.classList.add('selected');

    const jacket = document.createElement('div');
    jacket.className = 'jacket';
    jacket.title = '点击选中 / 取消';
    const src = song.filename ? getThumbOrFull(song.filename) : '';
    if (src) {
      const img = document.createElement('img'); img.src = src; img.alt = song.name; img.loading = 'lazy';
      img.onerror = function () { this.style.display = 'none'; };
      jacket.appendChild(img);
    } else {
      const ph = document.createElement('div'); ph.className = 'ph'; ph.textContent = '无图'; jacket.appendChild(ph);
    }
    jacket.addEventListener('click', () => {
      if (selectedSongs.has(song)) { selectedSongs.delete(song); row.classList.remove('selected'); }
      else { selectedSongs.add(song); row.classList.add('selected'); }
      updateBatchBar();
    });
    jacket.draggable = true; // 缩略图作为拖拽把手
    jacket.addEventListener('dragstart', (e) => {
      e.dataTransfer.effectAllowed = 'move';
      dragSrcSong = { song, fromSpecial: true, pageIdx: state.currentPageIndex, songIdx: idx };
      try { e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'song' })); } catch (err) {}
      row.classList.add('dragging');
    });
    jacket.addEventListener('dragend', () => {
      row.classList.remove('dragging');
      dragSrcSong = null;
      document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    });
    row.addEventListener('dragover', (e) => {
      if (!dragSrcSong) return;
      e.preventDefault(); e.dataTransfer.dropEffect = 'move';
      row.classList.add('drag-over');
    });
    row.addEventListener('dragleave', (e) => { if (!row.contains(e.relatedTarget)) row.classList.remove('drag-over'); });
    row.addEventListener('drop', (e) => {
      if (!dragSrcSong) return;
      e.preventDefault(); e.stopPropagation(); row.classList.remove('drag-over');
      let d = null;
      try { d = JSON.parse(e.dataTransfer.getData('text/plain')); } catch (err) {}
      if (!d || d.type !== 'song' || !dragSrcSong.fromSpecial) return;
      if (dragSrcSong.songIdx === idx && dragSrcSong.pageIdx === state.currentPageIndex) return; // 原位不动
      if (moveSongToSpecial(dragSrcSong, state.currentPageIndex, idx)) {
        renderAll();
        toast('已调整顺序', 'success');
      }
    });
    row.appendChild(jacket);

    const actions = document.createElement('div');
    actions.className = 'quick-actions';
    actions.innerHTML = `<button class="mini-btn pick-img" title="选择曲绘">图</button><button class="mini-btn pick-tag" title="特殊标签">签</button><button class="mini-btn danger del" title="删除">删</button>`;
    actions.querySelector('.pick-img').addEventListener('click', () => {
      pickImage(function (filename) {
        pushHistory();
        applyFilenameToSong(song, filename);
        renderEditor(); renderPreview();
      });
    });
    actions.querySelector('.pick-tag').addEventListener('click', () => {
      pickTag(getSongTagDisplay(song), function (newTag) {
        pushHistory();
        song.tag = newTag;
        renderEditor(); renderPreview();
        toast(newTag ? '已设置标签: ' + newTag : '已移除标签', 'success');
      });
    });
    actions.querySelector('.del').addEventListener('click', () => {
      pushHistory();
      selectedSongs.delete(song);
      page.songs.splice(idx, 1);
      renderEditor(); renderPreview();
    });
    row.appendChild(actions);

    const nameInput = document.createElement('input');
    nameInput.className = 'name';
    nameInput.value = song.name;
    nameInput.placeholder = '曲名';
    nameInput.addEventListener('change', function () {
      pushHistory();
      const oldName = song.name;
      song.name = this.value;
      if (state.jacketMap[oldName] && oldName !== song.name) { state.jacketMap[song.name] = state.jacketMap[oldName]; delete state.jacketMap[oldName]; }
      renderPreview();
    });
    row.appendChild(nameInput);

    const badge = document.createElement('div');
    badge.className = 'special-badge ' + getDiffClass(song.difficulty);
    badge.textContent = song.difficulty;
    badge.title = '点击修改角标';
    badge.addEventListener('click', () => {
      pickBadge(function (d) {
        pushHistory();
        song.difficulty = d;
        renderEditor(); renderPreview();
        toast('已更新角标', 'success');
      });
    });
    row.appendChild(badge);

    const displayTag = getSongTagDisplay(song);
    if (displayTag) {
      const tagEl = document.createElement('div');
      tagEl.className = 'inline-tag';
      tagEl.textContent = displayTag;
      tagEl.title = '点击修改标签';
      tagEl.addEventListener('click', () => {
        pickTag(displayTag, function (newTag) {
          pushHistory();
          song.tag = newTag;
          renderEditor(); renderPreview();
          toast(newTag ? '已设置标签: ' + newTag : '已移除标签', 'success');
        });
      });
      row.appendChild(tagEl);
    }

    const constInput = document.createElement('input');
    constInput.type = 'number';
    constInput.step = '0.01';
    constInput.className = 'constant';
    constInput.value = song.constant;
    constInput.addEventListener('change', function () { pushHistory(); song.constant = parseFloat(this.value) || 0; renderPreview(); });
    row.appendChild(constInput);

    return row;
  }

  let _lastPreviewKey = '';
  function renderPreview() {
    const root = document.getElementById('viewer-root');
    const page = state.data.pages[state.currentPageIndex];
    if (!page) {
      root.innerHTML = '<div style="text-align:center;color:#3a3d50;padding:60px 20px;font-size:12px;">选择页面后显示预览</div>';
      _lastPreviewKey = '';
      return;
    }
    const key = state.currentPageIndex + '|' + JSON.stringify(page) + '|' + state.data.version + '|' + Object.keys(localThumbs).length;
    if (key === _lastPreviewKey) return;
    _lastPreviewKey = key;
    const imgResolver = function (fn) { if (!fn) return ''; return getThumbOrFull(fn); };
    root.innerHTML = Viewer.renderPage(page, state.data, state.jacketMap, imgResolver);
  }
  function invalidatePreview() { _lastPreviewKey = ''; }

  // ===== 弹窗关闭动画 =====
  // 各处关闭都直接 remove('active')，这里用 MutationObserver 统一补播退出动画，
  // 无需改动调用点；用 oldValue 区分「关闭」与「动画中重新打开」，避免循环触发。
  function setupModalCloseAnimation() {
    const meta = new WeakMap(); // el -> { timer, handler }
    const stop = el => {
      const m = meta.get(el);
      if (!m) return;
      clearTimeout(m.timer);
      el.removeEventListener('animationend', m.handler);
      meta.delete(el);
      el.classList.remove('closing');
    };
    const play = el => {
      stop(el);
      const m = { timer: null, handler: null };
      m.handler = e => { if (e.target === el) stop(el); };
      m.timer = setTimeout(() => stop(el), 400); // 兜底：动画被打断或被禁用时确保隐藏
      meta.set(el, m);
      el.classList.add('closing');
      el.addEventListener('animationend', m.handler);
    };
    const obs = new MutationObserver(muts => {
      muts.forEach(mu => {
        const el = mu.target;
        if (!el.classList || !el.classList.contains('modal-overlay')) return;
        const hadActive = String(mu.oldValue || '').split(/\s+/).indexOf('active') > -1;
        const hasActive = el.classList.contains('active');
        const hasClosing = el.classList.contains('closing');
        if (hadActive && !hasActive && !hasClosing) play(el);           // 关闭 → 播退出动画
        else if (hasActive && hasClosing) stop(el);                      // 动画中被重新打开 → 取消退出
      });
    });
    document.querySelectorAll('.modal-overlay').forEach(el => {
      obs.observe(el, { attributes: true, attributeFilter: ['class'], attributeOldValue: true });
    });
  }

  let _lastPageIdxForAnim = null;
  // 页面切换时给编辑区与预览区入场动画：只动 transform/opacity（合成器友好），仅切页触发
  function playPanelEnter() {
    ['editor-panel', 'viewer-root'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.classList.remove('page-enter');
      void el.offsetWidth; // 强制重排，连续切换时动画可重放
      el.classList.add('page-enter');
    });
  }
  function renderAll() {
    const pageSwitched = _lastPageIdxForAnim !== state.currentPageIndex;
    _lastPageIdxForAnim = state.currentPageIndex;
    renderSidebar(); renderEditor();
    invalidatePreview();
    renderPreview();
    syncVersionInput();
    if (state.isDirty) setStatus('未保存', 'dirty');
    else setStatus('已保存', 'saved');
    updateSaveTime();
    updateBatchBar();
    if (pageSwitched) playPanelEnter();
  }

  function addNewPage() {
    pushHistory();
    const maxInt = state.data.pages.filter(p => typeof p.integer === 'number').reduce((m, p) => Math.max(m, p.integer), 0);
    const newInt = maxInt + 1;
    state.data.pages.push({
      integer: newInt,
      sections: [{ range: newInt + '.0-' + newInt + '.4', decimals: [] }],
      bgImage: ''
    });
    state.currentPageIndex = state.data.pages.length - 1;
    renderAll();
    toast('已添加新页面', 'success');
  }

  // ===== 新定数页：曲绘 + 曲名 + 各难度定数 =====
  function addNewConstPage() {
    pushHistory();
    state.data.pages.push({
      type: 'newconst',
      title: '新曲定数',
      subtitle: 'New Constants',
      songs: [],
      bgImage: ''
    });
    state.currentPageIndex = state.data.pages.length - 1;
    renderAll();
    toast('已添加新定数页', 'success');
  }

  // ===== 套用定数：收集正文/多指定数/新定数页中每首曲目的全部谱面定数（含多指定数与难度标签）=====
  // exceptSong：目标行自身（对象同一性），避免自己套自己
  function collectMainSongCharts(exceptSong) {
    const map = new Map();
    const getEntry = (key) => {
      let entry = map.get(key);
      if (!entry) { entry = { name: key, filename: '', charts: [], _seen: {} }; map.set(key, entry); }
      return entry;
    };
    const hasConst = (v) => !(v === null || v === undefined || v === '');
    state.data.pages.forEach(page => {
      if (page.type === 'special') {
        // 多指定数页：每条记录就是一条谱面（同曲可多条不同定数），常数原样保留（含 15.75 这类 2 位数值）
        (page.songs || []).forEach(song => {
          if (song === exceptSong) return;
          const key = String(song.name || '').trim();
          if (!key) return;
          const entry = getEntry(key);
          if (!entry.filename) entry.filename = song.filename || state.jacketMap[key] || '';
          if (!hasConst(song.constant)) return;
          const ck = String(song.difficulty || '') + '|' + String(song.constant);
          if (!entry._seen[ck]) { entry._seen[ck] = true; entry.charts.push({ difficulty: song.difficulty || '', constant: song.constant }); }
        });
        return;
      }
      if (page.type === 'newconst') {
        // 新定数页：diffs 原样收集（可含 3.25* 等多指定数与难度标签）
        (page.songs || []).forEach(song => {
          if (song === exceptSong) return;
          const key = String(song.name || '').trim();
          if (!key) return;
          const entry = getEntry(key);
          if (!entry.filename) entry.filename = song.filename || state.jacketMap[key] || '';
          (song.diffs || []).forEach(d => {
            if (!hasConst(d.constant)) return;
            const ck = String(d.difficulty || '') + '|' + String(d.constant) + '|' + String(d.tag || '');
            if (!entry._seen[ck]) {
              entry._seen[ck] = true;
              const chart = { difficulty: d.difficulty || '', constant: d.constant };
              if (d.tag) chart.tag = d.tag;
              entry.charts.push(chart);
            }
          });
        });
        return;
      }
      // 普通正文页：定数 = 整数.小数
      const N = String(page.integer == null ? '' : page.integer).trim();
      if (!/^\d+$/.test(N)) return;
      (page.sections || []).forEach(sec => (sec.decimals || []).forEach(dg => {
        if (typeof dg.decimal !== 'number' || isNaN(dg.decimal)) return;
        const constant = Number(N + '.' + dg.decimal);
        (dg.songs || []).forEach(song => {
          const key = String(song.name || '').trim();
          if (!key) return;
          const entry = getEntry(key);
          if (!entry.filename) entry.filename = song.filename || state.jacketMap[key] || '';
          const ck = String(song.difficulty || '') + '|' + constant;
          if (!entry._seen[ck]) { entry._seen[ck] = true; entry.charts.push({ difficulty: song.difficulty || '', constant }); }
        });
      }));
    });
    const numVal = v => (typeof v === 'number' && isFinite(v)) ? v : NaN;
    return Array.from(map.values()).filter(e => e.charts.length).map(entry => {
      entry.charts.sort((a, b) => (difficultyRank(a.difficulty) - difficultyRank(b.difficulty)) ||
        (numVal(b.constant) - numVal(a.constant) || 0));
      delete entry._seen;
      return entry;
    });
  }
  // 把候选曲目的全部谱面定数套到新定数行：同步曲名、曲绘与 jacketMap
  function applyMainChartsToSong(song, cand) {
    if (!song || !cand || !cand.charts || !cand.charts.length) return false;
    pushHistory();
    const oldName = song.name;
    song.name = cand.name;
    if (cand.filename) song.filename = cand.filename;
    if (oldName !== song.name && state.jacketMap[oldName]) {
      state.jacketMap[song.name] = state.jacketMap[oldName];
      delete state.jacketMap[oldName];
    }
    if (cand.filename) state.jacketMap[song.name] = cand.filename;
    song.diffs = cand.charts.map(c => {
      const d = { difficulty: c.difficulty, constant: c.constant };
      if (c.tag) d.tag = c.tag;
      return d;
    });
    renderEditor(); renderPreview();
    return true;
  }
  let applyTargetSong = null;
  function openApplyPicker(song) {
    applyTargetSong = song;
    const search = document.getElementById('apply-search');
    if (search) search.value = '';
    renderApplyList('');
    document.getElementById('modal-apply').classList.add('active');
    setTimeout(() => { if (search) search.focus(); }, 80);
  }
  function renderApplyList(filter) {
    const box = document.getElementById('apply-list');
    if (!box) return;
    const all = collectMainSongCharts(applyTargetSong);
    const q = String(filter || '').trim().toLowerCase();
    const list = q ? all.filter(e => e.name.toLowerCase().indexOf(q) > -1) : all;
    box.innerHTML = '';
    if (!list.length) {
      box.innerHTML = '<div class="audit-empty">' + (all.length ? '没有匹配的曲目' : '还没有可套用的曲目') + '</div>';
      return;
    }
    list.forEach(entry => {
      const row = document.createElement('div');
      row.className = 'audit-item info apply-item';
      const charts = entry.charts.map(c => (c.difficulty || '') + (c.tag || '') + ' ' + fmtChartConstant(c.constant)).join(' · ');
      row.innerHTML = '<span class="dot"></span><span class="msg">' + esc(entry.name) +
        '<span class="sub">' + esc(charts) + '</span></span><span class="acts"><button>套用</button></span>';
      row.addEventListener('click', () => {
        if (applyMainChartsToSong(applyTargetSong, entry)) {
          document.getElementById('modal-apply').classList.remove('active');
          applyTargetSong = null;
          toast('已套用 ' + entry.name + ' 的 ' + entry.charts.length + ' 个谱面定数', 'success');
        }
      });
      box.appendChild(row);
    });
  }

  function renderNewconstEditor(panel, page) {
    panel.innerHTML = '';
    const info = document.createElement('div');
    info.className = 'page-info';
    info.innerHTML = `
      <label>标题</label>
      <input type="text" value="${esc(page.title || '')}" id="nc-title">
      <label>副标题</label>
      <input type="text" value="${esc(page.subtitle || '')}" id="nc-subtitle">
      <label>背景图</label>
      <div class="bg-preview" id="bg-preview" title="${esc(page.bgImage || '')}">${bgPreviewHtml(page.bgImage)}</div>
      <button class="btn" id="nc-pick-bg">选择</button>
    `;
    panel.appendChild(info);
    document.getElementById('nc-title').addEventListener('change', function () { pushHistory(); page.title = this.value; renderSidebar(); renderPreview(); });
    document.getElementById('nc-subtitle').addEventListener('change', function () { pushHistory(); page.subtitle = this.value; renderPreview(); });
    document.getElementById('nc-pick-bg').addEventListener('click', () => {
      pickImage(function (filename) {
        pushHistory(); page.bgImage = filename;
        const prev = document.getElementById('bg-preview');
        if (prev) { prev.innerHTML = bgPreviewHtml(filename); prev.title = filename; }
        renderPreview();
      });
    });
    (page.songs || []).forEach((song, idx) => { panel.appendChild(buildNewconstRow(page, song, idx)); });
    const addBtn = document.createElement('button');
    addBtn.className = 'add-section-btn';
    addBtn.textContent = '+ 添加曲目';
    addBtn.addEventListener('click', () => {
      pushHistory();
      page.songs = page.songs || [];
      page.songs.push({ name: '新曲目', filename: '', diffs: [ { difficulty: 'CB', constant: null } ] });
      renderEditor(); renderPreview();
    });
    panel.appendChild(addBtn);
  }

  // 新定数解析：≤1 位小数的纯数字存 number（显示时保留 1 位）；
  // ≥2 位小数（如 3.25）或带标记（如 3.25*）视为多指定数，原样存字符串
  function parseNcConstant(raw) {
    const s = String(raw == null ? '' : raw).trim();
    if (!s) return null;
    if (/^-?\d+(\.\d+)?$/.test(s)) {
      const decimals = (s.split('.')[1] || '').length;
      return decimals <= 1 ? parseFloat(s) : s;
    }
    return s;
  }
  function buildNewconstRow(page, song, idx) {
    song.diffs = song.diffs || [];
    const row = document.createElement('div');
    row.className = 'nc-row';
    row.dataset.songIdx = idx;

    const head = document.createElement('div');
    head.className = 'nc-head';

    const jacket = document.createElement('div');
    jacket.className = 'nc-jacket';
    jacket.title = '点击更换曲绘';
    const src = song.filename ? getThumbOrFull(song.filename) : '';
    if (src) {
      const img = document.createElement('img');
      img.src = src; img.alt = song.name; img.loading = 'lazy';
      img.onerror = function () { this.style.display = 'none'; };
      jacket.appendChild(img);
    } else {
      const ph = document.createElement('div');
      ph.className = 'ph'; ph.textContent = '无图';
      jacket.appendChild(ph);
    }
    jacket.addEventListener('click', () => {
      pickImage(function (filename) {
        pushHistory();
        applyFilenameToSong(song, filename);
        renderEditor(); renderPreview();
        toast('已更新曲绘', 'success');
      });
    });
    head.appendChild(jacket);

    const nameInput = document.createElement('input');
    nameInput.className = 'nc-name';
    nameInput.value = song.name;
    nameInput.placeholder = '曲名';
    nameInput.addEventListener('change', function () {
      pushHistory();
      const oldName = song.name;
      song.name = this.value;
      if (state.jacketMap[oldName] && oldName !== song.name) {
        state.jacketMap[song.name] = state.jacketMap[oldName];
        delete state.jacketMap[oldName];
      }
      renderPreview();
    });
    head.appendChild(nameInput);

    const acts = document.createElement('div');
    acts.className = 'nc-acts';
    acts.innerHTML = '<button class="apply" title="套用该曲目的所有谱面定数（正文/多指定数/新定数）">套</button><button class="up" title="上移">↑</button><button class="down" title="下移">↓</button><button class="danger del" title="删除">删</button>';
    acts.querySelector('.apply').addEventListener('click', () => openApplyPicker(song));
    acts.querySelector('.up').addEventListener('click', () => {
      if (idx <= 0) return;
      pushHistory();
      const [m] = page.songs.splice(idx, 1);
      page.songs.splice(idx - 1, 0, m);
      renderEditor(); renderPreview();
    });
    acts.querySelector('.down').addEventListener('click', () => {
      if (idx >= page.songs.length - 1) return;
      pushHistory();
      const [m] = page.songs.splice(idx, 1);
      page.songs.splice(idx + 1, 0, m);
      renderEditor(); renderPreview();
    });
    acts.querySelector('.del').addEventListener('click', () => {
      pushHistory();
      selectedSongs.delete(song);
      page.songs.splice(idx, 1);
      renderEditor(); renderPreview();
      toast('已删除曲目', 'success');
    });
    head.appendChild(acts);
    row.appendChild(head);

    const diffs = document.createElement('div');
    diffs.className = 'nc-diffs';
    song.diffs.forEach((entry, di) => {
      const wrap = document.createElement('span');
      wrap.className = 'nc-entry';
      const badge = document.createElement('button');
      badge.className = 'badge-select-btn ' + getDiffClass(entry.difficulty);
      badge.textContent = entry.difficulty || 'CB';
      badge.title = '点击修改难度';
      badge.addEventListener('click', () => {
        pickBadge(function (d) { pushHistory(); entry.difficulty = d; renderEditor(); renderPreview(); });
      });
      wrap.appendChild(badge);
      const tagBtn = document.createElement('button');
      tagBtn.className = 'tg' + (entry.tag ? ' on' : '');
      tagBtn.textContent = entry.tag || '签';
      tagBtn.title = '难度标签（如：追加），显示在难度后';
      tagBtn.addEventListener('click', () => {
        pickTag(entry.tag, function (t) {
          pushHistory();
          if (t) entry.tag = t; else delete entry.tag;
          renderEditor(); renderPreview();
          toast(t ? '已设置标签: ' + t : '已移除标签', 'success');
        });
      });
      wrap.appendChild(tagBtn);
      const cInput = document.createElement('input');
      cInput.className = 'c-input';
      cInput.type = 'text';
      cInput.value = (entry.constant === null || entry.constant === undefined) ? '' : String(entry.constant);
      cInput.placeholder = '定数';
      cInput.addEventListener('change', function () {
        pushHistory();
        entry.constant = parseNcConstant(this.value);
        renderPreview();
      });
      wrap.appendChild(cInput);
      const rm = document.createElement('button');
      rm.className = 'rm';
      rm.textContent = '×';
      rm.title = '移除该难度';
      rm.addEventListener('click', () => {
        pushHistory();
        song.diffs.splice(di, 1);
        renderEditor(); renderPreview();
      });
      wrap.appendChild(rm);
      diffs.appendChild(wrap);
    });
    const addDiff = document.createElement('button');
    addDiff.className = 'nc-add';
    addDiff.textContent = '+ 难度';
    addDiff.addEventListener('click', () => {
      pushHistory();
      song.diffs.push({ difficulty: 'CB', constant: null });
      renderEditor(); renderPreview();
    });
    diffs.appendChild(addDiff);
    row.appendChild(diffs);
    return row;
  }

  function addNewSpecialPage() {
    pushHistory();
    state.data.pages.push({
      type: 'special',
      title: '多指定数',
      subtitle: 'Multiple Constants',
      songs: [],
      bgImage: ''
    });
    state.currentPageIndex = state.data.pages.length - 1;
    renderAll();
    toast('已添加特殊页面', 'success');
  }

  let imageCallback = null;
  function pickImage(cb) {
    imageCallback = cb;
    const modal = document.getElementById('modal-image');
    const grid = document.getElementById('image-grid');
    const search = document.getElementById('image-search');
    const custom = document.getElementById('custom-image-input');

    let _io = null;
    try {
      _io = new IntersectionObserver(entries => {
        entries.forEach(en => {
          if (en.isIntersecting) {
            const img = en.target.querySelector('img[data-src]');
            if (img) {
              img.src = img.dataset.src;
              img.removeAttribute('data-src');
            }
            _io.unobserve(en.target);
          }
        });
      }, { root: grid, rootMargin: '200px' });
    } catch (e) { _io = null; }

    function renderGrid(filter) {
      if (_io) { try { _io.disconnect(); } catch (e) {} }
      const files = collectAllFilenames();
      const q = String(filter || '').toLowerCase();
      const list = q
        ? files.filter(f => f.toLowerCase().includes(q) || String(MANIFEST_NAME[f] || '').toLowerCase().includes(q))
        : files;
      grid.innerHTML = '';
      if (!list.length) {
        grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:#3a3d50;padding:20px;font-size:12px;">暂无图片，请上传或手动输入</div>';
        return;
      }
      const frag = document.createDocumentFragment();
      list.forEach(fn => {
        const item = document.createElement('div');
        item.className = 'item';
        const src = getThumbOrFull(fn);
        const eager = list.length <= 20;
        const imgHtml = eager
          ? `<img src="${esc(src)}" loading="lazy" onerror="this.style.display='none'">`
          : `<img data-src="${esc(src)}" loading="lazy" onerror="this.style.display='none'">`;
        item.innerHTML = `${imgHtml}<div class="label">${esc(fn.replace(/^\(.*?\)/, '').replace(/\.(png|jpg|jpeg)$/i, ''))}</div>`;
        item.title = fn;
        item.addEventListener('click', () => {
          if (imageCallback) { imageCallback(fn); imageCallback = null; }
          modal.classList.remove('active');
        });
        frag.appendChild(item);
      });
      grid.appendChild(frag);
      if (_io && list.length > 20) {
        grid.querySelectorAll('.item').forEach(it => _io.observe(it));
      }
    }
    function renderUploaded() {
      const list = document.getElementById('uploaded-list');
      const keys = Object.keys(localImages);
      list.innerHTML = keys.length ? keys.map(k => `<div class="file">${esc(k)}</div>`).join('') : '';
    }

    renderGrid(''); renderUploaded();
    search.value = ''; custom.value = '';
    search.oninput = () => renderGrid(search.value);

    const uploadZone = document.getElementById('upload-zone');
    const uploadInput = document.getElementById('upload-input');
    uploadZone.onclick = () => uploadInput.click();
    uploadZone.ondragover = e => { e.preventDefault(); uploadZone.classList.add('dragover'); };
    uploadZone.ondragleave = () => uploadZone.classList.remove('dragover');
    uploadZone.ondrop = e => { e.preventDefault(); uploadZone.classList.remove('dragover'); if (e.dataTransfer.files.length) handleUpload(e.dataTransfer.files); };
    uploadInput.onchange = function () { if (this.files.length) handleUpload(this.files); this.value = ''; };

    async function processFile(file) {
      return new Promise(resolve => {
        const reader = new FileReader();
        reader.onload = async e => {
          const fullDataUrl = e.target.result;
          localImages[file.name] = fullDataUrl;
          try {
            const thumb = await generateThumbnail(fullDataUrl);
            localThumbs[file.name] = thumb;
          } catch (err) {
            console.warn('[Thumb gen]', err);
          }
          resolve(true);
        };
        reader.onerror = () => resolve(false);
        reader.readAsDataURL(file);
      });
    }

    async function handleUpload(files) {
      const arr = Array.from(files).filter(f => f.type.startsWith('image/'));
      if (!arr.length) return;
      const results = await Promise.all(arr.map(f => processFile(f)));
      const ok = results.filter(Boolean).length;
      renderUploaded();
      renderGrid(search.value);
      if (ok) {
        markDirty();
        invalidatePreview();
        toast('已加载 ' + ok + ' 张图片', 'success');
        // 资源导入后同样可选先加载（进度可见），完成后回到选择器/页面
        openPreloadFlow(collectPreloadTargets(), {
          askTitle: '导入完成',
          hint: '已导入 ' + ok + ' 张图片资源，先加载完成可避免预览与图片选择的加载卡顿。',
          startLabel: '先加载资源',
          directLabel: '直接完成',
          skipLabel: '跳过并完成'
        }, function () {});
      }
    }

    document.getElementById('btn-custom-image').onclick = () => {
      const v = custom.value.trim();
      if (!v) { toast('请输入文件名', 'error'); return; }
      if (imageCallback) { imageCallback(v); imageCallback = null; }
      modal.classList.remove('active');
    };
    modal.classList.add('active');
  }

  function collectAllFilenames() {
    const set = new Set();
    state.data.pages.forEach(p => {
      if (p.bgImage) set.add(p.bgImage);
      if (p.type === 'special' || p.type === 'newconst') { (p.songs || []).forEach(s => { if (s.filename) set.add(s.filename); }); }
      else { (p.sections || []).forEach(sec => (sec.decimals || []).forEach(d => (d.songs || []).forEach(s => { if (s.filename) set.add(s.filename); }))); }
    });
    Object.values(state.jacketMap).forEach(v => set.add(v));
    Object.keys(localImages).forEach(k => set.add(k));
    ILLUSTRATION_MANIFEST.forEach(e => { if (e && e.file) set.add(e.file); });
    return Array.from(set).sort();
  }

  // ===== 曲绘自动匹配（基于 manifest，精确归一化匹配，避免错配）=====
  function normalizeSongKey(s) {
    const base = String(s == null ? '' : s).toLowerCase()
      .replace(/\.(png|jpe?g|gif|webp|bmp)$/, '')
      .replace(/^\(.*?\)\s*/, '');
    return base.replace(/[\s_\-–—~·、，,。.!?'’“”`()\[\]{}+*#:;\/\\|&%$@^<>=]/g, '');
  }
  const KIND_RANK = { Artwork: 0, SquareArtwork: 1, Special: 2, Other: 3 };
  let _manifestIndex = null;
  function resetManifestIndex() { _manifestIndex = null; }
  function getManifestIndex() {
    if (_manifestIndex) return _manifestIndex;
    const byKey = new Map();
    ILLUSTRATION_MANIFEST.forEach(e => {
      if (!e || !e.file) return;
      const rank = (KIND_RANK[e.kind] === undefined ? 9 : KIND_RANK[e.kind]);
      [e.name || '', e.file].forEach(raw => {
        const k = normalizeSongKey(raw);
        if (!k) return;
        const cur = byKey.get(k);
        if (!cur || rank < cur.rank) byKey.set(k, { file: e.file, rank: rank });
      });
    });
    _manifestIndex = byKey;
    return byKey;
  }
  // 曲名 → 清单中的曲绘文件名；无匹配返回 ''
  function findJacketFor(songName) {
    const key = normalizeSongKey(songName);
    if (!key) return '';
    const hit = getManifestIndex().get(key);
    return hit ? hit.file : '';
  }
  // 只设置 filename 与 jacketMap，不改动曲名；force=true 时允许覆盖已有 filename
  function autoMatchSong(song, force) {
    if (!song) return false;
    if (song.filename && !force) return false;
    const file = findJacketFor(song.name);
    if (!file || file === song.filename) return false;
    song.filename = file;
    if (song.name) state.jacketMap[song.name] = file;
    return true;
  }

  // ===== 数据体检 =====
  function basenameOf(p) {
    const s = String(p == null ? '' : p);
    const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
    return i === -1 ? s : s.substring(i + 1);
  }
  function songJacketRef(song) {
    return song.filename || (song.name && state.jacketMap[song.name]) || '';
  }
  function collectUsedBasenames() {
    const set = new Set();
    const add = v => { if (v) set.add(basenameOf(v).toLowerCase()); };
    state.data.pages.forEach(p => {
      add(p.bgImage);
      if (p.type === 'special' || p.type === 'newconst') { (p.songs || []).forEach(s => add(songJacketRef(s))); }
      else { (p.sections || []).forEach(sec => (sec.decimals || []).forEach(d => (d.songs || []).forEach(s => add(songJacketRef(s))))); }
    });
    Object.values(state.jacketMap).forEach(add);
    Object.keys(localImages).forEach(add);
    return set;
  }
  function runAudit() {
    const issues = [];
    const used = collectUsedBasenames();
    const manifestFiles = new Set();
    ILLUSTRATION_MANIFEST.forEach(e => { if (e && e.file) manifestFiles.add(e.file.toLowerCase()); });
    const dupMap = new Map();

    const pushSongIssues = (song, target, locText) => {
      const name = String(song.name || '').trim();
      const ref = songJacketRef(song);
      const prefix = locText ? locText + ' · ' : '';
      if (!ref) {
        const guess = findJacketFor(name);
        issues.push({
          level: 'warn', target, song, fixable: !!guess,
          msg: prefix + (name || '(未命名)'),
          sub: guess ? '缺曲绘，可匹配为 ' + basenameOf(guess) : '缺曲绘，清单中无匹配'
        });
      } else if (!ref.startsWith('data:') && !Object.prototype.hasOwnProperty.call(localImages, ref)) {
        const verifiable = ref.indexOf('/') === -1 || ref.indexOf('res/illustration/') === 0;
        const bn = basenameOf(ref).toLowerCase();
        if (verifiable && !manifestFiles.has(bn)) {
          issues.push({ level: 'warn', target, msg: prefix + (name || '(未命名)'), sub: '曲绘文件不存在：' + basenameOf(ref) });
        }
      }
      const nk = normalizeSongKey(name);
      if (nk) {
        const key = nk + '|' + String(song.difficulty || '').toUpperCase();
        if (!dupMap.has(key)) dupMap.set(key, []);
        dupMap.get(key).push({ name, locText, target });
      }
    };

    state.data.pages.forEach((page, pageIdx) => {
      if (page.type === 'special' || page.type === 'newconst') {
        const isNC = page.type === 'newconst';
        if (!String(page.title || '').trim()) issues.push({ level: 'warn', pageIdx, msg: (isNC ? '新定数页' : '特殊页') + '缺少标题' });
        const spSongs = page.songs || [];
        if (!spSongs.length) issues.push({ level: 'info', pageIdx, msg: (page.title || (isNC ? '新定数页' : '特殊页')) + ' 没有曲目' });
        spSongs.forEach((song, songIdx) => pushSongIssues(song, { kind: page.type, pageIdx, songIdx }, page.title || (isNC ? '新定数' : '特殊')));
        return;
      }
      const N = String(page.integer == null ? '' : page.integer).trim();
      const hasInteger = /^\d+$/.test(N);
      if (!hasInteger) issues.push({ level: 'warn', pageIdx, msg: '页面缺少整数' });
      const sections = page.sections || [];
      const hasSongs = sections.some(s => (s.decimals || []).some(d => (d.songs || []).length));
      if (!hasSongs) issues.push({ level: 'info', pageIdx, msg: (hasInteger ? N : '?') + ' 页没有曲目' });
      if (hasInteger) {
        const secU = sections.find(s => classifyRange(s.range) === 'upper');
        const secL = sections.find(s => classifyRange(s.range) === 'lower');
        const missing = [];
        [[secU, [9, 8, 7, 6, 5]], [secL, [4, 3, 2, 1, 0]]].forEach(pair => {
          const sec = pair[0];
          if (!sec) { missing.push.apply(missing, pair[1]); return; }
          const have = new Set((sec.decimals || []).map(d => (typeof d.decimal === 'number' && !isNaN(d.decimal)) ? d.decimal : NaN));
          pair[1].forEach(d => { if (!have.has(d)) missing.push(d); });
        });
        if (missing.length) {
          missing.sort((a, b) => b - a);
          issues.push({ level: 'info', pageIdx, msg: N + ' 页缺小数行 ' + missing.map(d => '.' + d).join(' ') + '，可用 +0–9 补齐' });
        }
      }
      sections.forEach((sec, secIdx) => {
        (sec.decimals || []).forEach((dg, decIdx) => {
          const locText = hasInteger ? N + ((dg.decimal === null || dg.decimal === undefined) ? '' : '.' + dg.decimal) : '';
          (dg.songs || []).forEach((song, songIdx) => {
            pushSongIssues(song, { kind: 'normal', pageIdx, secIdx, decIdx, songIdx }, locText);
          });
        });
      });
    });

    dupMap.forEach(list => {
      if (list.length > 1) {
        issues.push({
          level: 'warn', target: list[0].target,
          msg: '疑似重复：' + list[0].name + ' ×' + list.length,
          sub: '位于 ' + list.map(x => x.locText).join('、')
        });
      }
    });

    const unused = [];
    ILLUSTRATION_MANIFEST.forEach(e => { if (e && e.file && !used.has(e.file.toLowerCase())) unused.push(e.file); });
    if (unused.length) {
      issues.push({
        level: 'info', msg: unused.length + ' 张曲绘未被使用',
        sub: unused.slice(0, 8).join('、') + (unused.length > 8 ? ' …等' : '')
      });
    }
    return issues;
  }

  function openAudit() {
    const issues = runAudit();
    const summary = document.getElementById('audit-summary');
    const list = document.getElementById('audit-list');
    const warnCount = issues.filter(i => i.level === 'warn').length;
    summary.textContent = issues.length ? '共 ' + issues.length + ' 项：注意 ' + warnCount + ' · 提示 ' + (issues.length - warnCount) : '';
    list.innerHTML = '';
    if (!issues.length) {
      list.innerHTML = '<div class="audit-empty">未发现问题</div>';
    } else {
      issues.forEach(iss => {
        const row = document.createElement('div');
        row.className = 'audit-item ' + iss.level;
        row.innerHTML = '<span class="dot"></span><span class="msg">' + esc(iss.msg) +
          (iss.sub ? '<span class="sub">' + esc(iss.sub) + '</span>' : '') + '</span><span class="acts"></span>';
        const acts = row.querySelector('.acts');
        if (iss.target) {
          const btn = document.createElement('button');
          btn.textContent = '跳转';
          btn.onclick = () => { document.getElementById('modal-audit').classList.remove('active'); gotoSearchResult(iss.target); };
          acts.appendChild(btn);
        }
        if (iss.fixable && iss.song) {
          const btn = document.createElement('button');
          btn.className = 'fix';
          btn.textContent = '匹配';
          btn.onclick = () => {
            pushHistory();
            if (autoMatchSong(iss.song)) {
              renderEditor(); renderPreview();
              toast('已匹配曲绘', 'success');
              openAudit();
            }
          };
          acts.appendChild(btn);
        }
        list.appendChild(row);
      });
    }
    document.getElementById('modal-audit').classList.add('active');
  }
  function auditFixAll() {
    const targets = runAudit().filter(i => i.fixable && i.song);
    if (!targets.length) { toast('没有可自动匹配的曲目', 'error'); return; }
    pushHistory();
    let n = 0;
    targets.forEach(i => { if (autoMatchSong(i.song)) n++; });
    renderEditor(); renderPreview();
    toast('已匹配 ' + n + ' 首曲绘', 'success');
    openAudit();
  }

  let badgeCallback = null;
  function pickBadge(cb) {
    badgeCallback = cb;
    const modal = document.getElementById('modal-badge');
    const box = document.getElementById('badge-options');
    const list = [
      { key: 'DZ', desc: 'Drizzle' },
      { key: 'SK', desc: 'Sprinkle' },
      { key: 'CB', desc: 'Cloudburst' },
      { key: 'CL', desc: 'Clear' },
      { key: 'SP', desc: 'Special' }
    ];
    box.innerHTML = '';
    list.forEach(b => {
      const btn = document.createElement('button');
      btn.className = 'badge-select-btn diff-' + b.key.toLowerCase();
      btn.textContent = b.key;
      btn.title = b.desc;
      btn.onclick = () => {
        if (badgeCallback) { badgeCallback(b.key); badgeCallback = null; }
        modal.classList.remove('active');
      };
      box.appendChild(btn);
    });
    modal.classList.add('active');
  }

  let tagCallback = null;
  function pickTag(currentTag, cb) {
    tagCallback = cb;
    const modal = document.getElementById('modal-tag');
    const input = document.getElementById('tag-input');
    input.value = currentTag || '';
    modal.classList.add('active');
    setTimeout(() => { input.focus(); input.select(); }, 100);
  }

  function exportJson() {
    const payload = { chartData: state.data, jacketMap: state.jacketMap, localImages: localImages, localThumbs: localThumbs };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'milthm_chart_data_' + Date.now() + '.json';
    a.click();
    URL.revokeObjectURL(url);
    toast('已导出 JSON', 'success');
  }
  // ===== JSON raw 查看 =====
  function buildJsonViewPayload(includeImages) {
    const payload = { chartData: state.data, jacketMap: state.jacketMap };
    if (includeImages) { payload.localImages = localImages; payload.localThumbs = localThumbs; }
    return payload;
  }
  function renderJsonView() {
    const withImages = document.getElementById('json-with-images').checked;
    const text = JSON.stringify(buildJsonViewPayload(withImages), null, 2);
    document.getElementById('json-view').textContent = text;
    document.getElementById('json-size').textContent = (text.length / 1024).toFixed(1) + ' KB';
  }
  function openJsonView() {
    renderJsonView();
    document.getElementById('modal-json').classList.add('active');
  }
  function copyJsonView() {
    const text = document.getElementById('json-view').textContent;
    const done = () => toast('已复制 JSON', 'success');
    const fallback = () => {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        if (ok) done(); else toast('复制失败', 'error');
      } catch (e) { toast('复制失败', 'error'); }
    };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done, fallback);
    } else { fallback(); }
  }

  // ===== 批量替换：遍历 bgImage / song.filename / jacketMap 的文本值 =====
  function walkReplace(find, replace, apply) {
    if (!find) return 0;
    let hits = 0;
    const rep = s => {
      if (typeof s !== 'string' || s.indexOf(find) === -1) return s;
      hits += s.split(find).length - 1;
      return apply ? s.split(find).join(replace) : s;
    };
    state.data.pages.forEach(p => {
      if (p.bgImage) p.bgImage = rep(p.bgImage);
      const visit = song => { if (song && typeof song.filename === 'string') song.filename = rep(song.filename); };
      if (p.type === 'special' || p.type === 'newconst') (p.songs || []).forEach(visit);
      else (p.sections || []).forEach(sec => (sec.decimals || []).forEach(dg => (dg.songs || []).forEach(visit)));
    });
    Object.keys(state.jacketMap).forEach(k => { state.jacketMap[k] = rep(state.jacketMap[k]); });
    return hits;
  }
  function openReplace() {
    document.getElementById('replace-find').value = '';
    document.getElementById('replace-with').value = '';
    document.getElementById('replace-count').textContent = '输入后显示将影响的位置数';
    document.getElementById('modal-replace').classList.add('active');
  }
  function updateReplaceCount() {
    const find = document.getElementById('replace-find').value;
    const cnt = document.getElementById('replace-count');
    if (!find) { cnt.textContent = '输入后显示将影响的位置数'; return; }
    const n = walkReplace(find, document.getElementById('replace-with').value, false);
    cnt.textContent = n > 0 ? '将替换 ' + n + ' 处' : '没有匹配项';
  }
  function runReplace() {
    const find = document.getElementById('replace-find').value;
    const replace = document.getElementById('replace-with').value;
    if (!find) { toast('请输入查找文本', 'error'); return; }
    const n = walkReplace(find, replace, false);
    if (!n) { toast('没有匹配项', 'error'); return; }
    createSnapshot('批量替换前');
    pushHistory();
    const done = walkReplace(find, replace, true);
    document.getElementById('modal-replace').classList.remove('active');
    renderAll();
    toast('已替换 ' + done + ' 处', 'success');
  }

  // ===== 导入后预加载资源：可选先加载、实时进度、完成后自动进入页面 =====
  // 收集当前会用到的全部图片 src：viewer 同款解析（本地内存图优先，否则 res/illustration）
  function collectPreloadTargets() {
    const set = new Set();
    const add = fn => {
      if (!fn) return;
      const src = localImages[fn] || resolveAssetUrl(fn);
      if (src && !set.has(src)) set.add(src);
    };
    (state.data.pages || []).forEach(page => {
      if (page.type === 'special' || page.type === 'newconst') {
        (page.songs || []).forEach(s => add(s.filename));
      } else {
        (page.sections || []).forEach(sec => (sec.decimals || []).forEach(dg => (dg.songs || []).forEach(s => add(s.filename))));
      }
    });
    Object.keys(state.jacketMap || {}).forEach(k => add(state.jacketMap[k]));
    Object.keys(localImages).forEach(add);
    return Array.from(set);
  }
  // 逐张加载并 decode()（解码进缓存），实时回调进度；失败不阻塞；支持中途跳过
  function preloadImages(list, onProgress) {
    const signal = { cancelled: false, cancel: null };
    let releaseCancel;
    const cancelled = new Promise(r => { releaseCancel = r; });
    signal.cancel = () => { signal.cancelled = true; releaseCancel(); };
    let done = 0;
    const total = list.length;
    const work = Promise.all(list.map(src => new Promise(resolve => {
      const img = new Image();
      const finish = ok => {
        if (signal.cancelled) { resolve(); return; }
        done++;
        if (onProgress) onProgress(done, total, src, ok);
        resolve();
      };
      img.onload = () => {
        if (typeof img.decode === 'function') img.decode().then(() => finish(true), () => finish(true));
        else finish(true);
      };
      img.onerror = () => finish(false);
      img.src = src;
    })));
    return {
      signal,
      promise: Promise.race([work, cancelled]).then(() => ({ done, total, cancelled: signal.cancelled }))
    };
  }
  const PRELOAD_PREF_KEY = 'mct.preloadPref'; // 'auto' | 'never' | 空（每次询问）
  function readPreloadPref() { try { return localStorage.getItem(PRELOAD_PREF_KEY); } catch (e) { return null; } }
  function writePreloadPref(v) { try { v ? localStorage.setItem(PRELOAD_PREF_KEY, v) : localStorage.removeItem(PRELOAD_PREF_KEY); } catch (e) {} }
  function preloadBaseName(src) {
    if (!src) return '';
    if (src.indexOf('data:') === 0) return '内嵌图片';
    const seg = src.split('/').pop();
    try { return decodeURIComponent(seg); } catch (e) { return seg; }
  }
  // 主入口：有资源 → 询问（或按记忆直接执行）→ 实时进度 → 完成后自动调 onEnter 进入页面
  function openPreloadFlow(targets, opts, onEnter) {
    opts = opts || {};
    let entered = false;
    const enter = () => {
      if (entered) return;
      entered = true;
      document.getElementById('modal-preload').classList.remove('active');
      if (onEnter) onEnter();
    };
    if (!targets || !targets.length) { enter(); return; }
    const pref = readPreloadPref();
    if (pref === 'never') { enter(); return; }
    const modal = document.getElementById('modal-preload');
    const askBox = document.getElementById('pl-ask');
    const runBox = document.getElementById('pl-run');
    const title = document.getElementById('pl-title');
    const hint = document.getElementById('pl-hint');
    const status = document.getElementById('pl-status');
    const fill = document.getElementById('pl-fill');
    const remember = document.getElementById('pl-remember');
    const startBtn = document.getElementById('btn-pl-start');
    const directBtn = document.getElementById('btn-pl-direct');
    const skipBtn = document.getElementById('btn-pl-skip');
    remember.checked = false;
    hint.textContent = opts.hint || ('检测到 ' + targets.length + ' 张图片资源，先加载完成再进入页面，可避免预览时逐张加载的卡顿。');
    const startRun = () => {
      title.textContent = '正在预加载图片资源';
      askBox.hidden = true;
      runBox.hidden = false;
      skipBtn.textContent = opts.skipLabel || '跳过并进入';
      fill.style.transform = 'scaleX(0)';
      status.textContent = '0 / ' + targets.length;
      const t0 = Date.now();
      const run = preloadImages(targets, (done, total, src) => {
        fill.style.transform = 'scaleX(' + (done / total) + ')';
        status.textContent = done + ' / ' + total + ' · ' + preloadBaseName(src);
      });
      skipBtn.onclick = () => { run.signal.cancel(); enter(); };
      run.promise.then(res => {
        if (res.cancelled) return;
        fill.style.transform = 'scaleX(1)';
        status.textContent = '完成 · ' + res.done + ' 张（' + ((Date.now() - t0) / 1000).toFixed(1) + 's）';
        setTimeout(enter, 200);
      });
    };
    if (pref === 'auto') {
      modal.classList.add('active');
      startRun();
      return;
    }
    title.textContent = opts.askTitle || '导入完成';
    askBox.hidden = false;
    runBox.hidden = true;
    startBtn.textContent = opts.startLabel || '先加载资源';
    directBtn.textContent = opts.directLabel || '直接进入';
    startBtn.onclick = () => { if (remember.checked) writePreloadPref('auto'); startRun(); };
    directBtn.onclick = () => { if (remember.checked) writePreloadPref('never'); enter(); };
    modal.classList.add('active');
  }

  function importJson(file) {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const parsed = JSON.parse(e.target.result);
        if (!parsed.chartData || !parsed.chartData.pages) throw new Error('缺少 chartData.pages');
        createSnapshot('导入前');
        pushHistory();
        state.data = parsed.chartData;
        state.jacketMap = parsed.jacketMap || {};
        localImages = (parsed.localImages && typeof parsed.localImages === 'object') ? parsed.localImages : {};
        localThumbs = (parsed.localThumbs && typeof parsed.localThumbs === 'object') ? parsed.localThumbs : {};
        state.currentPageIndex = 0;
        selectedSongs.clear();
        markDirty();
        toast('已导入 JSON', 'success');
        // 可选先预加载图片资源（实时进度），完成后再进入页面，避免预览卡顿
        openPreloadFlow(collectPreloadTargets(), {}, function () {
          renderAll();
          setTimeout(ensureAllThumbs, 100);
        });
      } catch (err) { toast('导入失败: ' + err.message, 'error'); }
    };
    reader.readAsText(file);
  }

  function showExportProgress(text) {
    document.getElementById('export-status').textContent = text;
    document.getElementById('export-progress').classList.add('active');
  }
  function hideExportProgress() { document.getElementById('export-progress').classList.remove('active'); }
  function waitForImages(container, timeout) {
    timeout = timeout || 3000;
    const images = Array.from(container.querySelectorAll('img'));
    return Promise.all(images.map(img => {
      if (img.complete) return Promise.resolve();
      return new Promise(resolve => {
        let resolved = false;
        const done = () => { if (!resolved) { resolved = true; resolve(); } };
        img.addEventListener('load', done);
        img.addEventListener('error', done);
        setTimeout(done, timeout);
      });
    }));
  }
  const EMPTY_PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  async function inlineImagesAsDataUrls(container) {
    const images = Array.from(container.querySelectorAll('img'));
    const promises = images.map(img => new Promise(resolve => {
      const src = img.getAttribute('src');
      if (!src) { img.setAttribute('src', EMPTY_PIXEL); resolve(); return; }
      if (src.startsWith('data:')) { resolve(); return; }
      const test = new Image();
      test.crossOrigin = 'anonymous';
      let settled = false;
      const done = () => { if (!settled) { settled = true; resolve(); } };
      const timer = setTimeout(() => { img.setAttribute('src', EMPTY_PIXEL); done(); }, 2500);
      test.onload = () => {
        clearTimeout(timer);
        try {
          const canvas = document.createElement('canvas');
          canvas.width = test.naturalWidth || 1;
          canvas.height = test.naturalHeight || 1;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(test, 0, 0);
          img.setAttribute('src', canvas.toDataURL('image/png'));
        } catch (e) { img.setAttribute('src', EMPTY_PIXEL); }
        done();
      };
      test.onerror = () => { clearTimeout(timer); img.setAttribute('src', EMPTY_PIXEL); done(); };
      test.src = src;
    }));
    await Promise.all(promises);
  }

  // ===== 导出单页（修复右侧灰边）=====
  // 关键修复：
  //   1) 离屏容器用 padding: 0 覆盖 .viewer-scope 的 padding: 8px 8px 20px 8px
  //   2) 用 getBoundingClientRect() 动态读取 targetEl 的真实尺寸，不再硬编码 420
  async function exportSinglePage(pageIdx, scale, triggerDownload) {
    const page = state.data.pages[pageIdx];
    if (!page) return null;
    const container = document.createElement('div');
    container.className = 'viewer-scope';
    container.style.position = 'fixed';
    container.style.left = '-9999px';
    container.style.top = '0';
    container.style.width = '420px';
    container.style.padding = '0';            // ★ 关键：覆盖原 .viewer-scope 的 padding
    container.style.margin = '0';
    container.style.background = 'transparent';
    container.style.pointerEvents = 'none';
    container.style.zIndex = '-1';
    // 导出使用【原图】而非缩略图，保证清晰度
    const imgResolver = function (fn) { if (!fn) return ''; return localImages[fn] || resolveAssetUrl(fn); };
    container.innerHTML = Viewer.renderPage(page, state.data, state.jacketMap, imgResolver);
    document.body.appendChild(container);
    try {
      await waitForImages(container, 3000);
      await inlineImagesAsDataUrls(container);
      const targetEl = container.querySelector('.page');
      if (!targetEl) { document.body.removeChild(container); return null; }
      // 动态测量实际尺寸（避免依赖硬编码的 420 宽度）
      const rect = targetEl.getBoundingClientRect();
      const w = Math.max(1, Math.round(rect.width));
      const h = Math.max(1, Math.round(rect.height));
      // 让元素宽度严格等于真实宽度（避免 flex / max-width 的舍入导致 ±1px 溢出）
      targetEl.style.width = w + 'px';
      targetEl.style.marginBottom = '0';       // 移除原 .page 的 margin-bottom: 12px
      const dataUrl = await domtoimage.toPng(targetEl, {
        bgcolor: '#1a1b26', quality: 1.0,
        width: w * scale, height: h * scale,
        style: {
          transform: 'scale(' + scale + ')',
          transformOrigin: 'top left',
          width: w + 'px', height: h + 'px'
        }
      });
      document.body.removeChild(container);
      if (triggerDownload) {
        const a = document.createElement('a');
        const label = page.type === 'special' ? (page.title || 'SP') : (page.type === 'newconst' ? (page.title || 'NC') : page.integer);
        a.download = 'Milthm_CC_' + label + '.png';
        a.href = dataUrl;
        a.click();
      }
      return dataUrl;
    } catch (e) {
      console.error('[Export]', e);
      if (container.parentNode) document.body.removeChild(container);
      return null;
    }
  }
  async function exportCurrentPage() {
    const idx = state.currentPageIndex;
    if (!state.data.pages[idx]) { toast('当前没有可导出的页面', 'error'); return; }
    const scale = parseInt(document.getElementById('export-scale').value, 10) || 2;
    showExportProgress('正在导出当前页...');
    try {
      const ok = await exportSinglePage(idx, scale, true);
      if (ok) toast('当前页导出完成', 'success');
      else toast('导出失败', 'error');
    } finally { hideExportProgress(); }
  }
  async function exportAllPages() {
    if (state.data.pages.length === 0) { toast('暂无页面可导出', 'error'); return; }
    const scale = parseInt(document.getElementById('export-scale').value, 10) || 2;
    const total = state.data.pages.length;
    showExportProgress('正在导出 0/' + total + '...');
    try {
      for (let i = 0; i < total; i++) {
        showExportProgress('正在导出 ' + (i + 1) + '/' + total + '...');
        await exportSinglePage(i, scale, true);
        await new Promise(r => setTimeout(r, 650));
      }
      toast('全部导出完成 (' + total + ' 页)', 'success');
    } finally { hideExportProgress(); }
  }

  // ===== 全局搜索：跨页面查找曲目，回车/点击跳转并高亮定位 =====
  function matchSong(song, q) {
    return String(song.name || '').toLowerCase().indexOf(q) > -1 ||
           String(song.filename || '').toLowerCase().indexOf(q) > -1;
  }
  // 难度排序权重：DZ → SK → CB → CL → SP（未知难度排最后）
  const DIFF_ORDER = { DZ: 0, SK: 1, CB: 2, CL: 3, SP: 4 };
  function difficultyRank(d) {
    const v = DIFF_ORDER[String(d == null ? '' : d).trim().toUpperCase()];
    return v === undefined ? 9 : v;
  }
  function searchAllSongs(q) {
    const query = String(q == null ? '' : q).trim().toLowerCase();
    if (!query) return [];
    const out = [];
    state.data.pages.forEach((page, pageIdx) => {
      if (page.type === 'special' || page.type === 'newconst') {
        (page.songs || []).forEach((song, songIdx) => {
          const cNum = Number(song.constant);
          const hasC = song.constant != null && song.constant !== '' && isFinite(cNum);
          const numText = hasC ? cNum.toFixed(2) : '';
          const locTitle = page.title || (page.type === 'newconst' ? '新定数' : '特殊');
          const loc = locTitle + (numText ? ' · ' + numText : '');
          if (matchSong(song, query) || loc.toLowerCase().indexOf(query) > -1) {
            out.push({
              kind: page.type, pageIdx, songIdx, loc, locTitle, numText,
              digit: hasC ? Math.floor(cNum * 10) % 10 : null,
              name: song.name, diff: song.difficulty,
              file: song.filename || state.jacketMap[song.name] || ''
            });
          }
        });
      } else {
        (page.sections || []).forEach((sec, secIdx) => {
          (sec.decimals || []).forEach((dg, decIdx) => {
            (dg.songs || []).forEach((song, songIdx) => {
              const dec = (dg.decimal === null || dg.decimal === undefined) ? '' : '.' + dg.decimal;
              const loc = page.integer + dec;
              if (matchSong(song, query) || loc.indexOf(query) > -1) {
                out.push({
                  kind: 'normal', pageIdx, secIdx, decIdx, songIdx, loc,
                  name: song.name, diff: song.difficulty,
                  digit: (dg.decimal === null || dg.decimal === undefined) ? null : Number(dg.decimal),
                  file: song.filename || state.jacketMap[song.name] || ''
                });
              }
            });
          });
        });
      }
    });
    // 同名曲目聚在一起（组序按首次出现），组内按 DZ→SK→CB→CL→SP；难度相同保持原顺序
    const groups = new Map();
    out.forEach(r => {
      const k = String(r.name || '').trim().toLowerCase();
      if (!groups.has(k)) groups.set(k, groups.size);
    });
    return out.map((r, i) => ({ r, i }))
      .sort((a, b) => {
        const ga = groups.get(String(a.r.name || '').trim().toLowerCase());
        const gb = groups.get(String(b.r.name || '').trim().toLowerCase());
        if (ga !== gb) return ga - gb;
        const da = difficultyRank(a.r.diff), db = difficultyRank(b.r.diff);
        if (da !== db) return da - db;
        return a.i - b.i;
      })
      .map(p => p.r);
  }
  const SEARCH_MAX = 50;
  function renderSearchResults(q) {
    const box = document.getElementById('search-results');
    if (!box) return;
    if (!String(q == null ? '' : q).trim()) { box.classList.remove('active'); box.innerHTML = ''; return; }
    const results = searchAllSongs(q);
    if (!results.length) {
      box.innerHTML = '<div class="empty">无匹配结果</div>';
      box.classList.add('active');
      return;
    }
    const shown = results.slice(0, SEARCH_MAX);
    box.innerHTML = shown.map((r, i) => {
      const src = r.file ? getThumbOrFull(r.file) : '';
      const th = '<span class="th">' + (src ? '<img src="' + esc(src) + '" alt="" loading="lazy" onerror="this.style.display=\'none\'">' : '') + '</span>';
      const numCls = (r.digit === null || r.digit === undefined) ? '' : ' c-' + r.digit;
      const locInner = (r.kind === 'special' || r.kind === 'newconst')
        ? esc(r.locTitle || '') + (r.numText ? ' · <span class="num' + numCls + '">' + esc(r.numText) + '</span>' : '')
        : '<span class="num' + numCls + '">' + esc(r.loc) + '</span>';
      const badge = r.diff ? '<span class="badge ' + getDiffClass(r.diff) + '">' + esc(r.diff) + '</span>' : '';
      return '<div class="item" data-i="' + i + '">' + badge + '<span class="loc">' + locInner + '</span>' + th + '<span class="nm">' + esc(r.name || '(未命名)') + '</span></div>';
    }).join('') + (results.length > SEARCH_MAX ? '<div class="empty">还有 ' + (results.length - SEARCH_MAX) + ' 条，可细化关键词</div>' : '');
    box.classList.add('active');
    box.querySelectorAll('.item').forEach(el => {
      el.addEventListener('click', () => {
        box.classList.remove('active');
        gotoSearchResult(shown[parseInt(el.dataset.i, 10)]);
      });
    });
  }
  function gotoSearchResult(r) {
    if (!r) return;
    if (r.pageIdx !== state.currentPageIndex) {
      state.currentPageIndex = r.pageIdx;
      renderAll();
    }
    // renderAll 是同步 DOM 重建，下一帧再查询定位
    requestAnimationFrame(() => {
      let el = null;
      if (r.kind === 'special') {
        el = document.querySelector('.special-song-row[data-song-idx="' + r.songIdx + '"]');
      } else if (r.kind === 'newconst') {
        el = document.querySelector('.nc-row[data-song-idx="' + r.songIdx + '"]');
      } else {
        const row = document.querySelector('.decimal-row[data-sec-idx="' + r.secIdx + '"][data-dec-idx="' + r.decIdx + '"]');
        if (row) el = row.querySelectorAll('.song-card')[r.songIdx] || row;
      }
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('search-hit');
      setTimeout(() => el.classList.remove('search-hit'), 2200);
    });
  }
  // 预览曲绘点击定位：解析 viewer 渲染的 data-jump 引用，复用 gotoSearchResult 跳转+高亮
  function parseJumpRef(attr) {
    const p = String(attr || '').split(':');
    if (p[0] === 's') return { kind: 'special', songIdx: +p[1] };
    if (p[0] === 'c') return { kind: 'newconst', songIdx: +p[1] };
    if (p[0] === 'n') return { kind: 'normal', secIdx: +p[1], decIdx: +p[2], songIdx: +p[3] };
    return null;
  }

  function bindEvents() {
    setupModalCloseAnimation();
    // ===== 预览定位：点击右侧预览的曲绘 → 跳到编辑器对应条目并高亮 =====
    document.getElementById('viewer-root').addEventListener('click', function (e) {
      const el = e.target && e.target.closest ? e.target.closest('[data-jump]') : null;
      if (!el) return;
      const r = parseJumpRef(el.getAttribute('data-jump'));
      if (!r) return;
      r.pageIdx = state.currentPageIndex;
      gotoSearchResult(r);
    });
    document.getElementById('btn-undo').onclick = undo;
    document.getElementById('btn-redo').onclick = redo;
    document.getElementById('btn-export').onclick = exportJson;
    document.getElementById('btn-view-json').onclick = openJsonView;
    document.getElementById('json-with-images').onchange = renderJsonView;
    document.getElementById('btn-json-copy').onclick = copyJsonView;
    document.getElementById('btn-json-close').onclick = () => document.getElementById('modal-json').classList.remove('active');
    document.getElementById('modal-json').onclick = function (e) { if (e.target === this) this.classList.remove('active'); };
    document.getElementById('btn-save').onclick = () => doSave(false);
    document.getElementById('btn-reset').onclick = async () => {
      if (!confirm('清空当前数据？清空前会自动创建快照，可在「快照」中恢复。')) return;
      createSnapshot('清空前');
      await Storage.clear();
      state.data = { game: 'Milthm', version: '1.0', pages: [] };
      state.jacketMap = {};
      localImages = {};
      localThumbs = {};
      _thumbPromises = {};
      selectedSongs.clear();
      invalidatePreview();
      state.currentPageIndex = 0;
      state.undoStack = []; state.redoStack = [];
      state.isDirty = false; state.lastSaveTime = null;
      renderAll(); updateHistoryButtons();
      toast('已清空', 'success');
    };
    document.getElementById('btn-import').onclick = () => document.getElementById('file-input').click();
    document.getElementById('file-input').onchange = function () { if (this.files[0]) importJson(this.files[0]); this.value = ''; };
    document.getElementById('btn-export-current').onclick = exportCurrentPage;
    document.getElementById('btn-export-all').onclick = exportAllPages;

    const versionInput = document.getElementById('version-input');
    versionInput.addEventListener('change', function () {
      pushHistory();
      state.data.version = this.value.trim() || '1.0';
      invalidatePreview();
      renderPreview();
      toast('已更新版本号: Ver ' + state.data.version, 'success');
    });
    versionInput.addEventListener('blur', function () { syncVersionInput(); });

    document.getElementById('batch-delete').onclick = batchDelete;
    document.getElementById('batch-set-badge').onclick = batchSetBadge;
    document.getElementById('batch-clear').onclick = () => { clearSelection(); toast('已取消选择'); };

    document.getElementById('btn-cancel-image').onclick = () => { document.getElementById('modal-image').classList.remove('active'); imageCallback = null; };
    document.getElementById('modal-image').onclick = function (e) { if (e.target === this) { this.classList.remove('active'); imageCallback = null; } };
    document.getElementById('btn-cancel-badge').onclick = () => { document.getElementById('modal-badge').classList.remove('active'); badgeCallback = null; };
    document.getElementById('modal-badge').onclick = function (e) { if (e.target === this) { this.classList.remove('active'); badgeCallback = null; } };

    document.getElementById('btn-apply-tag').onclick = () => {
      const v = document.getElementById('tag-input').value.trim();
      if (tagCallback) { tagCallback(v); tagCallback = null; }
      document.getElementById('modal-tag').classList.remove('active');
    };
    document.getElementById('btn-cancel-tag').onclick = () => {
      document.getElementById('modal-tag').classList.remove('active');
      tagCallback = null;
    };
    document.getElementById('modal-tag').onclick = function (e) {
      if (e.target === this) { this.classList.remove('active'); tagCallback = null; }
    };
    document.getElementById('tag-input').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); document.getElementById('btn-apply-tag').click(); }
    });

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && selectedSongs.size > 0) clearSelection();
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); doSave(false); }
      if ((e.ctrlKey || e.metaKey) && e.key === 'o') { e.preventDefault(); document.getElementById('file-input').click(); }
    });
    // ===== 全局搜索 =====
    const searchInput = document.getElementById('global-search');
    const searchResultsBox = document.getElementById('search-results');
    searchInput.addEventListener('input', function () { renderSearchResults(this.value); });
    searchInput.addEventListener('focus', function () { if (this.value.trim()) renderSearchResults(this.value); });
    searchInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        const first = searchResultsBox.querySelector('.item');
        if (first) first.click();
      } else if (e.key === 'Escape') {
        this.value = ''; renderSearchResults(''); this.blur();
      }
    });
    document.addEventListener('click', e => {
      if (e.target && e.target.closest && !e.target.closest('.search-box')) searchResultsBox.classList.remove('active');
    });

    // ===== 体检 / 快照 =====
    document.getElementById('btn-audit').onclick = openAudit;
    document.getElementById('btn-audit-close').onclick = () => document.getElementById('modal-audit').classList.remove('active');
    document.getElementById('modal-audit').onclick = function (e) { if (e.target === this) this.classList.remove('active'); };
    document.getElementById('btn-audit-fix').onclick = auditFixAll;
    document.getElementById('btn-snap').onclick = openSnapshots;
    document.getElementById('btn-snap-close').onclick = () => document.getElementById('modal-snapshot').classList.remove('active');
    document.getElementById('modal-snapshot').onclick = function (e) { if (e.target === this) this.classList.remove('active'); };
    document.getElementById('btn-snap-create').onclick = () => {
      if (createSnapshot('手动创建')) { renderSnapshotList(); toast('已创建快照', 'success'); }
      else toast('快照创建失败', 'error');
    };

    // ===== 批量替换 =====
    document.getElementById('btn-replace').onclick = openReplace;
    document.getElementById('btn-replace-close').onclick = () => document.getElementById('modal-replace').classList.remove('active');
    document.getElementById('modal-replace').onclick = function (e) { if (e.target === this) this.classList.remove('active'); };
    document.getElementById('btn-replace-run').onclick = runReplace;
    document.getElementById('replace-find').addEventListener('input', updateReplaceCount);
    document.getElementById('replace-with').addEventListener('input', updateReplaceCount);

    // ===== 从正文套用定数 =====
    document.getElementById('btn-apply-close').onclick = () => document.getElementById('modal-apply').classList.remove('active');
    document.getElementById('modal-apply').onclick = function (e) { if (e.target === this) this.classList.remove('active'); };
    document.getElementById('apply-search').addEventListener('input', function () { renderApplyList(this.value); });

    window.addEventListener('beforeunload', () => { if (state.isDirty) doSave(true); });
  }

  async function init() {
    const saved = Storage.load();
    if (saved) {
      state.data = saved.data;
      state.jacketMap = saved.jacketMap || {};
      state.currentPageIndex = 0;
      state.isDirty = false;
      state.lastSaveTime = saved.savedAt || null;
    }
    updateHistoryButtons();
    bindEvents();
    // 图片/缩略图：IndexedDB 优先，旧 localStorage 数据自动迁移；到位后再渲染，避免曲绘闪烁
    try {
      const blobs = await Storage.loadBlobs();
      localImages = blobs.images || {};
      localThumbs = blobs.thumbs || {};
    } catch (e) {
      console.warn('[init] 图片加载失败:', e);
      localImages = {};
      localThumbs = {};
    }
    if (saved) {
      renderAll();
      setTimeout(ensureAllThumbs, 100);
      setStatus('已从本地存储恢复', 'saved');
      updateSaveTime();
      toast('已恢复上次编辑的数据', 'success');
    } else {
      renderAll();
      setStatus('就绪');
      updateSaveTime();
    }
  }

  init();
