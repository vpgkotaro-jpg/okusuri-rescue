// 曲げた紙を模した合成画像で、位置合わせパターンを1つだけ使う読み方（改良前）と、全部使う読み方（改良後）を比べる。
//   実行：node test/compare-bend.js   （jsqr を入れていれば jsQR も並べる）
// 画像：デモの24人の避難所カード（型番14〜15）を順に、640×640。紙の曲がり（QR の幅が見込む角度）は 0〜86度を4つの帯に分け、
//       帯ごとに60枚。2割は手前に反らせる。回転 0〜360度・遠近 0〜0.15・ノイズ ±0〜30・明るさのむら 0〜50（乱数の種は固定）。
//       描き方（test/render.js）は自分で作ったもので、実機のカメラや紙のしわとは違う
const Core = require("../okusuri-core.js");
const R = require("../qr-read.js");
const Demo = require("../demo-data.js");
const { renderQR } = require("./render.js");
let jsQR = null;
try { jsQR = require("jsqr"); } catch (e) { /* 入っていない */ }
let seed = 2026;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const bands = [[0, 0.5], [0.5, 0.9], [0.9, 1.2], [1.2, 1.5]];
const deg = (r) => Math.round(r * 180 / Math.PI);
const per = +(process.argv[2] || 60);
const total = { one: 0, all: 0, js: 0, n: 0 };
for (const [lo, hi] of bands) {
  let one = 0, all = 0, js = 0, cells = 0, poly = 0, tOne = 0, tAll = 0;
  for (let t = 0; t < per; t++) {
    const p = Demo.PEOPLE[t % 24];
    const s = Core.cardText(Demo.issuedFields(p), p.onHand + "日分", "北山小学校 体育館", Demo.SIGS[p.id]);
    const q = Core.qrEncode(s);
    const o = { W: 640, H: 640, scale: 5.2, rot: rnd() * 6.283, bend: (lo + rnd() * (hi - lo)) * (rnd() < 0.8 ? 1 : -1),
      persp: rnd() * 0.15, noise: rnd() * 30, shade: rnd() * 50, seed: t + 1 };
    const img = renderQR(q.modules, o);
    let t0 = Date.now(); const a = R.decodeImage(img, { alignment: "one" }); tOne += Date.now() - t0;
    t0 = Date.now(); const b = R.decodeImage(img); tAll += Date.now() - t0;
    if (a && a.text === s) one++;
    if (b && b.text === s) { all++; if (b.piecewise === "cells") cells++; if (b.piecewise === "poly") poly++; }
    if (jsQR) { const j = jsQR(img.data, 640, 640); if (j && Buffer.from(j.binaryData).toString("utf8") === s) js++; }
  }
  total.one += one; total.all += all; total.js += js; total.n += per;
  console.log(`曲がり ${deg(lo)}〜${deg(hi)}度 ${per}枚：改良前 ${one}枚／改良後 ${all}枚（区画ごと ${cells}・多項式 ${poly}）` +
    (jsQR ? `／jsQR ${js}枚` : "") + `　1枚の平均 ${(tOne / per).toFixed(0)}ms → ${(tAll / per).toFixed(0)}ms`);
}
console.log(`合計 ${total.n}枚：改良前 ${total.one}枚／改良後 ${total.all}枚` + (jsQR ? `／jsQR ${total.js}枚` : ""));
