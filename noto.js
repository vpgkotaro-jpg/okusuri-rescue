// 珠洲市の公開データ（孤立集落・避難所の位置）で配送計画を試す：node noto.js
// データと、仮に置いた値は noto/suzu-2024-01-08.js の冒頭に書いた
const Core = require("./okusuri-core.js");
const D = require("./noto/suzu-2024-01-08.js");

function km(a, b) {
  const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}
// 集落ごとに、薬が3日以内・7日以内に切れる人を小木地区と同じ割合で置く（締切は1〜3日後、4〜7日後に順に割り振る）
function people(range) {
  const out = [];
  D.isolated.forEach((c) => {
    const n7 = Math.round(c.people * D.ogi.within7 / D.ogi.surveyed), n3 = Math.round(c.people * D.ogi.within3 / D.ogi.surveyed);
    const bases = D.bases.map((b) => [b.id, km(b, c)]).filter((e) => e[1] <= range).sort((x, y) => x[1] - y[1]).map((e) => e[0]);
    for (let i = 0; i < n7; i++) out.push({ id: out.length, shelter: c.name, bases, release: 2, deadline: i < n3 ? 1 + i % 3 : 4 + (i - n3) % 4 });
  });
  return out;
}

console.log(`${D.report.title} ${D.report.asOf} の珠洲市の孤立集落 ${D.isolated.length}地区 ${D.isolated.reduce((s, c) => s + c.people, 0)}人`);
console.log("拠点からの距離（km）：");
D.isolated.forEach((c) => console.log(`  ${c.name}（${c.people}人）  ` + D.bases.map((b) => `${b.id} ${km(b, c).toFixed(1)}`).join("・")));
const ids = D.bases.map((b) => b.id);
for (const range of [12, 15]) {
  const P = people(range), none = P.filter((p) => !p.bases.length).length, never = P.filter((p) => p.deadline < p.release).length;
  console.log(`\n飛べる距離 ${range}km：薬が7日以内に切れる人 ${P.length}人（うち届け方なし ${none}人、2日後より前に切れる人 ${never}人）`);
  console.log("  1拠点1日の便 | 届く前に切れる人：【1便1人分】登録順 | 締切順で飛ばす | 増加路 ‖ 【1便5人分】登録順 | 締切順で飛ばす | 最大流（上界）");
  for (const F of [1, 2, 3]) {
    const fifo = Core.assignDrones(P, ids, F, "fifo").late.length;
    const skip = Core.assignDrones(P, ids, F, "skip").late.length;
    const edf = Core.assignDrones(P, ids, F, "edf").late.length;
    const sh = Core.planShelters(P, ids, F, 5);
    const f5 = Core.fillShelters(P, ids, F, 5, "fifo").late.length, s5 = Core.fillShelters(P, ids, F, 5, "skip").late.length;
    console.log(`  ${F}便 | ${fifo} | ${skip} | ${edf} ‖ ${f5} | ${s5} | ${P.length - sh.onTime}（${P.length - sh.upper}）`);
  }
}
