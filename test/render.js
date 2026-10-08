// テスト用：QR のモジュールを、回転・遠近（射影）・紙の曲がり・ノイズ・明るさのむら・ぼかしをつけて RGBA の画像に描く。
// 実機のカメラとは違う、自分で作った描き方。
//   bend：紙を縦の軸のまわりに円筒状に曲げる。QR の幅が見込む角度（ラジアン）。負なら手前に反る
//   画像の点 → 遠近を戻す → 曲がりを戻す → 回転を戻す → モジュール、の順に逆にたどって色を決める
function renderQR(mods, o) {
  const size = mods.length, W = o.W, H = o.H, data = new Uint8ClampedArray(W * H * 4);
  const s = o.scale, cx = W / 2, cy = H / 2, cos = Math.cos(o.rot || 0), sin = Math.sin(o.rot || 0);
  const bend = o.bend || 0, Rb = bend ? size * s / Math.abs(bend) : 0, sign = bend < 0 ? -1 : 1, f = 2.5 * W;
  // 円筒に貼った紙を正面から見たときの横の位置 x(θ) = Rb·sinθ·f/(f+z)、z = Rb(1−cosθ)
  const xOf = (th) => Rb * Math.sin(th) * f / (f + sign * Rb * (1 - Math.cos(th)));
  const thMax = Math.min(1.45, Math.abs(bend) * 0.9 + 0.2);
  let seed = o.seed || 1;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let dx = x - cx, dy = y - cy;
    const k = 1 + (o.persp || 0) * dy / H; dx /= k; dy /= k;      // 射影：下ほど手前（大きく見える）
    if (bend) {
      // x(θ) は θ について単調に増えるので、二分法で θ を求める
      let lo = -thMax, hi = thMax;
      if (dx <= xOf(lo) || dx >= xOf(hi)) { dx = 1e9; }
      else {
        for (let it = 0; it < 40; it++) { const m = (lo + hi) / 2; if (xOf(m) < dx) lo = m; else hi = m; }
        const th = (lo + hi) / 2, z = sign * Rb * (1 - Math.cos(th));
        dx = Rb * th; dy = dy * (f + z) / f;
      }
    }
    const u = (cos * dx + sin * dy) / s + size / 2, v = (-sin * dx + cos * dy) / s + size / 2;
    const mx = Math.floor(u), my = Math.floor(v);
    const dark = mx >= 0 && my >= 0 && mx < size && my < size && mods[my][mx];
    let g = dark ? 30 : 225;
    g += (o.shade || 0) * (x / W - 0.5) * 2;
    g += (rnd() - 0.5) * 2 * (o.noise || 0);
    const i = (y * W + x) * 4; data[i] = data[i + 1] = data[i + 2] = g; data[i + 3] = 255;
  }
  if (o.blur) boxBlur(data, W, H, o.blur);
  return { data, width: W, height: H };
}
// ぼかし（半径 r の箱型を縦横に1回ずつ）。ピントの甘いカメラ画像の代わり
function boxBlur(d, W, H, r) {
  const g = new Float32Array(W * H), t = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) g[i] = d[i * 4];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let s = 0, n = 0;
    for (let k = -r; k <= r; k++) { const xx = x + k; if (xx >= 0 && xx < W) { s += g[y * W + xx]; n++; } }
    t[y * W + x] = s / n;
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let s = 0, n = 0;
    for (let k = -r; k <= r; k++) { const yy = y + k; if (yy >= 0 && yy < H) { s += t[yy * W + x]; n++; } }
    const v = s / n, i = (y * W + x) * 4; d[i] = d[i + 1] = d[i + 2] = v;
  }
}
module.exports = { renderQR };
