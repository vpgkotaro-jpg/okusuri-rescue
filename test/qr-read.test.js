// 自作の QR 読み取り（qr-read.js）のテスト。外部ライブラリなし
const test = require("node:test");
const assert = require("node:assert");
const Core = require("../okusuri-core.js");
const R = require("../qr-read.js");
const { renderQR } = require("./render.js");
const rng = (seed) => () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

test("Reed–Solomon：誤りが誤り訂正の数の半分までなら必ず直る。超えたときに別のデータに化ける割合は小さい（4,000問）", () => {
  const rnd = rng(3);
  let over = 0, wrongFix = 0;
  for (let t = 0; t < 4000; t++) {
    const k = 1 + Math.floor(rnd() * 40), nsym = 2 + 2 * Math.floor(rnd() * 15);
    const data = Array.from({ length: k }, () => Math.floor(rnd() * 256));
    const block = data.concat(Core._qr.rsRemainder(data, Core._qr.rsDivisor(nsym)));
    const ne = Math.floor(rnd() * (nsym / 2 + 3));
    const pos = new Set(); while (pos.size < Math.min(ne, block.length)) pos.add(Math.floor(rnd() * block.length));
    const bad = block.slice(); pos.forEach((p) => { bad[p] ^= 1 + Math.floor(rnd() * 255); });
    const r = R.rsDecode(bad, nsym);
    if (pos.size <= nsym / 2) {
      assert.ok(r, "直せるはずの誤り " + pos.size + "/" + nsym);
      assert.deepStrictEqual(r.data, data);
      assert.strictEqual(r.errors, pos.size);
    } else {
      over++;
      if (r && JSON.stringify(r.data) !== JSON.stringify(data)) wrongFix++;   // 別の正しい符号語に化けた（理論上まれに起こる）
    }
  }
  assert.ok(over > 100);
  assert.ok(wrongFix / over < 0.05, "直せない誤りを、別のデータに化けさせる割合が小さい：" + wrongFix + "/" + over);
});

test("格子から読む：4つの誤り訂正レベル × 型番1〜40 の160通り（マスクは8種類を順に使う）で、生成した文と一致する", () => {
  const rnd = rng(11);
  let n = 0;
  for (const level of ["L", "M", "Q", "H"]) for (let ver = 1; ver <= 40; ver++) {
    const cap = Core._qr.dataCodewords(ver, level) - (ver <= 9 ? 2 : 3);
    const len = Math.max(1, cap - Math.floor(rnd() * 5));
    let s = ""; for (let i = 0; i < len; i++) s += String.fromCharCode(33 + Math.floor(rnd() * 90));
    const mask = n % 8;
    const q = Core.qrEncode(s, { level, mask });
    assert.strictEqual(q.version, ver);
    const r = R.decodeGrid(q.modules);
    assert.ok(r, level + ver);
    assert.strictEqual(r.text, s);
    assert.strictEqual(r.mask, mask);
    n++;
  }
  assert.strictEqual(n, 160);
});

test("日本語のカードに面積8%の汚れ（四角の中を白黒ランダムに塗り直す。約4%のモジュールが反転）があっても読む（30回）", () => {
  const Demo = require("../demo-data.js");
  const A = Demo.PEOPLE[0];
  const card = Core.cardText(Demo.issuedFields(A), "0日（家が壊れた）", "北山小学校 体育館", Demo.SIGS[A.id]);
  const q = Core.qrEncode(card);
  const rnd = rng(17);
  for (let t = 0; t < 30; t++) {
    const m = q.modules.map((r) => r.slice());
    const side = Math.round(Math.sqrt(0.08) * q.size);
    const x0 = 9 + Math.floor(rnd() * (q.size - 18 - side)), y0 = 9 + Math.floor(rnd() * (q.size - 18 - side));
    for (let y = y0; y < y0 + side; y++) for (let x = x0; x < x0 + side; x++) m[y][x] = rnd() < 0.5;
    const r = R.decodeGrid(m);
    assert.ok(r, "読めない " + t);
    assert.strictEqual(r.text, card);
    assert.ok(r.errors > 0, "誤り訂正を使って直した");
  }
});

