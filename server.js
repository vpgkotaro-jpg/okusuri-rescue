// おくすりレスキューの小さなサーバー（Node 18 以降、外部ライブラリなし）
//   起動：OKUSURI_STAFF_KEY=… OKUSURI_DEVICE_KEYS='{"dev-ab12":"鍵"}' node server.js   → http://localhost:8080/
//   POST /api/scans  係員の端末がためた読み取り記録。端末ごとの鍵で本文に HMAC-SHA256 を付けて送る
//                    （x-okusuri-device：端末ID、x-okusuri-sig：16進）。記録の sid は「端末ID-」で始まるものだけ受け取るので、
//                    ほかの端末の記録は上書きできない。カードの署名と期限はサーバーの日付で確かめ直す
//   POST /api/lost   患者アプリの「手元の薬を失った」。署名つきのカードの文を添える（係員の鍵は要らない）
//   GET  /api/scans・/api/lost  一覧。薬の名前が入るので係員の鍵（x-okusuri-staff）が要る
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const Core = require("./okusuri-core.js");
const Demo = require("./demo-data.js");

const ROOT = __dirname;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json", ".json": "application/json; charset=utf-8", ".md": "text/plain; charset=utf-8" };
const PUBLIC = new Set(["index.html", "okusuri-core.js", "qr-read.js", "app.js", "demo-data.js", "sw.js", "manifest.webmanifest", "icon.svg"]);

function today() {
  const d = new Date(), z = (n) => (n < 10 ? "0" : "") + n;
  return d.getFullYear() + "-" + z(d.getMonth() + 1) + "-" + z(d.getDate());
}
function hmac(key, body) { return crypto.createHmac("sha256", key).update(body).digest("hex"); }
function same(a, b) { a = Buffer.from(String(a)); b = Buffer.from(String(b)); return a.length === b.length && crypto.timingSafeEqual(a, b); }

function createServer(opts) {
  opts = opts || {};
  const dir = opts.dataDir || path.join(ROOT, "data");
  const staffKey = opts.staffKey !== undefined ? opts.staffKey : process.env.OKUSURI_STAFF_KEY || "";
  const deviceKeys = opts.deviceKeys || JSON.parse(process.env.OKUSURI_DEVICE_KEYS || "{}");
  const now = opts.today || today;
  function load(name) { try { return JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")); } catch (e) { return []; } }
  function save(name, v) {
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, name);
    fs.writeFileSync(f + ".tmp", JSON.stringify(v, null, 1));
    fs.renameSync(f + ".tmp", f);                    // 書きかけのファイルを残さない
  }
  let queue = Promise.resolve();                     // 同時に来た POST を1つずつ処理する
  function send(res, code, body) {
    res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(JSON.stringify(body));
  }
  function readBody(req, res, then) {
    let body = "";
    req.on("data", (c) => { body += c; if (body.length > 1e6) { send(res, 413, { error: "大きすぎる" }); req.destroy(); } });
    req.on("end", () => {
      let json;
      try { json = JSON.parse(body); } catch (e) { return send(res, 400, { error: "形式が違う" }); }
      queue = queue.then(() => then(body, json)).catch((e) => send(res, 500, { error: String(e) }));
    });
  }
  const isStaff = (req) => staffKey && same(req.headers["x-okusuri-staff"] || "", staffKey);

  return http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    if (url.pathname === "/api/health") return send(res, 200, { ok: true });
    if ((url.pathname === "/api/scans" || url.pathname === "/api/lost") && req.method === "GET") {
      if (!isStaff(req)) return send(res, 403, { error: "係員の鍵がない" });
      return send(res, 200, url.pathname === "/api/scans" ? { scans: load("scans.json") } : { lost: load("lost.json") });
    }
    if (url.pathname === "/api/scans" && req.method === "POST") {
      return readBody(req, res, async (raw, json) => {
        const dev = req.headers["x-okusuri-device"] || "", key = deviceKeys[dev];
        if (!key || !same(req.headers["x-okusuri-sig"] || "", hmac(key, raw))) return send(res, 401, { error: "端末の鍵が合わない" });
        if (!Array.isArray(json.scans)) return send(res, 400, { error: "形式が違う" });
        const ok = [], rejected = [];
        for (const s of json.scans) {
          if (!s || typeof s.sid !== "string" || typeof s.card !== "string" || typeof s.at !== "string") { rejected.push({ sid: s && s.sid, reason: "項目が足りない" }); continue; }
          if (!s.sid.startsWith(dev + "-") || s.dev !== dev) { rejected.push({ sid: s.sid, reason: "ほかの端末の記録" }); continue; }
          const v = await Core.verifyCard(s.card, Demo.ISSUER_PUB, now());
          if (!v.ok || v.card.ID !== s.id) { rejected.push({ sid: s.sid, reason: v.reason || "IDが合わない" }); continue; }
          const h = Core.handCheck(v.card, now());
          ok.push(Object.assign({}, s, { hand: h.use, reported: v.card.hand, capped: h.capped, needsCheck: h.needsCheck }));
        }
        const merged = Core.mergeScans(load("scans.json"), ok);
        save("scans.json", merged);
        send(res, 200, { accepted: ok.length, rejected, total: merged.length });
      });
    }
    if (url.pathname === "/api/lost" && req.method === "POST") {
      return readBody(req, res, async (raw, json) => {
        if (typeof json.card !== "string") return send(res, 400, { error: "形式が違う" });
        const v = await Core.verifyCard(json.card, Demo.ISSUER_PUB, now());
        if (!v.ok) return send(res, 400, { error: v.reason });
        // カード1枚につき1件。同じカードから何度送っても、最初に受け取った時刻のまま場所だけ新しくする
        const list = load("lost.json"), cur = list.find((x) => x.id === v.card.ID);
        if (cur) cur.place = v.card["場所"] || cur.place;
        else list.push({ id: v.card.ID, place: v.card["場所"] || "", received: new Date().toISOString(), checked: false });
        save("lost.json", list);
        send(res, 200, { ok: true, total: list.length });
      });
    }
    // 静的ファイル（決まったものだけ返す）
    const name = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    if (!PUBLIC.has(name)) { res.writeHead(404); return res.end("not found"); }
    fs.readFile(path.join(ROOT, name), (err, buf) => {
      if (err) { res.writeHead(404); return res.end("not found"); }
      res.writeHead(200, { "content-type": TYPES[path.extname(name)] || "application/octet-stream" });
      res.end(buf);
    });
  });
}
module.exports = { createServer, hmac };
if (require.main === module) {
  const port = +process.env.PORT || 8080;
  createServer().listen(port, () => console.log("おくすりレスキュー: http://localhost:" + port + "/"));
}
