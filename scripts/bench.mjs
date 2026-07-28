// A self-contained runner for the machines we own, as opposed to the GitHub
// matrix that scripts/update.ts drives. It needs nothing but node: no bun, no
// pnpm, no workspace install, so it can be dropped on a fresh Linux box or a
// Windows desktop and run as is. It builds dist/ itself, runs whichever engines
// are actually on PATH, and writes the same JSON shape the CI harness produces.
//
//   node scripts/bench.mjs                              # every engine it can find
//   node scripts/bench.mjs --engines bento,v8,bun       # just these
//   node scripts/bench.mjs --repeat 3 --out linux.json  # best of three
//
// Engine names are the "name" field of info.json, so --engines v8 selects the
// d8 binary. Scores are the V8 benchmark suite's own: higher is faster.

import { execFile, execFileSync } from "child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "fs";
import { basename, dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import os from "os";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const info = JSON.parse(readFileSync(join(root, "info.json"), "utf8"));

// Engines that are slow enough or broken enough upstream that the CI harness
// skips them; there is no reason for a local run to sit through them either.
const SKIP = new Set(["engine262", "rhino", "hako", "nova", "JerryScript"]);

const KINDS = [
  "Richards",
  "DeltaBlue",
  "Crypto",
  "RayTrace",
  "EarleyBoyer",
  "RegExp",
  "Splay",
  "NavierStokes",
  "Score",
];

function parseArgs(argv) {
  const opts = { engines: null, repeat: 1, out: "", timeout: 1800 };
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].split("=");
    const value = inline ?? argv[++i];
    switch (flag) {
      case "--engines":
        opts.engines = value.split(",").map((s) => s.trim()).filter(Boolean);
        break;
      case "--repeat":
        opts.repeat = Math.max(1, +value | 0);
        break;
      case "--out":
        opts.out = value;
        break;
      case "--timeout":
        opts.timeout = +value;
        break;
      default:
        throw new Error(`unknown flag: ${flag}`);
    }
  }
  return opts;
}

// PATH lookup without shelling out to which/where, which differ per platform and
// are missing entirely from a bare cmd.exe.
function findOnPath(bin) {
  const exts = process.platform === "win32"
    ? (process.env.PATHEXT || ".EXE;.CMD;.BAT").split(";")
    : [""];
  for (const dir of (process.env.PATH || "").split(process.platform === "win32" ? ";" : ":")) {
    if (!dir) continue;
    for (const ext of ["", ...exts]) {
      const p = join(dir, bin + ext);
      try {
        if (statSync(p).isFile()) return p;
      } catch {
        // not here, keep looking
      }
    }
  }
  return "";
}

