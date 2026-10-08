// 最大流（Dinic 法）と、避難所単位の配送計画（1便で何人分かを運ぶ）のテスト
const test = require("node:test");
const assert = require("node:assert");
const Core = require("../okusuri-core.js");
function rng(seed) { return () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; }

test("Dinic：小さなグラフの最大流", () => {
  const G = new Core.FlowGraph(4);
  G.add(0, 1, 3); G.add(0, 2, 2); G.add(1, 2, 1); G.add(1, 3, 2); G.add(2, 3, 3);
  assert.strictEqual(G.maxflow(0, 3), 5);
});

test("1便1人分の問題：増加路（assignDrones）と最大流（Dinic）で、間に合う人数が同じ（1問1〜60人・拠点1〜3つ、3,000問）", () => {
  const rnd = rng(31);
  for (let t = 0; t < 3000; t++) {
    const B = ["b1", "b2", "b3"].slice(0, 1 + Math.floor(rnd() * 3));
    const n = 1 + Math.floor(rnd() * 60), cap = 1 + Math.floor(rnd() * 3);
    const people = [];
    for (let i = 0; i < n; i++) people.push({ id: i, release: 1 + Math.floor(rnd() * 3), deadline: Math.floor(rnd() * 9), bases: B.filter(() => rnd() < 0.55) });
    const a = Core.assignDrones(people, B, cap, "edf");
    assert.strictEqual(Core.onTimeByFlow(people, B, cap), n - a.late.length);
  }
});

// 全探索：一人ずつ「間に合う (拠点, 日)」か「入れない」を全部試す。拠点・日ごとの便の数は、避難所ごとに人数を payload で割って切り上げた和
function bruteShelters(people, F, K) {
  const cnt = {};
  let best = 0;
  const fits = (b, d) => {
    const pre = b + "|" + d + "|";
    let f = 0;
    for (const k in cnt) if (k.startsWith(pre)) f += Math.ceil(cnt[k] / K);
    return f <= F;
  };
  const dfs = (i, n) => {
    if (n + people.length - i <= best) return;
    if (i === people.length) { best = n; return; }
    const p = people[i];
    for (const b of p.bases) for (let d = p.release; d <= p.deadline; d++) {
      const k = b + "|" + d + "|" + p.shelter;
      cnt[k] = (cnt[k] || 0) + 1;
      if (fits(b, d)) dfs(i + 1, n + 1);
      if (!--cnt[k]) delete cnt[k];
    }
    dfs(i + 1, n);
  };
  dfs(0, 0);
  return best;
}
function shelterCase(rnd) {
  const B = ["b1", "b2"].slice(0, 1 + Math.floor(rnd() * 2));
  const ns = 1 + Math.floor(rnd() * 3), S = Array.from({ length: ns }, (_, i) => "s" + i), sb = {};
  S.forEach((s) => { sb[s] = B.filter(() => rnd() < 0.7); if (!sb[s].length) sb[s] = [B[0]]; });
  const n = 1 + Math.floor(rnd() * 8), F = 1 + Math.floor(rnd() * 2), K = 1 + Math.floor(rnd() * 3);
  const people = [];
  for (let i = 0; i < n; i++) {
    const s = S[Math.floor(rnd() * ns)];
    people.push({ id: i, shelter: s, bases: sb[s], release: 1 + Math.floor(rnd() * 2), deadline: Math.floor(rnd() * 5) });
  }
  return { B, people, F, K };
}

test("避難所単位：全探索と比べる（1問1〜8人・避難所1〜3つ・拠点1〜2つ・1日1〜2便・1便1〜3人分、3,000問）", () => {
  const rnd = rng(2026);
  let same = 0, off = 0, proven = 0;
  for (let t = 0; t < 3000; t++) {
    const { B, people, F, K } = shelterCase(rnd);
    const r = Core.planShelters(people, B, F, K), best = bruteShelters(people, F, K);
    // 便の決まりを守る：1便 K 人分まで、拠点・日ごとに F 便まで。間に合う人は release〜deadline に、間に合わない人も release 以降に届く
    const per = {};
    r.flights.forEach((f) => {
      assert.ok(f.ids.length <= K);
      per[f.base + "|" + f.day] = (per[f.base + "|" + f.day] || 0) + 1;
      f.ids.forEach((id) => {
        const p = people[id];
        assert.strictEqual(p.shelter, f.shelter);
        assert.ok(f.day >= p.release && (r.late.includes(id) || f.day <= p.deadline));
      });
    });
    assert.strictEqual(Object.keys(r.day).length, people.length, "全員に届く日がある");
    Object.values(per).forEach((v) => assert.ok(v <= F));
    assert.ok(r.onTime <= best && best <= r.upper, "全探索の答えは、この方法と上界の間に入る");
    if (r.onTime === r.upper) { proven++; assert.strictEqual(r.onTime, best, "上界に届いたら最適"); }
    if (r.onTime === best) same++; else { off++; assert.strictEqual(best - r.onTime, 1); }
  }
  // 2026-10-08 の実行：3,000問すべて全探索と同じ（上界に届いたのは2,970問）
  assert.strictEqual(same, 3000);
  console.log(`  全探索と同じ ${same}問／1人少ない ${off}問／上界に届いた ${proven}問`);
});

test("1便1人分（payload 1）なら、避難所単位の計画は assignDrones と同じ人数", () => {
  const rnd = rng(5);
  for (let t = 0; t < 1000; t++) {
    const { B, people, F } = shelterCase(rnd);
    assert.strictEqual(Core.planShelters(people, B, F, 1).onTime, people.length - Core.assignDrones(people, B, F, "edf").late.length);
  }
});

test("1便に3人分積めると、同じ便の数で間に合う人が増える（同じ避難所に締切の近い人がいる場合）", () => {
  const people = [0, 1, 2, 3, 4, 5].map((i) => ({ id: i, shelter: i < 3 ? "大谷" : "長橋", bases: ["b1"], release: 2, deadline: 2 }));
  assert.strictEqual(Core.planShelters(people, ["b1"], 1, 1).onTime, 1);
  const r = Core.planShelters(people, ["b1"], 1, 3);
  assert.strictEqual(r.onTime, 3);
  assert.strictEqual(r.flights.filter((f) => f.day === 2).length, 1);
  assert.strictEqual(r.day[r.late[0]], 3, "間に合わない3人は次の日の便で届く");
  assert.strictEqual(Core.planShelters(people, ["b1"], 2, 3).onTime, 6);
});
