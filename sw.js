/* 一度開いたら、通信がなくても画面とロジックが動くようにする（https で公開したときだけ有効） */
var CACHE = "lastone-v4";
var FILES = ["./", "./index.html", "./demo-data.js", "./lastone-core.js", "./qr-read.js", "./app.js", "./manifest.webmanifest", "./icon.svg"];
self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(FILES); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
// 同じ場所のファイルは、まず通信を試し、だめならキャッシュを返す（更新を取りこぼさないため）
self.addEventListener("fetch", function (e) {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(function (res) {
    var copy = res.clone();
    caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
    return res;
  }).catch(function () {
    return caches.match(e.request, { ignoreSearch: true }).then(function (hit) { return hit || caches.match("./index.html"); });
  }));
});