// dist/run.js is the whole suite with every load() inlined, which is what an
// engine with no module loader needs. This is scripts/build.ts minus the zip
// step, so a local run does not need the @easy-install/easy-archive dependency.
function build() {
  const dist = join(root, "dist");
  const src = join(root, "v8-v7");
  if (!existsSync(dist)) mkdirSync(dist);

  const runSource = readFileSync(join(src, "run.js"), "utf8");
  const loads = [...runSource.matchAll(/load\('([^']+)'\);/g)];
  const files = {};
  for (const m of loads) files[m[1]] = readFileSync(join(src, m[1]), "utf8");

  let full = runSource;
  for (const m of loads) full = full.replace(m[0], files[m[1]]);
  writeFileSync(join(dist, "run.js"), full);

  const last = loads[loads.length - 1];
  const runner = runSource.slice((last.index ?? 0) + last[0].length);
  for (const name of loads.map((m) => m[1]).filter((n) => n !== "base.js")) {
    writeFileSync(
      join(dist, `${basename(name, ".js")}.js`),
      [files["base.js"], files[name], runner].join("\n"),
    );
  }
  return join(dist, "run.js");
}

function run(exe, args, cwd, timeoutSec) {
  return new Promise((done) => {
    execFile(
      exe,
      args,
      { cwd, timeout: timeoutSec * 1000, maxBuffer: 64 * 1024 * 1024 },
      (err, stdout, stderr) => done({ err, stdout: stdout || "", stderr: stderr || "" }),
    );
  });
}

// Engines disagree about where results go and what else they print alongside
// them, so take both streams and keep only lines that look like "Name: number".
function parseScores(name, stdout, stderr) {
  const text = `${stdout}\n${stderr}`;
  const scores = {};
  for (const line of text.split("\n")) {
    const m = line.replaceAll('"', "").replace("INFO ", "").match(
      /([A-Za-z/()]+)\s*:\s*(-?[\d.]+)\s*$/,
    );
    if (!m) continue;
    const [, key, value] = m;
    if (!KINDS.includes(key)) continue;
    scores[key] = Number(value) | 0;
  }
  return scores;
}

function versionArgs(bin) {
  switch (bin) {
    case "bento":
    case "bun":
    case "node":
    case "deno":
    case "tjs":
    case "hermes":
    case "llrt":
    case "boa":
      return ["--version"];
    case "qjs":
    case "qjs-ng":
      return ["-h"];
    case "xst":
    case "njs":
      return ["-v"];
    default:
      return null;
  }
}

async function versionOf(bin, exe, cwd, timeoutSec) {
  if (bin === "d8") {
    // d8 has no --version; the banner it prints on startup carries it.
    const { stdout } = await run(exe, ["-e", "print(version())"], cwd, timeoutSec);
    return stdout.trim().split(/\s+/)[0] || "";
  }
  const args = versionArgs(bin);
  if (!args) return "";
  const { stdout, stderr } = await run(exe, args, cwd, timeoutSec);
  const text = `${stdout}\n${stderr}`;
  // "bento version 0.2.3", "v24.18.0", "quickjs version 2025-04-26"
  const m = text.match(/version (\d{4}-\d{2}-\d{2})/) ||
    text.match(/version ([\d.]+(?:-[a-zA-Z0-9]+)?)/) ||
    text.match(/v?([\d]+\.[\d.]+(?:-[a-zA-Z0-9]+)?)/);
  return m ? m[1] : "";
}

// The bytes you actually ship. Static single-file engines pay only exeSize; the
// ones that load a runtime beside them get that counted too, which is the whole
// point of the Score/MB column.
function sizeOf(exe) {
  let exeSize = 0;
  try {
    exeSize = statSync(exe).size;
  } catch {
    return { exeSize: 0, dllSize: 0 };
  }

  const deps = [];
  const dir = dirname(exe);
  if (exe.endsWith("jsc")) {
    deps.push(join(dir, "JavaScriptCore.framework/Versions/A/JavaScriptCore"));
  }
  if (exe.endsWith("ch")) {
    for (const f of readdirSync(dir)) {
      if (f.includes("libChakraCore")) deps.push(join(dir, f));
    }
  }
  try {
    if (process.platform === "darwin") {
      const out = execFileSync("otool", ["-L", exe], { encoding: "utf8" });
      for (const line of out.split("\n").slice(1)) {
        const dep = line.trim().split(" ")[0];
        if (dep && !dep.startsWith("(")) deps.push(dep);
      }
    } else if (process.platform === "linux") {
      const out = execFileSync("ldd", [exe], { encoding: "utf8" });
      for (const line of out.split("\n")) {
        const dep = line.split("=>")[1]?.trim().split(" (")[0];
        // System libraries are on the box already, so they are not shipped size.
        if (!dep || dep.startsWith("/lib/") || dep.startsWith("/lib64/") ||
          dep.startsWith("/usr/lib/x86_64-linux-gnu/lib") || dep.startsWith("linux-")) {
          continue;
        }
        deps.push(dep);
      }
    }
  } catch {
    // A static binary has no dynamic section and ldd/otool say so loudly.
  }

  let dllSize = 0;
  for (const dep of deps) {
    try {
      dllSize += statSync(dep).size;
    } catch {
      // A dependency we cannot stat is one we cannot bill for.
    }
  }
  return { exeSize, dllSize };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const runJs = build();

  const wanted = opts.engines && new Set(opts.engines);
  const data = {};
  const put = (kind, name, value) => {
    (data[kind] ||= {})[name] = value;
  };

  for (const item of info) {
    const name = item.name;
    const bin = item.bin || item.name;
    if (SKIP.has(bin) || SKIP.has(name)) continue;
    if (wanted && !wanted.has(name) && !wanted.has(bin)) continue;

    const exe = findOnPath(bin);
    if (!exe) {
      if (wanted) console.error(`skip ${name}: ${bin} not on PATH`);
      continue;
    }
    const cwd = dirname(exe);
    const subcmd = item.subcmd ? [item.subcmd] : [];

    // A smoke test first: an engine that cannot print 1+1 will only waste
    // minutes failing the real suite in a less legible way.
    const smoke = await run(exe, [...subcmd, join(root, "scripts", "test.js")], cwd, 60);
    if (!`${smoke.stdout}${smoke.stderr}`.includes("2")) {
      console.error(`skip ${name}: smoke test failed (${smoke.err?.message || "no output"})`);
      continue;
    }

    let best = null;
    let bestSeconds = 0;
    for (let i = 0; i < opts.repeat; i++) {
      process.stderr.write(`run ${name} (${i + 1}/${opts.repeat}) ... `);
      const started = Date.now();
      const { stdout, stderr } = await run(exe, [...subcmd, runJs], cwd, opts.timeout);
      const seconds = (Date.now() - started) / 1000;
      const scores = parseScores(name, stdout, stderr);
      console.error(scores.Score ? `Score ${scores.Score} in ${seconds.toFixed(1)}s` : "no score");
      if (!scores.Score) continue;
      if (!best || scores.Score > best.Score) {
        best = scores;
        bestSeconds = seconds;
      }
    }
    if (!best) continue;

    const { exeSize, dllSize } = sizeOf(exe);
    put("Version", name, await versionOf(bin, exe, cwd, 60));
    put("Total size", name, exeSize + dllSize);
    put("Exe size", name, exeSize);
    put("Dll size", name, dllSize);
    for (const [k, v] of Object.entries(best)) put(k, name, v);
    put("Score/MB", name, exeSize + dllSize ? (best.Score / (exeSize + dllSize) * 1024 * 1024) | 0 : 0);
    put("Time(s)", name, bestSeconds | 0);
  }

  data.Host = {
    platform: `${os.platform()}-${os.arch()}`,
    cpu: os.cpus()[0]?.model || "",
    cores: os.cpus().length,
    hostname: os.hostname(),
  };

  const json = JSON.stringify(data, null, 2);
  if (opts.out) {
    writeFileSync(opts.out, json);
    console.error(`wrote ${opts.out}`);
  } else {
    console.log(json);
  }

  const names = Object.keys(data.Score || {}).sort((a, b) => data.Score[b] - data.Score[a]);
  if (names.length) {
    const width = Math.max(...names.map((n) => n.length));
    console.error(`\n${"engine".padEnd(width)}  score  vs fastest`);
    const top = data.Score[names[0]];
    for (const n of names) {
      const ratio = (data.Score[n] / top).toFixed(3);
      console.error(`${n.padEnd(width)}  ${String(data.Score[n]).padStart(6)}  ${ratio}x`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
