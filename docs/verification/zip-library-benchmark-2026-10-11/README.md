# zip.js / client-zip BGA archive experiment — 2026-10-11

This is an isolated comparison, not a production library migration. Production code and dependencies were not changed.

## Fixture and scope

Six real production charts (ZEUS, 天靈靈地靈靈, Xaleid◆scopiX, Ref:rain, 推活天使ビビアンちゃん, 超ナイト・オブ・ナイツ), each with `maidata.txt`, `track.mp3`, `bg.png`, and `pv.mp4`. `fixture.json` records source URLs, lengths and SHA-256 hashes. Total: **318,736,980 bytes / 303.97 MiB**.

Repeat 9 creates 216 entries / 2.672 GiB; repeat 15 creates 360 entries / 4.453 GiB. The same real bytes are repeated under separate `Test N/<song>/<file>` directories. This exercises archive growth and offsets over 4 GiB, not thousands of unique songs, a single file over 4 GiB, or 65,535+ entries. The grouping follows the existing archive directory layout.

Both libraries use STORE (no compression); zip.js uses `level: 0`, workers disabled and unbuffered writes. Input uses disk-backed browser `File` objects from the same local assets. Network fetches, the production download cache, service workers and download history are outside this experiment.

## Measurement

16 GiB macOS host; Chromium 151.0.7922.34 and Playwright WebKit 26.5. Browser tests run sequentially. “Mobile” means a 390×844 touch viewport; this is **not an Android/iOS device**. Chromium's 128 MiB JavaScript heap setting and synthetic memory-pressure notification do not limit total browser memory or emulate a 2 GiB phone.

Final runs sample `ps` RSS asynchronously with a nominal 250 ms cadence. Sum browser descendant processes, plus the test WebKit XPC processes started through launchd. Exclude Node. RSS omits compressed memory, swap and OS filesystem cache; samples can miss brief peaks. This was a shared workstation with existing memory pressure, one run per case. Persistent profiles also retain their default blank tab; that browser overhead is included in baseline and total RSS. Values are observations, not a statistically established performance ranking or a native-device RAM requirement. Ready/release snapshots are also included when deriving maximum observed RSS.

Packing time starts after module loading and output initialization and ends when the output is ready. Download/export time is separate. A fresh Save button click creates the `.adx` download; success requires completed download, exact saved size, and no page error. Release revokes the object URL, clears the file input and removes OPFS output; immediate RSS retention does not prove a leak.

`blob` consumes the stream into a browser Blob. `opfs` streams into browser origin-private storage, then obtains a disk-backed File and exports it through the same Save action. It does **not** test `showSaveFilePicker`, iOS Share/Files UI, browser background termination, or Huawei browser settings. OPFS also consumes disk quota and may require another full-size copy during export.

## Archive compatibility

`verify.py` reads every entry in chunks, checks exact directory/filename sets and lengths, validates ZIP CRC through Python `zipfile`, and compares SHA-256 with the original assets. It also reports ZIP versions, ZIP64 records and central-directory fields.

The independent C# reader uses the official Unity `com.unity.sharp-zip-lib` 1.3.8 DLL (SharpZipLib 1.3.3) and reads every selected entry with SHA-256 comparison. This validates compatibility with that decoder family, **not execution of AstroDX's complete import workflow**.

The official AstroDX 2.2.0.0023 APK includes null-terminated metadata symbols `Unity.SharpZipLib.dll`, `ZipFile`, `UseZip64`, and `InstallLevels`. This does not establish the importer call chain, exact DLL version, memory behavior, chart registration, BGA playback or success on 32-bit devices. No Android device was connected and no representative iOS/Huawei/low-memory device was available. Actual game import remains unverified. The official Android guide (written for v2.0.0 Beta 2 Patch 4 and above) still lists a custom level smaller than 2 GB as a prerequisite; this experiment does not prove that the current game accepts aggregate archives over that size.

zip.js keeps ZIP versions lower for small entries where possible and introduces ZIP64 as offsets require it. client-zip marks all entries as requiring ZIP 4.5, including the small archive. The tested Unity decoder reads both. The APK evidence alone does not certify either library's native import.

## Reproduce

Copy this directory to a scratch directory; do not check large assets or archives into Git. Requires Python 3.12+, curl, Node, Playwright and installed browser engines.

```sh
python3 setup.py
python3 fetch.py
REGULAR=1 node run.mjs chromium zipjs 15 opfs desktop
REGULAR=1 node run.mjs chromium clientzip 15 opfs desktop
REGULAR=1 node run.mjs chromium zipjs 9 blob mobile
REGULAR=1 node run.mjs chromium clientzip 9 blob mobile
REGULAR=1 node run.mjs webkit zipjs 1 blob mobile
REGULAR=1 node run.mjs webkit clientzip 1 blob mobile
python3 verify.py
```

Optional environment variables: `BENCH_ROOT`, `BENCH_PROXY`, `PLAYWRIGHT_MODULE`, `WEBKIT_EXECUTABLE`, and `WEBKIT_PROCESS_ROOT`. The WebKit process root is inferred from its executable; override `WEBKIT_PROCESS_ROOT` for unusual macOS installations. Packing has a 180-second harness timeout. The runner stops its own browser if observed RSS exceeds 4 GiB; that is a harness safety stop, not proof of a browser crash.

`dependencies.json` pins npm tarballs with verified SHA-512 integrity. For the Unity reader, download the official package below into `unity/`, compile `decoder/decoder.csproj` using .NET 10, and pass a directory containing `fixture.json` and complete `.adx` files. Build output and binaries are intentionally omitted.

Diagnostic incognito runs encountered Blob errors near the 2 GiB range and explicit OPFS quota failures. They are recorded separately; they do not establish a library or normal-browser size ceiling. Interrupted runs, navigation-wait errors, the initial wrong zip.js module entry and the old synchronous/incomplete WebKit RSS sampler are harness errors and excluded from final comparisons.

## Primary references

- [AstroDX releases](https://github.com/2394425147/astrodx/releases)
- [AstroDX Android installation guide](https://wiki.astrodx.com/en/install/android)
- [AstroDX installation logic](https://wiki.astrodx.com/en/install-logic)
- [Unity SharpZipLib wrapper documentation](https://docs.unity.cn/Packages/com.unity.sharp-zip-lib%401.3/manual/index.html)
- [Official Unity package used by the independent reader](https://packages.unity.com/com.unity.sharp-zip-lib/-/com.unity.sharp-zip-lib-1.3.8.tgz)
- [Chromium Blob storage design and quota behavior](https://chromium.googlesource.com/chromium/src/+/HEAD/storage/browser/blob/README.md)
