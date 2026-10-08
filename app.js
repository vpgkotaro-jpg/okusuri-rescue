/* おくすりレスキューの画面（患者アプリと係員の端末）。ロジックは okusuri-core.js と qr-read.js にある */
(function () {
  "use strict";
  var Core = window.OkusuriCore, Demo = window.OkusuriDemo, QR = window.OkusuriQRRead;
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  /* ---------- タブ ---------- */
  var tabs = { patient: $("tab-patient"), triage: $("tab-triage") };
  var views = { patient: $("view-patient"), triage: $("view-triage") };
  function show(name) {
    Object.keys(tabs).forEach(function (k) {
      tabs[k].setAttribute("aria-selected", k === name ? "true" : "false");
      views[k].hidden = k !== name;
    });
    if (name === "triage") renderTriage();
    else stopCamera();
  }
  tabs.patient.addEventListener("click", function () { show("patient"); });
  tabs.triage.addEventListener("click", function () { show("triage"); });

  /* ======================================================================
   * 患者アプリ（Aさん）
   * ==================================================================== */
  var START = new Date(2026, 9, 3);
  var CLS = { imm: { label: "即時中断不可", grace: 0 }, h72: { label: "48〜72時間以内に確保", grace: 2 } };
  var ME = Demo.PEOPLE[0];
  var drugs = Demo.A_DRUGS.map(function (d) { return { name: d.name, cls: d.cls, hand: d.hand }; });
  var quake = false, place = "未登録", lostA = false, rot;
  function addMonths(d, n) { var x = new Date(d); x.setMonth(x.getMonth() + n); return x; }
  function fmt(d) { return (d.getMonth() + 1) + "/" + d.getDate(); }
  function fmtYM(d) { return d.getFullYear() + "年" + (d.getMonth() + 1) + "月"; }

  // 預かり分：最初は残薬から（期限まで26か月）。期限まで12か月を切った月か、処方が変わった月に入れ替える
  function resetRot() { rot = { m: 0, swaps: 0, lotSeq: 1, rx: false, hist: [0], lot: { id: 0, exp: addMonths(START, 26) }, log: "最初の7日分は、手元の残薬から預けた。" }; }
  function today() { return addMonths(START, rot.m); }
  function monthsLeft() { return (rot.lot.exp.getFullYear() - today().getFullYear()) * 12 + rot.lot.exp.getMonth() - today().getMonth(); }
  function stepMonth() {
    rot.m += 1;
    var why = rot.rx ? "処方が変わった" : monthsLeft() < 12 ? "期限まで1年を切った" : "";
    if (why) {
      rot.lot = { id: rot.lotSeq++, exp: addMonths(today(), 30) }; rot.swaps += 1;
      rot.log = fmtYM(today()) + "：" + why + "ので入れ替えた。古い7日分が返送箱つきで届き、先に飲んで、新しく受け取った薬から7日分を送り返した。";
      rot.rx = false;
    }
    rot.hist.push(rot.lot.id);
  }
  function handOf(d) { return lostA ? 0 : d.hand; }
  function minImmHand() { return Math.min.apply(null, drugs.filter(function (d) { return d.cls === "imm"; }).map(handOf)); }
  function clsPill(c) { return '<span class="pill ' + (c === "imm" ? "p-imm" : "p-h72") + '">' + CLS[c].label + '</span>'; }

  function drugHTML(d, i) {
    var h = handOf(d), max = 30;
    return '<div class="drug"><div class="drug-top"><b>' + esc(d.name) + '</b>' + clsPill(d.cls) + '</div>' +
      '<div class="drug-top"><span class="days-big">' + h + '<small> 日分（手元）</small></span>' +
      (lostA ? '<span class="pill p-lost">手元の薬を失った</span>' : '<span class="muted">＋預かり ' + Demo.RESERVE + '日分</span>') + '</div>' +
      '<div class="meter"><div class="n" style="width:' + Math.min(100, h / max * 100) + '%' + (lostA ? ';background:var(--danger)' : '') + '"></div></div>' +
      '<div class="meter"><div class="r" style="width:' + (Demo.RESERVE / max * 100) + '%"></div></div>' +
      (lostA ? "" : '<div class="drug-ed"><button class="chip" data-d="' + i + '" data-v="-1">今日の分を飲んだ（−1日）</button><button class="chip" data-d="' + i + '" data-v="28">28日分を受け取った</button></div>') + '</div>';
  }

  function cardFor(p, hand, where) { return Core.cardText(Demo.issuedFields(p), hand, where, Demo.SIGS[p.id]); }
  function myCard() { return cardFor(ME, lostA ? "0日（家が壊れた）" : minImmHand() + "日分", place); }

  function renderPatient() {
    $("ph-date").textContent = fmt(today());
    $("ph-drugs").innerHTML = drugs.map(drugHTML).join("");
    if (place !== "未登録" && $("evac-sel").value !== place) $("evac-sel").value = place;   // 登録済みの場所を選択欄にも出す
    var al = $("ph-alert");
    if (!quake) {
      al.className = "alert calm";
      al.innerHTML = "<b>いつもどおり</b><span>あなたの薬 <b class='num'>7日分</b> を、薬バンク中部（提携薬局に委託・架空）で預かっています。次の入れ替え：" + fmtYM(addMonths(rot.lot.exp, -12)) + "ごろ（返送箱が届きます）。</span>";
    } else {
      computePlan();
      // 言うことは3行だけ（いつ届くか・どこで受け取るか・それまでどうするか）。理由や仕組みは「くわしく」に畳む
      var arr = arrival(P[0]);
      var n = Core.patientNotice({ lost: lostA, arrival: arr, drone: !!P[0].via, place: place, hand: lostA ? 0 : minImmHand(), cls: "imm" });
      al.className = "alert disaster";
      al.innerHTML = "<b>" + n.title + "</b><dl class='notice'>" +
        n.rows.map(function (r, k) { return "<dt>" + r[0] + "</dt><dd" + (k === 2 && n.short ? " class='act'" : "") + ">" + esc(r[1]) + "</dd>"; }).join("") + "</dl>" +
        "<details><summary>くわしく</summary>預かっている7日分は箱詰め済みで、薬バンクに伝わってから24時間以内に発送する。あなたに処方済みの薬なので、新しい処方箋は要らない。" +
        (lostA ? lostStatus() : "") + "</details>";
    }
    // 36か月の帯
    var cols = ["var(--accent)", "#4f7fbf", "#7fa3d6"], cells = [];
    for (var k = 0; k < 36; k++) {
      var has = k < rot.hist.length, id = has ? rot.hist[k] : -1, sw = has && k > 0 && rot.hist[k] !== rot.hist[k - 1];
      cells.push('<span class="cell' + (k === rot.m ? " today" : "") + '" style="width:18px;background:' + (has ? cols[id % 3] : "var(--surface-2)") + (sw ? ";box-shadow:inset 0 -6px 0 var(--safe)" : "") + '" title="' + fmtYM(addMonths(START, k)) + '"></span>');
    }
    $("shelf").innerHTML = cells.join("");
    $("lots").innerHTML = '<div><i style="background:' + cols[rot.lot.id % 3] + '"></i><span>いま預かっている分：ロット' + (rot.lot.id + 1) + '・7日分</span></div>' +
      '<div><i style="background:var(--safe)"></i><span>緑の線＝入れ替えた月（返送箱で往復）</span></div>';
    $("st-total").textContent = rot.m + "か月";
    $("st-res").textContent = rot.swaps + "回";
    $("st-next").textContent = fmtYM(addMonths(rot.lot.exp, -12));
    $("st-exp").textContent = fmtYM(rot.lot.exp);
    $("rot-msg").textContent = rot.rx ? "処方の変更を受けた。来月、新しい処方の7日分と入れ替える。" : rot.log;
    // カード
    var f = Demo.issuedFields(ME);
    $("qr-dl").innerHTML = [["名前", f.name], ["中断不可", f["中断不可"]], ["72時間", f["72時間"]], ["手元", lostA ? "0日（家が壊れた）" : minImmHand() + "日分"],
      ["いる場所", place], ["預かり", f["預かり"]], ["最後の受け取り", f["交付"].replace("/", "・")], ["期限", f["期限"]]].map(function (r) { return "<dt>" + r[0] + "</dt><dd>" + esc(r[1]) + "</dd>"; }).join("");
    drawQR();
    save();
  }
  $("ph-drugs").addEventListener("click", function (e) {
    var b = e.target.closest("[data-d]"); if (!b) return;
    var d = drugs[+b.getAttribute("data-d")];
    d.hand = Math.max(0, Math.min(180, d.hand + +b.getAttribute("data-v")));
    renderPatient();
  });

  function drawQR() {
    var q = Core.qrEncode(myCard()), quiet = 4, n = q.size + quiet * 2;
    var c = $("qr-canvas"), g = c.getContext("2d");
    c.width = n; c.height = n;
    g.fillStyle = "#fff"; g.fillRect(0, 0, n, n); g.fillStyle = "#111";
    for (var y = 0; y < q.size; y++) for (var x = 0; x < q.size; x++) if (q.modules[y][x]) g.fillRect(x + quiet, y + quiet, 1, 1);
    $("qr-meta").textContent = "QR 型番" + q.version + "（" + q.size + "×" + q.size + "）・誤り訂正M・マスク" + q.mask + "・" + q.bytes + "バイト・署名 ECDSA P-256";
  }

  /* ---------- 手元の日数などは、この端末の中だけに保存する ---------- */
  var KEY = "okusuri-demo-v2";
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ quake: quake, place: place, lostA: lostA, drugs: drugs.map(function (d) { return d.hand; }),
        rot: { m: rot.m, swaps: rot.swaps, lotSeq: rot.lotSeq, rx: rot.rx, hist: rot.hist, lot: { id: rot.lot.id, exp: rot.lot.exp.getTime() }, log: rot.log } }));
      $("saved").innerHTML = "手元の日数はこの端末の中だけに保存（送るのは「失った」とカードの文だけ）　<button class='chip' id='btn-forget'>保存を消す</button>";
      $("btn-forget").onclick = function () { try { localStorage.removeItem(KEY); } catch (e) {} location.hash = ""; location.reload(); };
    } catch (e) { $("saved").textContent = ""; }
  }
  function load() {
    try {
      var v = JSON.parse(localStorage.getItem(KEY) || "null");
      if (!v || !v.rot || !Array.isArray(v.rot.hist)) return false;
      quake = !!v.quake; lostA = !!v.lostA; place = typeof v.place === "string" ? v.place : "未登録";
      if (Array.isArray(v.drugs)) v.drugs.forEach(function (h, i) { if (drugs[i]) drugs[i].hand = Math.max(0, Math.min(180, h | 0)); });
      var r = v.rot;
      rot = { m: r.m | 0, swaps: r.swaps | 0, lotSeq: r.lotSeq | 0, rx: !!r.rx, hist: r.hist.map(Number), lot: { id: r.lot.id | 0, exp: new Date(r.lot.exp) }, log: String(r.log || "") };
      return true;
    } catch (e) { return false; }
  }
  $("btn-day").addEventListener("click", function () { if (rot.m < 35) stepMonth(); renderPatient(); });
  $("btn-week").addEventListener("click", function () { for (var i = 0; i < 6 && rot.m < 35; i++) stepMonth(); renderPatient(); });
  $("btn-refill").addEventListener("click", function () { rot.rx = true; renderPatient(); });
  $("btn-reset").addEventListener("click", function () { resetRot(); renderPatient(); });
  $("btn-qr").addEventListener("click", function () { $("qr").hidden = !$("qr").hidden; drawQR(); });
  $("btn-print").addEventListener("click", function () { document.body.classList.add("print-card"); window.print(); });
  window.addEventListener("afterprint", function () { document.body.classList.remove("print-card"); });
  $("btn-quake").addEventListener("click", function () { quake = true; $("evac").hidden = false; renderPatient(); });
  $("btn-evac").addEventListener("click", function () { place = $("evac-sel").value; $("qr").hidden = false; renderPatient(); });
  $("btn-lost").addEventListener("click", function () {
    quake = true; lostA = true; if (place === "未登録") place = $("evac-sel").value; $("qr").hidden = false;
    lostQueue = { card: myCard(), at: isoNow(), sent: false }; saveLost(); renderPatient(); sendLost();
  });
  /* 「失った」をサーバーへ送る。カードの署名で本人のカードだと確かめてもらう。通信がなければ端末にためて、戻ったら送る */
  var LOST_KEY = "okusuri-lost-v1", lostQueue = null;
  try { lostQueue = JSON.parse(localStorage.getItem(LOST_KEY) || "null"); } catch (e) { lostQueue = null; }
  function saveLost() { try { localStorage.setItem(LOST_KEY, JSON.stringify(lostQueue)); } catch (e) {} }
  function lostStatus() {
    if (lostQueue && lostQueue.sent) return "「失った」は薬バンクのサーバーに届いた。係員がカードを読んだときに確認する。";
    return "「失った」はこの端末に記録した。通信が戻ったら薬バンクのサーバーへ送る" + (server === false ? "（いまは送れない" + (location.protocol === "file:" ? "：ファイルとして開いている" : "：サーバーがないか圏外") + "）" : "") + "。";
  }
  function sendLost() {
    if (!lostQueue || lostQueue.sent || server !== true) return;
    fetch("api/lost", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ card: lostQueue.card, at: lostQueue.at }) })
      .then(function (r) { return r.json(); })
      .then(function (res) { if (res.ok) { lostQueue.sent = true; saveLost(); renderPatient(); } }, function () {});
  }

  /* ======================================================================
   * 災害時トリアージ（係員の端末）
   * ==================================================================== */
  var AREAS = Demo.AREAS, NET = Demo.NET, PH = Demo.PHARMACIES;
  var closed = {};
  function resetRoads() { closed = {}; Demo.CLOSED.forEach(function (k) { closed[k] = true; }); }
  // 名簿（カードを読むと、手元の日数・場所・失ったかどうかが更新される）
  var P = Demo.PEOPLE.map(function (p) { return { i: p.i, id: p.id, name: p.name, area: p.area, drug: p.drug, cls: p.cls, onHand: p.onHand, newDrug: p.newDrug, lost: p.lost, src: p }; });
  var mode = "on", access = {}, plan = null, planF = null, planS = null;

  function isLost(p) { return p.i === 0 ? lostA : p.lost; }
  function hand(p) { return isLost(p) ? 0 : p.i === 0 ? minImmHand() : p.onHand; }
  function reserveOf(p) { return Demo.reserveOf(p.src); }
  function jobsNow() {
    return P.filter(function (p) { return access[p.area].how !== "car"; }).map(function (p) {
      var a = access[p.area];
      return { id: p.i, shelter: p.area, deadline: Core.dangerDay(hand(p), p.cls), release: a.release, bases: a.bases };
    });
  }
  var BASE_IDS = NET.bases.map(function (b) { return b.id; });
  function computePlan() {
    access = Core.accessPlan(NET, closed);
    var cap = +$("cap").value, pay = +$("pay").value, jobs = jobsNow();
    plan = Core.planShelters(jobs, BASE_IDS, cap, pay);
    planF = Core.fillShelters(jobs, BASE_IDS, cap, pay, "fifo");
    planS = Core.fillShelters(jobs, BASE_IDS, cap, pay, "sorted");
    P.forEach(function (p) { p.via = plan.base[p.i] || null; });
  }
  // 預かり分が届く日（届け方がない地区は null）
  function arrival(p) {
    var a = access[p.area];
    if (a.how === "car") return 1;
    return plan.day[p.i] === undefined ? null : plan.day[p.i];
  }
  // 預かり分が届く前に切れる人
  function gap(p) { var d = arrival(p); return d === null || Core.dangerDay(hand(p), p.cls) < d; }
  function have(p, m) { return m === "off" || gap(p) ? hand(p) : hand(p) + reserveOf(p); }
  function danger(p, m) { return have(p, m) + CLS[p.cls].grace; }
  // 車で行ける地区にいて、開いている近くの薬局に同じ薬の在庫がある（一社流通の薬は地域の薬局にない）
  function localStock(p) {
    if (p.newDrug || access[p.area].how !== "car") return null;
    return PH.filter(function (x) { return x.open && access[x.area].how === "car" && x.stock.indexOf(p.drug) >= 0; })[0] || null;
  }
  function needs(p, m, sup) { return danger(p, m) < sup && !localStock(p); }
  function routeOf(p, m) {
    var a = access[p.area];
    if (m === "off") {
      var ph = localStock(p);
      return { r: ph ? "近" : "—", text: ph ? ph.name + "の在庫" : p.newDrug ? "発災後にメーカー・卸を探す" : "発災後に卸（県の拠点）を探す" };
    }
    var r = (p.newDrug ? "B" : "A") + (a.how !== "car" ? "+C" : "");
    if (a.how === "none") return { r: r, text: "届け方なし（どの拠点からも届かない。自治体にヘリ等を要請）" };
    var d = arrival(p);
    return { r: r, text: (a.how === "car" ? "車" : p.via + "からドローン") + "・" + d + "日後着" };
  }
  function cmpOrder(m) {
    return function (a, b) { return danger(a, m) - danger(b, m) || (arrival(b) || 99) - (arrival(a) || 99) || a.i - b.i; };
  }

  function renderTriage() {
    var sup = +$("sup").value, day = +$("day").value, cap = +$("cap").value, pay = +$("pay").value;
    computePlan();
    $("sup-v").textContent = sup; $("day-v").textContent = day; $("cap-v").textContent = cap; $("pay-v").textContent = pay;
    $("mode-on").setAttribute("aria-pressed", mode === "on" ? "true" : "false");
    $("mode-off").setAttribute("aria-pressed", mode === "off" ? "true" : "false");
    var off = P.filter(function (p) { return needs(p, "off", sup); }).length;
    var on = P.filter(function (p) { return needs(p, "on", sup); }).length;
    var keep = plan; plan = planF;                         // 同じ数え方で、ドローンだけ登録順にした場合
    var onF = P.filter(function (p) { return needs(p, "on", sup); }).length;
    plan = keep;
    $("k-onf").textContent = onF + "人";
    var gaps = P.filter(function (p) { return gap(p) && !localStock(p); }).length;
    $("k-off").textContent = off + "人"; $("k-on").textContent = on + "人"; $("k-need").textContent = gaps + "人";

    // 便が足りないときの比べ方
    var jobs = jobsNow(), nDrone = jobs.length;
    $("c-fifo").textContent = planF.late.length + "人";
    $("c-sorted").textContent = planS.late.length + "人";
    $("c-edf").textContent = plan.late.length + "人";
    var hdr = "<tr><th>1拠点の便/日（1便" + pay + "人分）</th>", rows = { fifo: "<tr><td>登録した順</td>", sorted: "<tr><td>締切順に並べるだけ</td>", skip: "<tr><td>締切順・間に合わない人は飛ばす（近い拠点から）</td>", edf: "<tr><td>おくすりレスキューの割り当て（最大流）</td>" };
    [1, 2, 3, 4, 6, 12].forEach(function (c) {
      hdr += '<th class="r">' + c + "便</th>";
      rows.fifo += '<td class="r">' + Core.fillShelters(jobs, BASE_IDS, c, pay, "fifo").late.length + "人</td>";
      rows.sorted += '<td class="r">' + Core.fillShelters(jobs, BASE_IDS, c, pay, "sorted").late.length + "人</td>";
      rows.skip += '<td class="r">' + Core.fillShelters(jobs, BASE_IDS, c, pay, "skip").late.length + "人</td>";
      rows.edf += '<td class="r">' + Core.planShelters(jobs, BASE_IDS, c, pay).late.length + "人</td>";
    });
    $("sweep").innerHTML = hdr + "</tr>" + rows.fifo + "</tr>" + rows.sorted + "</tr>" + rows.skip + "</tr>" + rows.edf + "</tr>";
    var noneN = plan.none.length;
    $("c-note").textContent = "車で行けない地区の " + nDrone + "人に、ドローン拠点" + BASE_IDS.length + "か所から1拠点1日" + cap + "便、1便" + pay + "人分ずつ送る（数は預かり分が届く前に薬が切れる人）。" +
      "1便は1つの地区の避難所へ行く。この小さな町では「締切順で飛ばす」方法と同じ人数になる。差が出るのは、珠洲市の公開データで1便に5人分積んだとき（node noto.js：24人→21人）や、大きな町（node bench.js）。" + (noneN ? "どの拠点からも届かない人が" + noneN + "人いる。" : "");

    // 地図
    var svg = [], k;
    NET.roads.forEach(function (r) {
      var a = NET.nodes[r[0]], b = NET.nodes[r[1]], key = Core.roadKey(r[0], r[1]), cl = !!closed[key];
      svg.push('<line x1="' + a.x + '" y1="' + a.y + '" x2="' + b.x + '" y2="' + b.y + '" stroke="' + (cl ? "var(--danger)" : "var(--muted)") + '" stroke-width="5" stroke-linecap="round"' + (cl ? ' stroke-dasharray="3 7"' : "") + ' opacity=".8"/>');
      svg.push('<line class="road" data-road="' + key + '" x1="' + a.x + '" y1="' + a.y + '" x2="' + b.x + '" y2="' + b.y + '" stroke="transparent" stroke-width="16" style="cursor:pointer"><title>' + (cl ? "通れない（押すと開ける）" : "通れる（押すと閉じる）") + '</title></line>');
    });
    var hub = NET.nodes.hub;
    svg.push('<text x="4" y="' + (hub.y - 12) + '" font-size="8.5" fill="var(--muted)">県の拠点へ</text><circle cx="' + hub.x + '" cy="' + hub.y + '" r="5" fill="var(--muted)"/>');
    Object.keys(AREAS).forEach(function (k2) {
      var a = AREAS[k2], ac = access[k2];
      var fill = ac.how === "car" ? "var(--map-ok)" : ac.how === "drone" ? "var(--map-cut)" : "var(--map-iso)";
      var label = ac.how === "car" ? "車で行ける" : ac.how === "drone" ? "ドローン（" + ac.bases.map(function (b) { return b.replace("拠点", ""); }).join("・") + "）" : "届け方なし";
      svg.push('<rect x="' + (a.x - 52) + '" y="' + (a.y - 46) + '" width="104" height="92" rx="8" fill="' + fill + '" stroke="var(--line)" pointer-events="none"/>');
      svg.push('<text x="' + (a.x - 46) + '" y="' + (a.y - 31) + '" font-size="12" font-weight="700" fill="var(--fg)" pointer-events="none">' + a.name + (a.isoProne ? '<tspan font-size="8" font-weight="400" fill="var(--muted)"> 孤立しやすい</tspan>' : "") + '</text>');
      svg.push('<text x="' + (a.x - 46) + '" y="' + (a.y - 19) + '" font-size="8.5" fill="var(--muted)" pointer-events="none">' + label + '</text>');
      PH.filter(function (x) { return x.area === k2; }).forEach(function (x) {
        svg.push('<rect x="' + (a.x + 30) + '" y="' + (a.y - 42) + '" width="16" height="16" rx="3" fill="' + (x.open ? "var(--accent)" : "var(--muted)") + '"><title>' + x.name + (x.open ? "（開いている）" : "（閉まっている）") + '</title></rect>');
        svg.push('<text x="' + (a.x + 38) + '" y="' + (a.y - 30) + '" font-size="10" font-weight="700" text-anchor="middle" fill="var(--surface)" pointer-events="none">薬</text>');
      });
      P.filter(function (p) { return p.area === k2; }).forEach(function (p, j) {
        var cx = a.x - 34 + (j % 3) * 30, cy = a.y + 2 + Math.floor(j / 3) * 26;
        var left = danger(p, mode) - day, col = localStock(p) ? "var(--safe)" : left < 0 ? "var(--danger)" : left <= 3 ? "var(--warn)" : "var(--safe)";
        svg.push('<circle cx="' + cx + '" cy="' + cy + '" r="10" fill="' + col + '"><title>' + p.name + "：" + p.drug + "（危険になる日：発災から " + danger(p, mode) + '日後）</title></circle>');
        svg.push('<text x="' + cx + '" y="' + (cy + 4) + '" font-size="10" font-weight="700" text-anchor="middle" fill="var(--surface)" pointer-events="none">' + p.name.charAt(0) + '</text>');
      });
    });
    NET.bases.forEach(function (b) {
      var n = NET.nodes[b.at], ok = access[b.at] && access[b.at].how === "car";
      svg.push('<circle cx="' + n.x + '" cy="' + n.y + '" r="' + b.range + '" fill="none" stroke="var(--accent)" stroke-dasharray="2 4" opacity="' + (ok ? .4 : .12) + '" pointer-events="none"/>');
      svg.push('<path d="M' + (n.x - 8) + ' ' + (n.y + 34) + ' l8 -8 l8 8 l-8 8z" fill="' + (ok ? "var(--accent)" : "var(--muted)") + '"><title>' + b.id + (ok ? "（車で補給できる）" : "（車で補給できないので使えない）") + '</title></path>');
    });
    $("map").innerHTML = svg.join("");

    // 表
    var sorted = P.slice().sort(cmpOrder(mode));
    $("rows").innerHTML = sorted.map(function (p, i) {
      var a = AREAS[p.area], need = needs(p, mode, sup), ro = routeOf(p, mode), ls = localStock(p);
      var tags = (isLost(p) ? ' <span class="pill p-lost">手元を失った</span>' : "") + (mode === "on" && gap(p) && !ls ? ' <span class="pill p-imm">先につなぐ</span>' : "") + (p.scanned ? ' <span class="pill p-info">カード確認</span>' : "") + (p.needsCheck && !checkedFor(p) ? ' <span class="pill p-h72">申告を要確認</span>' : "") + (p.capped ? ' <span class="pill p-info">交付の記録で頭打ち</span>' : "");
      return '<tr class="' + (need ? "need" : "later") + '"><td class="r">' + (i + 1) + '</td><td>' + p.name + tags + '</td>' +
        '<td>' + a.name + '</td><td>' + p.drug + ' <span class="pill ' + (p.cls === "imm" ? "p-imm" : "p-h72") + '">' + CLS[p.cls].label + '</span>' + (p.newDrug ? ' <span class="pill p-info">一社流通</span>' : "") + '</td>' +
        '<td class="r">' + have(p, mode) + '日</td><td class="r">' + danger(p, mode) + '日後</td>' +
        '<td>' + (ls ? '<span class="muted">' + ls.name + 'の在庫でつなげる</span>' : (mode === "on" ? '<span class="route ' + ro.r.charAt(0) + '">' + ro.r + '</span> ' : "") + ro.text) + '</td></tr>';
    }).join("");
    $("export").hidden = true; $("copy-msg").textContent = "";
  }
  $("map").addEventListener("click", function (e) {
    var t = e.target.closest("[data-road]"); if (!t) return;
    var k = t.getAttribute("data-road");
    if (closed[k]) delete closed[k]; else closed[k] = true;
    renderTriage();
  });
  $("btn-roads-reset").addEventListener("click", function () { resetRoads(); renderTriage(); });
  $("btn-roads-open").addEventListener("click", function () { closed = {}; renderTriage(); });
  $("mode-on").addEventListener("click", function () { mode = "on"; renderTriage(); });
  $("mode-off").addEventListener("click", function () { mode = "off"; renderTriage(); });
  ["sup", "day", "cap", "pay"].forEach(function (id) { $(id).addEventListener("input", renderTriage); });
  Array.prototype.forEach.call(document.querySelectorAll("[data-cap]"), function (b) { b.addEventListener("click", function () { $("cap").value = b.getAttribute("data-cap"); renderTriage(); }); });
  Array.prototype.forEach.call(document.querySelectorAll("[data-sup]"), function (b) { b.addEventListener("click", function () { $("sup").value = b.getAttribute("data-sup"); renderTriage(); }); });
  $("btn-export").addEventListener("click", function () {
    var sup = +$("sup").value;
    var list = P.filter(function (p) { return mode === "on" || needs(p, mode, sup); }).sort(cmpOrder(mode));
    var lines = ["順,人,地区,薬,分類,危険になる日,届け方"].concat(list.map(function (p, i) {
      var ls = localStock(p);
      return [i + 1, p.name, AREAS[p.area].name, p.drug, CLS[p.cls].label, danger(p, mode) + "日後", ls ? ls.name + "の在庫" : routeOf(p, mode).r + " " + routeOf(p, mode).text].join(",");
    }));
    if (!list.length) lines.push("（手配が要る人はいません）");
    var text = lines.join("\n"), box = $("export"), msg = $("copy-msg");
    box.textContent = text; box.hidden = false;
    try {
      navigator.clipboard.writeText(text).then(function () { msg.textContent = "一覧をコピーしました（本人の同意の範囲で共有する想定）"; }, function () { msg.textContent = "下の一覧を選んでコピーしてください"; });
    } catch (e) { msg.textContent = "下の一覧を選んでコピーしてください"; }
  });

  /* ---------- 避難所カードを読む ---------- */
  var DEV_KEY = "okusuri-device", LOG_KEY = "okusuri-scans-v1";
  // 端末ID は HTTP のヘッダーで送るので英数字だけにする
  var dev = (function () { try { var d = localStorage.getItem(DEV_KEY); if (!d || !/^[\w-]+$/.test(d)) { d = "dev-" + Math.random().toString(36).slice(2, 6); localStorage.setItem(DEV_KEY, d); } return d; } catch (e) { return "dev-" + Math.random().toString(36).slice(2, 6); } })();
  // 係員の端末の鍵。サーバーの OKUSURI_DEVICE_KEYS にこの端末の ID と同じ鍵を登録しておく。送る本文に HMAC-SHA256 を付ける
  var STAFF_KEY = "okusuri-device-key", devKey = "";
  try { devKey = localStorage.getItem(STAFF_KEY) || ""; } catch (e) {}
  $("dev-id").textContent = dev;
  $("dev-key").value = devKey;
  $("btn-dev-key").addEventListener("click", function () { devKey = $("dev-key").value.trim(); try { localStorage.setItem(STAFF_KEY, devKey); } catch (e) {} renderLog(); trySync(); });
  function hmacHex(key, text) {
    var enc = new TextEncoder();
    return crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
      .then(function (k) { return crypto.subtle.sign("HMAC", k, enc.encode(text)); })
      .then(function (b) { return Array.prototype.map.call(new Uint8Array(b), function (x) { return (x < 16 ? "0" : "") + x.toString(16); }).join(""); });
  }
  function checkedFor(p) { return scans.some(function (s) { return s.id === p.id && s.checked; }); }
  var scans = (function () { try { return JSON.parse(localStorage.getItem(LOG_KEY) || "[]"); } catch (e) { return []; } })();
  function saveScans() { try { localStorage.setItem(LOG_KEY, JSON.stringify(scans)); } catch (e) {} }
  function isoNow() { var d = new Date(), z = function (n) { return (n < 10 ? "0" : "") + n; }; return d.getFullYear() + "-" + z(d.getMonth() + 1) + "-" + z(d.getDate()) + "T" + z(d.getHours()) + ":" + z(d.getMinutes()) + ":" + z(d.getSeconds()); }

  Demo.PEOPLE.forEach(function (p) {
    var o = document.createElement("option"); o.value = p.i; o.textContent = p.name + "（" + AREAS[p.area].name + "）" + (p.name === "Xさん" ? "・期限切れ" : "");
    $("demo-who").appendChild(o);
  });
  $("btn-card-demo").addEventListener("click", function () {
    var p = P[+$("demo-who").value];
    $("card-in").value = p.i === 0 ? myCard() : cardFor(p.src, hand(p) + "日分", "本町公民館");
    $("card-msg").textContent = "";
  });
  // 手元の日数は申告。署名された交付の記録から出した上限で頭打ちにし、上限より少ない申告には確認待ちの印をつける
  // （デモの町の日付 10/12 で数える）
  function applyScan(c) {
    var p = P.filter(function (x) { return x.id === c.ID; })[0];
    if (!p) return null;
    var h = Core.handCheck(c, Demo.DEMO_TODAY);
    if (h.use !== null && h.use !== undefined) {
      if (p.i === 0) lostA = h.use === 0;   // Aさんは患者アプリと同じ人
      else { p.lost = h.use === 0; p.onHand = h.use; }
    }
    if (p.i === 0 && c["場所"]) place = c["場所"];
    p.scanned = true; p.capped = h.capped; p.needsCheck = h.needsCheck;
    return { p: p, h: h };
  }
  function importCard(text, how) {
    var msg = $("card-msg");
    msg.style.color = "";
    return Core.verifyCard(text, Demo.ISSUER_PUB, isoNow().slice(0, 10)).then(function (r) {
      if (!r.ok) { msg.style.color = "var(--danger)"; msg.textContent = "読み込まない：" + r.reason; return; }
      var c = r.card, ap = applyScan(c);
      if (!ap) { msg.textContent = "署名は正しいが、この町の名簿にいない人"; return; }
      var p = ap.p, h = ap.h;
      scans.push({ sid: dev + "-" + (scans.length + 1) + "-" + Date.now().toString(36), id: c.ID, at: isoNow(), hand: h.use, reported: c.hand, needsCheck: h.needsCheck, place: c["場所"] || "", dev: dev, checked: false, rev: 0, card: text, synced: false });
      saveScans();
      if (p.i === 0) renderPatient();
      renderTriage(); renderLog(); trySync();
      var order = P.slice().sort(cmpOrder(mode)).indexOf(p) + 1;
      msg.style.color = "var(--safe)";
      msg.textContent = (how ? how + "で読んだ。" : "") + "署名と期限を確認：" + c.name + "、手元 " + c.hand + "日" +
        (h.capped ? "（交付の記録では多くて" + h.cap + "日なので、" + h.cap + "日として扱う）" : h.needsCheck ? "（交付の記録より少ない。失った・壊れたなら係員が確かめて「確認」に印）" : "") +
        "、" + (c["場所"] || "場所なし") + "。届ける順番の表で " + order + "番目" +
        (gap(p) && !localStock(p) ? "。預かり分は間に合わないので、近くの救護所・薬局の在庫で先につなぐ。" : "。預かり分は" + routeOf(p, "on").text + "。");
    });
  }
  $("btn-card-read").addEventListener("click", function () { importCard($("card-in").value, ""); });

  // 画像から：まず自作の読み取り（qr-read.js）。読めなければ、端末に BarcodeDetector があればそれも試す
  function decodeCanvas(cv) {
    var g = cv.getContext("2d"), img = g.getImageData(0, 0, cv.width, cv.height);
    var t0 = performance.now(), r = QR.decodeImage(img);
    return r ? { text: r.text, ms: Math.round(performance.now() - t0), info: "型番" + r.version + "・" + r.level + "・誤り訂正で直した数 " + r.errors } : null;
  }
  function toCanvas(src, w, h) {
    var s = Math.min(1, 1200 / Math.max(w, h)), cv = document.createElement("canvas");
    cv.width = Math.round(w * s); cv.height = Math.round(h * s);
    cv.getContext("2d").drawImage(src, 0, 0, cv.width, cv.height);
    return cv;
  }
  $("card-img").addEventListener("change", function () {
    var f = this.files[0]; if (!f) return;
    this.value = "";
    createImageBitmap(f).then(function (bmp) {
      var r = decodeCanvas(toCanvas(bmp, bmp.width, bmp.height));
      if (r) { $("cam-msg").textContent = "自作の読み取り：" + r.ms + "ms（" + r.info + "）"; $("card-in").value = r.text; return importCard(r.text, "画像"); }
      if ("BarcodeDetector" in window) return new window.BarcodeDetector({ formats: ["qr_code"] }).detect(bmp).then(function (c) {
        if (!c.length) throw 0; $("cam-msg").textContent = "端末の BarcodeDetector で読んだ"; $("card-in").value = c[0].rawValue; return importCard(c[0].rawValue, "画像");
      });
      throw 0;
    }).catch(function () { $("card-msg").style.color = "var(--danger)"; $("card-msg").textContent = "画像からQRコードを見つけられなかった"; });
  });

  // カメラ：250msごとに1枚取り出して読む
  var stream = null, camTimer = null;
  function stopCamera() {
    if (camTimer) clearTimeout(camTimer); camTimer = null;
    if (stream) stream.getTracks().forEach(function (t) { t.stop(); }); stream = null;
    $("cam").hidden = true; $("btn-cam").textContent = "カメラで読む";
  }
  $("btn-cam").addEventListener("click", function () {
    if (stream) { stopCamera(); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { $("cam-msg").textContent = "この端末・開き方ではカメラを使えない（https か localhost で開く）。画像から読むか、文字を貼り付ける"; return; }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1280 } }, audio: false }).then(function (s) {
      stream = s; var v = $("cam"); v.srcObject = s; v.hidden = false; v.play();
      $("btn-cam").textContent = "カメラを止める"; $("cam-msg").textContent = "カードのQRを枠に入れてください（自作の読み取りで探しています）";
      var tries = 0;
      (function tick() {
        if (!stream) return;
        if (v.videoWidth) {
          tries++;
          var r = decodeCanvas(toCanvas(v, v.videoWidth, v.videoHeight));
          if (r) { stopCamera(); $("cam-msg").textContent = "自作の読み取り：" + tries + "枚目で読めた（1枚 " + r.ms + "ms、" + r.info + "）"; $("card-in").value = r.text; importCard(r.text, "カメラ"); return; }
        }
        camTimer = setTimeout(tick, 250);
      })();
    }, function () { $("cam-msg").textContent = "カメラの許可がない。画像から読むか、文字を貼り付ける"; });
  });

  /* ---------- 読み取り記録と、サーバーへの送信（通信が戻ったら） ---------- */
  var server = null;   // null=未確認, false=なし, true=あり
  function renderLog() {
    var t = $("scanlog");
    if (!scans.length) { t.innerHTML = "<tr><td class='muted'>まだ読んでいない</td></tr>"; }
    else t.innerHTML = "<tr><th>時刻</th><th>人</th><th class='r'>手元</th><th>場所</th><th>確認</th><th>送信</th></tr>" + scans.slice().reverse().map(function (s) {
      var p = P.filter(function (x) { return x.id === s.id; })[0];
      return "<tr><td class='r'>" + s.at.slice(11, 16) + "</td><td>" + (p ? p.name : s.id) + "</td><td class='r'>" + s.hand + "日</td><td>" + esc(s.place) + "</td>" +
        "<td><input type='checkbox' data-sid='" + s.sid + "'" + (s.checked ? " checked" : "") + " aria-label='係員が確認した'></td><td>" + (s.synced ? "済" : "待ち") + "</td></tr>";
    }).join("");
    var wait = scans.filter(function (s) { return !s.synced; }).length;
    $("sync-msg").textContent = (server === true ? "サーバーにつながっている。" : server === false ? "サーバーなし（" + (location.protocol === "file:" ? "ファイルとして開いている" : "圏外か、サーバーが止まっている") + "）。記録はこの端末にためておき、つながったら送る。" : "サーバーを確認中。") +
      "送信待ち " + wait + "件。端末どうし・サーバーで同じ記録を何度合わせても重ならない。";
    $("btn-sync").disabled = server !== true || !wait || !devKey;
  }
  $("scanlog").addEventListener("change", function (e) {
    var sid = e.target.getAttribute("data-sid"); if (!sid) return;
    scans.forEach(function (s) { if (s.sid === sid) { s.checked = e.target.checked; s.rev = (s.rev || 0) + 1; s.synced = false; } });
    saveScans(); renderLog(); renderTriage(); trySync();
  });
  function checkServer() {
    if (!/^https?:$/.test(location.protocol)) { server = false; renderLog(); return Promise.resolve(false); }
    return fetch("api/health", { cache: "no-store" }).then(function (r) { server = r.ok; }, function () { server = false; }).then(function () { renderLog(); return server; });
  }
  function trySync() {
    if (server !== true) return;
    var wait = scans.filter(function (s) { return !s.synced; });
    if (!wait.length) return;
    if (!devKey || !(window.crypto && crypto.subtle)) { $("sync-msg").textContent += "　係員の鍵が入っていないので送れない。"; return; }
    var raw = JSON.stringify({ scans: wait.map(function (s) { var c = {}; Object.keys(s).forEach(function (k) { if (k !== "synced") c[k] = s[k]; }); return c; }) });
    hmacHex(devKey, raw).then(function (sig) {
      return fetch("api/scans", { method: "POST", headers: { "content-type": "application/json", "x-okusuri-device": dev, "x-okusuri-sig": sig }, body: raw });
    })
      .then(function (r) { if (r.status === 401) throw new Error("鍵"); return r.json(); })
      .then(function (res) {
        var bad = {}; (res.rejected || []).forEach(function (x) { bad[x.sid] = x.reason; });
        wait.forEach(function (s) { if (!bad[s.sid]) s.synced = true; });
        saveScans(); renderLog();
        $("sync-msg").textContent += "　送信した（サーバーの記録 " + res.total + "件" + (res.rejected.length ? "、断られた " + res.rejected.length + "件" : "") + "）";
      }, function (e) {
        if (e && e.message === "鍵") { $("sync-msg").textContent += "　サーバーがこの端末の鍵を受け付けなかった。"; return; }
        server = false; renderLog();
      });
  }
  $("btn-sync").addEventListener("click", trySync);
  $("btn-log-clear").addEventListener("click", function () { scans = []; saveScans(); renderLog(); });
  window.addEventListener("online", function () { checkServer().then(function () { trySync(); sendLost(); renderPatient(); }); });
  window.addEventListener("offline", function () { server = false; renderLog(); });

  /* ---------- 起動 ---------- */
  resetRot(); resetRoads();
  var h = (location.hash || "").replace("#", "");
  if (!h && load()) { if (quake) $("evac").hidden = false; if (place !== "未登録" || lostA) $("qr").hidden = false; }
  computePlan();
  renderPatient(); renderLog(); checkServer().then(function () { trySync(); sendLost(); if (lostA) renderPatient(); });
  if (/^https?:$/.test(location.protocol) && "serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(function () {});
  if (h === "triage" || h === "triage-off") { if (h === "triage-off") mode = "off"; show("triage"); }
  else if (h === "lost") { quake = true; lostA = true; place = "北山小学校 体育館"; $("evac").hidden = false; $("qr").hidden = false; renderPatient(); }
  else if (h === "cap") { $("cap").value = 1; show("triage"); $("cap-panel").scrollIntoView(); }
  else if (h === "roads") { show("triage"); }
  else if (h === "card") {
    $("cap").value = 1; show("triage");
    lostA = false; place = "北山小学校 体育館";
    var text = cardFor(ME, "0日（家が壊れた）", place);
    $("card-in").value = text; importCard(text, "");
  }
  else if (h === "quake") { quake = true; place = "北山小学校 体育館"; $("evac").hidden = false; $("qr").hidden = false; renderPatient(); }
})();
