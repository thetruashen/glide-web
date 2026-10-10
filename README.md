# Glide Web

A compiled Next.js launcher on GitHub Pages, with temporary Minecraft sessions on GitHub Actions. Based on [Glide u2](https://github.com/PierrotTheFreak/Glide-u2-beta).

## Play

Open **https://thetruashen.github.io/glide-web/**. Connect a fine-grained GitHub token scoped to the session repository with **Actions: read and write**. The repository owner must grant each player this access or provision their own scoped token. Tokens are stored only in the current tab's session storage and sent only to GitHub; no shared token is bundled in the site. Never use a full account token in the launcher. Tokens disclosed in chat should be revoked and replaced.

Pick a Minecraft version and a compatible loader, upload `.jar` mods, set memory and resolution, then launch. All official releases, snapshots, alpha and beta entries are included; the catalog refreshes weekly. Availability in the catalog is not a guarantee that every historical release works with today's Linux drivers. Loader compatibility comes from minecraft-launcher-lib's upstream metadata; legacy loaders are not silently mapped to modern loaders.

Microsoft mode uses a registered Microsoft public-client application ID with device-code flow enabled and Xbox/Minecraft access. Enter that application ID in settings, start the session, and follow the Microsoft device-code prompt in the page. The account must own Minecraft Java Edition. No Microsoft password or refresh token is stored in your browser or repository. Application registration and access approval are external prerequisites; a client ID is not supplied by this repository.

Click the stream to capture the mouse; its Selkies client provides raw pointer motion. Use Fullscreen or the stream's own fullscreen control. Escape behavior belongs to the browser; the website cannot guarantee a hold-Escape gesture or prevent a user from leaving fullscreen. If third-party cookies prevent embedding, use Open stream, which authenticates in a separate top-level tab.

## Saves and multiple players

Each local profile has separate worlds, settings and mods in IndexedDB. Different browsers and devices do not automatically share them. Export/import a profile ZIP to move devices. Clearing site data erases local saves. The site requests persistent storage, but the browser can decline it.

Every launch creates a browser-generated RSA keypair and a separate Actions runner. The workflow receives only settings and the public key. It publishes the encrypted connection envelope in an Actions step name, which the originating browser decrypts. The private key and runner capability stay in tab session storage, allowing reload recovery. Closing the tab loses connection recovery; your last IndexedDB backup remains. Other players cannot decrypt your connection envelope. Actions credentials still authorize repository-wide Actions administration; they are not per-player isolation credentials.

The browser sends its profile **directly to the runner** over authenticated HTTPS. Personal data never enters repository commits, Actions artifacts or game caches. The runner accepts only approved profile paths and rejects traversal, symlinks and oversized ZIPs. Limits: 512 MiB transfer, 1 GiB expanded archive, 100,000 files. This is an initial limit, not unlimited world storage. Quick tunnels may impose smaller request limits; uploads return an explicit error if the tunnel refuses them.

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

`npm run typecheck` and `npm run build` verify the web app. Run `python -m unittest discover -s Client/tests` for archive-boundary tests. `Web/out` is the static production export. No server or separately hosted broker is needed.

For another repository, enable Pages with **GitHub Actions** as the source and dispatch **Publish Glide website**. Its build sets the repository name as the Next.js base path and the correct default session repository. Forks can change the repository in Connection; public repositories can host Pages subject to the account's plan. The original standalone server workflow is not part of this browser session product.

Reference: [Next.js static exports](https://nextjs.org/docs/app/guides/static-exports), [GitHub Actions dependency caching](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching), [minecraft-launcher-lib mod loader API](https://minecraft-launcher-lib.readthedocs.io/en/stable/modules/mod_loader.html).
