# t3code-pm

A personal fork of [T3 Code](https://github.com/pingdotgg/t3code) that adds **Project Manager
(PM) threads**. Everything else is upstream T3 Code; the design is in [PM_DESIGN.md](PM_DESIGN.md).

## What the fork adds

- **PM threads.** A PM is an ordinary thread in a project that plans work, starts and briefs
  worker threads, follows them, and reports back. A project can have any number of PMs. It runs a
  port of the Ghostex coordinator playbook (`packages/pm/src/playbook.ts`).
- **Workers report back by themselves.** When a worker finishes, waits for an answer, goes quiet
  for 8 minutes, stops mid-turn, sits idle while owing work, or restarts with the server, the PM
  gets a report message and wakes up. Reports are delivered once, also across restarts.
- **Work items, asks and memory.** Each line of work is `W<n>`, each question `Q<n>`. Asks show in
  a dock above the composer with one-click answers, snooze and dismiss. Memory notes, the mission
  and standing instructions are editable in the thread's details panel.
- **Live pages.** A PM can publish an HTML page (Ghostex's page kit) that opens in a floating
  window over the chat; your answers go back to the PM.
- **One switch.** Settings, Project managers, "Project Managers (t3code-pm)". Off hides every PM
  view, tool and watcher; PM threads show as normal threads and nothing is deleted. On the phone
  it is in Settings, Environments, the environment, "Project managers".
- **Mobile.** PM rows with their counts and workers in the thread list, the dock above the
  composer, the PM sheet (Work, Workers, Goal, Memory) from the header button, Live pages, and New
  PM from the Android home button's long-press or any thread's long-press menu.

The PM's tools (`pm_*`) reach any provider that gets T3's MCP server (Claude, Codex, Cursor,
OpenCode, Pi, Muse and the ACP family). Workers can use any provider.

## Data and compatibility

- The fork's default data folder is **`~/.t3-pm`**, not `~/.t3`, so it never shares state with
  the official app. `T3CODE_HOME` still overrides it.
- PM state lives in `pm_*` tables with their own migration ledger (`pm_migrations`). Upstream
  builds open a fork database and ignore those tables; the fork opens an upstream database and adds
  them. No upstream table is altered.
- Upstream clients (app.t3.codes, the store apps) can talk to a fork server and see PMs as plain
  threads. The orchestration protocol version is unchanged.
- The server never updates itself from npm: npm's `t3` package is upstream and would replace the
  fork.

## Building and running

```sh
vp i
vp run dev                      # server + web, state in this checkout's .t3 when it is a worktree
vp run dist:desktop:dmg:arm64   # unsigned macOS desktop app (right-click, Open the first time)
```

A plain clone shares `~/.t3/dev` in dev mode; isolate it with
`vp run migrate-dev-db --base-dir <clone>/.t3` and `vp run dev --home-dir <clone>/.t3`.
The free `Replay (dev)` provider has a `pm` scenario that drives the real `pm_*` tools.

To try the fork on your real data, quit the official app and copy
`~/.t3/userdata/statev2.sqlite` into `~/.t3-pm/userdata/`.

## Trying the Android app

The fork ships its own APK, **T3 Code PM** (`com.t3codepm.app`). It installs beside the official
T3 Code app, never takes upstream's over-the-air updates, and talks to any T3 server; PM views
show only on a fork server.

1. **Install the APK.** Copy `t3code-pm-<version>.apk` to the phone and open it (allow installs
   from your file manager or browser when Android asks), or `adb install t3code-pm-<version>.apk`.
2. **Set up Tailscale.** Install Tailscale on the computer running the fork server and on the
   phone, and sign both in to the same tailnet.
3. **Start the fork's server where the phone can reach it.** With the desktop app, turn on
   remote access in Settings, Connections. From a checkout, `vp run dev --share` publishes it on
   the tailnet over HTTPS (it needs HTTPS certificates turned on in the tailnet's DNS settings);
   without them, `vp run dev --host 0.0.0.0` serves plain HTTP, which Tailscale still encrypts.
4. **Pair.** In T3 Code PM, Add environment: scan the QR code from Settings, Connections, or enter
   the computer's tailnet address with the port (for example `100.x.y.z:13773`) and a pairing
   code from `node apps/server/src/bin.ts auth pairing create` (or the desktop's Connections). The
   environment appears with its projects; PMs show in the thread list.

T3 Connect does not work in the fork APK. The APK is built without the T3 Connect settings, so
it shows no sign-in. A build with them shows Clerk's sign-in, but Clerk rejects the fork's
redirect (`clerk://com.t3codepm.app.callback` is not an authorized redirect URI for T3's
instance), so only T3's own apps can sign in. Use Tailscale or the local network.

Building the APK yourself needs a JDK 17 and the Android SDK:

```sh
T3CODE_PM_KEYSTORE=~/keys/t3code-pm.keystore \
T3CODE_PM_KEYSTORE_PASSWORD_FILE=~/keys/t3code-pm.password \
scripts/pm-build-apk.sh ~/Downloads
```

Make the keystore once with `keytool -genkeypair -keystore ~/keys/t3code-pm.keystore -alias
t3code-pm -keyalg RSA -keysize 4096 -validity 10000` and keep it: Android only installs updates
signed with the same key. Never commit it.

## Syncing with upstream

```sh
scripts/sync-upstream.sh
```

It fetches upstream's `main` (the `upstream` remote, else `origin`), keeps the old tip as
`pm-before-sync-<date>`, rebases, and then runs the PM tests, the typecheck of the packages PM
touches and both translation checks. On a conflict it lists the files and which of them hold
`t3code-pm:` hunks. Every edit to an upstream file is a one-line mount or call marked
`// t3code-pm:`, so conflicts stay small: keep upstream's change and put the marked line back.
It never pushes.

PM strings live in their own catalogs (`apps/{web,mobile}/src/pm/i18n/translations`), never in upstream's
generated `translations/*.json`. After changing PM copy, run `node scripts/pm-i18n.ts generate`
and translate the new keys by hand; `node scripts/pm-i18n.ts check` is the matching check.

## Switching back to upstream safely

1. In the fork, Settings, Project managers: turn PMs off (optional; it changes nothing on disk).
2. Quit the fork. Install or open the official T3 Code.
3. The official app uses `~/.t3` and never saw the fork's `~/.t3-pm`, so nothing needs undoing.
   If you want your fork threads there, copy `~/.t3-pm/userdata/statev2.sqlite` into
   `~/.t3/userdata/` while both apps are closed. Upstream ignores the `pm_*` tables; PM threads
   open as ordinary threads.
4. To remove the fork's data entirely, delete `~/.t3-pm` once you no longer need it.
