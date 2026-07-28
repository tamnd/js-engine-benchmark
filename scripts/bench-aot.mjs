// Benchmark bento's AOT path against the engines that can run the same source.
//
//   node scripts/bench-aot.mjs --bento-root ~/github/tamnd/bento
//   node scripts/bench-aot.mjs --repeat 3 --out aot-linux.json
//
// bento's AOT compiler takes typed TypeScript, not the ES5 the V8 suite is
// written in, so this runs the ports in ts/ rather than v8-v7/. Each port is the
// same algorithm doing the same work with the same reference time, which keeps
// the scores on the suite's own scale, but it is not the same file, so these
// numbers belong beside scripts/bench.mjs's rather than in the same table.
//
// The comparison engines run the ported TypeScript too: node strips the types
// itself as of v23 and bun has always run TypeScript directly, so all three
// engines see one source. Scores are the V8 benchmark suite's own, higher is
// faster, and the overall Score is their geometric mean the way base.js takes it.

import { execFile, execFileSync } from "child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import os from "os";

import { BENCHES } from "./build-ts.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "ts-dist");

function parseArgs(argv) {
  const opts = { repeat: 1, out: "", timeout: 1800, bentoRoot: process.env.BENTO_MODULE_ROOT || "" };
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].split("=");
    const value = inline ?? argv[++i];
    switch (flag) {
      case "--repeat":
        opts.repeat = Math.max(1, +value | 0);
        break;
      case "--out":
        opts.out = value;
        break;
      case "--timeout":
        opts.timeout = +value;
        break;
      case "--bento-root":
        opts.bentoRoot = value;
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

function run(exe, args, cwd, timeoutSec, env) {
  return new Promise((done) => {
    execFile(
      exe,
      args,
      { cwd, timeout: timeoutSec * 1000, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...env } },
      (err, stdout, stderr) => done({ err, stdout: stdout || "", stderr: stderr || "" }),
    );
  });
}

// Each entry prints one "Name: score" line, the same line base.js prints.
function parseScore(name, stdout, stderr) {
  for (const line of `${stdout}\n${stderr}`.split("\n")) {
    const m = line.match(/^([A-Za-z]+)\s*:\s*(-?[\d.]+)\s*$/);
    if (m && m[1] === name) return Number(m[2]);
  }
  return 0;
}

function geometricMean(numbers) {
  let log = 0;
  for (const n of numbers) log += Math.log(n);
  return Math.pow(Math.E, log / numbers.length);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  execFileSync(process.execPath, [join(root, "scripts", "build-ts.mjs")], { stdio: "inherit" });

  const bento = findOnPath("bento");
  if (!bento) throw new Error("bento is not on PATH");
  const bentoEnv = opts.bentoRoot ? { BENTO_MODULE_ROOT: resolve(opts.bentoRoot) } : {};

  // The ports that exist, compiled ahead of time. A benchmark bento cannot
  // compile is reported and dropped rather than silently missing from the table.
  const ported = [];
  for (const b of BENCHES) {
    const src = join(dist, `${b.file}.ts`);
    if (!existsSync(src)) continue;
    const bin = join(dist, `${b.file}${process.platform === "win32" ? ".exe" : ".bin"}`);
    process.stderr.write(`build ${b.name} ... `);
    const { err, stdout, stderr } = await run(bento, ["build", src, "-o", bin], dist, opts.timeout, bentoEnv);
    if (err || !existsSync(bin)) {
      console.error(`FAILED\n${(stdout + stderr).trim()}`);
      continue;
    }
    console.error("ok");
    ported.push({ ...b, src, bin });
  }

  const engines = [{ name: "bento-aot", exe: "", args: (p) => [] }];
  for (const bin of ["node", "bun"]) {
    const exe = findOnPath(bin);
    if (exe) engines.push({ name: bin, exe, args: (p) => [p.src] });
    else console.error(`skip ${bin}: not on PATH`);
  }

  const data = {};
  const put = (kind, name, value) => {
    (data[kind] ||= {})[name] = value;
  };

  for (const engine of engines) {
    const scores = {};
    for (const p of ported) {
      const exe = engine.exe || p.bin;
      let best = 0;
      for (let i = 0; i < opts.repeat; i++) {
        process.stderr.write(`run ${engine.name} ${p.name} (${i + 1}/${opts.repeat}) ... `);
        const { stdout, stderr } = await run(exe, engine.args(p), dist, opts.timeout);
        const score = parseScore(p.name, stdout, stderr);
        console.error(score || `no score\n${(stdout + stderr).trim()}`);
        if (score > best) best = score;
      }
      if (best) scores[p.name] = best | 0;
    }
    for (const [k, v] of Object.entries(scores)) put(k, engine.name, v);
    const values = Object.values(scores);
    if (values.length) put("Score", engine.name, geometricMean(values) | 0);
    if (engine.exe || existsSync(join(dist, `${ported[0]?.file}.bin`))) {
      const exe = engine.exe || join(dist, `${ported[0].file}.bin`);
      try {
        put("Exe size", engine.name, statSync(exe).size);
      } catch {
        // A binary we cannot stat is one we cannot bill for.
      }
    }
  }

  data.Host = {
    platform: `${os.platform()}-${os.arch()}`,
    cpu: os.cpus()[0]?.model || "",
    cores: os.cpus().length,
    hostname: os.hostname(),
    repeat: opts.repeat,
    ported: ported.map((p) => p.name),
    missing: BENCHES.filter((b) => !ported.some((p) => p.file === b.file)).map((b) => b.name),
  };

  const json = JSON.stringify(data, null, 2);
  if (opts.out) {
    writeFileSync(opts.out, json);
    console.error(`wrote ${opts.out}`);
  } else {
    console.log(json);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
