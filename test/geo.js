// テストとベンチ用の架空の町：拠点を横一列に並べ、人は町の中心ほど多い。飛べる拠点は距離 R 以内を近い順に
function rng(seed) { return () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; }
function geoCase(n, nb, cap, R, seed) {
  const rnd = rng(seed * 7919);
  const bases = Array.from({ length: nb }, (_, i) => ({ id: "b" + i, x: 10 + 80 * i / (nb - 1), y: 50 }));
  const people = [];
  while (people.length < n) {
    const x = 50 + (rnd() + rnd() - 1) * 50, y = 50 + (rnd() - 0.5) * 30;
    const bs = bases.map((b) => [b.id, Math.hypot(b.x - x, b.y - y)]).filter((e) => e[1] <= R).sort((a, b) => a[1] - b[1]).map((e) => e[0]);
    if (!bs.length) continue;
    people.push({ id: people.length, release: 2, deadline: 2 + Math.floor(rnd() * 12), bases: bs });
  }
  return { people, ids: bases.map((b) => b.id), cap };
}
module.exports = { geoCase };
