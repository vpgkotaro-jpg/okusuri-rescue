// サーバー：端末がためた読み取り記録と、患者アプリの「失った」を受け取る
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Core = require("../okusuri-core.js");
const Demo = require("../demo-data.js");
const { createServer, hmac } = require("../server.js");

async function start() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "okusuri-"));
  const srv = createServer({ dataDir, staffKey: "k1", deviceKeys: { d1: "key-d1", d2: "key-d2" }, today: () => "2026-10-12" });
  await new Promise((r) => srv.listen(0, r));
  return { srv, base: "http://127.0.0.1:" + srv.address().port };
}
const card = (p, hand, place) => Core.cardText(Demo.issuedFields(p), hand, place || "北山小学校 体育館", Demo.SIGS[p.id]);
const A = Demo.PEOPLE[0], X = Demo.PEOPLE[23];

test("読み取り記録：端末の鍵で署名した記録だけ受け取り、書き換えたカードと期限切れを断り、同じ記録を2回送っても増えない", async () => {
  const { srv, base } = await start();
  const post = (dev, key, body) => {
    const raw = JSON.stringify(body);
    return fetch(base + "/api/scans", { method: "POST", headers: { "content-type": "application/json", "x-okusuri-device": dev, "x-okusuri-sig": hmac(key, raw) }, body: raw })
      .then(async (r) => ({ status: r.status, ...(await r.json()) }));
  };
  const scans = [
    { sid: "d1-1", dev: "d1", id: A.id, at: "2026-10-12T09:00", hand: 0, place: "北山小学校 体育館", card: card(A, "0日（家が壊れた）") },
    { sid: "d1-2", dev: "d1", id: A.id, at: "2026-10-12T09:05", hand: 0, card: card(A, "0日").replace("ステロイド", "ステロイト") },
    { sid: "d1-3", dev: "d1", id: X.id, at: "2026-10-12T09:10", hand: 4, card: card(X, "4日分") }
  ];
  try {
    assert.strictEqual((await post("d1", "違う鍵", { scans })).status, 401, "鍵が合わなければ受け取らない");
    assert.strictEqual((await post("d9", "key-d1", { scans })).status, 401, "登録されていない端末");
    const r1 = await post("d1", "key-d1", { scans });
    assert.strictEqual(r1.accepted, 1);
    assert.deepStrictEqual(r1.rejected.map((x) => x.sid), ["d1-2", "d1-3"]);
    assert.strictEqual((await post("d1", "key-d1", { scans: [scans[0]] })).total, 1, "同じ記録を2回送っても1件のまま");
    const over = { ...scans[0], hand: 5, rev: 9, card: card(A, "5日分") };
    const r3 = await post("d2", "key-d2", { scans: [over] });
    assert.strictEqual(r3.accepted, 0, "端末 d2 は d1 の記録を上書きできない");
    assert.strictEqual(r3.rejected[0].reason, "ほかの端末の記録");
    const r4 = await post("d2", "key-d2", { scans: [{ ...over, sid: "d2-1", dev: "d2" }] });
    assert.strictEqual(r4.accepted, 1);
    assert.strictEqual((await fetch(base + "/api/scans")).status, 403, "係員の鍵がないと一覧は読めない");
    const g = await fetch(base + "/api/scans", { headers: { "x-okusuri-staff": "k1" } }).then((r) => r.json());
    const d2 = g.scans.find((s) => s.sid === "d2-1");
    assert.strictEqual(d2.reported, 5);
    assert.strictEqual(d2.hand, 2, "交付の記録から出した上限（2日）で頭打ち");
    assert.ok(d2.capped);
    assert.strictEqual(g.scans.find((s) => s.sid === "d1-1").needsCheck, true, "上限より少ない申告（失った）は係員の確認待ち");
    assert.strictEqual((await fetch(base + "/../server.js")).status, 404);
    assert.strictEqual((await fetch(base + "/okusuri-core.js")).status, 200);
  } finally { srv.close(); }
});

test("患者の「失った」：署名つきのカードを添えれば受け取り、カード1枚につき1件にまとめる", async () => {
  const { srv, base } = await start();
  const post = (body) => fetch(base + "/api/lost", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
  try {
    assert.ok((await post({ card: card(A, "0日（家が壊れた）") })).ok);
    assert.strictEqual((await post({ card: card(A, "0日（家が壊れた）", "本町公民館") })).total, 1);
    assert.match((await post({ card: card(A, "0日").replace("7日分", "14日分") })).error, /一致しない/);
    assert.match((await post({ card: card(X, "0日") })).error, /有効期限/);
    const g = await fetch(base + "/api/lost", { headers: { "x-okusuri-staff": "k1" } }).then((r) => r.json());
    assert.strictEqual(g.lost.length, 1);
    assert.strictEqual(g.lost[0].place, "本町公民館");
  } finally { srv.close(); }
});

test("手元の日数の上限：交付からの日数で減り、申告が多ければ頭打ち、少なければ確認待ち", () => {
  const c = { "交付": "2026-09-20/28日分", hand: 10 };
  assert.deepStrictEqual(Core.handCheck(c, "2026-10-12"), { use: 6, cap: 6, capped: true, needsCheck: false });
  assert.deepStrictEqual(Core.handCheck({ ...c, hand: 0 }, "2026-10-12"), { use: 0, cap: 6, capped: false, needsCheck: true });
  assert.strictEqual(Core.handCheck({ ...c, hand: 6 }, "2026-10-12").needsCheck, false);
  assert.strictEqual(Core.handCheck(c, "2026-11-30").cap, 0);
  assert.strictEqual(Core.handCheck({ hand: 3 }, "2026-10-12").use, 3, "交付の記録がないカードは申告のまま");
});
