// 速さと結果を測る：node bench.js
//  1. 1便1人分の配送計画：増加路（assignDrones）と、標準の最大流（Dinic 法、onTimeByFlow）を同じ問題で比べる
//  2. 拠点が並ぶ町（test/geo.js）：比べる4つの方法の結果と、増加路の時間
//  3. 避難所単位（1便で何人分か運ぶ）：planShelters の結果・上界・時間
//  4. QR 読み取り：カードの QR を回転・遠近・ノイズつきの 640×640 の画像にして、自作の読み取りにかかる時間
// 時間は3回測った真ん中の値（1回目の前に1回走らせて捨てる）。ms は環境で変わる
const Core = require("./okusuri-core.js");
const R = require("./qr-read.js");
const Demo = require("./demo-data.js");
const { renderQR } = require("./test/render.js");
const { geoCase, geoShelters } = require("./test/geo.js");
function rng(seed) { return () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; }
function time(f) {
  f();
  const ts = [];
  for (let i = 0; i < 3; i++) { const t0 = process.hrtime.bigint(); f(); ts.push(Number(process.hrtime.bigint() - t0) / 1e6); }
  return ts.sort((a, b) => a - b)[1].toFixed(0) + " ms";
}
console.log(`Node ${process.version}・${require("node:os").cpus()[0].model}`);

console.log("\n1. 1便1人分：増加路と最大流（Dinic）。ドローン拠点5か所、締切0〜13日、届けられる日1〜3日、飛べる拠点は1〜3か所");
const B = ["b1", "b2", "b3", "b4", "b5"];
for (const [n, cap] of [[1000, 10], [10000, 100], [100000, 1000]]) {
  const rnd = rng(n), people = [];
  for (let i = 0; i < n; i++) {
    const k = 1 + Math.floor(rnd() * 3), bases = B.slice().sort(() => rnd() - 0.5).slice(0, k);
    people.push({ id: i, release: 1 + Math.floor(rnd() * 3), deadline: Math.floor(rnd() * 14), bases });
  }
  const a = n - Core.assignDrones(people, B, cap, "edf").late.length, d = Core.onTimeByFlow(people, B, cap);
  console.log(`  ${n}人・1拠点1日${cap}件：間に合う人 増加路 ${a}／Dinic ${d}　時間 増加路 ${time(() => Core.assignDrones(people, B, cap, "edf"))}／Dinic ${time(() => Core.onTimeByFlow(people, B, cap))}`);
}

console.log("\n2. 拠点が横に並ぶ町（人は町の中心ほど多い。締切は発災から2〜13日後）。届く前に切れる人");
for (const a of [[1000, 5, 15, 28, 1], [10000, 8, 120, 22, 3]]) {
  const { people, ids, cap } = geoCase(...a);
  const r = (k) => Core.assignDrones(people, ids, cap, k).late.length;
  console.log(`  ${a[0]}人・拠点${a[1]}・1拠点1日${cap}件：登録順 ${r("fifo")}・締切順だけ ${r("sorted")}・締切順で飛ばす（近い拠点から） ${r("skip")}・増加路 ${r("edf")}　増加路の時間 ${time(() => Core.assignDrones(people, ids, cap, "edf"))}`);
}

console.log("\n3. 避難所単位（拠点8か所・1便4人分）。上界＝便を避難所で分けなくてよいとしたときの最大流");
for (const [n, ns, F] of [[10000, 100, 30], [100000, 400, 250], [100000, 400, 300]]) {
  const { people, ids } = geoShelters(n, 8, ns, 22, 3);
  const r = Core.planShelters(people, ids, F, 4), one = Core.planShelters(people, ids, F, 1);
  const f = (o) => Core.fillShelters(people, ids, F, 4, o).late.length;
  console.log(`  ${n}人・避難所${ns}・1拠点1日${F}便：届く前に切れる人 最大流 ${n - r.onTime}（上界では ${n - r.upper}）・登録順 ${f("fifo")}・締切順で飛ばす ${f("skip")}（どれも1便4人分）、最大流で1便1人分なら ${n - one.onTime}　最大流の時間 ${time(() => Core.planShelters(people, ids, F, 4))}`);
}

console.log("\n4. QR 読み取り");
const A = Demo.PEOPLE[0];
const q = Core.qrEncode(Core.cardText(Demo.issuedFields(A), "0日（家が壊れた）", "北山小学校 体育館", Demo.SIGS[A.id]));
const rnd = rng(1);
let ok = 0, total = 0;
for (let t = 0; t < 30; t++) {
  const img = renderQR(q.modules, { W: 640, H: 640, scale: 5, rot: rnd() * 6.28, persp: rnd() * 0.2, noise: rnd() * 40, shade: rnd() * 60, seed: t + 1 });
  const t0 = process.hrtime.bigint();
  if (R.decodeImage(img)) ok++;
  total += Number(process.hrtime.bigint() - t0) / 1e6;
}
console.log(`  カード（型番${q.version}）を写した 640×640 の画像30枚（曲がりなし）のうち ${ok}枚、1枚 平均 ${(total / 30).toFixed(0)} ms`);
