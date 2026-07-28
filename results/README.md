# Results from our own machines

The JSON files at the repository root (`ubuntu.json`, `windows.json`,
`macos-arm64.json`) come from the GitHub matrix and cover every engine the
setup action can install. These are different: five machines we control,
running only the engines worth comparing against bento, best of three runs.

| File | Machine |
| --- | --- |
| `macos-arm64.json` | MacBook Air, Apple M4, 10 cores, macOS arm64 |
| `windows-x86_64.json` | gamingpc, i9-13900K, 32 cores, Windows x86_64 |
| `linux-server1.json` | server1, AMD EPYC, 4 cores, Ubuntu x86_64 |
| `linux-server2.json` | server2, AMD EPYC, 6 cores, Ubuntu x86_64 |
| `linux-server3.json` | server3, AMD EPYC, 8 cores, Ubuntu x86_64 |

Reproduce with:

    bash scripts/setup.sh                  # pwsh -File scripts/setup.ps1 on Windows
    source scripts/env.sh
    node scripts/bench.mjs --engines bento,v8,bun,node,quickjs --repeat 3 --out results/<machine>.json
    node scripts/table.mjs results/*.json

The three Linux boxes are shared VPS instances and server3 was running an
unrelated job during its pass, so treat absolute scores as machine-specific.
The ratios between engines on one machine are the part worth reading.
