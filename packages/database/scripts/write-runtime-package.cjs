const { mkdirSync, writeFileSync } = require("node:fs");
const { resolve } = require("node:path");

const runtimeRoot = resolve(__dirname, "../dist");
mkdirSync(runtimeRoot, { recursive: true });
writeFileSync(`${runtimeRoot}/package.json`, '{\n  "type": "commonjs"\n}\n', "utf8");
