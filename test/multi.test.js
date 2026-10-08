// 拠点が複数あるときの配送計画と、道路の寸断から届け方を出す処理のテスト
const test = require("node:test");
const assert = require("node:assert");
const Core = require("../okusuri-core.js");

// 全探索：一人ずつ「飛べる拠点 × [release, deadline] のどの枠に入れるか／入れないか」を全部試す
function bruteMax(people, cap) {
  const used = {};
  let best = 0;
  const dfs = (i, ok) => {
    if (ok + (people.length - i) <= best) return;
    if (i === people.length) { best = Math.max(best, ok); return; }
    const p = people[i];
    for (const b of p.bases) for (let d = p.release; d <= p.deadline; d++) {
      const k = b + "|" + d;
      if ((used[k] || 0) < cap) { used[k] = (used[k] || 0) + 1; dfs(i + 1, ok + 1); used[k]--; }
    }
    dfs(i + 1, ok);
  };
  dfs(0, 0);
  return best;
}
function rng(seed) { return () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; }
function randomCase(rnd, nMax) {
  const B = ["b1", "b2", "b3"].slice(0, 1 + Math.floor(rnd() * 3));
  const n = 1 + Math.floor(rnd() * nMax), cap = 1 + Math.floor(rnd() * 2);
  const people = [];
  for (let i = 0; i < n; i++) {
    const bases = B.filter(() => rnd() < 0.55);
    people.push({ id: i, release: 1 + Math.floor(rnd() * 3), deadline: Math.floor(rnd() * 7), bases });
  }
  return { B, people, cap };
}
function checkFeasible(r, people, cap) {
  const per = {};
  people.forEach((p) => {
    if (!p.bases.length) { assert.ok(r.none.includes(p.id)); return; }
    assert.ok(p.bases.includes(r.base[p.id]), "飛べない拠点に入れていない");
    assert.ok(r.day[p.id] >= p.release, "届けられる日より前に入れていない");
    const k = r.base[p.id] + "|" + r.day[p.id];
    per[k] = (per[k] || 0) + 1;
    assert.ok(per[k] <= cap, "1日の件数の上限を守る");
  });
}

test("複数拠点：間に合う人数が全探索の最大と一致する（1問1〜8人・拠点1〜3つ・1日1〜2件、3,000問）", () => {
  const rnd = rng(20261007);
  for (let t = 0; t < 3000; t++) {
    const { B, people, cap } = randomCase(rnd, 8);
    const r = Core.assignDrones(people, B, cap, "edf");
    checkFeasible(r, people, cap);
    const onTime = people.length - r.late.length;
    assert.strictEqual(onTime, bruteMax(people, cap), JSON.stringify({ people, cap }));
  }
});

test("複数拠点：締切順に空き枠を埋めるだけだと最適にならない例", () => {
  // 1日1件。a は b1 からも b2 からも届く。b は b1 からしか届かない。どちらも締切2日目
  const people = [
    { id: "a", release: 2, deadline: 2, bases: ["b1", "b2"] },
    { id: "b", release: 2, deadline: 2, bases: ["b1"] }
  ];
  const fifo = Core.assignDrones(people, ["b1", "b2"], 1, "fifo");
  assert.deepStrictEqual(fifo.late, ["b"]);   // a が b1 の枠を先に使う
  const best = Core.assignDrones(people, ["b1", "b2"], 1, "edf");
  assert.deepStrictEqual(best.late, []);      // a を b2 へ押し出して、b を b1 に入れる
  assert.strictEqual(best.base.a, "b2");
  assert.strictEqual(best.base.b, "b1");
});

test("拠点が1つなら、締切順の貪欲法（schedule）と同じ人数になる（1問1〜12人、2,000問）", () => {
  const rnd = rng(42);
  for (let t = 0; t < 2000; t++) {
    const n = 1 + Math.floor(rnd() * 12), cap = 1 + Math.floor(rnd() * 3);
    const jobs = [];
    for (let i = 0; i < n; i++) jobs.push({ id: i, release: 1 + Math.floor(rnd() * 3), deadline: Math.floor(rnd() * 9), bases: ["x"] });
    const a = Core.assignDrones(jobs, ["x"], cap, "edf").late.length;
    const b = Core.schedule(jobs, cap, "edf").late.length;
    assert.strictEqual(a, b);
  }
});

test("優先順：締切の早い人が先に枠を取り、後から来た人に押し出されない", () => {
  // b1 の枠は2日目と3日目の2つ。x（締切2）と y（締切3）は b1 だけ、w（締切3）は b1 と b2
  const people = [
    { id: "w", release: 2, deadline: 3, bases: ["b1", "b2"] },
    { id: "y", release: 2, deadline: 3, bases: ["b1"] },
    { id: "x", release: 2, deadline: 2, bases: ["b1"] },
    { id: "z", release: 2, deadline: 1, bases: ["b1"] }
  ];
  const r = Core.assignDrones(people, ["b1", "b2"], 1, "edf");
  assert.deepStrictEqual(r.late, ["z"], "間に合う3人は全員入り、最初から間に合わない z だけが残る");
  assert.strictEqual(r.day.x, 2);
  assert.strictEqual(r.base.w, "b2");
});

