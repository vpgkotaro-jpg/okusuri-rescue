/* LASTONE core：画面に依存しないロジック（ブラウザ・サーバー・テストで同じものを使う）
 *  1.  危険になる日と、届ける順番（1日の件数に上限がある配送計画）
 *  1b. 道路の寸断から、地区ごとの届け方と最初に届けられる日を出す
 *  1c. ドローン拠点が複数あるときの配送計画（増加路による割り当て）
 *  2.  避難所カードの中身と署名（ECDSA P-256、WebCrypto）
 *  2b. 係員の端末の読み取り記録の突き合わせ
 *  3.  避難所カードの QR コード生成（ISO/IEC 18004、バイトモード、誤り訂正 L/M/Q/H、型番1〜40）
 *      生成部分は Project Nayuki「QR Code generator library」（MIT、Copyright (c) Project Nayuki）の
 *      Java/JavaScript 実装を JavaScript に移植したもの（式・表・処理の順番が同じ）。penalty の計算だけ規格から書き直した。
 *      ライセンス文は LICENSE にある。読み取り側（qr-read.js）は移植ではなく規格から書いた。
 */
(function (root, factory) {
  var core = factory();
  if (typeof module === "object" && module.exports) module.exports = core;
  else root.LastoneCore = core;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* ======================================================================
   * 1. 危険になる日と配送計画
   * ==================================================================== */

  // 薬の分類ごとの猶予（日）。分類は「難病患者の災害対策ガイドライン」（厚労科研、2026年3月）
  var GRACE = { imm: 0, h72: 2 };

  // 危険になる日 = 手元の日数 + 分類の猶予
  function dangerDay(onHand, cls) { return onHand + GRACE[cls]; }

  /* 上限つきの配送計画（1件 = 1人分の預かり分。どの便も1日を使う）
   * jobs: [{ id, deadline, release }]
   *   deadline = 危険になる日（この日までに届けば間に合う）
   *   release  = いちばん早く届けられる日（地区の状態や拠点からの距離で人ごとに違ってよい）
   * capacity: 1日に届けられる件数（Infinity なら上限なし）
   * policy:
   *   "edf"  … 日ごとに、もう届けられる人のうち締切（deadline）が早い人から枠を埋める。
   *            締切を過ぎた人には枠を使わず、後ろに回す（近くの救護所・薬局の在庫で先につなぐ）。
   *            人ごとに「届けてよい日の区間 [release, deadline]」があり、枠に人を割り当てる問題
   *            （区間の二部グラフの最大マッチング）になる。この形の問題では、この貪欲法で
   *            間に合う人の数が最大になる。
   *   "fifo" … 登録順（配列の順）に、空いている最初の日へ入れる（比べるための素朴な方法）。
   *   "sorted" … 締切順に並べてから、空いている最初の日へ入れる（間に合わない人にも枠を使う）。
   * 戻り値：{ day: {id: 届く日}, late: [id...] }（late = 届く前に薬が切れる人）
   */
  function schedule(jobs, capacity, policy) {
    var cap = capacity > 0 ? capacity : Infinity;
    var used = {};
    function take(from) {
      var d = from;
      while ((used[d] || 0) >= cap) d++;
      used[d] = (used[d] || 0) + 1;
      return d;
    }
    var day = {}, late = [];
    if (policy !== "edf") {
      var list = policy === "sorted" ? jobs.slice().sort(function (a, b) { return a.deadline - b.deadline; }) : jobs;
      list.forEach(function (j) {
        day[j.id] = take(j.release);
        if (day[j.id] > j.deadline) late.push(j.id);
      });
      return { day: day, late: late };
    }
    var pending = jobs.slice().sort(function (a, b) { return a.release - b.release; });
    var pool = [], dropped = [];
    var t = pending.length ? pending[0].release : 0;
    while (pending.length || pool.length) {
      if (!pool.length && pending[0].release > t) t = pending[0].release;
      while (pending.length && pending[0].release <= t) pool.push(pending.shift());
      // 今日にはもう間に合わない人は外す
      pool = pool.filter(function (j) { if (j.deadline < t) { dropped.push(j); return false; } return true; });
      pool.sort(function (a, b) { return a.deadline - b.deadline || a.release - b.release; });
      for (var k = 0; k < cap && pool.length; k++) {
        var j = pool.shift();
        day[j.id] = t;
        used[t] = (used[t] || 0) + 1;
      }
      t++;
    }
    // 間に合わない人は、間に合う人の枠を使い終えてから、空いている最初の日に送る
    dropped.forEach(function (j) { day[j.id] = take(j.release); late.push(j.id); });
    return { day: day, late: late };
  }

  /* ======================================================================
   * 1b. 道路の寸断から、地区ごとの届け方と最初に届けられる日を出す
   *  nodes: { id: {x, y} }、roads: [[a, b], ...]（無向）、closed: { "a-b": true }
   *  hub から車で行ける地区は1日目。行けない地区は、車で行けるドローン拠点のうち
   *  飛べる距離（range）以内にあるものから2日目。どの拠点からも届かない地区は届け方なし。
   * ==================================================================== */
  function roadKey(a, b) { return a < b ? a + "-" + b : b + "-" + a; }
  function reachable(roads, closed, start) {
    var adj = {}, seen = {}, q = [start];
    roads.forEach(function (r) {
      if (closed[roadKey(r[0], r[1])]) return;
      (adj[r[0]] = adj[r[0]] || []).push(r[1]);
      (adj[r[1]] = adj[r[1]] || []).push(r[0]);
    });
    seen[start] = true;
    while (q.length) {
      var v = q.shift();
      (adj[v] || []).forEach(function (w) { if (!seen[w]) { seen[w] = true; q.push(w); } });
    }
    return seen;
  }
  /* 戻り値 { area: { how: "car"|"drone"|"none", release, bases: [拠点id...] } }
   *  bases は、その地区へ飛べる拠点（拠点が車で補給できるものだけ）を、近い順に並べたもの。 */
  function accessPlan(net, closed) {
    var ok = reachable(net.roads, closed || {}, net.hub), out = {};
    Object.keys(net.areas).forEach(function (a) {
      if (ok[a]) { out[a] = { how: "car", release: 1, bases: [] }; return; }
      var p = net.nodes[a];
      var bases = net.bases.map(function (b) {
        var q = net.nodes[b.at];
        return { id: b.id, ok: ok[b.at], d: Math.hypot(p.x - q.x, p.y - q.y), range: b.range };
      }).filter(function (b) { return b.ok && b.d <= b.range; })
        .sort(function (x, y) { return x.d - y.d; }).map(function (b) { return b.id; });
      out[a] = bases.length ? { how: "drone", release: 2, bases: bases } : { how: "none", release: Infinity, bases: [] };
    });
    return out;
  }

  /* ======================================================================
   * 1c. ドローン拠点が複数あるときの配送計画
   *  一人ずつ「飛べる拠点」と「届けてよい日の区間 [release, deadline]」があり、
   *  (拠点, 日) の枠（1日 capacity 件）に人を割り当てる。拠点が1つなら上の schedule と同じ問題。
   *  拠点ごとに飛べる範囲が違うと、締切順に近い拠点の空き枠を埋めるだけでは最適にならない
   *  （ある拠点の枠を、別の拠点からも届く人が先に使ってしまい、その拠点しか届かない人が溢れる）。
   *  そこで二部マッチングの増加路を使う。締切が早い人から順に、空いた枠か、
   *  すでに入れた人を別の枠へ移して空く枠を探して入れる。一度入れた人は移っても外れないので、
   *  人数は最大マッチングと同じになり、同じ人数なら締切の早い人が残る。
   *  people: [{ id, deadline, release, bases: [拠点id...] }]
   *  戻り値 { day: {id: 届く日}, base: {id: 拠点}, late: [id...], none: [id...] }
   * ==================================================================== */
  function assignDrones(people, baseIds, capacity, policy) {
    var cap = capacity > 0 ? capacity : Infinity;
    var slot = {};                    // "拠点|日" → [id...]
    var who = {};                     // id → "拠点|日"
    var byId = {};
    people.forEach(function (p) { byId[p.id] = p; });
    function slotsOf(p) {
      var s = [];
      for (var d = p.release; d <= p.deadline; d++) p.bases.forEach(function (b) { s.push(b + "|" + d); });
      return s;
    }
    function put(id, k) { (slot[k] = slot[k] || []).push(id); who[id] = k; }
    function drop(id) { var k = who[id], a = slot[k]; a.splice(a.indexOf(id), 1); delete who[id]; }
    var dead = {};
    function augment(id, seen) {
      var s = slotsOf(byId[id]);
      // 空いている枠があれば、押し出しを探す前にそこへ入れる（長さ1の増加路。速くなるだけで結果の人数は同じ）
      for (var f = 0; f < s.length; f++) if (!seen[s[f]] && (slot[s[f]] || []).length < cap) { seen[s[f]] = true; put(id, s[f]); return true; }
      for (var i = 0; i < s.length; i++) {
        var k = s[i];
        if (seen[k]) continue;
        seen[k] = true;
        var here = slot[k] || [];
        if (here.length < cap) { put(id, k); return true; }
        var occupants = here.slice();
        for (var j = 0; j < occupants.length; j++) {
          var other = occupants[j];
          drop(other);                              // いったん枠から出して、別の枠へ移せるか試す
          if (augment(other, seen)) { put(id, k); return true; }
          put(other, k);                            // 移せなければ元に戻す
        }
      }
      return false;
    }
    var order = people.filter(function (p) { return p.bases.length; });
    var none = people.filter(function (p) { return !p.bases.length; }).map(function (p) { return p.id; });
    if (policy === "skip") {
      // 比べるための方法：拠点が1つのときの締切順の貪欲法をそのまま広げたもの。
      // 日ごとに、締切の早い人から、飛べる拠点のうち空いている最初の拠点へ入れる。締切を過ぎた人は飛ばす。
      // 拠点が1つなら最適。拠点ごとに飛べる範囲が違うと、他の拠点からも届く人が枠を先に使ってしまうことがある
      var pend = order.slice().sort(function (a, b) { return a.release - b.release; }), pool = [], skipped = [];
      for (var t = pend.length ? pend[0].release : 0; pend.length || pool.length; t++) {
        while (pend.length && pend[0].release <= t) pool.push(pend.shift());
        pool = pool.filter(function (p) { if (p.deadline < t) { skipped.push(p); return false; } return true; });
        pool.sort(function (a, b) { return a.deadline - b.deadline || a.release - b.release; });
        pool = pool.filter(function (p) {
          var b = p.bases.filter(function (b) { return (slot[b + "|" + t] || []).length < cap; })[0];
          if (!b) return true;
          put(p.id, b + "|" + t); return false;
        });
      }
      skipped.forEach(function (p) {
        for (var d = p.release; ; d++) {
          var b = p.bases.filter(function (b) { return (slot[b + "|" + d] || []).length < cap; })[0];
          if (b) { put(p.id, b + "|" + d); break; }
        }
      });
    } else if (policy === "fifo" || policy === "sorted") {
      // 比べるための素朴な方法：登録順（sorted は締切順）に、飛べる拠点のうち空いている最初の日へ
      if (policy === "sorted") order = order.slice().sort(function (a, b) { return a.deadline - b.deadline; });
      order.forEach(function (p) {
        for (var d = p.release; ; d++) {
          var b = p.bases.filter(function (b) { return (slot[b + "|" + d] || []).length < cap; })[0];
          if (b) { put(p.id, b + "|" + d); break; }
        }
      });
    } else {
      order = order.slice().sort(function (a, b) { return a.deadline - b.deadline || a.release - b.release; });
      // 探しても入れられなかったとき、たどった枠はすべて満杯で、そこにいる人も外へ出られない。
      // 後の人がその枠を通っても空きには届かないので、以後は探さない（同じ結果のまま速くなる）
      order.forEach(function (p) {
        if (p.deadline < p.release) return;
        var seen = Object.create(dead);
        if (!augment(p.id, seen)) for (var k in seen) dead[k] = true;
      });
      // 拠点が決まった人は、拠点ごとに締切順で日を詰め直す（拠点が1つの場合の方法。全員が間に合うまま、早く届く）
      var perBase = {};
      Object.keys(who).forEach(function (id) {
        var b = who[id].split("|")[0], p = byId[id];
        (perBase[b] = perBase[b] || []).push({ id: p.id, deadline: p.deadline, release: p.release });
      });
      slot = {}; var fixed = {};
      Object.keys(perBase).forEach(function (b) {
        var r = schedule(perBase[b], cap, "edf");
        Object.keys(r.day).forEach(function (id) { fixed[id] = b + "|" + r.day[id]; });
      });
      who = {};
      Object.keys(fixed).forEach(function (id) { put(byId[id] ? byId[id].id : id, fixed[id]); });
      // 間に合わない人は、間に合う人の枠を使い終えてから、空いている最初の日に送る
      order.filter(function (p) { return !who[p.id]; }).forEach(function (p) {
        for (var d = p.release; ; d++) {
          var b = p.bases.filter(function (b) { return (slot[b + "|" + d] || []).length < cap; })[0];
          if (b) { put(p.id, b + "|" + d); break; }
        }
      });
    }
    var day = {}, base = {}, late = [];
    people.forEach(function (p) {
      if (!who[p.id]) return;
      var k = who[p.id].split("|");
      base[p.id] = k[0]; day[p.id] = +k[1];
      if (day[p.id] > p.deadline) late.push(p.id);
    });
    none.forEach(function (id) { late.push(id); });
    return { day: day, base: base, late: late, none: none };
  }

  /* ======================================================================
   * 2. 避難所カード：中身と署名
   *  登録時の内容（ID・名前・薬・預け先・発行日・有効期限）に、発行者（薬バンク）が ECDSA P-256 で署名する。
   *  署名は発行側の道具（tools/issue-cards.mjs）で付け、アプリが持つのは発行者の公開鍵だけ。
   *  係員の端末は圏外でも署名と期限を確かめられる。手元の日数といる場所は本人の申告なので、署名の対象にしない。
   * ==================================================================== */
  var CARD_HEAD = "LASTONE 避難所カード";
  function parseCard(text) {
    var lines = String(text).replace(/\r/g, "").split("\n");
    if (lines[0] !== CARD_HEAD) return null;
    var c = { name: lines[2] || "" };
    lines.slice(1).forEach(function (l) {
      var i = l.indexOf(":");
      if (i > 0) c[l.slice(0, i)] = l.slice(i + 1);
    });
    var m = /^(\d+)日/.exec(c["手元"] || "");
    c.hand = m ? +m[1] : null;
    return c;
  }
  // 署名する文字列。どれか1文字でも変わると署名が通らない
  function issuedString(c) {
    return [c.ID, c.name, c["中断不可"] || "", c["72時間"] || "", c["預かり"], c["発行"], c["期限"]].join("|");
  }
  /* 患者アプリの災害時のお知らせ。言うことを3行に絞る：いつ届くか・どこで受け取るか・それまでどうするか
   * o: { lost, arrival（届く日。届け方がなければ null）, drone（ドローンで届くか）, place（いまいる場所）, hand（手元の日数）, cls } */
  function patientNotice(o) {
    var noRoute = o.arrival === null || o.arrival === undefined;
    var when = noRoute ? "届け方を調整中（決まったらここに出る）" : "発災" + o.arrival + "日目ごろ（" + (o.drone ? "ドローン" : "車") + "）";
    var where = !o.place || o.place === "未登録" ? "下で、いまいる場所を登録する"
      : o.place === "自宅" ? "近くの避難所の救護所" : o.place + "の救護所";
    var short = noRoute || dangerDay(o.hand, o.cls || "imm") < o.arrival;
    var until = short ? "救護所でカードを見せ、届くまでの分を先にもらう" : "手元の薬を飲んで待つ（届くまでもつ）";
    return { title: o.lost ? "手元の薬を失ったと記録した" : "地震が起きた（デモ）", short: short,
      rows: [["いつ届く", when], ["受け取る所", where], ["それまで", until]] };
  }
  // 発行側が作るカードの文（署名の行まで）。申告の2行（手元・場所）は空けておき、本人の端末が埋める
  function cardText(f, hand, place, sig) {
    var lines = [CARD_HEAD, "ID:" + f.ID, f.name];
    if (f["中断不可"]) lines.push("中断不可:" + f["中断不可"]);
    if (f["72時間"]) lines.push("72時間:" + f["72時間"]);
    lines.push("手元:" + hand, "場所:" + place, "預かり:" + f["預かり"], "発行:" + f["発行"], "期限:" + f["期限"]);
    if (sig) lines.push("署名:" + sig);
    return lines.join("\n");
  }
  function b64urlDecode(s) {
    s = s.replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    var bin = typeof atob === "function" ? atob(s) : Buffer.from(s, "base64").toString("binary");
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  /* 戻り値 Promise<{ ok, card, reason }>
   * today：期限と比べる日（"2026-10-12" の形）。省略すると期限は見ない */
  function verifyCard(text, publicJwk, today) {
    var c = parseCard(text);
    if (!c) return Promise.resolve({ ok: false, card: null, reason: "LASTONE のカードではない" });
    if (!c["署名"]) return Promise.resolve({ ok: false, card: c, reason: "署名がない" });
    var subtle = (typeof crypto !== "undefined" && crypto.subtle) || null;
    if (!subtle) return Promise.resolve({ ok: false, card: c, reason: "この環境では署名を確かめられない" });
    return subtle.importKey("jwk", publicJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"])
      .then(function (key) {
        return subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, b64urlDecode(c["署名"]), new Uint8Array(utf8(issuedString(c))));
      })
      .then(function (ok) {
        if (!ok) return { ok: false, card: c, reason: "登録時の内容と一致しない（書き換えの疑い）" };
        if (today && c["期限"] && c["期限"] < today) return { ok: false, card: c, reason: "有効期限（" + c["期限"] + "）を過ぎている。薬バンクで再発行が要る" };
        return { ok: true, card: c, reason: "" };
      }, function () { return { ok: false, card: c, reason: "署名の形式が正しくない" }; });
  }

  /* ======================================================================
   * 2b. 係員の端末の読み取り記録と、その突き合わせ
   *  1件 = { sid: 端末ID-連番, id: カードID, at: 読んだ時刻(ISO), hand, place, dev, checked, rev }
   *  端末どうし・端末とサーバーで記録を合わせても、順番や回数によらず同じ結果になるようにする
   *  （同じ sid は rev の大きい方を残す。和集合なので、何度送っても、どちらから合わせても同じ）。
   * ==================================================================== */
  function mergeScans(a, b) {
    var by = {};
    (a || []).concat(b || []).forEach(function (s) {
      var cur = by[s.sid];
      if (!cur || (s.rev || 0) > (cur.rev || 0) || ((s.rev || 0) === (cur.rev || 0) && JSON.stringify(s) > JSON.stringify(cur))) by[s.sid] = s;
    });
    return Object.keys(by).map(function (k) { return by[k]; })
      .sort(function (x, y) { return x.at < y.at ? -1 : x.at > y.at ? 1 : x.sid < y.sid ? -1 : x.sid > y.sid ? 1 : 0; });
  }
  // カードごとに、いちばん新しい読み取りを返す
  function latestByCard(scans) {
    var out = {};
    mergeScans(scans, []).forEach(function (s) { out[s.id] = s; });
    return out;
  }

  /* ======================================================================
   * 3. QR コード生成（Project Nayuki の実装の移植。冒頭の注記を参照）
   *    バイトモード（UTF-8）、誤り訂正レベル L/M/Q/H（既定は M：約15%の欠けまで読める）、
   *    型番 1〜40 から入る最小のものを選ぶ。8種類のマスクを全部試し、減点が最小のものを使う。
   * ==================================================================== */

  // 誤り訂正レベルごとの表（規格の表 7・9。型番 0 は使わない）。並びは L, M, Q, H
  var ECC_PER_BLOCK = {
    L: [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    M: [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
    Q: [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    H: [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30]
  };
  var NUM_BLOCKS = {
    L: [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
    M: [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
    Q: [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
    H: [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81]
  };
  var ECL_BITS = { L: 1, M: 0, Q: 3, H: 2 };
  var MAX_VER = 40;

  function rawModules(ver) {
    var r = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
      var na = Math.floor(ver / 7) + 2;
      r -= (25 * na - 10) * na - 55;
      if (ver >= 7) r -= 36;
    }
    return r;
  }
  function dataCodewords(ver, ecl) {
    ecl = ecl || "M";
    return Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK[ecl][ver] * NUM_BLOCKS[ecl][ver];
  }

  // GF(2^8)、原始多項式 x^8+x^4+x^3+x^2+1（0x11D）
  function gfMul(x, y) {
    var z = 0;
    for (var i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11D);
      z ^= ((y >>> i) & 1) * x;
    }
    return z;
  }
  function rsDivisor(degree) {
    var r = [];
    for (var i = 0; i < degree - 1; i++) r.push(0);
    r.push(1);
    var root = 1;
    for (i = 0; i < degree; i++) {
      for (var j = 0; j < r.length; j++) {
        r[j] = gfMul(r[j], root);
        if (j + 1 < r.length) r[j] ^= r[j + 1];
      }
      root = gfMul(root, 0x02);
    }
    return r;
  }
  function rsRemainder(data, div) {
    var r = div.map(function () { return 0; });
    data.forEach(function (b) {
      var f = b ^ r.shift();
      r.push(0);
      div.forEach(function (c, i) { r[i] ^= gfMul(c, f); });
    });
    return r;
  }

  function utf8(str) {
    if (typeof TextEncoder !== "undefined") return Array.prototype.slice.call(new TextEncoder().encode(str));
    return unescape(encodeURIComponent(str)).split("").map(function (c) { return c.charCodeAt(0); });
  }

  function alignPositions(ver) {
    if (ver === 1) return [];
    var size = ver * 4 + 17, n = Math.floor(ver / 7) + 2;
    // 規格の表 E.1 と同じ値になる。型番32だけは式が合わないので表の値（間隔26）を使う
    var step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
    var res = [6];
    for (var pos = size - 7; res.length < n; pos -= step) res.splice(1, 0, pos);
    return res;
  }

  function bit(x, i) { return ((x >>> i) & 1) !== 0; }

  function makeBits(bytes, ver, ecl) {
    var bits = [];
    function put(val, len) { for (var i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); }
    put(0x4, 4);                                  // バイトモード
    put(bytes.length, ver <= 9 ? 8 : 16);         // 文字数
    bytes.forEach(function (b) { put(b, 8); });
    var cap = dataCodewords(ver, ecl) * 8;
    put(0, Math.min(4, cap - bits.length));       // 終端
    put(0, (8 - bits.length % 8) % 8);
    for (var pad = 0xEC; bits.length < cap; pad ^= 0xEC ^ 0x11) put(pad, 8);
    var out = [];
    for (var i = 0; i < bits.length; i += 8) {
      var v = 0;
      for (var k = 0; k < 8; k++) v = (v << 1) | bits[i + k];
      out.push(v);
    }
    return out;
  }

  function addEcc(data, ver, level) {
    level = level || "M";
    var nb = NUM_BLOCKS[level][ver], ecl = ECC_PER_BLOCK[level][ver];
    var raw = Math.floor(rawModules(ver) / 8);
    var nShort = nb - raw % nb, shortLen = Math.floor(raw / nb);
    var div = rsDivisor(ecl), blocks = [], k = 0;
    for (var i = 0; i < nb; i++) {
      var dat = data.slice(k, k + shortLen - ecl + (i < nShort ? 0 : 1));
      k += dat.length;
      var ecc = rsRemainder(dat, div);
      if (i < nShort) dat.push(0);
      blocks.push(dat.concat(ecc));
    }
    var res = [];
    for (i = 0; i < blocks[0].length; i++) {
      blocks.forEach(function (b, j) {
        if (i !== shortLen - ecl || j >= nShort) res.push(b[i]);
      });
    }
    return res;
  }

  var MASKS = [
    function (x, y) { return (x + y) % 2 === 0; },
    function (x, y) { return y % 2 === 0; },
    function (x, y) { return x % 3 === 0; },
    function (x, y) { return (x + y) % 3 === 0; },
    function (x, y) { return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; },
    function (x, y) { return x * y % 2 + x * y % 3 === 0; },
    function (x, y) { return (x * y % 2 + x * y % 3) % 2 === 0; },
    function (x, y) { return ((x + y) % 2 + x * y % 3) % 2 === 0; }
  ];

  function Grid(ver) {
    var size = ver * 4 + 17;
    this.size = size;
    this.m = []; this.fn = [];
    for (var y = 0; y < size; y++) {
      this.m.push(new Array(size).fill(false));
      this.fn.push(new Array(size).fill(false));
    }
  }
  Grid.prototype.setFn = function (x, y, dark) { this.m[y][x] = dark; this.fn[y][x] = true; };

  function drawFunctionPatterns(g, ver, level) {
    var size = g.size, i;
    for (i = 0; i < size; i++) { g.setFn(6, i, i % 2 === 0); g.setFn(i, 6, i % 2 === 0); }
    [[3, 3], [size - 4, 3], [3, size - 4]].forEach(function (c) {
      for (var dy = -4; dy <= 4; dy++) for (var dx = -4; dx <= 4; dx++) {
        var d = Math.max(Math.abs(dx), Math.abs(dy)), x = c[0] + dx, y = c[1] + dy;
        if (x >= 0 && x < size && y >= 0 && y < size) g.setFn(x, y, d !== 2 && d !== 4);
      }
    });
    var ap = alignPositions(ver), n = ap.length;
    for (i = 0; i < n; i++) for (var j = 0; j < n; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
      for (var ay = -2; ay <= 2; ay++) for (var ax = -2; ax <= 2; ax++)
        g.setFn(ap[i] + ax, ap[j] + ay, Math.max(Math.abs(ax), Math.abs(ay)) !== 1);
    }
    drawFormat(g, 0, level);
    if (ver >= 7) {
      var rem = ver;
      for (i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
      var vb = ver << 12 | rem;
      for (i = 0; i < 18; i++) {
        var a = size - 11 + i % 3, b = Math.floor(i / 3), c = bit(vb, i);
        g.setFn(a, b, c); g.setFn(b, a, c);
      }
    }
  }

  // 形式情報（誤り訂正レベル2ビット + マスク番号3ビット）。BCH(15,5) で守る
  function formatBits(mask, level) {
    var data = (ECL_BITS[level || "M"] << 3) | mask, rem = data;
    for (var i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    return (data << 10 | rem) ^ 0x5412;
  }
  function drawFormat(g, mask, level) {
    var b = formatBits(mask, level), size = g.size, i;
    for (i = 0; i <= 5; i++) g.setFn(8, i, bit(b, i));
    g.setFn(8, 7, bit(b, 6)); g.setFn(8, 8, bit(b, 7)); g.setFn(7, 8, bit(b, 8));
    for (i = 9; i < 15; i++) g.setFn(14 - i, 8, bit(b, i));
    for (i = 0; i < 8; i++) g.setFn(size - 1 - i, 8, bit(b, i));
    for (i = 8; i < 15; i++) g.setFn(8, size - 15 + i, bit(b, i));
    g.setFn(8, size - 8, true);
  }

  function drawCodewords(g, cw) {
    var size = g.size, i = 0, total = cw.length * 8;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var v = 0; v < size; v++) for (var j = 0; j < 2; j++) {
        var x = right - j, up = ((right + 1) & 2) === 0, y = up ? size - 1 - v : v;
        if (!g.fn[y][x] && i < total) { g.m[y][x] = bit(cw[i >>> 3], 7 - (i & 7)); i++; }
      }
    }
  }

  function applyMask(g, k) {
    for (var y = 0; y < g.size; y++) for (var x = 0; x < g.size; x++)
      if (!g.fn[y][x] && MASKS[k](x, y)) g.m[y][x] = !g.m[y][x];
  }

  // 減点（規格の N1〜N4）。小さいほど読み取り機が誤読しにくい
  function penalty(m) {
    var n = m.length, p = 0, x, y, dark = 0;
    function lines(get) {
      for (var a = 0; a < n; a++) {
        var run = 1, row = [];
        for (var b = 0; b < n; b++) row.push(get(a, b) ? 1 : 0);
        for (b = 1; b <= n; b++) {
          if (b < n && row[b] === row[b - 1]) run++;
          else { if (run >= 5) p += 3 + (run - 5); run = 1; }
        }
        var s = row.join("");
        var pats = ["10111010000", "00001011101"];
        pats.forEach(function (pt) {
          for (var at = s.indexOf(pt); at !== -1; at = s.indexOf(pt, at + 1)) p += 40;
        });
      }
    }
    lines(function (a, b) { return m[a][b]; });
    lines(function (a, b) { return m[b][a]; });
    for (y = 0; y < n - 1; y++) for (x = 0; x < n - 1; x++) {
      var c = m[y][x];
      if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) p += 3;
    }
    for (y = 0; y < n; y++) for (x = 0; x < n; x++) if (m[y][x]) dark++;
    p += Math.floor(Math.abs(dark * 100 / (n * n) - 50) / 5) * 10;
    return p;
  }

  /* text を QR に。opts.level は "L" "M" "Q" "H"（既定 M）、opts.mask でマスクを固定できる
   * 戻り値 { version, level, mask, size, modules: boolean[y][x], bytes } */
  function qrEncode(text, opts) {
    opts = opts || {};
    var level = opts.level || "M", maxVer = opts.maxVersion || MAX_VER;
    var bytes = utf8(text), ver;
    for (ver = 1; ver <= maxVer; ver++) {
      var need = 4 + (ver <= 9 ? 8 : 16) + bytes.length * 8;
      if (need <= dataCodewords(ver, level) * 8) break;
    }
    if (ver > maxVer) throw new Error("QR に入りきらない（" + bytes.length + "バイト）");
    var cw = addEcc(makeBits(bytes, ver, level), ver, level);
    var best = null;
    for (var k = 0; k < 8; k++) {
      if (opts.mask !== undefined && opts.mask !== k) continue;
      var g = new Grid(ver);
      drawFunctionPatterns(g, ver, level);
      drawCodewords(g, cw);
      applyMask(g, k);
      drawFormat(g, k, level);
      var sc = penalty(g.m);
      if (!best || sc < best.score) best = { score: sc, g: g, mask: k };
    }
    return { version: ver, level: level, mask: best.mask, size: best.g.size, modules: best.g.m, bytes: bytes.length, codewords: cw };
  }

  return {
    GRACE: GRACE,
    dangerDay: dangerDay,
    schedule: schedule,
    roadKey: roadKey,
    reachable: reachable,
    accessPlan: accessPlan,
    assignDrones: assignDrones,
    parseCard: parseCard,
    issuedString: issuedString,
    cardText: cardText,
    patientNotice: patientNotice,
    mergeScans: mergeScans,
    latestByCard: latestByCard,
    verifyCard: verifyCard,
    qrEncode: qrEncode,
    _qr: { gfMul: gfMul, rsDivisor: rsDivisor, rsRemainder: rsRemainder, formatBits: formatBits, dataCodewords: dataCodewords,
      alignPositions: alignPositions, rawModules: rawModules, ECC_PER_BLOCK: ECC_PER_BLOCK, NUM_BLOCKS: NUM_BLOCKS, ECL_BITS: ECL_BITS,
      Grid: Grid, drawFunctionPatterns: drawFunctionPatterns, MASKS: MASKS, utf8: utf8 }
  };
});
