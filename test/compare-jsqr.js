// 自作の読み取り（qr-read.js）と jsQR を、同じ合成画像200枚で比べる。
//   準備：npm install（jsqr を入れる）  実行：node test/compare-jsqr.js
// 画像：文字数20〜249のランダムな文、レベル L/M/Q/H を順に、640×640、
//       回転 0〜360度・遠近のゆがみ 0〜0.3・ノイズ ±0〜60・明るさのむら 0〜80（乱数の種は固定）
//       同じ200枚に、ぼかし（半径2の箱型）を足した場合も測る。描き方は自分で作ったものなので、実機のカメラとは違う
const Core = require("../okusuri-core.js");
const R = require("../qr-read.js");
const { renderQR } = require("./render.js");
let jsQR;
try { jsQR = require("jsqr"); } catch (e) { console.log("jsqr が入っていない（npm install）"); process.exit(0); }
function run(blur) {
let seed = 99;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
let a = 0, b = 0, ta = 0, tb = 0;
const n = 200;
for (let t = 0; t < n; t++) {
  const len = 20 + Math.floor(rnd() * 230);
  let s = ""; for (let i = 0; i < len; i++) s += "薬カードID0123abc:\n"[Math.floor(rnd() * 18)];
  const q = Core.qrEncode(s, { level: ["L", "M", "Q", "H"][t % 4] });
  const o = { blur, scale: 3 + rnd() * 3, rot: rnd() * 6.28, persp: rnd() * 0.3, noise: rnd() * 60, shade: rnd() * 80, W: 640, H: 640, seed: t + 1 };
  if ((q.size + 8) * o.scale * 1.45 > 640) o.scale = 640 / ((q.size + 8) * 1.45);
  const img = renderQR(q.modules, o);
  let t0 = Date.now(); const r = R.decodeImage(img); ta += Date.now() - t0;
  if (r && r.text === s) a++;
  t0 = Date.now(); const j = jsQR(img.data, 640, 640); tb += Date.now() - t0;
  if (j && Buffer.from(j.binaryData).toString("utf8") === s) b++;
}
console.log(`${blur ? "ぼかしあり" : "ぼかしなし"} ${n}枚：自作 ${a}枚（平均 ${(ta / n).toFixed(0)} ms）／jsQR ${b}枚（平均 ${(tb / n).toFixed(0)} ms）`);
}
run(0);
run(2);
