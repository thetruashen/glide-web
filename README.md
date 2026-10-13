# Glide Web

A compiled Next.js launcher on GitHub Pages, with temporary Minecraft sessions on GitHub Actions. Based on [Glide u2](https://github.com/PierrotTheFreak/Glide-u2-beta).

## Play

Open **https://thetruashen.github.io/glide-web/**. Connect a fine-grained GitHub token scoped to the session repository with **Actions: read and write**. The repository owner must grant each player this access or provision their own scoped token. Tokens are stored only in the current tab's session storage and sent only to GitHub; no shared token is bundled in the site. Never use a full account token in the launcher. Tokens disclosed in chat should be revoked and replaced.

Pick a Minecraft version and a compatible loader, upload `.jar` mods, set memory and resolution, then launch. All official releases, snapshots, alpha and beta entries are included; the catalog refreshes weekly. Availability in the catalog is not a guarantee that every historical release works with today's Linux drivers. Loader compatibility comes from minecraft-launcher-lib's upstream metadata; legacy loaders are not silently mapped to modern loaders.

Microsoft mode uses a registered Microsoft public-client application ID with device-code flow enabled and Xbox/Minecraft access. Enter that application ID in settings, start the session, and follow the Microsoft device-code prompt in the page. The account must own Minecraft Java Edition. No Microsoft password or refresh token is stored in your browser or repository. Application registration and access approval are external prerequisites; a client ID is not supplied by this repository.

Use the stream’s Gaming Mode to capture the mouse and keyboard; its Selkies client provides raw pointer motion. Use Fullscreen or the stream's own fullscreen control. The page requests Escape keyboard lock when supported, allowing a short Escape press for game menus and hold-Escape to leave fullscreen in compatible Chromium browsers. Keyboard lock may require browser permission; other browsers fall back to their normal Escape behavior. [Chrome keyboard lock documentation](https://developer.chrome.com/blog/better-full-screen-mode). If third-party cookies prevent embedding, use Open stream, which authenticates in a separate top-level tab.

## Mods and modpacks

The launcher browses **Modrinth and CurseForge** directly from the browser: search, pagination, descriptions, compatible releases, mod installation and required dependencies. Resource packs and shaders also have dedicated catalog sections. Modrinth needs no key. Enter a CurseForge API key in its catalog tab; it is stored only in tab session storage, sent only to api.curseforge.com, and never bundled in the site or forwarded to GitHub/CDNs.

Install a catalog modpack or import a `.mrpack` / CurseForge manifest `.zip`. The installer verifies provider checksums, downloads required client files, applies overrides (including scripts/defaultconfigs), and commits a **new** browser-local instance only after every file succeeds. It preserves existing worlds. The pack's exact Minecraft and loader versions are retained; pinned loader caches can reuse the normal game cache without invalidating existing prewarms.

CurseForge’s CDN blocks browser downloads. Connect the launcher’s Actions token to enable a temporary authenticated download helper (up to 15 minutes); it receives approved file URLs and sizes, never the CurseForge API key, and is stopped after installation. Modrinth downloads usually run directly in the browser. If a CurseForge file has no permitted download URL, the installer can use an author-published Modrinth file only when SHA-1 and size match exactly. Otherwise it links to the official file page and asks for the downloaded file; its size and hash must match. It never invents restricted download URLs or silently skips required files. Unsupported pack paths, unresolved dependencies, hash failures and packs beyond the 512 MiB transfer / 1 GiB expanded limits stop installation with an explicit error. Very large packs may exceed these limits or hosted-runner resources. Optional pack entries and server-only Modrinth entries are excluded from client installs.

The supplied animated banner is served as a 30-second MP4 loop (about 3.9 MiB), with a still poster and a pause control. It respects reduced-motion and data-saving settings and pauses while off-screen or the tab is hidden.

Catalog references: [Modrinth API](https://docs.modrinth.com/api/), [CurseForge API](https://docs.curseforge.com/rest-api/), [Modrinth pack format](https://support.modrinth.com/en/articles/8802351-modrinth-modpack-format-mrpack).

## Saves and multiple players

Each local profile has separate worlds, settings and mods in IndexedDB. Different browsers and devices do not automatically share them. Export/import a profile ZIP to move devices. Clearing site data erases local saves. The site requests persistent storage, but the browser can decline it.

Every launch creates a browser-generated RSA keypair and a separate Actions runner. The workflow receives only settings and the public key. It publishes the encrypted connection envelope in an Actions step name, which the originating browser decrypts. The private key and runner capability stay in tab session storage, allowing reload recovery. Closing the tab loses connection recovery; your last IndexedDB backup remains. Other players cannot decrypt your connection envelope. Actions credentials still authorize repository-wide Actions administration; they are not per-player isolation credentials.

The browser sends its profile **directly to the runner** over authenticated HTTPS in 8 MiB chunks, below tunnel request-size limits. Personal data never enters repository commits, Actions artifacts or game caches. The runner accepts only approved profile paths and rejects traversal, symlinks and oversized ZIPs. Limits: 512 MiB transfer, 1 GiB expanded archive, 100,000 files. This is an initial limit, not unlimited world storage.

Keep the launcher tab open. It downloads a live snapshot approximately every minute; these live copies may be inconsistent if Minecraft is writing a region file. **Save & stop** terminates Minecraft, waits for its shutdown save, downloads the final snapshot, then cancels the runner. It retains the preceding snapshot in IndexedDB when replacing a backup. Export backups regularly. Forced workflow cancellation, network failure or runner timeout can lose changes since the last snapshot. A runner waits up to 15 minutes for the browser, runs at most 3 hours, and remains available 5 minutes after game exit for a final download. Personal files are removed during cleanup and the hosted runner is destroyed.

## Startup caches

Run **Prewarm Glide caches** from the Actions tab. The default builds all supported loaders for 1.21.1, 1.20.1 and 1.21.4, including NeoForge's expensive installer processors. Other versions warm automatically on first launch, **before** gameplay begins. The same exact cache keys are used by prewarm and play. Only `assets`, `libraries`, `versions` and installer markers are cached, keyed by operating system, architecture, Java version, Minecraft version, loader and installer source hash. Mod files and worlds never enter these caches. Streaming packages and Python dependencies have separate caches.

To prewarm any version, enter its official ID. For catalog-wide batches, choose `versions=all` and an `offset` of 0, 20, 40, etc.; each run builds at most 20 versions, with two jobs at a time. Retaining every version simultaneously is not feasible within typical cache quotas. GitHub evicts caches according to repository limits and inactivity, so a cold cache can recur. No startup time or cache permanence is promised until measured. GitHub runner queueing and desktop package installation remain outside the game cache.

The former graphics bridge compilation, Vulkan probe compilation and repeated apt updates have been removed from the normal session path. Standard hosted runners use native Mesa OpenGL in Xvfb; the Rust graphics sources remain available for development. These runners have no dedicated gaming GPU. Caching improves startup; it cannot create GPU hardware or remove streaming latency.

## Development and deployment

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r Client/requirements.txt
.\.venv\Scripts\python.exe Client/scripts/catalog.py Web/public/versions.json
cd Web
npm ci
npm run dev
```

`npm test`, `npm run typecheck` and `npm run build` verify the catalog, pack installer and web app. Run `python -m unittest discover -s Client/tests` for archive-boundary tests. `Web/out` is the static production export. No server or separately hosted broker is needed.

For another repository, enable Pages with **GitHub Actions** as the source and dispatch **Publish Glide website**. Its build sets the repository name as the Next.js base path and the correct default session repository. Forks can change the repository in Connection; public repositories can host Pages subject to the account's plan. The original standalone server workflow is not part of this browser session product.

Reference: [Next.js static exports](https://nextjs.org/docs/app/guides/static-exports), [GitHub Actions dependency caching](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching), [minecraft-launcher-lib mod loader API](https://minecraft-launcher-lib.readthedocs.io/en/stable/modules/mod_loader.html).

## Hosted launcher

The primary launcher is https://glide-thetruashen.wasmer.app. See [Hosting/README.md](Hosting/README.md) for deployment, private credentials, Microsoft device-code configuration, and portable instance backups. GitHub Pages remains a static fallback and requires tab-local credentials.


### Gameplay boost

Enabled per instance by default; turn it off in Play settings to compare or troubleshoot. No mods are installed automatically. Players manage their own mods through the existing catalog and instance content pages.

JVM settings use balanced G1 without the former forced Java 21 ZGC / 50 ms pause target. The boost streams at 30 FPS and gives the software encoder lower scheduling priority to reserve CPU for game rendering and simulation. Turning it off restores 60 FPS streaming and the JVM default collector. Existing video settings are retained.

The boost caps the physical render surface at 960×540 and prevents browser/fullscreen resizing from increasing it. Fullscreen scales the resulting video. Live snapshots store already-compressed JAR/ZIP/media bytes directly rather than recompressing them, and the backup API runs at lower scheduling priority. Legacy runtime-owned additions remain excluded from snapshots only while their recorded hashes match; user-provided or edited files are preserved.

These measures do not guarantee a frame-rate increase on every pack. CPU-based Mesa rendering still limits large packs. Further changes are proposals in [BACKEND-PERFORMANCE-IDEAS.md](BACKEND-PERFORMANCE-IDEAS.md).
