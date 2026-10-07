// LASTONE の小さなサーバー（Node 18 以降、外部ライブラリなし）
//   起動：node server.js   → http://localhost:8080/
//   係員の端末が圏外でためた読み取り記録を、通信が戻ったときに受け取って突き合わせる。
//   カードの署名は、ブラウザと同じ lastone-core.js でもう一度確かめる。期限はサーバーの日付で比べる
//   （端末が送ってくる読み取り時刻は書き換えられるので使わない）。
//   記録の一覧（GET）には薬の名前が入るので、係員の鍵（環境変数 LASTONE_STAFF_KEY）がないと読めない。
//   ログインはまだない。鍵を決めずに起動すると、一覧は誰にも返さない。
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const Core = require("./lastone-core.js");
const Demo = require("./demo-data.js");

const ROOT = __dirname;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json", ".json": "application/json; charset=utf-8", ".md": "text/plain; charset=utf-8" };
const PUBLIC = new Set(["index.html", "lastone-core.js", "qr-read.js", "app.js", "demo-data.js", "sw.js", "manifest.webmanifest", "icon.svg"]);

function today() {
  const d = new Date(), z = (n) => (n < 10 ? "0" : "") + n;
  return d.getFullYear() + "-" + z(d.getMonth() + 1) + "-" + z(d.getDate());
}
function createServer(opts) {
  opts = opts || {};
  const dataFile = opts.dataFile || path.join(ROOT, "data", "scans.json");
  const staffKey = opts.staffKey !== undefined ? opts.staffKey : process.env.LASTONE_STAFF_KEY || "";
  const now = opts.today || today;
  function load() { try { return JSON.parse(fs.readFileSync(dataFile, "utf8")); } catch (e) { return []; } }
  function save(scans) {
    fs.mkdirSync(path.dirname(dataFile), { recursive: true });
    const tmp = dataFile + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(scans, null, 1));
    fs.renameSync(tmp, dataFile);                    // 書きかけのファイルを残さない
  }
  let queue = Promise.resolve();                     // 同時に来た POST を1つずつ処理する
  function send(res, code, body) {
    res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(JSON.stringify(body));
  }
  return http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    if (url.pathname === "/api/health") return send(res, 200, { ok: true });
    if (url.pathname === "/api/scans" && req.method === "GET") {
      if (!staffKey || req.headers["x-lastone-staff"] !== staffKey) return send(res, 403, { error: "係員の鍵がない" });
      return send(res, 200, { scans: load() });
    }
    if (url.pathname === "/api/scans" && req.method === "POST") {
      let body = "";
      req.on("data", (c) => { body += c; if (body.length > 1e6) { send(res, 413, { error: "大きすぎる" }); req.destroy(); } });
      req.on("end", () => {
        let incoming;
        try { incoming = JSON.parse(body).scans; if (!Array.isArray(incoming)) throw 0; } catch (e) { return send(res, 400, { error: "形式が違う" }); }
        queue = queue.then(async () => {
          const ok = [], rejected = [];
          for (const s of incoming) {
            if (!s || typeof s.sid !== "string" || typeof s.card !== "string" || typeof s.at !== "string") { rejected.push({ sid: s && s.sid, reason: "項目が足りない" }); continue; }
            const v = await Core.verifyCard(s.card, Demo.ISSUER_PUB, now());
            if (!v.ok || v.card.ID !== s.id) { rejected.push({ sid: s.sid, reason: v.reason || "IDが合わない" }); continue; }
            ok.push(s);
          }
          const merged = Core.mergeScans(load(), ok);
          save(merged);
          send(res, 200, { accepted: ok.length, rejected, total: merged.length });
        }).catch((e) => send(res, 500, { error: String(e) }));
      });
      return;
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
module.exports = { createServer };
if (require.main === module) {
  const port = +process.env.PORT || 8080;
  createServer().listen(port, () => console.log("LASTONE: http://localhost:" + port + "/"));
}
