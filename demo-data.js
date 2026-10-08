/* デモ用の架空データ（人・地区・薬局・道路・ドローン拠点・カードの署名）。実在の人や場所ではない。
 * ブラウザ（index.html）、サーバー（server.js）、発行側の道具（tools/issue-cards.mjs）、テストで同じものを使う。 */
(function (root, factory) {
  var d = factory();
  if (typeof module === "object" && module.exports) module.exports = d;
  else root.OkusuriDemo = d;
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
    return { i: i, id: "OR-" + String(i + 1).padStart(4, "0"), name: r[0], area: r[1], drug: r[2], cls: r[3], onHand: r[4], newDrug: !!r[5],
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

  // カードの「登録時の内容」（署名の対象）。発行日・期限・交付はデモの値。
  // 交付は、手元の日数を決める薬を最後に28日分受け取った日。デモの日（10/12）に手元の日数ちょうどが残るように置いた
  function dispensed(p) {
    var d = new Date(Date.UTC(2026, 9, 12) - (28 - p.onHand) * 86400000);
    return d.toISOString().slice(0, 10) + "/28日分";
  }
  function issuedFields(p) {
    var f = { ID: p.id, name: p.name + "（架空）", "預かり": "薬バンク中部 " + reserveOf(p) + "日分", "交付": dispensed(p), "発行": "2026-10-01", "期限": "2027-09-30" };
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
    "OR-0001": "ZGRshh2bbZHE3HO_3U6XnQWyevh5ZjI8m3AK794iSYa6L-P5cCa16q92Q9DZrS-3Z_ao4EGHvJqlLfivSk_fRw",
    "OR-0002": "CZOBfyfNA-mWznOIO-t1HMwn5rdWECfxMAJBQ4fYZ3aknv2_nolceoAwGRW2wlTXjPN-gLVBTCTIG48tdBos0A",
    "OR-0003": "4GRhziJkvNyIb4DbPJaJ5pVbstQsL2_e75xPy4hQHo2C-rEKm8QQZBdI5j4y80ytN89aIh_SYaabTP075P3C9g",
    "OR-0004": "aTsXDXkNUZV7mDxiQehjFk_-InnXRzJoX2tVRyxG49mHE9KjgHnFh8RE8bPxCEZAxCysixliaKchnHJc4NHrDA",
    "OR-0005": "o-b1yt10OgR2A-QyfEcx8romOZH8gryWBUHWx2MQiWOy0UEto8bGXRZyt-mxYFe9sYXrFYGT3-l7j0_iR9ioFA",
    "OR-0006": "S7lHPWMMukNrL-RbMp2BM7ldconTBY4gdAr3RfL8pM49ze1_JLGMIgNIyvS1lKNH4h2dJ-Y403hmM1t5UHuC4w",
    "OR-0007": "Vt6Bo-9K5E_goZX1LrjgezxQNh58wR67nouoYaBiwja4LD9iA5wt8WZIo1cU_Dw7rFip6KOm3ERIP_SEFxdhPg",
    "OR-0008": "WZniLIX2A4zQzduFhfSAxMAie6RGP1FucIDFOLXy0k99XWdlSLt4Npj6JgQ8QuqQO0ONMQjjvX9xSilhjyjZ2g",
    "OR-0009": "RQWXmOgEoZJgjJQtj-WJq9Jl5ZLQ40vKb-Z4VgiB9lolsEEKKIrf07j1re3DHBhdfvlnyA2egCgzl_U_p8gB_w",
    "OR-0010": "PpkymJ2HAmR6eqK4cqif7IvAv5LmJJ3kNC9MEVGhvD2VGGkzHF9iHIw3BvRPnfqhcfsj4M2QKJr0X0J3N2KB0Q",
    "OR-0011": "D0zZ9Dyc6RChp7G8v4Fv3j5nCXBZ5VzpSa16jfNWSUtleOX_Z2s_GUDONGsg2SUg8kxwtDNNOYggEHLupU_BjA",
    "OR-0012": "HkUbgM4PN286FLPoeyH5KAXAPZvrwZZ7zp66aF8Daa5VguqQ7mlnetGS2_FRiFvOnapNm8kXwScxqnC4v2HNMA",
    "OR-0013": "IAB0VdLmSbh5hxCwtSvfI5lUlU8BWNUyehqliu7lerGA0wwEVWLtiuMIEysEDKeHWUzP9npqJCbyYaC_H0pLVA",
    "OR-0014": "nbEOP3FLTqtrLTpoi7p9j_kxyj0VdTwiDki3eMiQ3iaer7KPE_d3ww1ZC5WEzV9TNnfQfSnTxngu8gMcW9tyUA",
    "OR-0015": "wLUGMEwQxrI0ZbxHxAgXrJTAJh7DvWuINzBWwoLUr06OYV7Lcivua3DIDfhgj0u4bNemcHy3oI0dRy1a8Eavng",
    "OR-0016": "ZE_yQk0ZH9Kl0cFLhAvJ58AocVOdxR8txHtc03NHrbn05QsULoOGTEQdU505v27ooeYIANzBRZoczNl-BjqbPg",
    "OR-0017": "obwngXM0QmAarPgPs3fDl3bbQP397AiYq4b1uAosQVwhfeVJi_vcTy05-YCeaMPM_ljd6HF_EoqBqli3A7k5yw",
    "OR-0018": "gadkFQ7hwyVANBtyiOohsv9boZERdVXN5IpSyS-WOUrva7gshkmehO4OOdHX8Rh9wUpEN7j9UYUrJpP8qu8wtQ",
    "OR-0019": "M9o9zWY8IXSb7ESrIb64aukMcn0HbrA77QPRIo8rc3aX99_7Lz6D-mgHZJaWfPUaHDnIdU77A6acBBK1Jr3svQ",
    "OR-0020": "Z8bD66XG8ayeYKy7Nbp9AOxoocElhxbOsTTpqTMhd2mSiLItC5Vt2hcd7K84Tb6VuhdyVtzrB8vnASzPunqroQ",
    "OR-0021": "oSG1ttmeQt_YOXGfDEIjNYGMqWSOGmzBL5KqvJLRSvxacyUIoEG8eKuF4ZMPKCQPVoRavt5HJTQtUOGOBrGehQ",
    "OR-0022": "m46LuaMhAtwUQIXiIxvkwHoMpz5_Hzuolx-29kxZ72jb9WUJdPtyPifdTShd8FnPKtBhrw4G1fREoN8VJNGLYQ",
    "OR-0023": "Rgnwt7pjoHovN_CBqLobmKWKvh5Nma0zLtuzR3GQcCDPEpQ9k9ca4MEphnKoRLafAKVwEbuHL60X31hMAE_Q7w",
    "OR-0024": "MYwoWv_b7VNbKJ1yb_q4qkNfQO5sWdThTpwaltYqXH3a_xzjwst7NeZaj-kAqnln4s3ISQMQ-1N99QvKmH5Zlg"
  };
  // SIGS-END
  var DEMO_TODAY = "2026-10-12";

  return { AREAS: AREAS, NET: NET, CLOSED: CLOSED, PEOPLE: PEOPLE, A_DRUGS: A_DRUGS, PHARMACIES: PHARMACIES,
    RESERVE: RESERVE, RESERVE_PLUS: RESERVE_PLUS, reserveOf: reserveOf, issuedFields: issuedFields,
    ISSUER_PUB: ISSUER_PUB, SIGS: SIGS, DEMO_TODAY: DEMO_TODAY };
});
