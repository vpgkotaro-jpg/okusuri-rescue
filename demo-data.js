/* デモ用の架空データ（人・地区・薬局・道路・ドローン拠点・カードの署名）。実在の人や場所ではない。
 * ブラウザ（index.html）、サーバー（server.js）、発行側の道具（tools/issue-cards.mjs）、テストで同じものを使う。 */
(function (root, factory) {
  var d = factory();
  if (typeof module === "object" && module.exports) module.exports = d;
  else root.LastoneDemo = d;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  // 地区。x, y は地図（SVG）の上の中心。isoProne は「孤立しやすい地区」（預かりを14日分にする）
  var AREAS = {
    honmachi:    { name: "本町", x: 95,  y: 72 },
    minato:      { name: "港",   x: 215, y: 72 },
    nishihama:   { name: "西浜", x: 335, y: 72 },
    kitayama:    { name: "北山", x: 95,  y: 202 },
    higashidani: { name: "東谷", x: 215, y: 202 },
    okusawa:     { name: "奥沢", x: 335, y: 202, isoProne: true }
  };
  // 道路。hub は町の外（県の集配拠点）へつながる入口
  var NET = {
    hub: "hub",
    nodes: { hub: { x: 18, y: 72 } },
    areas: {},
    roads: [["hub", "honmachi"], ["honmachi", "minato"], ["minato", "nishihama"], ["honmachi", "kitayama"],
      ["minato", "higashidani"], ["nishihama", "okusawa"], ["kitayama", "higashidani"], ["higashidani", "okusawa"]],
    // ドローン拠点（協定先が機体を置いておく場所）。range は飛べる距離（地図の単位、仮置き）
    bases: [{ id: "本町拠点", at: "honmachi", range: 185 }, { id: "西浜拠点", at: "nishihama", range: 185 }]
  };
  Object.keys(AREAS).forEach(function (k) { NET.nodes[k] = { x: AREAS[k].x, y: AREAS[k].y }; NET.areas[k] = true; });
  // 発災直後に通れない道路（地図の道路を押すと開け閉めできる）
  var CLOSED = ["honmachi-kitayama", "higashidani-minato", "nishihama-okusawa"];

  // 架空の24人：名前, 地区, 薬, 分類（imm=即時中断不可, h72=48〜72時間以内に確保）, 手元の日数, 一社流通で残薬なし（引当で始めた）
  var PEOPLE = [
    ["Aさん", "kitayama", "抗てんかん薬", "imm", 2, 0],
    ["Bさん", "honmachi", "ドパミン作動薬", "imm", 5, 0],
    ["Cさん", "okusawa", "ステロイド", "imm", 3, 0],
    ["Dさん", "minato", "免疫抑制薬", "h72", 7, 0],
    ["Eさん", "okusawa", "抗てんかん薬", "imm", 1, 1],
    ["Fさん", "higashidani", "ステロイド", "imm", 4, 0],
    ["Gさん", "nishihama", "甲状腺ホルモン", "h72", 6, 0],
    ["Hさん", "honmachi", "β遮断薬", "imm", 10, 0],
    ["Iさん", "kitayama", "ドパミン作動薬", "imm", 3, 0],
    ["Jさん", "minato", "生物学的製剤", "h72", 8, 0],
    ["Kさん", "higashidani", "バクロフェン", "imm", 5, 0],
    ["Lさん", "minato", "ドパミン作動薬", "imm", 2, 1],
    ["Mさん", "nishihama", "ステロイド", "imm", 12, 0],
    ["Nさん", "kitayama", "免疫抑制薬", "h72", 6, 0],
    ["Oさん", "honmachi", "抗てんかん薬", "imm", 4, 0],
    ["Pさん", "higashidani", "甲状腺ホルモン", "h72", 9, 0],
    ["Qさん", "minato", "ステロイド", "imm", 3, 0],
    ["Rさん", "okusawa", "免疫抑制薬", "h72", 7, 0],
    ["Sさん", "nishihama", "ドパミン作動薬", "imm", 14, 0],
    ["Tさん", "kitayama", "β遮断薬", "imm", 5, 0],
    ["Uさん", "higashidani", "抗てんかん薬", "imm", 2, 1],
    ["Vさん", "honmachi", "生物学的製剤", "h72", 6, 0],
    ["Wさん", "minato", "抗てんかん薬", "imm", 11, 0],
    ["Xさん", "nishihama", "バクロフェン", "imm", 4, 0]
  ].map(function (r, i) {
    return { i: i, id: "LO-" + String(i + 1).padStart(4, "0"), name: r[0], area: r[1], drug: r[2], cls: r[3], onHand: r[4], newDrug: !!r[5],
      lost: r[0] === "Fさん" || r[0] === "Oさん" };
  });
  // Aさんは患者アプリの本人。薬が3つある
  var A_DRUGS = [
    { name: "抗てんかん薬", cls: "imm", hand: 2 },
    { name: "ステロイド", cls: "imm", hand: 21 },
    { name: "甲状腺ホルモン", cls: "h72", hand: 9 }
  ];
  // 架空の薬局と在庫。一社流通の薬（newDrug の人の薬）は地域の薬局にない前提
  var PHARMACIES = [
    { name: "本町薬局", area: "honmachi", open: true, stock: ["抗てんかん薬", "ステロイド", "甲状腺ホルモン", "β遮断薬", "ドパミン作動薬"] },
    { name: "港薬局", area: "minato", open: false, stock: [] },
    { name: "西浜薬局", area: "nishihama", open: true, stock: ["ステロイド", "免疫抑制薬", "バクロフェン", "β遮断薬"] }
  ];
  var RESERVE = 7, RESERVE_PLUS = 14;
  function reserveOf(p) { return (p.newDrug || AREAS[p.area].isoProne) ? RESERVE_PLUS : RESERVE; }

  // カードの「登録時の内容」（署名の対象）。発行日・期限はデモの値
  function issuedFields(p) {
    var f = { ID: p.id, name: p.name + "（架空）", "預かり": "薬バンク中部 " + reserveOf(p) + "日分", "発行": "2026-10-01", "期限": "2027-09-30" };
    if (p.i === 0) { f["中断不可"] = "抗てんかん薬・ステロイド"; f["72時間"] = "甲状腺ホルモン"; }
    else if (p.cls === "imm") f["中断不可"] = p.drug;
    else f["72時間"] = p.drug;
    if (p.name === "Xさん") { f["発行"] = "2025-10-01"; f["期限"] = "2026-09-30"; }   // 期限切れのカードの見本
    return f;
  }

  // 発行者（薬バンク）の公開鍵。秘密鍵はこのリポジトリに入れない（tools/issue-cards.mjs が別の場所から読む）
  var ISSUER_PUB = { kty: "EC", crv: "P-256", x: "7h8GaETYnSsPXHqubxcv3vVuYyaY_bhkzAeqHm3fu4c", y: "-ZGL8WiqX42dbMHpmd2CSu053z0UteARf7A62HCoExk" };
  // 署名（tools/issue-cards.mjs が書き込む。手で直さない）
  // SIGS-BEGIN
  var SIGS = {
    "LO-0001": "dn8-gifThEKJqxD63mRcyIzbekEE_7PtNGlUUMaACbK3hL6BB7ayeFWynjFOLZRsLlm8R6xJJNkyGJwM1p6wdQ",
    "LO-0002": "oTLKfzFIHkT3kvITAnY0CKj5xd2Qc8NLiF8ufuufDgMbqF7kVV6xReobRo8cOg5COOR-3y8lfV2QtpqfVizp0g",
    "LO-0003": "wE3bi0LWxbPXZ61i6GW_t-QFMr9TvRv91ZUtMPzHoTHkwVBKR0DvyVW_gxmQkavOIqxDc6G_5VM2frfQWFF_Bw",
    "LO-0004": "aXoP3i5RUGsFH_8tOEkRYJHqHFcE9zk8zzdKCudEU6B3J70pIElb5vRcPxgbl17c7gzv7p9v3WiuC17DEKxw0Q",
    "LO-0005": "yzID3_74fa_YpNEnbAWeEl95g6ZXIaXL5Sc_-N2Ju4cHIgI7pEx5yPoF7TJMc48l2xOL82Y9Jdga4I6RcGg9zA",
    "LO-0006": "EKBCX1RLQVXjXC3CLHtu2MXBwT26dlDD1NNErOvyGPGd4ESksiiFcaICl-w6b8NoUwiEmjmzetQIojyaw1zZNA",
    "LO-0007": "kfsVphm33wpQ8AgDCF1ifGk-VUMfh3Upx16iw23Bu6h8570C06LCs232fPHGJyunBrjVmc3iJ5GRG1LF6J4zxQ",
    "LO-0008": "Xp3BnmnofprWVt8GexXQPU9jcVIUX_HF27izzmfwxEm0ZAlOvaqg4GVd1n7FgT2P3HJnGrqVIjXu4pc8F912EQ",
    "LO-0009": "GRIPifgc7mgqXj5gIPEgQfdEKJNlHIvY_2ys4IIADrTEVd32KjKWQYOh39mMCc3-E9Q1ZRfxbfx6fTNcPNzD_A",
    "LO-0010": "crv5wNlfJbMbjvnriAC94Hz3qfxL8Gd7AeUpKp-8AhJXCr4MN8rbAlXcCoiW1nk7lnjen-bwbnpyYJOPD__xcg",
    "LO-0011": "bCZUC7Kh6l4FyPx7u8OqTjUCpSVeB9E8n-JMx3-PcaQO0FqjvjiZ7wgzs_eEeh1m435zJg5kCH7-oGCzy6Fung",
    "LO-0012": "V_KGk6ORDsMggN8uAxWiyL79_4MTpq_gKCFsoh3eTyghyc3Brl-OWYQVKbkNz2TWjB-Z9atRWzQsByL8Nu8ykA",
    "LO-0013": "u0Jd2bJeHt-lOkAFRxPnIiNESNoq_TYrZE3Dot4yxhGHzKCS07zPeXHy-Z18BqfHPZT2qV504_2esouOFsc11g",
    "LO-0014": "vJ1SLFE9QQjHfVDKjnk_xuGJqCzxdjUbrFH4VzRrUMnjMrv4xuDr-25c4UQG5uqqydCJhwuR0yZHEaI1JgkEng",
    "LO-0015": "-WbLA4eG1Srr6TqlTCBx-6fjttEbfAotdjaYFvjKDgBo1wPfLRhebFr6mItE9t0-xTzZaYA4iO87VxRIfjG5PA",
    "LO-0016": "YrWw2IMmzOVRtkqk_yYZep7Vh0FeHjJibD34ffhU4jCN5ArmeVu2zNACjr8qfdQ6zNrq4FHNWsb7H6gU8M2QLA",
    "LO-0017": "46Ch1xzrQJJPi9Ma-2hwGM6YQ3JRai4uAL1_vFdO2C1L4uO8eSFUvqg1yBNlJmdpYPmGLvyW64TTY7aQooYQ7A",
    "LO-0018": "SM5UvjB77vXwqaHOPb1i2ghzVjfCuXB4enWYg6LqPszpbHwft_OLVW1vXqqFK23RIxsnVqd-GxcrPWO3rVTq0g",
    "LO-0019": "HMU3rN9edSd88lDTIQ3gMWNTaEkscFFunbVQ3GvajSNfd2J5ySEN6aEi-3VXcwy5vQMjPfgCGEcnPnotqwSX9g",
    "LO-0020": "hvqqwUZbHK5UGipe0TWZrY2Os4HudXBu9zgctBFUHgezTcHuRJaghxUAlmZEz2rbScoBVsFFgFnyGioPP84iNg",
    "LO-0021": "ZeymJexQjxC3N3vzIITX0-TAfh4iwfgYMFCMdgJFS0f-Cg0ydHNZeNwepwtBttI0yyRcd2E5PLTXhaf4G-aoxg",
    "LO-0022": "e49yaT5ri1n55k2vyr1pWTvrbAxXuQ75WMcWVU97TizdSMW-EAFnI0Rw3WlwEvoscaMgbX9KQuBnEOUepk6DaQ",
    "LO-0023": "ilHSnP3mS-ZpmOVbZWN-1POHx5eiRfu317lSzihx_x09M_LRYmfnrLvIdoKzUjpicqAXTQRSNjDDpVGZyi2g2A",
    "LO-0024": "BRWS9pZ-mDbtDkcc-Qs9_97T21C4_xJnlt8WKPFZk7LeeggvqfcRFALIAv5NawNH_pjmk--WfEe8C2TWWz8FhA"
  };
  // SIGS-END
  var DEMO_TODAY = "2026-10-12";

  return { AREAS: AREAS, NET: NET, CLOSED: CLOSED, PEOPLE: PEOPLE, A_DRUGS: A_DRUGS, PHARMACIES: PHARMACIES,
    RESERVE: RESERVE, RESERVE_PLUS: RESERVE_PLUS, reserveOf: reserveOf, issuedFields: issuedFields,
    ISSUER_PUB: ISSUER_PUB, SIGS: SIGS, DEMO_TODAY: DEMO_TODAY };
});
