// 発行側の道具：薬バンクの秘密鍵で、名簿の一人ずつの「登録時の内容」に署名する。
//   鍵を作る：     node tools/issue-cards.mjs --new-key 鍵のファイル.jwk.json
//   署名を付ける： node tools/issue-cards.mjs --key 鍵のファイル.jwk.json
// 秘密鍵はリポジトリの外に置く（.gitignore で *.jwk.json を除外している）。
// 署名は demo-data.js の SIGS-BEGIN〜SIGS-END の間に書き込む。公開鍵が変わったら ISSUER_PUB も書き換える。
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const Core = require(join(here, "..", "lastone-core.js"));
const Demo = require(join(here, "..", "demo-data.js"));
const { subtle } = globalThis.crypto;
const args = process.argv.slice(2);

if (args[0] === "--new-key") {
  const kp = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  writeFileSync(args[1], JSON.stringify(await subtle.exportKey("jwk", kp.privateKey)));
  const pub = await subtle.exportKey("jwk", kp.publicKey);
  console.log("秘密鍵を書いた：", args[1]);
  console.log("公開鍵（demo-data.js の ISSUER_PUB に入れる）：", JSON.stringify({ kty: pub.kty, crv: pub.crv, x: pub.x, y: pub.y }));
  process.exit(0);
}
if (args[0] !== "--key" || !args[1]) { console.error("使い方：node tools/issue-cards.mjs --key 鍵.jwk.json"); process.exit(1); }
const jwk = JSON.parse(readFileSync(args[1], "utf8"));
const key = await subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
if (jwk.x !== Demo.ISSUER_PUB.x || jwk.y !== Demo.ISSUER_PUB.y) console.warn("注意：この鍵は demo-data.js の公開鍵と対になっていない");
const sigs = {};
for (const p of Demo.PEOPLE) {
  const f = Demo.issuedFields(p);
  const sig = await subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(Core.issuedString(f)));
  sigs[p.id] = Buffer.from(sig).toString("base64url");
}
const file = join(here, "..", "demo-data.js");
const src = readFileSync(file, "utf8");
const body = "  var SIGS = {\n" + Object.entries(sigs).map(([k, v]) => `    "${k}": "${v}"`).join(",\n") + "\n  };\n";
const out = src.replace(/(\/\/ SIGS-BEGIN\n)[\s\S]*?(  \/\/ SIGS-END)/, (_, a, b) => a + body + b);
writeFileSync(file, out);
console.log(Object.keys(sigs).length + "人分の署名を demo-data.js に書いた");
