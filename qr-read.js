/* LASTONE QR 読み取り（係員の端末のカメラ・画像から、避難所カードを読む）
 *  参考実装は写さず、規格 ISO/IEC 18004 の手順を順に書いた。生成側（lastone-core.js）の表と模様の配置を共有する。
 *   1. 画像を白黒にする（画像全体のしきい値と、周りの明るさとの比較の2通りを試す）
 *   2. 位置検出パターン（黒白黒白黒が 1:1:3:1:1）を横に探し、縦でも確かめる
 *   3. 3つの位置から向きと大きさを出し、右下の位置合わせパターンを探して、射影変換で格子を読む
 *      （型番7以上は型番情報を読んで大きさを決める。位置合わせパターンは右下の1つだけ使い、
 *       大きい型番の中ほどにあるものは使っていない。紙が大きく曲がっていると読めないことがある）
 *   4. 形式情報 → マスクを外す → 符号語の並べ替えを戻す
 *   5. Reed–Solomon の誤り訂正（Berlekamp–Massey → Chien 探索 → Forney）
 *   6. データを読む（数字・英数字・8ビットバイト・漢字）
 */
(function (root, factory) {
  var core = typeof module === "object" && module.exports ? require("./lastone-core.js") : root.LastoneCore;
  var lib = factory(core);
  if (typeof module === "object" && module.exports) module.exports = lib;
  else root.LastoneQRRead = lib;
})(typeof self !== "undefined" ? self : this, function (Core) {
  "use strict";
  var Q = Core._qr;

  /* ---------------- GF(2^8) の表（原始多項式 0x11D、α = 2） ---------------- */
  var EXP = new Array(512), LOG = new Array(256);
  (function () {
    var x = 1;
    for (var i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11D; }
    for (i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  })();
  function mul(a, b) { return a && b ? EXP[LOG[a] + LOG[b]] : 0; }
  function div(a, b) { if (!b) throw new Error("0で割った"); return a ? EXP[(LOG[a] + 255 - LOG[b]) % 255] : 0; }
  // 多項式は「低い次数から」の配列で持つ（p[i] が x^i の係数）
  function polyEval(p, x) { var y = 0; for (var i = p.length - 1; i >= 0; i--) y = mul(y, x) ^ p[i]; return y; }

  /* ---------------- Reed–Solomon の復号 ----------------
   * block：受け取った1ブロック（データ + 誤り訂正。先頭がいちばん高い次数）、nsym：誤り訂正の数
   * 生成多項式の根は α^0 … α^(nsym-1)（生成側の rsDivisor と同じ）。
   * 戻り値 { data, errors }。直せないときは null（nsym/2 個を超える誤り）
   */
  function rsDecode(block, nsym) {
    var n = block.length, c = block.slice();
    // 1. シンドローム S_i = r(α^i)
    var S = [], any = false;
    for (var i = 0; i < nsym; i++) {
      var s = 0, a = EXP[i];
      for (var k = 0; k < n; k++) s = mul(s, a) ^ c[k];
      S.push(s); if (s) any = true;
    }
    if (!any) return { data: c.slice(0, n - nsym), errors: 0 };
    // 2. Berlekamp–Massey：誤りの位置を根に持つ多項式 Λ を、いちばん短い漸化式として求める
    var L = 0, C = [1], B = [1], m = 1, b = 1;
    for (var r = 0; r < nsym; r++) {
      var d = S[r];
      for (i = 1; i <= L; i++) d ^= mul(C[i] || 0, S[r - i]);
      if (!d) { m++; continue; }
      var coef = div(d, b), T = C.slice();
      for (i = 0; i < B.length; i++) C[i + m] = (C[i + m] || 0) ^ mul(coef, B[i]);
      if (2 * L <= r) { L = r + 1 - L; B = T; b = d; m = 1; } else m++;
    }
    if (L * 2 > nsym) return null;
    // 3. Chien 探索：位置 k の誤りは X = α^(n-1-k)。Λ(X^-1) = 0 になる k を全部探す
    var pos = [];
    for (k = 0; k < n; k++) {
      var e = n - 1 - k;
      if (polyEval(C, EXP[(255 - e % 255) % 255]) === 0) pos.push(k);
    }
    if (pos.length !== L) return null;
    // 4. Forney：誤りの大きさ e = X · Ω(X^-1) / Λ'(X^-1)。Ω = S·Λ mod x^nsym
    var Om = [];
    for (i = 0; i < nsym; i++) {
      var v = 0;
      for (var j = 0; j <= i; j++) v ^= mul(S[j], C[i - j] || 0);
      Om.push(v);
    }
    var dC = [];                                // 形式的な微分（標数2なので奇数次の項だけ残る）
    for (i = 1; i < C.length; i++) dC[i - 1] = i % 2 ? (C[i] || 0) : 0;
    for (var t = 0; t < pos.length; t++) {
      var ex = n - 1 - pos[t], X = EXP[ex % 255], Xinv = EXP[(255 - ex % 255) % 255];
      var den = polyEval(dC, Xinv);
      if (!den) return null;
      c[pos[t]] ^= mul(X, div(polyEval(Om, Xinv), den));
    }
    // 直したあとで、もう一度シンドロームが全部0になるか確かめる
    for (i = 0; i < nsym; i++) {
      var s2 = 0;
      for (k = 0; k < n; k++) s2 = mul(s2, EXP[i]) ^ c[k];
      if (s2) return null;
    }
    return { data: c.slice(0, n - nsym), errors: pos.length };
  }

  /* ---------------- 格子（モジュールの白黒）から文字へ ---------------- */
  var LEVELS = ["L", "M", "Q", "H"];
  function popcount(x) { var n = 0; while (x) { n += x & 1; x >>>= 1; } return n; }

  // 形式情報を2か所から読み、32通りの正しい符号語のうちいちばん近いものを選ぶ（3ビットまでの誤りを直せる）
  function readFormat(m) {
    var size = m.length, a = 0, b = 0, i;
    function at(x, y) { return m[y][x] ? 1 : 0; }
    for (i = 0; i <= 5; i++) a |= at(8, i) << i;
    a |= at(8, 7) << 6; a |= at(8, 8) << 7; a |= at(7, 8) << 8;
    for (i = 9; i < 15; i++) a |= at(14 - i, 8) << i;
    for (i = 0; i < 8; i++) b |= at(size - 1 - i, 8) << i;
    for (i = 8; i < 15; i++) b |= at(8, size - 15 + i) << i;
    var best = null;
    LEVELS.forEach(function (lv) {
      for (var mask = 0; mask < 8; mask++) {
        var f = Q.formatBits(mask, lv), d = Math.min(popcount(f ^ a), popcount(f ^ b));
        if (!best || d < best.d) best = { d: d, level: lv, mask: mask };
      }
    });
    return best && best.d <= 3 ? best : null;
  }

  // 型番情報（型番7以上）：右上と左下の 6×3 の2か所の18ビットを読み、34通りの正しい符号語のいちばん近いものを選ぶ
  // （BCH(18,6)、3ビットまでの誤りを直せる）。読めなければ null
  function versionBits(v) {
    var rem = v;
    for (var i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
    return v << 12 | rem;
  }
  function readVersion(m) {
    var size = m.length;
    if (size < 45) return null;
    var a = 0, b = 0;
    for (var i = 0; i < 18; i++) {
      var x = size - 11 + i % 3, y = Math.floor(i / 3);
      if (m[y][x]) a |= 1 << i;            // 右上
      if (m[x][y]) b |= 1 << i;            // 左下
    }
    var best = null;
    for (var v = 7; v <= 40; v++) {
      var f = versionBits(v), d = Math.min(popcount(f ^ a), popcount(f ^ b));
      if (!best || d < best.d) best = { d: d, v: v };
    }
    return best.d <= 3 ? best.v : null;
  }

  function readCodewords(m, ver, level, mask) {
    var size = m.length, g = new Q.Grid(ver);
    Q.drawFunctionPatterns(g, ver, level);
    var total = Math.floor(Q.rawModules(ver) / 8), bits = [], fn = Q.MASKS[mask];
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var v = 0; v < size; v++) for (var j = 0; j < 2; j++) {
        var x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - v : v;
        if (!g.fn[y][x] && bits.length < total * 8) bits.push((m[y][x] ? 1 : 0) ^ (fn(x, y) ? 1 : 0));
      }
    }
    var out = [];
    for (var i = 0; i < total; i++) {
      var val = 0;
      for (var k = 0; k < 8; k++) val = (val << 1) | bits[i * 8 + k];
      out.push(val);
    }
    return out;
  }

  // 生成側の「ブロックを交互に並べる」処理を逆にたどる
  function deinterleave(cw, ver, level) {
    var nb = Q.NUM_BLOCKS[level][ver], ecl = Q.ECC_PER_BLOCK[level][ver];
    var raw = cw.length, nShort = nb - raw % nb, shortLen = Math.floor(raw / nb);
    var blocks = [], k = 0, i, j;
    for (j = 0; j < nb; j++) blocks.push([]);
    for (i = 0; i <= shortLen; i++) for (j = 0; j < nb; j++) {    // どのブロックも長さ shortLen+1（短いブロックは途中に空きが1つ）
      if (i === shortLen - ecl && j < nShort) { blocks[j][i] = null; continue; }  // 短いブロックの空き
      blocks[j][i] = cw[k++];
    }
    return blocks.map(function (bl, j) {
      return j < nShort ? bl.filter(function (_, i) { return i !== shortLen - ecl; }) : bl;
    }).map(function (bl) { return { block: bl, ecl: ecl }; });
  }

  var ALNUM = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";
  function parseSegments(bytes, ver) {
    var pos = 0, nbits = bytes.length * 8, out = [], raw = [];
    function read(n) {
      if (pos + n > nbits) throw new Error("データが途中で切れている");
      var v = 0;
      for (var i = 0; i < n; i++, pos++) v = (v << 1) | ((bytes[pos >>> 3] >>> (7 - (pos & 7))) & 1);
      return v;
    }
    function cc(a, b, c) { return ver <= 9 ? a : ver <= 26 ? b : c; }
    function flush() {
      if (!raw.length) return;
      out.push(decodeUtf8(raw)); raw = [];
    }
    while (pos + 4 <= nbits) {
      var mode = read(4), n, i;
      if (mode === 0) break;
      if (mode === 4) { n = read(cc(8, 16, 16)); for (i = 0; i < n; i++) raw.push(read(8)); continue; }
      flush();
      if (mode === 1) {
        n = read(cc(10, 12, 14)); var s = "";
        for (; n >= 3; n -= 3) s += String(1000 + read(10)).slice(1);
        if (n === 2) s += String(100 + read(7)).slice(1); else if (n === 1) s += read(4);
        out.push(s);
      } else if (mode === 2) {
        n = read(cc(9, 11, 13)); var t = "";
        for (; n >= 2; n -= 2) { var v = read(11); t += ALNUM[Math.floor(v / 45)] + ALNUM[v % 45]; }
        if (n === 1) t += ALNUM[read(6)];
        out.push(t);
      } else if (mode === 8) {
        n = read(cc(8, 10, 12)); var sj = [];
        for (i = 0; i < n; i++) {
          var w = read(13), hi = Math.floor(w / 0xC0), lo = w % 0xC0, code = (hi << 8 | lo) + (((hi << 8) | lo) < 0x1F00 ? 0x8140 : 0xC140);
          sj.push(code >> 8, code & 0xFF);
        }
        out.push(decodeSjis(sj));
      } else if (mode === 7) {
        var e = read(8); if ((e & 0x80) && !(e & 0x40)) read(8); else if ((e & 0xC0) === 0xC0) read(16);
      } else throw new Error("知らないモード " + mode);
    }
    flush();
    return out.join("");
  }
  function decodeUtf8(b) {
    if (typeof TextDecoder !== "undefined") return new TextDecoder("utf-8").decode(new Uint8Array(b));
    return decodeURIComponent(b.map(function (x) { return "%" + (x < 16 ? "0" : "") + x.toString(16); }).join(""));
  }
  function decodeSjis(b) {
    try { return new TextDecoder("shift_jis").decode(new Uint8Array(b)); } catch (e) { return "?"; }
  }

  /* modules: boolean[y][x]（正方形）。戻り値 { text, version, level, mask, errors } または null */
  function decodeGrid(m) {
    var size = m.length, ver = (size - 17) / 4;
    if (ver !== Math.floor(ver) || ver < 1 || ver > 40) return null;
    if (ver >= 7 && readVersion(m) !== ver) return null;     // 型番情報が大きさと合わない
    var f = readFormat(m);
    if (!f) return null;
    var cw = readCodewords(m, ver, f.level, f.mask);
    var data = [], errors = 0;
    var blocks = deinterleave(cw, ver, f.level);
    for (var i = 0; i < blocks.length; i++) {
      var r = rsDecode(blocks[i].block, blocks[i].ecl);
      if (!r) return null;
      data = data.concat(r.data); errors += r.errors;
    }
    try {
      return { text: parseSegments(data, ver), version: ver, level: f.level, mask: f.mask, errors: errors };
    } catch (e) { return null; }
  }

  /* ---------------- 画像から格子へ ---------------- */
  function toGray(img) {
    var w = img.width, h = img.height, d = img.data, g = new Uint8Array(w * h);
    for (var i = 0, j = 0; i < g.length; i++, j += 4) g[i] = (d[j] * 299 + d[j + 1] * 587 + d[j + 2] * 114) / 1000;
    return g;
  }
  // 画像全体で1つのしきい値（大津の方法：白と黒の2群の分散が最も分かれる値）
  function binOtsu(g) {
    var hist = new Array(256).fill(0), n = g.length, i;
    for (i = 0; i < n; i++) hist[g[i]]++;
    var sum = 0; for (i = 0; i < 256; i++) sum += i * hist[i];
    var wB = 0, sumB = 0, best = 0, th = 128;
    for (i = 0; i < 256; i++) {
      wB += hist[i]; if (!wB) continue;
      var wF = n - wB; if (!wF) break;
      sumB += i * hist[i];
      var mB = sumB / wB, mF = (sum - sumB) / wF, between = wB * wF * (mB - mF) * (mB - mF);
      if (between > best) { best = between; th = i; }
    }
    var out = new Uint8Array(n);
    for (i = 0; i < n; i++) out[i] = g[i] <= th ? 1 : 0;
    return out;
  }
  // 周りの明るさとの比較（影や照明のむらに強い）。積分画像で窓の平均を出す
  function binLocal(g, w, h) {
    var I = new Float64Array((w + 1) * (h + 1)), x, y;
    for (y = 0; y < h; y++) {
      var row = 0;
      for (x = 0; x < w; x++) { row += g[y * w + x]; I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row; }
    }
    var r = Math.max(8, Math.floor(Math.min(w, h) / 8)), out = new Uint8Array(w * h);
    for (y = 0; y < h; y++) for (x = 0; x < w; x++) {
      var x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1), y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
      var s = I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0];
      out[y * w + x] = g[y * w + x] < s / ((x1 - x0) * (y1 - y0)) * 0.92 ? 1 : 0;
    }
    return out;
  }

  // 5つの連続した長さが 1:1:3:1:1 に近いか
  function ratioOk(r) {
    var total = r[0] + r[1] + r[2] + r[3] + r[4];
    if (total < 7) return false;
    var u = total / 7, tol = u * 0.7;
    return Math.abs(r[0] - u) < tol && Math.abs(r[1] - u) < tol && Math.abs(r[2] - 3 * u) < tol * 2.2 &&
      Math.abs(r[3] - u) < tol && Math.abs(r[4] - u) < tol;
  }
  // (cx, cy) から縦（dx=0,dy=1）か横に、中心の黒・白・黒を数えて、パターンの中心と幅を返す
  function crossCheck(B, w, h, cx, cy, dx, dy) {
    function px(t) { var x = Math.round(cx + dx * t), y = Math.round(cy + dy * t); return x < 0 || y < 0 || x >= w || y >= h ? -1 : B[y * w + x]; }
    if (px(0) !== 1) return null;
    var r = [0, 0, 0, 0, 0], t = 0;
    while (px(t) === 1) { r[2]++; t--; }
    while (px(t) === 0) { r[1]++; t--; }
    while (px(t) === 1) { r[0]++; t--; }
    var start = t + 1; t = 1;
    while (px(t) === 1) { r[2]++; t++; }
    while (px(t) === 0) { r[3]++; t++; }
    while (px(t) === 1) { r[4]++; t++; }
    if (!ratioOk(r)) return null;
    var c = start + r[0] + r[1] + r[2] / 2;
    return { c: c, size: r[0] + r[1] + r[2] + r[3] + r[4] };
  }
  function findFinders(B, w, h) {
    var cands = [];
    for (var y = 0; y < h; y++) {
      var r = [0, 0, 0, 0, 0], k = 0, prev = 0;   // k：いま数えている区間（偶数=黒、奇数=白）
      for (var x = 0; x <= w; x++) {
        var v = x < w ? B[y * w + x] : 0;
        if (k === 0 && !v && !r[0]) continue;      // 最初の黒を待つ
        if ((k % 2 === 0) === (v === 1)) { r[k]++; continue; }
        if (k < 4) { k++; r[k] = 1; continue; }
        // 5区間がそろった
        if (ratioOk(r)) {
          var cx = x - r[4] - r[3] - r[2] / 2;
          var vc = crossCheck(B, w, h, cx, y, 0, 1);
          if (vc) {
            var cy = y + vc.c;
            var hc = crossCheck(B, w, h, cx, cy, 1, 0);
            if (hc) {
              var fx = cx + hc.c, mod = (hc.size + vc.size) / 14;
              var hit = cands.filter(function (c) { return Math.hypot(c.x - fx, c.y - cy) < mod * 2.5; })[0];
              if (hit) { hit.x = (hit.x * hit.n + fx) / (hit.n + 1); hit.y = (hit.y * hit.n + cy) / (hit.n + 1); hit.mod = (hit.mod * hit.n + mod) / (hit.n + 1); hit.n++; }
              else cands.push({ x: fx, y: cy, mod: mod, n: 1 });
            }
          }
        }
        // 2区間ずらして（黒から始まるように）続ける
        r = [r[2], r[3], r[4], 1, 0]; k = 3;
      }
    }
    return cands.sort(function (a, b) { return b.n - a.n; });
  }
  // 3点の組のうち、直角二等辺三角形にいちばん近いものを選び、左上・右上・左下に分ける
  function pickTriples(c) {
    var top = c.slice(0, 8), out = [];
    for (var i = 0; i < top.length; i++) for (var j = i + 1; j < top.length; j++) for (var k = j + 1; k < top.length; k++) {
      var p = [top[i], top[j], top[k]];
      var mods = p.map(function (q) { return q.mod; });
      if (Math.max.apply(null, mods) > Math.min.apply(null, mods) * 1.6) continue;
      var d = [[1, 2], [0, 2], [0, 1]].map(function (e) { return Math.hypot(p[e[0]].x - p[e[1]].x, p[e[0]].y - p[e[1]].y); });
      var a = d.indexOf(Math.max.apply(null, d));         // 斜辺の向かいが左上
      var A = p[a], Bq = p[(a + 1) % 3], Cq = p[(a + 2) % 3];
      var ab = Math.hypot(Bq.x - A.x, Bq.y - A.y), ac = Math.hypot(Cq.x - A.x, Cq.y - A.y);
      var cos = ((Bq.x - A.x) * (Cq.x - A.x) + (Bq.y - A.y) * (Cq.y - A.y)) / (ab * ac);
      var score = Math.abs(ab - ac) / Math.max(ab, ac) + Math.abs(cos);
      if (score > 0.5) continue;
      var cross = (Bq.x - A.x) * (Cq.y - A.y) - (Bq.y - A.y) * (Cq.x - A.x);
      out.push({ score: score, tl: A, tr: cross > 0 ? Bq : Cq, bl: cross > 0 ? Cq : Bq });
    }
    return out.sort(function (a, b) { return a.score - b.score; }).slice(0, 3);
  }

  // 4点の対応から射影変換（3×3）を解く。src[i] → dst[i]
  function homography(src, dst) {
    var A = [], i, j, k;
    for (i = 0; i < 4; i++) {
      var x = src[i][0], y = src[i][1], u = dst[i][0], v = dst[i][1];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
    }
    for (i = 0; i < 8; i++) {               // ガウスの消去法（部分ピボット）
      var p = i;
      for (j = i + 1; j < 8; j++) if (Math.abs(A[j][i]) > Math.abs(A[p][i])) p = j;
      var tmp = A[i]; A[i] = A[p]; A[p] = tmp;
      if (Math.abs(A[i][i]) < 1e-12) return null;
      for (j = 0; j < 8; j++) if (j !== i) {
        var f = A[j][i] / A[i][i];
        for (k = i; k < 9; k++) A[j][k] -= f * A[i][k];
      }
    }
    var hm = []; for (i = 0; i < 8; i++) hm.push(A[i][8] / A[i][i]);
    hm.push(1);
    return function (x, y) {
      var z = hm[6] * x + hm[7] * y + 1;
      return [(hm[0] * x + hm[1] * y + hm[2]) / z, (hm[3] * x + hm[4] * y + hm[5]) / z];
    };
  }

  // モジュールの中心と、その周り4点（±0.22モジュール）の多数決で白黒を決める（ノイズに強くする）
  function sampleGrid(B, w, h, T, dim) {
    var m = [], OFF = [[0, 0], [-0.22, -0.22], [0.22, -0.22], [-0.22, 0.22], [0.22, 0.22]];
    for (var y = 0; y < dim; y++) {
      var row = [];
      for (var x = 0; x < dim; x++) {
        var dark = 0;
        for (var k = 0; k < 5; k++) {
          var p = T(x + 0.5 + OFF[k][0], y + 0.5 + OFF[k][1]), px = Math.round(p[0]), py = Math.round(p[1]);
          if (px >= 0 && py >= 0 && px < w && py < h && B[py * w + px] === 1) dark++;
        }
        row.push(dark >= 3);
      }
      m.push(row);
    }
    return m;
  }
  // 右下の位置合わせパターン（5×5：黒・白・黒の中心）を、予想の位置の近くで探す。
  // 遠近のゆがみが大きいと予想から外れるので、近くで見つからなければ範囲を広げる。候補を良い順に返す
  function findAlignment(B, w, h, T, dim) {
    var c = dim - 6.5, radii = [6, Math.max(8, Math.round(dim * 0.16))], found = [];
    for (var ri = 0; ri < radii.length && !found.length; ri++) {
      var R = radii[ri], cands = [];
      for (var dy = -R; dy <= R; dy += 0.5) for (var dx = -R; dx <= R; dx += 0.5) {
        var ok = 0;
        for (var yy = -2; yy <= 2; yy++) for (var xx = -2; xx <= 2; xx++) {
          var want = Math.max(Math.abs(xx), Math.abs(yy)) !== 1;
          var p = T(c + dx + xx, c + dy + yy), px = Math.round(p[0]), py = Math.round(p[1]);
          var v = px >= 0 && py >= 0 && px < w && py < h ? B[py * w + px] === 1 : false;
          if (v === want) ok++;
        }
        if (ok >= 22) cands.push({ ok: ok, dist: Math.abs(dx) + Math.abs(dy), x: c + dx, y: c + dy });
      }
      cands.sort(function (a, b) { return b.ok - a.ok || a.dist - b.dist; });
      cands.forEach(function (q) {     // 近すぎる候補（同じパターンの0.5ずれ）はまとめる
        if (found.length < 3 && !found.some(function (f) { return Math.abs(f.x - q.x) + Math.abs(f.y - q.y) < 2; })) found.push(q);
      });
    }
    return found.map(function (q) { return T(q.x, q.y); });
  }

  /* img: { data: RGBA の配列, width, height }（canvas の ImageData と同じ形）
   * 戻り値 { text, version, level, mask, errors, corners } または null */
  function decodeImage(img) {
    var w = img.width, h = img.height, g = toGray(img);
    var bins = [binOtsu(g), binLocal(g, w, h)];
    for (var bi = 0; bi < bins.length; bi++) {
      var B = bins[bi], triples = pickTriples(findFinders(B, w, h));
      for (var ti = 0; ti < triples.length; ti++) {
        var t = triples[ti], mod = (t.tl.mod + t.tr.mod + t.bl.mod) / 3;
        // 横と縦に測った幅は、傾いていると 1/max(|cos|,|sin|) 倍に長く見えるので戻す
        var th = Math.atan2(t.tr.y - t.tl.y, t.tr.x - t.tl.x);
        mod *= Math.max(Math.abs(Math.cos(th)), Math.abs(Math.sin(th)));
        var est = (Math.hypot(t.tr.x - t.tl.x, t.tr.y - t.tl.y) + Math.hypot(t.bl.x - t.tl.x, t.bl.y - t.tl.y)) / 2 / mod + 7;
        var base = Math.round((est - 17) / 4);
        var vers = [base, base - 1, base + 1, base - 2, base + 2].filter(function (v) { return v >= 1 && v <= 40; });
        // 型番7以上なら、まず推定した大きさで格子を読み、型番情報が読めたらその型番を最初に試す
        if (base >= 6) {
          var dim0 = base * 4 + 17, T0 = homography([[3.5, 3.5], [dim0 - 3.5, 3.5], [3.5, dim0 - 3.5]].concat([[dim0 - 3.5, dim0 - 3.5]]),
            [[t.tl.x, t.tl.y], [t.tr.x, t.tr.y], [t.bl.x, t.bl.y], [t.tr.x + t.bl.x - t.tl.x, t.tr.y + t.bl.y - t.tl.y]]);
          var vr = T0 && readVersion(sampleGrid(B, w, h, T0, dim0));
          if (vr) vers = [vr].concat(vers.filter(function (v) { return v !== vr; }));
        }
        for (var vi = 0; vi < vers.length; vi++) {
          var dim = vers[vi] * 4 + 17;
          var src = [[3.5, 3.5], [dim - 3.5, 3.5], [3.5, dim - 3.5], [dim - 3.5, dim - 3.5]];
          var br = [t.tr.x + t.bl.x - t.tl.x, t.tr.y + t.bl.y - t.tl.y];
          var T = homography(src, [[t.tl.x, t.tl.y], [t.tr.x, t.tr.y], [t.bl.x, t.bl.y], br]);
          if (!T) continue;
          var tries = [];
          if (vers[vi] >= 2) findAlignment(B, w, h, T, dim).forEach(function (ap) {
            var T2 = homography([[3.5, 3.5], [dim - 3.5, 3.5], [3.5, dim - 3.5], [dim - 6.5, dim - 6.5]],
              [[t.tl.x, t.tl.y], [t.tr.x, t.tr.y], [t.bl.x, t.bl.y], ap]);
            if (T2) tries.push(T2);
          });
          tries.push(T);
          for (var k = 0; k < tries.length; k++) {
            var r = decodeGrid(sampleGrid(B, w, h, tries[k], dim));
            if (r) { r.corners = [t.tl, t.tr, t.bl]; return r; }
          }
        }
      }
    }
    return null;
  }

  return { rsDecode: rsDecode, decodeGrid: decodeGrid, decodeImage: decodeImage, _: { readFormat: readFormat, readVersion: readVersion, deinterleave: deinterleave, parseSegments: parseSegments, findFinders: findFinders, homography: homography } };
});
