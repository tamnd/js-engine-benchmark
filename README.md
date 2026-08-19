fork from: https://github.com/mozilla/arewefastyet/tree/master/benchmarks/v8-v7


## update

```bash
npm run build

npm run update

npm run update:doc
```

webui: https://ahaoboy.github.io/js-engine-benchmark/


## Engine & Runtime (37/43)

| name | lang | repo | score | platform | description |
| --- | --- | --- | --- | --- | --- |
| v8 | <img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/cplusplus/cplusplus-original.svg" width="20" style="vertical-align: middle;"/> | [v8.dev](https://v8.dev)<br><br>[v8-build](https://github.com/ahaoboy/v8-build) | 48397<br>65M<br>744/M | ✅unix<br>✅macArm<br>✅windows | V8 is Google’s open source high-performance JavaScript and WebAssembly engine |
| JavaScriptCore | <img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/cplusplus/cplusplus-original.svg" width="20" style="vertical-align: middle;"/> | [JavaScriptCore](https://github.com/WebKit/webkit/tree/main/Source/JavaScriptCore)<br><br>[jsc-build](https://github.com/ahaoboy/jsc-build) | 45201<br>33.8M<br>1336/M | ✅unix<br>✅macArm<br>✅windows | JavaScriptCore is the built-in JavaScript engine for WebKit, which implements ECMAScript as in ECMA-262 specification |
| bun | <img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/rust/rust-original.svg" width="20" style="vertical-align: middle;"/> | [bun](https://github.com/oven-sh/bun)<br><br>[setup-bun](https://github.com/oven-sh/setup-bun) | 41483<br>77M<br>539/M | ✅unix<br>✅macArm<br>✅windows | Incredibly fast JavaScript runtime, bundler, test runner, and package manager – all in one |
| deno | <img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/rust/rust-original.svg" width="20" style="vertical-align: middle;"/> | [deno](https://github.com/denoland/deno)<br><br>[setup-deno](https://github.com/denoland/setup-deno) | 40671<br>91.2M<br>446/M | ✅unix<br>✅macArm<br>✅windows | A modern runtime for JavaScript and TypeScript |
| bare | <img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/c/c-original.svg" width="20" style="vertical-align: middle;"/> | [bare](https://github.com/holepunchto/bare)<br><br>[bare-build](https://github.com/ahaoboy/bare-build) | 39283<br>43M<br>914/M | ✅unix<br>✅macArm<br>❌windows | Small and modular JavaScript runtime for desktop and mobile |
| dune | <img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/rust/rust-original.svg" width="20" style="vertical-align: middle;"/> | [dune](https://github.com/aalykiot/dune) | 38777<br>64.5M<br>600/M | ✅unix<br>✅macArm<br>✅windows | JavascriptA hobby runtime for JavaScript and TypeScript |
| lo | <img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/cplusplus/cplusplus-original.svg" width="20" style="vertical-align: middle;"/> | [lo](https://github.com/just-js/lo)<br><br>[lo-build](https://github.com/ahaoboy/lo-build) | 38421<br>40.7M<br>945/M | ✅unix<br>❌macArm<br>❌windows | it's JavaScript Jim, but not as we know it |
| node | <img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/cplusplus/cplusplus-original.svg" width="20" style="vertical-align: middle;"/> | [node](https://github.com/nodejs/node)<br><br>[setup-node](https://github.com/actions/setup-node) | 34884<br>109.4M<br>318/M | ✅unix<br>✅macArm<br>✅windows | Node.js JavaScript runtime |
| ChakraCore | <img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/cplusplus/cplusplus-original.svg" width="20" style="vertical-align: middle;"/> | [ChakraCore](https://github.com/chakra-core/ChakraCore)<br><br>[ChakraCore-build](https://github.com/ahaoboy/ChakraCore-build) | 19550<br>19.3M<br>1012/M | ✅unix<br>❌macArm<br>✅windows | ChakraCore is an open source Javascript engine with a C API |
| spidermonkey | <img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/cplusplus/cplusplus-original.svg" width="20" style="vertical-align: middle;"/> | [spidermonkey.dev](https://spidermonkey.dev)<br><br>[spidermonkey-build](https://github.com/ahaoboy/spidermonkey-build) | 19051<br>40.8M<br>466/M | ✅unix<br>✅macArm<br>✅windows | SpiderMonkey is Mozilla’s JavaScript and WebAssembly Engine, used in Firefox |
| mozjs | <img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/rust/rust-original.svg" width="20" style="vertical-align: middle;"/> | [mozjs](https://github.com/servo/mozjs)<br><br>[mozjs-cli](https://github.com/ahaoboy/mozjs-cli) | 17106<br>33.2M<br>515/M | ✅unix<br>✅macArm<br>❌windows | Rust bindings to SpiderMonkey |
| spiderfire | <img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/rust/rust-original.svg" width="20" style="vertical-align: middle;"/> | [spiderfire](https://github.com/Redfire75369/spiderfire)<br><br>[spiderfire-build](https://github.com/ahaoboy/spiderfire-build) | 16905<br>44.7M<br>378/M | ✅unix<br>✅macArm<br>✅windows | JavaScript Runtime built with Mozilla's SpiderMonkey Engine |
| graaljs | <img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/cplusplus/cplusplus-original.svg" width="20" style="vertical-align: middle;"/> | [graaljs](https://github.com/oracle/graaljs) | 9783<br>179.3M<br>54/M | ✅unix<br>✅macArm<br>✅windows | A ECMAScript 2023 compliant JavaScript implementation built on GraalVM. With polyglot language interoperability support. Running Node.js applications! |
| jjs | <img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/java/java-original.svg" width="20" style="vertical-align: middle;"/> | [nashorn](https://github.com/openjdk/nashorn) | 2613<br>0<br>0/M | ✅unix<br>✅macArm<br>❌windows | Nashorn engine is an open source implementation of the ECMAScript Edition 5.1 Language Specification |
| hermes | <img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/cplusplus/cplusplus-original.svg" width="20" style="vertical-align: middle;"/> | [hermes](https://github.com/facebook/hermes) | 1579<br>36M<br>43/M | ✅unix<br>✅macArm<br>✅windows | A JavaScript engine optimized for running React Native |
| quickjs | <img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/c/c-original.svg" width="20" style="vertical-align: middle;"/> | [quickjs](https://github.com/bellard/quickjs)<br><br>[quickjs-build](https://github.com/ahaoboy/quickjs-build) | 1186<br>1M<br>1160/M | ✅unix<br>✅macArm<br>✅windows | QuickJS is a small and embeddable Javascript engine. It supports the ES2023 specification including modules, asynchronous generators, proxies and BigInt. |
| llrt | <img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/rust/rust-original.svg" width="20" style="vertical-align: middle;"/> | [llrt](https://github.com/awslabs/llrt) | 922<br>14.2M<br>65/M | ✅unix<br>✅macArm<br>✅windows | LLRT (Low Latency Runtime) is a lightweight JavaScript runtime |
| txiki.js | <img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/c/c-original.svg" width="20" style="vertical-align: middle;"/> | [txiki.js](https://github.com/saghul/txiki.js)<br><br>[txiki.js-build](https://github.com/ahaoboy/txiki.js-build) | 827<br>4.1M<br>203/M | ✅unix<br>✅macArm<br>✅windows | A tiny JavaScript runtime |
| rquickjs | <img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/rust/rust-original.svg" width="20" style="vertical-align: middle;"/> | [rquickjs](https://github.com/DelSkayn/rquickjs)<br><br>[rquickjs-cli](https://github.com/ahaoboy/rquickjs-cli) | 789<br>1.5M<br>525/M | ✅unix<br>✅macArm<br>✅windows | High level bindings to the quickjs javascript engine |
| njs | <img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/c/c-original.svg" width="20" style="vertical-align: middle;"/> | [njs](https://github.com/nginx/njs)<br><br>[njs-build](https://github.com/ahaoboy/njs-build) | 717<br>1.9M<br>384/M | ✅unix<br>✅macArm<br>❌windows | A subset of JavaScript language to use in nginx |
| primjs | <img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/cplusplus/cplusplus-original.svg" width="20" style="vertical-align: middle;"/> | [primjs](https://github.com/lynx-family/primjs)<br><br>[primjs-build](https://github.com/ahaoboy/primjs-build) | 715<br>831.3K<br>880/M | ✅unix<br>✅macArm<br>❌windows | JavaScript Engine Optimized for Lynx |
| ladybird | <img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/cplusplus/cplusplus-original.svg" width="20" style="vertical-align: middle;"/> | [ladybird](https://github.com/LadybirdBrowser/ladybird)<br><br>[ladybird-js-build](https://github.com/ahaoboy/ladybird-js-build) | 702<br>43.8M<br>16/M | ✅unix<br>✅macArm<br>❌windows | Truly independent web browser |
| quickjs-ng | <img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/c/c-original.svg" width="20" style="vertical-align: middle;"/> | [quickjs](https://github.com/quickjs-ng/quickjs) | 624<br>1.8M<br>350/M | ✅unix<br>✅macArm<br>✅windows | QuickJS, the Next Generation: a mighty JavaScript engine |
| duktape | <img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/c/c-original.svg" width="20" style="vertical-align: middle;"/> | [duktape](https://github.com/svaarala/duktape)<br><br>[duktape-build](https://github.com/ahaoboy/duktape-build) | 537<br>370.4K<br>1484/M | ✅unix<br>✅macArm<br>✅windows | embeddable Javascript engine with a focus on portability and compact footprint |
| quickjs-emscripten | <img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/typescript/typescript-original.svg" width="20" style="vertical-align: middle;"/> | [quickjs-emscripten](https://github.com/justjake/quickjs-emscripten)<br><br>[quickjs-emscripten-cli](https://github.com/ahaoboy/quickjs-emscripten-cli) | 522<br>0<br>0/M | ✅unix<br>✅macArm<br>✅windows | Safely execute untrusted Javascript in your Javascript, and execute synchronous code that uses async functions |
| lumen | <img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/rust/rust-original.svg" width="20" style="vertical-align: middle;"/> | [lumen](https://github.com/lucid-softworks/lumen) | 460<br>10.9M<br>42/M | ✅unix<br>✅macArm<br>❌windows | A from-scratch JavaScript engine in Rust — std only, zero deps, 100% test262 (53,376/53,376) |
| mujs-one | <img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/rust/rust-original.svg" width="20" style="vertical-align: middle;"/> | [mujs-one](https://github.com/ahaoboy/mujs-one) | 396<br>685K<br>591/M | ✅unix<br>❌macArm<br>❌windows | mujs by c2rust |
| mujs | <img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/c/c-original.svg" width="20" style="vertical-align: middle;"/> | [mujs](https://github.com/ccxvii/mujs)<br><br>[mujs-build](https://github.com/ahaoboy/mujs-build) | 368<br>378.8K<br>994/M | ✅unix<br>✅macArm<br>✅windows | An embeddable Javascript interpreter in C |
| kiesel | <img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/zig/zig-original.svg" width="20" style="vertical-align: middle;"/> | [kiesel](https://codeberg.org/kiesel-js/kiesel)<br><br>[kiesel-build](https://github.com/ahaoboy/kiesel-build) | 348<br>13.5M<br>25/M | ✅unix<br>✅macArm<br>✅windows | A JavaScript engine written in Zig https://kiesel.dev |
| paserati | <img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/go/go-original.svg" width="20" style="vertical-align: middle;"/> | [paserati](https://github.com/nooga/paserati) | 323<br>13.7M<br>23/M | ✅unix<br>✅macArm<br>✅windows | TypeScript runtime implementation written in Go. **cough** |
| ringo | <img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/java/java-original.svg" width="20" style="vertical-align: middle;"/> | [ringojs](https://github.com/ringo/ringojs) | 301<br>0<br>0/M | ✅unix<br>✅macArm<br>❌windows | RingoJS is a JavaScript platform built on the JVM and optimized for server-side applications |
| goja | <img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/go/go-original.svg" width="20" style="vertical-align: middle;"/> | [goja](https://github.com/dop251/goja)<br><br>[goja-build](https://github.com/ahaoboy/goja-build) | 292<br>13.2M<br>22/M | ✅unix<br>✅macArm<br>✅windows | ECMAScript/JavaScript engine in pure Go |
| es5 | <img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/rust/rust-original.svg" width="20" style="vertical-align: middle;"/> | [es5](https://github.com/ahaoboy/es5) | 247<br>2.4M<br>102/M | ✅unix<br>✅macArm<br>✅windows | A ES5 JavaScript engine written in Rust |
| xst | <img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/c/c-original.svg" width="20" style="vertical-align: middle;"/> | [moddable](https://github.com/Moddable-OpenSource/moddable) | 244<br>2M<br>120/M | ✅unix<br>✅macArm<br>❌windows | Tools for developers to create truly open IoT products using standard JavaScript on low cost microcontrollers |
| bento | <img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/go/go-original.svg" width="20" style="vertical-align: middle;"/> | [bento](https://github.com/tamnd/bento) | 205<br>52.6M<br>3/M | ✅unix<br>✅macArm<br>✅windows | A TypeScript runtime built in Go, a Bun alternative. Pure Go with zero cgo, so it ships as one static binary that cross-compiles everywhere |
| jint | <img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/csharp/csharp-original.svg" width="20" style="vertical-align: middle;"/> | [jint](https://github.com/sebastienros/jint)<br><br>[jint-cli](https://github.com/ahaoboy/jint-cli) | 193<br>69M<br>2/M | ✅unix<br>✅macArm<br>✅windows | Javascript Interpreter for .NET |
| boa | <img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/rust/rust-original.svg" width="20" style="vertical-align: middle;"/> | [boa](https://github.com/boa-dev/boa) | 171<br>25.3M<br>6/M | ✅unix<br>✅macArm<br>✅windows | Boa is an embeddable and experimental Javascript engine written in Rust. Currently, it has support for some of the language. |
| JerryScript | <img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/c/c-original.svg" width="20" style="vertical-align: middle;"/> | [jerryscript](https://github.com/jerryscript-project/jerryscript)<br><br>[jerryscript-build](https://github.com/ahaoboy/jerryscript-build) | 0<br>454.2K<br>0/M | ❌unix<br>❌macArm<br>❌windows | Ultra-lightweight JavaScript engine for the Internet of Things |
| nova | <img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/rust/rust-original.svg" width="20" style="vertical-align: middle;"/> | [nova](https://github.com/trynova/nova) | 0<br>0<br>0/M | ❌unix<br>❌macArm<br>❌windows | Nova is a JavaScript and WebAssembly engine written in Rust |
| engine262 | <img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/javascript/javascript-original.svg" width="20" style="vertical-align: middle;"/> | [engine262](https://github.com/engine262/engine262) | 0<br>0<br>0/M | ❌unix<br>❌macArm<br>❌windows | An implementation of ECMA-262 in JavaScript |
| rhino | <img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/java/java-original.svg" width="20" style="vertical-align: middle;"/> | [rhino](https://github.com/mozilla/rhino)<br><br>[rhino-cli](https://github.com/ahaoboy/rhino-cli) | 0<br>0<br>0/M | ❌unix<br>❌macArm<br>❌windows | Rhino is an open-source implementation of JavaScript written entirely in Java |
| hako | <img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/c/c-original.svg" width="20" style="vertical-align: middle;"/> | [hako](https://github.com/andrewmd5/hako)<br><br>[hako-cli](https://github.com/andrewmd5/hako-cli) | 0<br>0<br>0/M | ❌unix<br>❌macArm<br>❌windows | An embeddable, lightweight, secure, high-performance JavaScript engine |
| ant | <img src="https://cdn.jsdelivr.net/gh/devicons/devicon/icons/c/c-original.svg" width="20" style="vertical-align: middle;"/> | [ant](https://github.com/theMackabu/ant) | 0<br>11.3K<br>0/M | ❌unix<br>❌macArm<br>❌windows | javascript for 🐜's, a tiny runtime with big ambitions |

## bench
8/19/2026, 1:33:45 AM

### ubuntu
| Engine | v8 | JavaScriptCore | bun | deno | bare | dune | lo | node | ChakraCore | spidermonkey | mozjs | spiderfire | graaljs | jjs | hermes | quickjs | llrt | txiki.js | rquickjs | njs | primjs | ladybird | quickjs-ng | duktape | quickjs-emscripten | lumen | mujs-one | mujs | xst | JerryScript | kiesel | paserati | ringo | goja | es5 | bento | jint | boa | ant |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Version | 15.3.0 |  | 1.4.0 | 2.9.5 |  | 0.11.3 |  | 26.7.0 | 1.13.0.0.beta | 147.0 |  |  | 25.2.4 |  | 0.12.0 | 2026.06.04 | 0.8.0.beta | 24.12.0 |  | 0.9.2 |  |  | 0.16.1 | 2.99.99 |  | 0.1.3.562a007 |  | 1.3.8 | 17.9.1 | 3.0.0 | 0.4.0.dev | 0.9.10 | 4.0.0 |  | 0.1.1 6593acf |  |  | 0.21.1 | ant.[options] [target [target2 [target3] ...]]
Options: 
  .help, .h              print this message and exit
  .projecthelp, .p       print project help information and exit
  .version               print the version information and exit
  .diagnostics           print information that might be helpful to
                         diagnose or report problems and exit
  .quiet, .q             be extra quiet
  .silent, .S            print nothing but task outputs and build failures
  .verbose, .v           be extra verbose
  .debug, .d             print debugging information
  .emacs, .e             produce logging information without adornments
  .lib <path>            specifies a path to search for jars and classes
  .logfile <file>        use given file for log
    .l     <file>                ''
  .logger <classname>    the class which is to perform logging
  .listener <classname>  add an instance of class as a project listener
  .noinput               do not allow interactive input
  .buildfile <file>      use given buildfile
    .file    <file>              ''
    .f       <file>              ''
  .D<property>=<value>   use value for given property
  .keep.going, .k        execute all targets that do not depend
                         on failed target(s)
  .propertyfile <name>   load all properties from file with .D
                         properties taking precedence
  .inputhandler <class>  the class which will handle input requests
  .find <file>           (s)earch for buildfile towards the root of
    .s  <file>           the filesystem and use it
  .nice  number          A niceness value for the main thread:
                         1 (lowest) to 10 (highest); 5 is the default
  .nouserlib             Run ant without using the jar files from
                         ${user.home}/.ant/lib
  .noclasspath           Run ant without using CLASSPATH
  .autoproxy             Java1.5+: use the OS proxy settings
  .main <class>          override Ant's normal entry point |
| Total size | 65M | 33.8M | 77M | 91.2M | 43M | 64.5M | 40.7M | 109.4M | 19.3M | 40.8M | 33.2M | 44.7M | 179.3M | 0 | 36M | 1M | 14.2M | 4.1M | 1.5M | 1.9M | 831.3K | 43.8M | 1.8M | 370.4K | 0 | 10.9M | 685K | 378.8K | 2M | 454.2K | 13.5M | 13.7M | 0 | 13.2M | 2.4M | 52.6M | 69M | 25.3M | 11.3K |
| Exe size | 907.7K | 33.8M | 77M | 91.2M | 43M | 64.5M | 40.7M | 109.4M | 472.2K | 40.8M | 33.2M | 44.7M | 764.2K | 0 | 36M | 1M | 14.2M | 4.1M | 1.5M | 1.9M | 831.3K | 43.8M | 1.8M | 370.4K | 0 | 10.9M | 685K | 378.8K | 2M | 454.2K | 13.5M | 13.7M | 0 | 13.2M | 2.4M | 52.6M | 69M | 25.3M | 11.3K |
| Dll size | 64.1M | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 18.8M | 0 | 0 | 0 | 178.6M | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Richards | 38296 | 41992 | 41872 | 35433 | 32368 | 34289 | 32983 | 33449 | 23702 | 14287 | 13362 | 13651 | 38511 | 14982 | 1119 | 852 | 686 | 710 | 592 | 544 | 578 | 607 | 357 | 313 | 401 | 279 | 266 | 241 | 79 | 302 | 230 | 169 | 127 | 220 | 148 | 134 | 113 | 115 |  |
| DeltaBlue | 103362 | 57113 | 52888 | 72955 | 71414 | 76227 | 71778 | 71791 | 24727 | 13349 | 12668 | 12543 | 33350 | 343 | 1038 | 747 | 650 | 676 | 572 | 529 | 587 | 524 | 390 | 356 | 406 | 348 | 359 | 306 | 148 | 309 | 189 | 235 | 191 | 266 | 188 | 166 | 128 | 122 |  |
| Crypto | 38646 | 47653 | 46999 | 37724 | 36127 | 37706 | 36114 | 36699 | 30794 | 19337 | 19427 | 17144 | 26315 | 9392 | 1283 | 809 | 666 | 572 | 606 | 851 | 482 | 1099 | 474 | 773 | 420 | 261 | 203 | 188 | 311 | 307 | 247 | 138 | 144 | 130 | 123 | 95 | 100 | 105 |  |
| RayTrace | 120988 | 123652 | 96791 | 78217 | 75035 | 77107 | 68819 | 76071 | 35075 | 29467 | 26956 | 26714 | 1613 | 1519 | 1885 | 1662 | 1290 | 1178 | 1208 | 664 | 969 | 865 | 872 | 691 | 503 | 1318 | 546 | 473 | 473 | 356 | 314 | 367 | 505 | 292 | 235 | 249 | 264 | 268 |  |
| EarleyBoyer | 93633 | 70645 | 50158 | 75679 | 71349 | 74954 | 75439 | 74710 | 7419 | 40207 | 37188 | 36109 | 28948 | 1273 | 3494 | 2074 | 1842 | 1745 | 1366 | 1617 | 1336 | 1232 | 1293 | 609 | 933 | 568 | 505 | 457 | 291 |  | 431 | 589 | 575 | 535 | 368 | 387 | 299 | 335 |  |
| RegExp | 11772 | 14064 | 14670 | 10739 | 10294 | 10365 | 8919 | 10313 | 7509 | 8546 | 8784 | 8620 | 921 | 579 | 577 | 406 | 276 | 228 | 226 | 111 | 230 | 68 | 268 | 147 | 179 | 178 | 194 | 201 | 90 |  | 179 | 403 | 447 | 216 | 304 | 99 | 257 | 50 |  |
| Splay | 41373 | 35359 | 33778 | 33697 | 34454 | 24162 | 33811 | 11808 | 18060 | 22011 | 12134 | 12965 | 2069 | 2866 | 3683 | 3281 | 2361 | 1793 | 2025 | 1901 | 1640 | 1224 | 2265 | 1370 | 1360 | 1446 | 1157 | 1144 | 318 |  | 1133 | 1080 | 917 | 984 | 569 | 765 | 394 | 462 |  |
| NavierStokes | 35657 | 35101 | 35022 | 35841 | 35764 | 35841 | 35474 | 35953 | 33505 | 21116 | 20862 | 21074 | 27899 | 14042 | 1852 | 1654 | 1136 | 946 | 970 | 1256 | 855 | 1886 | 509 | 947 | 705 | 411 | 507 | 490 | 868 |  | 730 | 230 | 160 | 208 | 275 | 196 | 167 | 243 |  |
| Score | 48397 | 45201 | 41483 | 40671 | 39283 | 38777 | 38421 | 34884 | 19550 | 19051 | 17106 | 16905 | 9783 | 2613 | 1579 | 1186 | 922 | 827 | 789 | 717 | 715 | 702 | 624 | 537 | 522 | 460 | 396 | 368 | 244 |  | 348 | 323 | 301 | 292 | 247 | 205 | 193 | 171 |  |
| Score/MB | 744 | 1336 | 539 | 446 | 914 | 600 | 945 | 318 | 1012 | 466 | 515 | 378 | 54 |  | 43 | 1160 | 65 | 203 | 525 | 384 | 880 | 16 | 350 | 1484 |  | 42 | 591 | 994 | 120 |  | 25 | 23 |  | 22 | 102 | 3 | 2 | 6 |  |
| Time(s) | 20 | 20 | 20 | 20 | 20 | 20 | 20 | 20 | 21 | 20 | 20 | 20 | 25 | 41 | 32 | 38 | 44 | 49 | 51 | 63 | 54 | 77 | 56 | 66 | 62 | 74 | 80 | 86 | 139 | 31 | 85 | 96 | 104 | 108 | 134 | 145 | 139 | 175 |  |
### macos-arm64
| Engine | JavaScriptCore | v8 | dune | deno | bare | node | bun | mozjs | spiderfire | spidermonkey | graaljs | lumen | jjs | quickjs | quickjs-ng | hermes | txiki.js | primjs | ladybird | llrt | rquickjs | njs | duktape | kiesel | quickjs-emscripten | mujs | paserati | xst | JerryScript | goja | ringo | es5 | bento | jint | boa | ant |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Version |  | 15.3.79 | 0.11.3 | 2.9.5 |  | 26.7.0 | 1.4.0 |  |  | 147.0 | 25.2.4 | 0.1.3.562a007 |  | 2026.06.04 | 0.16.1 | 0.12.0 | 24.12.0 |  |  | 0.8.0.beta |  | 0.9.2 | 2.99.99 | 0.4.0.dev |  | 1.3.8 | 0.9.10 | 17.9.1 | 3.0.0 |  | 4.0.0 | 0.1.1 6593acf |  |  | 0.21.1 | ant.[options] [target [target2 [target3] ...]]
Options: 
  .help, .h              print this message and exit
  .projecthelp, .p       print project help information and exit
  .version               print the version information and exit
  .diagnostics           print information that might be helpful to
                         diagnose or report problems and exit
  .quiet, .q             be extra quiet
  .silent, .S            print nothing but task outputs and build failures
  .verbose, .v           be extra verbose
  .debug, .d             print debugging information
  .emacs, .e             produce logging information without adornments
  .lib <path>            specifies a path to search for jars and classes
  .logfile <file>        use given file for log
    .l     <file>                ''
  .logger <classname>    the class which is to perform logging
  .listener <classname>  add an instance of class as a project listener
  .noinput               do not allow interactive input
  .buildfile <file>      use given buildfile
    .file    <file>              ''
    .f       <file>              ''
  .D<property>=<value>   use value for given property
  .keep.going, .k        execute all targets that do not depend
                         on failed target(s)
  .propertyfile <name>   load all properties from file with .D
                         properties taking precedence
  .inputhandler <class>  the class which will handle input requests
  .find <file>           (s)earch for buildfile towards the root of
    .s  <file>           the filesystem and use it
  .nice  number          A niceness value for the main thread:
                         1 (lowest) to 10 (highest); 5 is the default
  .nouserlib             Run ant without using the jar files from
                         ${user.home}/.ant/lib
  .noclasspath           Run ant without using CLASSPATH
  .autoproxy             Java1.5+: use the OS proxy settings
  .main <class>          override Ant's normal entry point |
| Total size | 79.2M | 28.6M | 56.5M | 77.1M | 32.8M | 100.6M | 61.2M | 29.8M | 40M | 134.9M | 174.5M | 7.9M | 0 | 950.3K | 1.1M | 13.9M | 3.4M | 1.5M | 40.2M | 11.8M | 1.3M | 2M | 431.4K | 12.5M | 0 | 395.5K | 12.9M | 1.5M | 482.8K | 12.7M | 0 | 2M | 50.8M | 75.4M | 22.4M | 0.2K |
| Exe size | 737.1K | 28.6M | 56.5M | 77.1M | 32.8M | 100.6M | 61.2M | 29.8M | 40M | 67.5M | 92.2K | 7.9M | 0 | 950.3K | 1.1M | 7M | 3.4M | 1.5M | 40.2M | 11.8M | 1.3M | 1.5M | 431.4K | 12.5M | 0 | 395.5K | 12.9M | 1.5M | 482.8K | 12.7M | 0 | 2M | 50.8M | 75.4M | 22.4M | 0.2K |
| Dll size | 78.5M | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 67.5M | 174.4M | 0 | 0 | 0 | 0 | 7M | 0 | 0 | 0 | 0 | 0 | 560.1K | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Richards | 45494 | 41709 | 58428 | 50139 | 38564 | 43605 | 27002 | 14040 | 13838 | 12511 | 24122 | 14576 | 18827 | 1197 | 999 | 998 | 1011 | 1011 | 918 | 786 | 863 | 684 | 443 | 397 | 434 | 325 | 256 | 99 | 178 | 307 | 199 | 190 | 200 | 164 | 142 |  |
| DeltaBlue | 71156 | 124236 | 100956 | 86119 | 94787 | 59189 | 42898 | 16404 | 14024 | 15346 | 8311 | 1753 | 829 | 1202 | 958 | 730 | 969 | 1123 | 879 | 839 | 818 | 712 | 562 | 311 | 419 | 415 | 343 | 187 | 162 | 310 | 240 | 247 | 203 | 179 | 169 |  |
| Crypto | 62242 | 60569 | 54128 | 47074 | 52185 | 34318 | 47880 | 24451 | 18566 | 22608 | 16473 | 14116 | 12945 | 1230 | 998 | 1013 | 1051 | 1426 | 1245 | 545 | 620 | 1038 | 1001 | 422 | 369 | 239 | 190 | 375 | 173 | 176 | 140 | 173 | 159 | 149 | 134 |  |
| RayTrace | 157544 | 154584 | 98493 | 74739 | 76145 | 59199 | 93367 | 48495 | 36259 | 36075 | 4340 | 2467 | 4663 | 2708 | 2471 | 1775 | 1894 | 1349 | 1470 | 1531 | 1287 | 947 | 800 | 578 | 503 | 790 | 539 | 578 | 276 | 431 | 759 | 355 | 269 | 366 | 386 |  |
| EarleyBoyer | 91008 | 97991 | 99151 | 83835 | 79634 | 60384 | 26724 | 46174 | 41804 | 34058 | 35648 | 1923 | 1065 | 3275 | 2609 | 3667 | 2603 | 2269 | 2360 | 2067 | 1999 | 2596 | 978 | 771 | 892 | 873 | 894 | 359 |  | 753 | 682 | 429 | 456 | 404 | 474 |  |
| RegExp | 27911 | 13170 | 13896 | 11784 | 12547 | 9961 | 6358 | 11819 | 10393 | 8538 | 1202 | 942 | 742 | 482 | 319 | 538 | 259 | 168 | 93 | 243 | 245 | 195 | 212 | 246 | 224 | 288 | 529 | 300 |  | 266 | 546 | 446 | 113 | 213 | 76 |  |
| Splay | 43508 | 48764 | 44665 | 39654 | 30690 | 27837 | 23943 | 19370 | 16029 | 18287 | 1284 | 4621 | 1964 | 5259 | 3168 | 3504 | 2968 | 540 | 2303 | 3602 | 2849 | 1000 | 1799 | 1797 | 1885 | 1083 | 1649 | 512 |  | 1307 | 1017 | 741 | 1038 | 610 | 689 |  |
| NavierStokes | 31515 | 31429 | 37618 | 31959 | 29028 | 33586 | 26982 | 19886 | 16792 | 18253 | 16931 | 21073 | 18809 | 2279 | 1868 | 1189 | 1879 | 3330 | 1853 | 1031 | 1060 | 1740 | 1308 | 1201 | 865 | 582 | 328 | 809 |  | 301 | 199 | 342 | 254 | 208 | 345 |  |
| Score | 56944 | 55945 | 54047 | 45698 | 43546 | 36200 | 29467 | 22124 | 18750 | 18738 | 7775 | 4462 | 3589 | 1756 | 1359 | 1346 | 1283 | 1052 | 1041 | 1003 | 978 | 898 | 747 | 577 | 569 | 502 | 468 | 340 |  | 393 | 374 | 329 | 264 | 254 | 239 |  |
| Score/MB | 718 | 1955 | 956 | 592 | 1327 | 360 | 481 | 743 | 468 | 138 | 44 | 566 |  | 1892 | 1186 | 96 | 382 | 698 | 25 | 84 | 757 | 445 | 1773 | 46 |  | 1299 | 36 | 221 |  | 30 |  | 162 | 5 | 3 | 10 |  |
| Time(s) | 20 | 20 | 20 | 20 | 20 | 20 | 20 | 20 | 20 | 20 | 24 | 24 | 35 | 31 | 37 | 34 | 40 | 48 | 60 | 47 | 46 | 51 | 50 | 57 | 62 | 63 | 74 | 100 | 42 | 84 | 91 | 143 | 116 | 113 | 127 |  |
### windows
| Engine | v8 | JavaScriptCore | deno | dune | bun | node | ChakraCore | spidermonkey | spiderfire | graaljs | quickjs | hermes | quickjs-ng | rquickjs | llrt | quickjs-emscripten | duktape | mujs | paserati | txiki.js | xst | kiesel | es5 | goja | bento | jint | boa | ant |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Version | 15.3.79 |  | 2.9.5 | 0.11.3 | 1.4.0 | 26.7.0 | 1.11.24.0 | 147.0 |  | 25.2.4 | 2026.06.04 | 0.12.0 | 0.16.1 |  | 0.8.0.beta |  | 2.7.0 | 1.3.8 | 0.9.10 | 24.12.0 |  | 0.4.0.dev | 0.1.1 6593acf |  |  |  | 0.21.1 | 14.0.ff84a70d.0 |
| Total size | 64.7M | 125.6M | 123.6M | 94.6M | 112.3M | 133.6M | 15.6M | 54.8M | 77.3M | 188.3M | 8.9M | 89.7M | 13.2M | 9.2M | 45.6M | 0 | 8.1M | 8.2M | 21M | 41.4M | 6.5M | 28M | 15.4M | 20.5M | 60.4M | 99.1M | 51.1M | 47.9M |
| Exe size | 32.4M | 344.5K | 92.8M | 61.5M | 84.8M | 98.4M | 334K | 34.8M | 42.6M | 378.5K | 1.1M | 3M | 1.6M | 1.4M | 14.6M | 0 | 329.5K | 400.5K | 13.9M | 4.1M | 1.3M | 19.6M | 2.4M | 13.3M | 53.2M | 68.8M | 26.4M | 12.4M |
| Dll size | 32.4M | 125.2M | 30.9M | 33.1M | 27.5M | 35.3M | 15.3M | 20M | 34.7M | 187.9M | 7.9M | 86.7M | 11.6M | 7.8M | 31M | 0 | 7.8M | 7.8M | 7.1M | 37.3M | 5.2M | 8.4M | 13M | 7.1M | 7.1M | 30.3M | 24.6M | 35.4M |
| Richards | 40795 | 33809 | 41222 | 41353 | 34945 | 37773 | 24111 | 12702 | 13570 | 38154 | 770 | 660 | 466 | 558 | 379 | 384 | 204 | 233 | 140 | 440 |  | 190 | 149 | 180 | 161 | 101 | 105 | 776 |
| DeltaBlue | 102476 | 47982 | 79156 | 78912 | 41826 | 68677 | 27882 | 13574 | 12417 | 24182 | 650 | 608 | 471 | 500 | 363 | 406 | 249 | 334 | 189 | 278 |  | 159 | 193 | 229 | 159 | 112 | 106 | 1486 |
| Crypto | 42107 | 48250 | 39559 | 38993 | 44479 | 37664 | 32676 | 19604 | 17566 | 19090 | 866 | 773 | 454 | 455 | 417 | 423 | 308 | 173 | 127 | 413 |  | 219 | 117 | 113 | 142 | 90 | 101 |  |
| RayTrace | 116252 | 105004 | 73629 | 73851 | 70303 | 69781 | 49727 | 28461 | 25086 | 1366 | 1418 | 942 | 1132 | 766 | 610 | 468 | 446 | 465 | 319 | 142 |  | 262 | 244 | 223 | 252 | 256 | 242 | 797 |
| EarleyBoyer | 81158 | 60372 | 71435 | 73224 | 35544 | 71677 | 42266 | 40316 | 36232 | 30008 | 1752 | 2206 | 1286 | 1029 | 993 | 906 | 513 | 579 | 545 | 298 |  | 388 | 308 | 446 | 403 | 288 | 289 | 1932 |
| RegExp | 10515 | 18892 | 9971 | 9971 | 12365 | 9770 | 9709 | 9010 | 8719 | 918 | 306 | 406 | 298 | 176 | 197 | 181 | 106 | 196 | 377 | 62 |  | 157 | 313 | 194 | 97 | 270 | 47 | 367 |
| Splay | 41780 | 34746 | 31570 | 26150 | 34542 | 13365 | 20308 | 23559 | 13609 | 2183 | 2833 | 2312 | 2310 | 1326 | 1369 | 1324 | 991 | 655 | 1116 | 281 |  | 1021 | 670 | 711 | 870 | 398 | 401 | 2282 |
| NavierStokes | 38584 | 33390 | 38287 | 38584 | 39029 | 35022 | 36249 | 21771 | 21876 | 28436 | 1951 | 1070 | 1061 | 668 | 689 | 750 | 1047 | 452 | 214 | 731 |  | 681 | 282 | 188 | 282 | 148 | 240 | 847 |
| Score | 47994 | 42614 | 41125 | 40275 | 35816 | 34967 | 27530 | 19128 | 17002 | 8948 | 1078 | 947 | 755 | 594 | 532 | 516 | 375 | 347 | 292 | 269 |  | 304 | 249 | 243 | 234 | 182 | 157 |  |
| Score/MB | 741 | 339 | 332 | 425 | 318 | 261 | 1764 | 349 | 220 | 47 | 120 | 10 | 57 | 64 | 11 |  | 46 | 42 | 13 | 6 |  | 10 | 16 | 11 | 3 | 1 | 3 |  |
| Time(s) | 20 | 20 | 20 | 20 | 20 | 20 | 20 | 20 | 20 | 24 | 41 | 42 | 50 | 61 | 61 | 62 | 85 | 86 | 104 | 124 | 130 | 92 | 123 | 125 | 124 | 150 | 185 | 39 |
