// js/storage.js — 存储层：localStorage（数据+曲绘索引）与 IndexedDB（图片/缩略图）
  const Storage = (function () {
    const KEY = 'milthm-editor-data-v1';
    const IMG_KEY = 'milthm-editor-images-v1';
    const THUMB_KEY = 'milthm-editor-thumbs-v1';
    function save(data, jacketMap, localImages, localThumbs) {
      try {
        const ts = Date.now();
        localStorage.setItem(KEY, JSON.stringify({ data, jacketMap, savedAt: ts, version: 1 }));
        // 有 IndexedDB 时图片大对象不进 localStorage（由 saveBlobs 异步写入）
        if (!hasIDB()) {
          if (localImages) {
            try { localStorage.setItem(IMG_KEY, JSON.stringify(localImages)); }
            catch (imgErr) { console.warn('[Storage] 图片保存失败（可能超出 localStorage 配额）:', imgErr); }
          }
          if (localThumbs) {
            try { localStorage.setItem(THUMB_KEY, JSON.stringify(localThumbs)); }
            catch (thumbErr) { console.warn('[Storage] 缩略图保存失败:', thumbErr); }
          }
        }
        return ts;
      } catch (e) { console.error('[Storage]', e); return null; }
    }
    function load() {
      try {
        const raw = localStorage.getItem(KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed.data || !parsed.data.pages) return null;
        return { data: parsed.data, jacketMap: parsed.jacketMap || {}, savedAt: parsed.savedAt };
      } catch (e) { console.error('[Storage]', e); return null; }
    }
    // ===== IndexedDB：存放图片/缩略图大对象，绕开 localStorage 5MB 配额 =====
    const IDB_NAME = 'milthm-editor-db';
    const IDB_STORE = 'kv';
    const BLOB_IMAGE_KEY = 'images-v1';
    const BLOB_THUMB_KEY = 'thumbs-v1';
    function hasIDB() {
      try { return typeof indexedDB !== 'undefined' && indexedDB !== null; } catch (e) { return false; }
    }
    let _idbPromise = null;
    function idbOpen() {
      if (_idbPromise) return _idbPromise;
      _idbPromise = new Promise((resolve, reject) => {
        let req;
        try { req = indexedDB.open(IDB_NAME, 1); } catch (e) { reject(e); return; }
        req.onupgradeneeded = () => {
          try { if (!req.result.objectStoreNames.contains(IDB_STORE)) req.result.createObjectStore(IDB_STORE); }
          catch (e) { reject(e); }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error('IndexedDB 打开失败'));
        req.onblocked = () => reject(new Error('IndexedDB 被其他标签页阻塞'));
      });
      _idbPromise.catch(() => { _idbPromise = null; });
      return _idbPromise;
    }
    function idbReq(request) {
      return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('IndexedDB 操作失败'));
      });
    }
    function idbGet(key) {
      return idbOpen().then(db => idbReq(db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(key)));
    }
    function idbPut(key, value) {
      return idbOpen().then(db => idbReq(db.transaction(IDB_STORE, 'readwrite').objectStore(IDB_STORE).put(value, key)));
    }
    function idbDel(key) {
      return idbOpen().then(db => idbReq(db.transaction(IDB_STORE, 'readwrite').objectStore(IDB_STORE).delete(key)));
    }
    function readLegacyBlobs() {
      let images = {}, thumbs = {};
      try {
        const r = localStorage.getItem(IMG_KEY);
        if (r) { const v = JSON.parse(r); if (v && typeof v === 'object') images = v; }
      } catch (e) { console.warn('[Storage] 图片加载失败:', e); }
      try {
        const r = localStorage.getItem(THUMB_KEY);
        if (r) { const v = JSON.parse(r); if (v && typeof v === 'object') thumbs = v; }
      } catch (e) { console.warn('[Storage] 缩略图加载失败:', e); }
      return { images, thumbs };
    }
    // 读取图片/缩略图：IndexedDB 优先；发现旧版 localStorage 数据则自动迁移并清理旧键
    async function loadBlobs() {
      if (hasIDB()) {
        try {
          const images = await idbGet(BLOB_IMAGE_KEY);
          const thumbs = await idbGet(BLOB_THUMB_KEY);
          if (images !== undefined || thumbs !== undefined) {
            try { localStorage.removeItem(IMG_KEY); localStorage.removeItem(THUMB_KEY); } catch (e) {}
            return { images: images || {}, thumbs: thumbs || {}, source: 'idb' };
          }
          const legacy = readLegacyBlobs();
          if (Object.keys(legacy.images).length || Object.keys(legacy.thumbs).length) {
            try {
              await idbPut(BLOB_IMAGE_KEY, legacy.images);
              await idbPut(BLOB_THUMB_KEY, legacy.thumbs);
              localStorage.removeItem(IMG_KEY);
              localStorage.removeItem(THUMB_KEY);
              return { images: legacy.images, thumbs: legacy.thumbs, source: 'idb' };
            } catch (e) {
              console.warn('[Storage] 图片迁移到 IndexedDB 失败，继续使用 localStorage:', e);
              return { images: legacy.images, thumbs: legacy.thumbs, source: 'local' };
            }
          }
          return { images: {}, thumbs: {}, source: 'idb' };
        } catch (e) { console.warn('[Storage] IndexedDB 读取失败，回退 localStorage:', e); }
      }
      const legacy = readLegacyBlobs();
      return { images: legacy.images, thumbs: legacy.thumbs, source: 'local' };
    }
    // 写入图片/缩略图：IndexedDB 优先，失败回退 localStorage
    async function saveBlobs(localImages, localThumbs) {
      const images = localImages || {}, thumbs = localThumbs || {};
      if (hasIDB()) {
        try {
          await idbPut(BLOB_IMAGE_KEY, images);
          await idbPut(BLOB_THUMB_KEY, thumbs);
          try { localStorage.removeItem(IMG_KEY); localStorage.removeItem(THUMB_KEY); } catch (e) {}
          return true;
        } catch (e) { console.warn('[Storage] IndexedDB 写入失败，回退 localStorage:', e); }
      }
      let ok = true;
      try { localStorage.setItem(IMG_KEY, JSON.stringify(images)); }
      catch (e) { console.warn('[Storage] 图片保存失败（可能超出 localStorage 配额）:', e); ok = false; }
      try { localStorage.setItem(THUMB_KEY, JSON.stringify(thumbs)); }
      catch (e) { console.warn('[Storage] 缩略图保存失败:', e); }
      return ok;
    }
    async function clear() {
      let ok = true;
      try {
        localStorage.removeItem(KEY);
        localStorage.removeItem(IMG_KEY);
        localStorage.removeItem(THUMB_KEY);
        // 快照保留：清空前会先存一份，用户可在「快照」里恢复
      } catch (e) { ok = false; }
      if (hasIDB()) {
        try { await idbDel(BLOB_IMAGE_KEY); await idbDel(BLOB_THUMB_KEY); }
        catch (e) { console.warn('[Storage] IndexedDB 清理失败:', e); ok = false; }
      }
      return ok;
    }
    const SNAP_KEY = 'milthm-editor-snapshots-v1';
    const SNAP_MAX = 10;
    function loadSnapshots() {
      try {
        const raw = localStorage.getItem(SNAP_KEY);
        if (!raw) return [];
        const list = JSON.parse(raw);
        return Array.isArray(list) ? list : [];
      } catch (e) { console.warn('[Storage] 快照读取失败:', e); return []; }
    }
    function saveSnapshots(list) {
      try {
        localStorage.setItem(SNAP_KEY, JSON.stringify((list || []).slice(0, SNAP_MAX)));
        return true;
      } catch (e) {
        console.warn('[Storage] 快照保存失败（可能超出 localStorage 配额）:', e);
        return false;
      }
    }
    return { save, load, clear, loadBlobs, saveBlobs, hasIDB, loadSnapshots, saveSnapshots, SNAP_MAX, KEY, IMG_KEY, THUMB_KEY, SNAP_KEY };
  })();
