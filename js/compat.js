// js/compat.js — dom-to-image 的 file:// 兼容补丁（字体/XHR 超时兜底）
(function patchDomToImage() {
  if (typeof domtoimage === 'undefined' || !domtoimage.impl) return;
  try {
    if (domtoimage.impl.fontFaces && typeof domtoimage.impl.fontFaces.resolveAll === 'function') {
      domtoimage.impl.fontFaces.resolveAll = function () { return Promise.resolve(''); };
    }
    if (domtoimage.impl.util && typeof domtoimage.impl.util.getAndEncode === 'function') {
      domtoimage.impl.util.getAndEncode = function (url) {
        return new Promise(function (resolve) {
          if (!url) { resolve(''); return; }
          if (url.indexOf('data:') === 0) {
            try { resolve(url.split(',')[1] || ''); } catch (e) { resolve(''); }
            return;
          }
          var settled = false;
          function done(v) { if (!settled) { settled = true; resolve(v || ''); } }
          var TIMEOUT = 1500;
          var timer = setTimeout(function () { done(''); }, TIMEOUT);
          try {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', url, true);
            xhr.responseType = 'blob';
            xhr.timeout = TIMEOUT;
            xhr.onloadend = function () {
              clearTimeout(timer);
              if (xhr.status !== 200 || !xhr.response) { done(''); return; }
              try {
                var reader = new FileReader();
                reader.onloadend = function () {
                  var dataUrl = reader.result || '';
                  done(dataUrl.indexOf(',') >= 0 ? dataUrl.split(',')[1] : '');
                };
                reader.onerror = function () { done(''); };
                reader.readAsDataURL(xhr.response);
              } catch (e) { done(''); }
            };
            xhr.onerror = function () { clearTimeout(timer); done(''); };
            xhr.ontimeout = function () { clearTimeout(timer); done(''); };
            xhr.send();
          } catch (e) { clearTimeout(timer); done(''); }
        });
      };
    }
  } catch (e) { console.warn('[patchDomToImage]', e); }
})();
