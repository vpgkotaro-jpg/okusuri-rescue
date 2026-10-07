// QR を別人が作った読み取りライブラリ（jsQR）で読み戻す。jsQR が入っていなければ飛ばす。
//   準備：npm install --no-save jsqr@1.4.0   実行：node --test app/test/*.test.js
const test = require("node:test");
const assert = require("node:assert");
const Core = require("../lastone-core.js");
let jsQR = null;
try { jsQR = require("jsqr"); } catch (e) { /* 入っていない */ }

function decode(mods, size) {
  const scale = 4, quiet = 4, n = (size + quiet * 2) * scale;
  const data = new Uint8ClampedArray(n * n * 4).fill(255);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (mods[y][x])
    for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
      const i = (((y + quiet) * scale + dy) * n + (x + quiet) * scale + dx) * 4;
      data[i] = data[i + 1] = data[i + 2] = 0;
    }
  const r = jsQR(data, n, n, { inversionAttempts: "dontInvert" });
  return r ? Buffer.from(r.binaryData).toString("utf8") : null;
}

test("ランダムな文字列を QR にして読み戻すと一致する（型番1〜19）", { skip: !jsQR && "jsqr が入っていない" }, () => {
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const chars = "abcXYZ0123 あいう薬避難所カード日分（）\n:-";
  const vers = new Set();
  for (let t = 0; t < 600; t++) {
    const len = 1 + Math.floor(rnd() * (t < 480 ? 120 : 600));
    let s = "";
    for (let i = 0; i < len; i++) s += chars[Math.floor(rnd() * chars.length)];
    let q;
    try { q = Core.qrEncode(s); } catch (e) { continue; }   // 型番20に入らない長さは飛ばす
    vers.add(q.version);
    assert.strictEqual(decode(q.modules, q.size), s);
  }
  assert.ok(vers.has(1) && Math.max(...vers) >= 18, [...vers].join(","));
});

test("データ領域の10%の四角を半分の確率で塗る（約5%のモジュールが反転）でも読める（30回）", { skip: !jsQR && "jsqr が入っていない" }, () => {
  const card = "LASTONE 避難所カード\nID:LO-0001\nAさん（架空）\n中断不可:抗てんかん薬・ステロイド\n手元:0日（家が壊れた）\n場所:北山小学校 体育館\n預かり:薬バンク中部 7日分";
  const q = Core.qrEncode(card);
  let seed = 11;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const side = Math.round(Math.sqrt(0.10) * q.size);
  for (let t = 0; t < 30; t++) {
    const m = q.modules.map((r) => r.slice());
    const x0 = 9 + Math.floor(rnd() * (q.size - 18 - side)), y0 = 9 + Math.floor(rnd() * (q.size - 18 - side));
    for (let y = y0; y < y0 + side; y++) for (let x = x0; x < x0 + side; x++) m[y][x] = rnd() < 0.5;
    assert.strictEqual(decode(m, q.size), card);
  }
});