test("画像から読む：回転・遠近のゆがみ・ノイズ・明るさのむらをつけた合成画像96枚のうち9割以上を読む", () => {
  const rnd = rng(23);
  let ok = 0, n = 0;
  for (const level of ["L", "M", "Q", "H"]) for (let t = 0; t < 24; t++) {
    let s = ""; const len = 20 + Math.floor(rnd() * 150);
    for (let i = 0; i < len; i++) s += "薬カードID0123abc:\n"[Math.floor(rnd() * 18)];
    const q = Core.qrEncode(s, { level });
    const W = 560, scale = Math.min(5, W / ((q.size + 8) * 1.45));
    const img = renderQR(q.modules, { W, H: W, scale, rot: rnd() * 6.283, persp: rnd() * 0.25, noise: rnd() * 50, shade: rnd() * 60, seed: t + 1 });
    const r = R.decodeImage(img);
    n++; if (r && r.text === s) ok++;
  }
  assert.ok(ok / n >= 0.9, "読めた " + ok + "/" + n);
});

test("QR がない画像では何も返さない", () => {
  const W = 200, data = new Uint8ClampedArray(W * W * 4).fill(200);
  assert.strictEqual(R.decodeImage({ data, width: W, height: W }), null);
});

// ブラウザ（Chromium）が描いた患者アプリの画面のスクリーンショット（拡大で縁がにじんでいる）。pngjs があるときだけ動く
let PNG = null;
try { PNG = require("pngjs").PNG; } catch (e) { /* 入っていない */ }
test("ブラウザの画面のスクリーンショットから、カードを読んで署名が通る", { skip: !PNG && "pngjs が入っていない" }, async () => {
  const fs = require("node:fs"), path = require("node:path");
  const png = PNG.sync.read(fs.readFileSync(path.join(__dirname, "card-screenshot.png")));
  const r = R.decodeImage({ data: png.data, width: png.width, height: png.height });
  assert.ok(r, "読めない");
  const Demo = require("../demo-data.js");
  const v = await Core.verifyCard(r.text, Demo.ISSUER_PUB, Demo.DEMO_TODAY);
  assert.ok(v.ok, v.reason);
  assert.strictEqual(v.card.ID, "OR-0001");
});

test("型番情報（型番7〜40）を読み、3ビットまでの誤りを直す", () => {
  for (let ver = 7; ver <= 40; ver++) {
    const cap = Core._qr.dataCodewords(ver, "L") - 3;
    const q = Core.qrEncode("x".repeat(cap), { level: "L" });
    assert.strictEqual(q.version, ver);
    const m = q.modules.map((r) => r.slice());
    const size = m.length;
    for (const i of [0, 7, 15]) { const x = size - 11 + i % 3, y = Math.floor(i / 3); m[y][x] = !m[y][x]; }   // 右上を3ビット壊す
    assert.strictEqual(R._.readVersion(m), ver);
  }
});

test("曲げた紙の合成画像：位置合わせパターンを全部使うと、右下の1つだけのときより多く読める（曲がり30〜50度、16枚）", () => {
  const Demo = require("../demo-data.js");
  const rnd = rng(41);
  let one = 0, all = 0;
  for (let t = 0; t < 16; t++) {
    const p = Demo.PEOPLE[t];
    const s = Core.cardText(Demo.issuedFields(p), p.onHand + "日分", "北山小学校 体育館", Demo.SIGS[p.id]);
    const q = Core.qrEncode(s);
    const img = renderQR(q.modules, { W: 640, H: 640, scale: 5.2, rot: rnd() * 6.283, bend: 0.52 + rnd() * 0.35, persp: rnd() * 0.1, noise: rnd() * 20, shade: rnd() * 40, seed: t + 1 });
    const a = R.decodeImage(img, { alignment: "one" }), b = R.decodeImage(img);
    if (a && a.text === s) one++;
    if (b && b.text === s) all++;
  }
  console.log(`  曲げた紙16枚：全部使う ${all}枚／右下の1つだけ ${one}枚`);
  assert.ok(all >= 14 && all > one + 4, "全部使う " + all + "／1つだけ " + one);
});
