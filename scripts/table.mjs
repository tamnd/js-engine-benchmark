// Turn one or more scripts/bench.mjs result files into markdown tables, which
// is what actually gets pasted into an issue or a PR.
//
//   node scripts/table.mjs results/*.json
//   node scripts/table.mjs --baseline v8 results/macos-arm64.json
//
// Every result file carries its own Host block, so a file per machine is enough
// to label the tables. Scores are the V8 benchmark suite's own: higher is faster.

import { readFileSync } from "fs";
import { basename } from "path";

const BENCHES = [
  "Richards",
  "DeltaBlue",
  "Crypto",
  "RayTrace",
  "EarleyBoyer",
  "RegExp",
  "Splay",
  "NavierStokes",
];

const args = process.argv.slice(2);
let baseline = "v8";
const files = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--baseline") baseline = args[++i];
  else files.push(args[i]);
}

function humanSize(n) {
  if (!n) return "";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(1)} ${units[i]}`;
}

function table(rows) {
  const widths = rows[0].map((_, c) => Math.max(...rows.map((r) => String(r[c] ?? "").length)));
  const line = (r) => `| ${r.map((v, c) => String(v ?? "").padEnd(widths[c])).join(" | ")} |`;
  const sep = `| ${widths.map((w) => "-".repeat(Math.max(3, w))).join(" | ")} |`;
  return [line(rows[0]), sep, ...rows.slice(1).map(line)].join("\n");
}

for (const file of files) {
  const data = JSON.parse(readFileSync(file, "utf8"));
  const host = data.Host || {};
  const engines = Object.keys(data.Score || {}).sort((a, b) => data.Score[b] - data.Score[a]);
  if (!engines.length) {
    console.log(`### ${basename(file)}\n\nno scores\n`);
    continue;
  }
  const base = data.Score[baseline];

  const label = host.cpu
    ? `${host.platform}, ${host.cpu}, ${host.cores} cores`
    : basename(file, ".json");
  console.log(`### ${label}\n`);

  const head = ["Benchmark", ...engines];
  const rows = [head];
  for (const b of BENCHES) rows.push([b, ...engines.map((e) => data[b]?.[e] ?? "")]);
  rows.push(["**Score**", ...engines.map((e) => `**${data.Score[e]}**`)]);
  if (base) {
    rows.push([`vs ${baseline}`, ...engines.map((e) => `${(data.Score[e] / base).toFixed(4)}x`)]);
  }
  rows.push(["Version", ...engines.map((e) => data.Version?.[e] || "")]);
  rows.push(["Binary", ...engines.map((e) => humanSize(data["Total size"]?.[e]))]);
  rows.push(["Wall time", ...engines.map((e) => `${data["Time(s)"]?.[e] ?? ""}s`)]);
  console.log(table(rows));
  console.log();
}
