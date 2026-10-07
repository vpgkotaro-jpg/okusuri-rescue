// 実行：node --test app/test/*.test.js   （Node 18 以降。外部ライブラリなし）
const test = require("node:test");
const assert = require("node:assert");
const Core = require("../lastone-core.js");

/* ---------- 危険になる日 ---------- */
test("危険になる日 = 手元の日数 + 分類の猶予", () => {
  assert.strictEqual(Core.dangerDay(2, "imm"), 2);
  assert.strictEqual(Core.dangerDay(6, "h72"), 8);
  assert.strictEqual(Core.dangerDay(0, "imm"), 0);
});

/* ---------- 配送計画 ---------- */
// 全探索：一人ずつ「[release, deadline] のどの日に入れるか／入れないか」を全部試し、間に合う人の最大数を出す
function bruteMaxOnTime(jobs, cap) {
  const used = {};
  let best = 0;
  const dfs = (i, ok) => {
    if (ok + (jobs.length - i) <= best) return;
    if (i === jobs.length) { best = Math.max(best, ok); return; }
    const j = jobs[i];
    for (let d = j.release; d <= j.deadline; d++) {
      if ((used[d] || 0) < cap) { used[d] = (used[d] || 0) + 1; dfs(i + 1, ok + 1); used[d]--; }
    }
    dfs(i + 1, ok);
  };
  dfs(0, 0);
  return best;
}

test("上限なしなら、全員がいちばん早い日に届く", () => {
  const jobs = [{ id: "a", deadline: 1, release: 2 }, { id: "b", deadline: 5, release: 2 }];
  const r = Core.schedule(jobs, Infinity, "edf");
  assert.deepStrictEqual(r.day, { a: 2, b: 2 });
  assert.deepStrictEqual(r.late, ["a"]);
});

test("間に合わない人には枠を使わない（後ろに回す）", () => {
  // 1日1件。a は締切0日で、どうやっても間に合わない。a に2日目を使うと b も遅れる
  const jobs = [{ id: "a", deadline: 0, release: 2 }, { id: "b", deadline: 2, release: 2 }];
  const r = Core.schedule(jobs, 1, "edf");
  assert.strictEqual(r.day.b, 2);
  assert.deepStrictEqual(r.late, ["a"]);
  assert.strictEqual(Core.schedule(jobs, 1, "fifo").late.length, 2);
});

test("edf は全探索の最適と一致する（届けられる最初の日が全員同じ：2,000問）", () => {
  let seed = 20261012;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let t = 0; t < 2000; t++) {
    const n = 1 + Math.floor(rnd() * 8), cap = 1 + Math.floor(rnd() * 3);
    const jobs = [];
    for (let i = 0; i < n; i++) jobs.push({ id: i, deadline: Math.floor(rnd() * 8), release: 2 });
    const edf = Core.schedule(jobs, cap, "edf").late.length;
    assert.strictEqual(edf, n - bruteMaxOnTime(jobs, cap), JSON.stringify({ jobs, cap }));
    assert.ok(edf <= Core.schedule(jobs, cap, "fifo").late.length);
  }
});

test("edf は全探索の最適と一致する（最初の日も人ごとに違う：3,000問）", () => {
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let t = 0; t < 3000; t++) {
    const n = 1 + Math.floor(rnd() * 9), cap = 1 + Math.floor(rnd() * 3);
    const jobs = [];
    for (let i = 0; i < n; i++) {
      const release = 1 + Math.floor(rnd() * 4);
      jobs.push({ id: i, release, deadline: Math.floor(rnd() * 9) });
    }
    const r = Core.schedule(jobs, cap, "edf");
    assert.strictEqual(r.late.length, n - bruteMaxOnTime(jobs, cap), JSON.stringify({ jobs, cap }));
    jobs.forEach((j) => assert.ok(r.day[j.id] >= j.release, "最初の日より前には届けない"));
  }
});

test("1日の件数の上限を守る", () => {
  const jobs = Array.from({ length: 9 }, (_, i) => ({ id: i, deadline: i, release: 2 }));
  const r = Core.schedule(jobs, 2, "edf");
  const per = {};
  Object.values(r.day).forEach((d) => { per[d] = (per[d] || 0) + 1; });
  Object.values(per).forEach((c) => assert.ok(c <= 2));
  assert.strictEqual(Object.keys(r.day).length, 9);
});

