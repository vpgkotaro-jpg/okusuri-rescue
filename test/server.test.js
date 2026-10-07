// サーバー：端末がためた読み取り記録を受け取り、署名を確かめて突き合わせる
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Core = require("../lastone-core.js");
const Demo = require("../demo-data.js");
const { createServer } = require("../server.js");

test("記録を受け取り、書き換えたカードと期限切れは断り、同じ記録を2回送っても増えない", async () => {
  const dataFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "lastone-")), "scans.json");
  const srv = createServer({ dataFile, staffKey: "k1", today: () => "2026-10-12" });
  await new Promise((r) => srv.listen(0, r));
  const base = "http://127.0.0.1:" + srv.address().port;
  const card = (p, hand) => Core.cardText(Demo.issuedFields(p), hand, "北山小学校 体育館", Demo.SIGS[p.id]);
  const A = Demo.PEOPLE[0], X = Demo.PEOPLE[23];
  const scans = [
    { sid: "dev1-1", id: A.id, at: "2026-10-12T09:00", hand: 0, place: "北山小学校 体育館", card: card(A, "0日（家が壊れた）") },
    { sid: "dev1-2", id: A.id, at: "2026-10-12T09:05", hand: 0, card: card(A, "0日").replace("ステロイド", "ステロイト") },
    { sid: "dev1-3", id: X.id, at: "2026-10-12T09:10", hand: 4, card: card(X, "4日分") }
  ];
  const post = (body) => fetch(base + "/api/scans", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());
  try {
    const r1 = await post({ scans });
    assert.strictEqual(r1.accepted, 1);
    assert.deepStrictEqual(r1.rejected.map((x) => x.sid), ["dev1-2", "dev1-3"]);
    const r2 = await post({ scans: [scans[0]] });
    assert.strictEqual(r2.total, 1, "同じ記録を2回送っても1件のまま");
    const r3 = await post({ scans: [{ ...scans[0], sid: "dev2-1", at: "2026-10-12T10:00" }] });
    assert.strictEqual(r3.total, 2, "別の端末の記録は足される");
    const r4 = await post({ scans: [{ ...scans[2], sid: "dev3-1", at: "2025-12-01T10:00" }] });
    assert.strictEqual(r4.accepted, 0, "読み取り時刻を古くしても、期限はサーバーの日付で比べるので通らない");
    assert.strictEqual((await fetch(base + "/api/scans")).status, 403, "鍵がないと一覧は読めない");
    const g = await fetch(base + "/api/scans", { headers: { "x-lastone-staff": "k1" } }).then((r) => r.json());
    assert.strictEqual(g.scans.length, 2);
    assert.strictEqual((await fetch(base + "/../server.js")).status, 404);
    assert.strictEqual((await fetch(base + "/lastone-core.js")).status, 200);
    assert.strictEqual((await post({ nope: 1 })).error, "形式が違う");
  } finally { srv.close(); }
});
