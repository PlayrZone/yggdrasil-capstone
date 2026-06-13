# Gahalla Release & Auto-Update Pipeline

**Status:** ACTIVE, 2026-06-13. How the desktop app ships and self-updates
while the engine source stays **private**.

## The model: private code, public release feed

The engine repo (`PlayrZone/GahallaGameEngine`) is **private**, so installed
apps can't read its release feed (private GitHub releases need auth a shipped
app can't safely carry). Fix: publish **only the installers + `latest.yml`**
to a small **public** repo, and point the app's updater at that.

- Code → `PlayrZone/GahallaGameEngine` (private).
- Releases → `PlayrZone/gahalla-releases` (public). Configured in
  `desktop/electron-builder.yml` (`publish.repo: gahalla-releases`).
- `electron-updater` in the app reads the public feed on launch
  (autoDownload + autoInstallOnAppQuit) → updates on relaunch.

## One-time setup (manual — only the repo owner can do these)

1. **Create the public repo**: `PlayrZone/gahalla-releases`, visibility
   **Public**, empty (no README needed).
2. **Create a token** with write access to it: a fine-grained PAT scoped to
   `gahalla-releases` with **Contents: Read and write** (or a classic PAT with
   `repo`). Copy it.
3. **Add it as a secret** on the *private* repo: GahallaGameEngine →
   Settings → Secrets and variables → Actions → New repository secret →
   name `RELEASES_TOKEN`, value = the PAT. (The workflow uses it because the
   built-in `GITHUB_TOKEN` can't write to a different repo.)

## Cutting a release (every time — no hand-building)

```powershell
cd desktop ; npm version patch --no-git-tag-version    # bump e.g. 0.8.1 -> 0.8.2
cd .. ; git commit -am "chore(desktop): v0.8.2"
git tag v0.8.2 ; git push ; git push --tags
```

The `Release desktop` workflow (`.github/workflows/release.yml`) builds the
installer on CI and publishes it (installer + `latest.yml` + blockmap) to
`gahalla-releases`. Installed apps pick it up on next launch.

## First run of the loop

Installed `0.8.0` was built pointing at the OLD (private) feed, so it won't
update. Get onto the public channel once:

1. Do the one-time setup above.
2. Cut **v0.8.1** (config now points at `gahalla-releases`).
3. **Install 0.8.1 from the gahalla-releases release** — this install's feed
   is the public repo.
4. From then on, every published release auto-updates on relaunch. (Test it:
   cut v0.8.2 and relaunch 0.8.1.)

## Why "doesn't auto-update after relaunch" happened (2026-06-13)

Two reasons: (1) no release newer than the installed 0.8.0 had been published
(latest public was v0.3.0), and (2) the feed pointed at the private engine
repo, which a shipped app can't read. This doc is the fix for both.