/* ---------- QR コード ---------- */
test("Reed-Solomon：規格の例（HELLO WORLD、型番1-M）の誤り訂正コード", () => {
  const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
  const ecc = Core._qr.rsRemainder(data, Core._qr.rsDivisor(10));
  assert.deepStrictEqual(ecc, [196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
});

test("形式情報（レベルM）が規格の表と一致する", () => {
  // レベル M、マスク 0〜7 の15ビット
  const table = [0x5412, 0x5125, 0x5E7C, 0x5B4B, 0x45F9, 0x40CE, 0x4F97, 0x4AA0];
  table.forEach((v, k) => assert.strictEqual(Core._qr.formatBits(k), v));
});

test("型番ごとのデータ容量（レベルM）", () => {
  const want = { 1: 16, 2: 28, 3: 44, 4: 64, 5: 86, 6: 108, 7: 124, 8: 154, 9: 182, 10: 216 };
  Object.entries(want).forEach(([v, n]) => assert.strictEqual(Core._qr.dataCodewords(+v), n));
});

test("避難所カードの文が入る型番を選び、位置合わせの模様がある", () => {
  const text = "LASTONE 避難所カード\n名前 Aさん（架空）\n中断不可 抗てんかん薬・ステロイド\n手元 0日（家が壊れた）";
  const q = Core.qrEncode(text);
  assert.strictEqual(q.size, q.version * 4 + 17);
  // 左上の位置検出パターン（7×7）：外枠が黒、その内側が白、中央3×3が黒
  const m = q.modules;
  for (let i = 0; i < 7; i++) { assert.ok(m[0][i]); assert.ok(m[6][i]); assert.ok(m[i][0]); assert.ok(m[i][6]); }
  for (let i = 1; i < 6; i++) { assert.ok(!m[1][i]); assert.ok(!m[5][i]); }
  for (let y = 2; y < 5; y++) for (let x = 2; x < 5; x++) assert.ok(m[y][x]);
  assert.ok(m[q.size - 8][8], "暗いモジュール");
});

/* ---------- 避難所カードの署名 ---------- */
const Demo = require("../demo-data.js");
const A = Demo.PEOPLE[0];
const CARD = Core.cardText(Demo.issuedFields(A), "0日（家が壊れた）", "北山小学校 体育館", Demo.SIGS[A.id]);

test("署名つきカードを読める。手元の日数と場所は書き換えても署名は通る（本人の申告）", async () => {
  const r = await Core.verifyCard(CARD, Demo.ISSUER_PUB, Demo.DEMO_TODAY);
  assert.ok(r.ok, r.reason);
  assert.strictEqual(r.card.hand, 0);
  assert.strictEqual(r.card["場所"], "北山小学校 体育館");
  const moved = await Core.verifyCard(CARD.replace("北山小学校 体育館", "本町公民館").replace("手元:0日", "手元:3日"), Demo.ISSUER_PUB, Demo.DEMO_TODAY);
  assert.ok(moved.ok);
  assert.strictEqual(moved.card.hand, 3);
});

test("登録時の内容（薬・預け先・期限）を書き換えると署名が通らない", async () => {
  for (const [from, to] of [["抗てんかん薬・ステロイド", "抗てんかん薬"], ["7日分", "14日分"], ["2027-09-30", "2029-09-30"], ["甲状腺ホルモン", "ステロイド"]]) {
    const r = await Core.verifyCard(CARD.replace(from, to), Demo.ISSUER_PUB, Demo.DEMO_TODAY);
    assert.ok(!r.ok, from + " → " + to);
  }
  assert.ok(!(await Core.verifyCard("ただの文字", Demo.ISSUER_PUB)).ok);
});

test("24人全員のカードが通り、期限切れのカード（Xさん）は期限で落ちる", async () => {
  for (const p of Demo.PEOPLE) {
    const text = Core.cardText(Demo.issuedFields(p), p.onHand + "日分", "未登録", Demo.SIGS[p.id]);
    const r = await Core.verifyCard(text, Demo.ISSUER_PUB, Demo.DEMO_TODAY);
    if (p.name === "Xさん") { assert.ok(!r.ok); assert.match(r.reason, /有効期限/); }
    else assert.ok(r.ok, p.name + " " + r.reason);
  }
});

test("別の人の署名を付け替えたカードは通らない", async () => {
  const B = Demo.PEOPLE[1];
  const text = Core.cardText(Demo.issuedFields(B), "5日分", "未登録", Demo.SIGS[A.id]);
  assert.ok(!(await Core.verifyCard(text, Demo.ISSUER_PUB, Demo.DEMO_TODAY)).ok);
});

/* ---------- 読み取り記録の突き合わせ ---------- */
test("記録の突き合わせは、順番・回数によらず同じ結果になる（500問）", () => {
  let seed = 5;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const mk = () => ({ sid: "d" + Math.floor(rnd() * 3) + "-" + Math.floor(rnd() * 6), id: "LO-000" + (1 + Math.floor(rnd() * 3)),
    at: "2026-10-1" + Math.floor(rnd() * 4) + "T0" + Math.floor(rnd() * 9) + ":00", hand: Math.floor(rnd() * 4), rev: Math.floor(rnd() * 3) });
  for (let t = 0; t < 500; t++) {
    const a = Array.from({ length: Math.floor(rnd() * 6) }, mk), b = Array.from({ length: Math.floor(rnd() * 6) }, mk), c = Array.from({ length: Math.floor(rnd() * 6) }, mk);
    const J = JSON.stringify;
    assert.strictEqual(J(Core.mergeScans(a, b)), J(Core.mergeScans(b, a)), "どちらから合わせても同じ");
    assert.strictEqual(J(Core.mergeScans(Core.mergeScans(a, b), c)), J(Core.mergeScans(a, Core.mergeScans(b, c))), "3台を合わせる順番によらない");
    const ab = Core.mergeScans(a, b);
    assert.strictEqual(J(Core.mergeScans(ab, ab)), J(ab), "同じ記録を何度送っても増えない");
  }
});

test("カードごとに最新の読み取りを返す", () => {
  const s = [{ sid: "a-1", id: "LO-0001", at: "2026-10-12T09:00", hand: 2 }, { sid: "b-1", id: "LO-0001", at: "2026-10-12T15:00", hand: 0 }];
  assert.strictEqual(Core.latestByCard(s)["LO-0001"].hand, 0);
});

/* ---------- 患者アプリの災害時のお知らせ（3行） ---------- */
test("災害時のお知らせは「いつ届く・受け取る所・それまで」の3行だけで、手元が足りないときは先にもらうよう伝える", () => {
  const lost = Core.patientNotice({ lost: true, arrival: 3, drone: true, place: "北山小学校 体育館", hand: 0, cls: "imm" });
  assert.strictEqual(lost.title, "手元の薬を失ったと記録した");
  assert.deepStrictEqual(lost.rows.map((r) => r[0]), ["いつ届く", "受け取る所", "それまで"]);
  assert.strictEqual(lost.rows[0][1], "発災3日目ごろ（ドローン）");
  assert.strictEqual(lost.rows[1][1], "北山小学校 体育館の救護所");
  assert.ok(lost.short && /先にもらう/.test(lost.rows[2][1]));
  for (const [, v] of lost.rows) assert.ok(v.length <= 26, "1行に収まる長さ：" + v);
  // 手元で届くまでもつ人には、待てばよいと伝える
  const ok = Core.patientNotice({ lost: false, arrival: 1, drone: false, place: "本町公民館", hand: 5, cls: "imm" });
  assert.ok(!ok.short && /待つ/.test(ok.rows[2][1]));
  assert.strictEqual(ok.rows[0][1], "発災1日目ごろ（車）");
  // 届け方がまだない・場所が未登録
  const none = Core.patientNotice({ lost: true, arrival: null, place: "未登録", hand: 0 });
  assert.ok(none.short && /調整中/.test(none.rows[0][1]) && /登録/.test(none.rows[1][1]));
  // 48〜72時間の薬は猶予2日を足して比べる（手元1日・3日目に届く → 1+2=3 で間に合う）
  assert.ok(!Core.patientNotice({ arrival: 3, place: "自宅", hand: 1, cls: "h72" }).short);
});
