// 速さを測る：node bench.js
//  1. 配送計画：架空の n 人、ドローン拠点5か所（1拠点1日 cap 件）、締切0〜13日、届けられる日1〜3日、飛べる拠点はランダムに1〜3か所
//     拠点が並ぶ町（test/geo.js）では、比べる4つの方法の結果と、増加路の時間を同じ条件で出す
//  2. QR 読み取り：カードの QR を回転・遠近・ノイズつきの 640×640 の画像にして、自作の読み取りにかかる時間
const Core = require("./lastone-core.js");
const R = require("./qr-read.js");
const Demo = require("./demo-data.js");
const { renderQR } = require("./test/render.js");
function rng(seed) { return () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; }
const B = ["b1", "b2", "b3", "b4", "b5"];
for (const [n, cap] of [[1000, 10], [10000, 100], [100000, 1000]]) {
  const rnd = rng(n);
  const people = [];
  for (let i = 0; i < n; i++) {
    const k = 1 + Math.floor(rnd() * 3), bases = B.slice().sort(() => rnd() - 0.5).slice(0, k);
    people.push({ id: i, release: 1 + Math.floor(rnd() * 3), deadline: Math.floor(rnd() * 14), bases });
  }
  const t0 = process.hrtime.bigint();
  const r = Core.assignDrones(people, B, cap, "edf");
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log(`配送計画の速さ ${n}人・拠点5・1拠点1日${cap}件：${ms.toFixed(0)} ms`);
}
// 町の中心に人が多く、拠点が横に並ぶ町：近い拠点から締切順に入れる方法（skip）と、増加路の割り当て（edf）を比べる
const { geoCase } = require("./test/geo.js");
for (const a of [[1000, 5, 15, 28, 1], [10000, 8, 120, 22, 3]]) {
  const { people, ids, cap } = geoCase(...a);
  const r = (k) => Core.assignDrones(people, ids, cap, k).late.length;
  console.log(`拠点が並ぶ町 ${a[0]}人・拠点${a[1]}・1拠点1日${cap}件：届く前に切れる人 登録順 ${r("fifo")}・締切順だけ ${r("sorted")}・締切順で飛ばす（近い拠点から） ${r("skip")}・この方法 ${r("edf")}`);
  // 同じ条件で、この方法（増加路）の時間を5回測り、真ん中の値を出す（1回目は JIT の準備が入るので捨てる）
  Core.assignDrones(people, ids, cap, "edf");
  const ts = [];
  for (let t = 0; t < 5; t++) { const t0 = process.hrtime.bigint(); Core.assignDrones(people, ids, cap, "edf"); ts.push(Number(process.hrtime.bigint() - t0) / 1e6); }
  ts.sort((x, y) => x - y);
  console.log(`  └ 同じ条件でのこの方法の時間：${ts[2].toFixed(0)} ms（5回の中央値、最小 ${ts[0].toFixed(0)}・最大 ${ts[4].toFixed(0)} ms）`);
}
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
console.log(`QR 読み取り：カード（型番${q.version}）を写した 640×640 の画像30枚のうち ${ok}枚、1枚 平均 ${(total / 30).toFixed(0)} ms`);