test("届けられる拠点がない人は none に入り、遅れとして数える", () => {
  const people = [{ id: 1, release: Infinity, deadline: 3, bases: [] }, { id: 2, release: 2, deadline: 3, bases: ["b1"] }];
  const r = Core.assignDrones(people, ["b1"], 1, "edf");
  assert.deepStrictEqual(r.none, [1]);
  assert.deepStrictEqual(r.late, [1]);
  assert.strictEqual(r.day[2], 2);
});

/* ---------- 道路の寸断から届け方を出す ---------- */
const NET = {
  hub: "hub",
  nodes: { hub: { x: 0, y: 0 }, A: { x: 10, y: 0 }, B: { x: 20, y: 0 }, C: { x: 10, y: 10 }, D: { x: 40, y: 10 } },
  areas: { A: 1, B: 1, C: 1, D: 1 },
  roads: [["hub", "A"], ["A", "B"], ["A", "C"], ["B", "D"]],
  bases: [{ id: "bA", at: "A", range: 12 }, { id: "bB", at: "B", range: 25 }]
};
test("道路が通れれば全地区に車で1日後", () => {
  const r = Core.accessPlan(NET, {});
  Object.values(r).forEach((v) => { assert.strictEqual(v.how, "car"); assert.strictEqual(v.release, 1); });
});
test("道路を閉じると、その先の地区はドローン（届く拠点だけ）。補給できない拠点は使わない", () => {
  const closed = { [Core.roadKey("A", "C")]: true, [Core.roadKey("B", "D")]: true };
  const r = Core.accessPlan(NET, closed);
  assert.strictEqual(r.C.how, "drone");
  assert.deepStrictEqual(r.C.bases.sort(), ["bA", "bB"]);   // bB からも距離 √200 ≒ 14 で届く
  assert.deepStrictEqual(r.D.bases, ["bB"]);
  const r2 = Core.accessPlan(NET, { ...closed, [Core.roadKey("A", "B")]: true });
  assert.strictEqual(r2.B.how, "drone");                    // B 自体が車で行けない
  assert.strictEqual(r2.D.how, "none");                     // bB は補給できず、bA からは遠い
  assert.strictEqual(r2.D.release, Infinity);
});

/* ---------- 比べる相手：締切順・間に合わない人は飛ばす・近い拠点から（skip） ---------- */
test("skip（締切順で飛ばす、近い拠点から）は、拠点が1つなら最適と同じ。増加路は skip より悪くならない（1問1〜8人、3,000問）", () => {
  const rnd = rng(77);
  let worse = 0;
  for (let t = 0; t < 3000; t++) {
    const { B, people, cap } = randomCase(rnd, 8);
    const s = Core.assignDrones(people, B, cap, "skip");
    checkFeasible(s, people, cap);
    const e = Core.assignDrones(people, B, cap, "edf").late.length;
    assert.ok(e <= s.late.length);
    if (e < s.late.length) worse++;
    const one = people.map((p) => ({ ...p, bases: p.bases.length ? ["x"] : [] }));
    assert.strictEqual(Core.assignDrones(one, ["x"], cap, "skip").late.length, Core.assignDrones(one, ["x"], cap, "edf").late.length);
  }
  assert.ok(worse > 0, "拠点が複数だと、skip が最適にならない問題がある");
});

test("skip が負ける形：両方から届く人が、片方からしか届かない人の拠点を先に使う", () => {
  // 1日1件。w は b1 が近く b2 にも届く（締切2）。x は b1 からしか届かない（締切2）
  const people = [
    { id: "w", release: 2, deadline: 2, bases: ["b1", "b2"] },
    { id: "x", release: 2, deadline: 2, bases: ["b1"] }
  ];
  assert.deepStrictEqual(Core.assignDrones(people, ["b1", "b2"], 1, "skip").late, ["x"]);
  assert.deepStrictEqual(Core.assignDrones(people, ["b1", "b2"], 1, "edf").late, []);
});

test("町の中心に人が多く、拠点が横に並ぶ町（架空の1,000人）で、増加路は skip より遅れる人が少ない", () => {
  const { geoCase } = require("./geo.js");
  const { people, ids, cap } = geoCase(1000, 5, 15, 28, 1);
  const s = Core.assignDrones(people, ids, cap, "skip").late.length;
  const e = Core.assignDrones(people, ids, cap, "edf").late.length;
  assert.ok(e < s, e + " < " + s);
});
