# Wasmer deployment

The frontend is a compiled Next.js static export, served by a same-origin Flask gateway. Wasmer auto-detects Flask and installs dependencies. No world or account-token database is deployed.

Run `npm --prefix Web ci`, `npm --prefix Web run build` (leave NEXT_PUBLIC_BASE_PATH unset), then `python Hosting/package_site.py`. Upload a folder containing app.py, microsoft.py, runner_pool.py, requirements.txt and public/ using the existing Wasmer app's Upload files control. Do not upload .env or the repository's local files.

Start command: `python -m uvicorn app:app --interface wsgi --host 0.0.0.0 --port 8080`.

Configure private runtime environment variables in Wasmer: CURSEFORGE_API_KEY, GITHUB_ACTIONS_TOKEN (Actions-only repository credential), GLIDE_SESSION_SECRET (at least 32 random bytes), GLIDE_ACCESS_CODE (shared only with invited players), GLIDE_ORIGIN (the public HTTPS origin). GLIDE_REPO defaults to thetruashen/glide-web. Never put the full-access GitHub credential in this service.

Microsoft: the default flow opens the Prism Launcher inside the private streamed session. Players sign in directly there and launch their prepared Glide instance. No player tokens, Microsoft app ID, or Azure setup are needed for this mode. The Prism client's account data stays in its private temporary directory and is excluded from instance backups and caches. Set MICROSOFT_CLIENT_ID only if you want the optional custom device-code flow instead.

Large packs: downloads are limited to 1 GiB per file and use 8 MiB HTTP range requests. Instance archives and transfers support 4 GiB, 100,000 entries and 8 GiB expanded size. ZIP64-aware lazy readers preserve large backups without reading them as one giant JavaScript buffer. Unchanged saved archives are reused when launching.

Account access uses a signed HttpOnly Secure cookie for 30 days. Actions operations are restricted to configured pool repositories, two known workflows, and launches owned by that browser's signed session. Cross-origin mutations and unsupported download hosts/redirects are rejected. Browser snapshots and instance backups travel directly to the runner, never through this gateway or repository.

When moving from GitHub Pages, export each instance on the old site and import it into the new site. IndexedDB storage is scoped to each domain. Updated exports include settings and mod metadata but never Microsoft credentials.

Checks: `python -m unittest discover -s Hosting`, `python -m unittest discover -s Client/tests`, `npm --prefix Web test`, and `npm --prefix Web run build`.


## Public runner pool
The Wasmer launcher automatically creates an anonymous, signed browser session. No access code is required. Worlds and settings remain in the visitor's IndexedDB. A server-issued random launch ID and browser-bound repository mapping prevent visitors from claiming another browser's run.

Set GLIDE_RUNNER_POOL as a private runtime environment variable to a JSON array:
```json
[{"repo":"owner-a/pigmc","token":"PRIVATE_ACTIONS_TOKEN_A","branch":"main","capacity":2},{"repo":"owner-b/pigmc","token":"PRIVATE_ACTIONS_TOKEN_B","branch":"main","capacity":2}]
```
Each repository must contain the current workflows and have Actions enabled. Tokens need Actions read/write for the selected repository. Tokens are never returned by config, cookies or allocation responses. The existing GLIDE_REPO/GITHUB_ACTIONS_TOKEN pair remains the single-repository fallback. The allocator queries active GitHub runs and chooses an available repository with the lowest relative load. GitHub remains the authority for account-level job and usage limits; per-repository capacities do not increase a shared account's quota. Allocation is load-aware rather than a durable cross-replica slot reservation. One browser may have one active Java session; independent visitors can play concurrently. Eaglercraft consumes no Actions runner.

Public launches can consume the configured accounts' Actions quota. Set conservative capacities and use repository-scoped credentials.
