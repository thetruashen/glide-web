# Wasmer deployment

The frontend is a compiled Next.js static export, served by a same-origin Flask gateway. Wasmer auto-detects Flask and installs dependencies. No world or account-token database is deployed.

Run `npm --prefix Web ci`, `npm --prefix Web run build` (leave NEXT_PUBLIC_BASE_PATH unset), then `python Hosting/package_site.py`. Upload a folder containing app.py, microsoft.py, requirements.txt and public/ using the existing Wasmer app's Upload files control. Do not upload .env or the repository's local files.

Start command: `python -m uvicorn app:app --interface wsgi --host 0.0.0.0 --port 8080`.

Configure private environment variables in Wasmer: CURSEFORGE_API_KEY, GITHUB_ACTIONS_TOKEN (Actions-only repository credential), GLIDE_SESSION_SECRET (at least 32 random bytes), GLIDE_ACCESS_CODE (shared only with invited players), GLIDE_ORIGIN (the public HTTPS origin). GLIDE_REPO defaults to thetruashen/glide-web. Never put the full-access GitHub credential in this service.

Microsoft: the default flow opens the Prism Launcher inside the private streamed session. Players sign in directly there and launch their prepared Glide instance. No player tokens, Microsoft app ID, or Azure setup are needed for this mode. The Prism client's account data stays in its private temporary directory and is excluded from instance backups and caches. Set MICROSOFT_CLIENT_ID only if you want the optional custom device-code flow instead.

Large packs: downloads are limited to 1 GiB per file and use 8 MiB HTTP range requests. Instance archives and transfers support 4 GiB, 100,000 entries and 8 GiB expanded size. ZIP64-aware lazy readers preserve large backups without reading them as one giant JavaScript buffer. Unchanged saved archives are reused when launching.

Account access uses a signed HttpOnly Secure cookie for 30 days. Actions operations are restricted to the fixed repository, two known workflows, and launches owned by that browser's signed session. Cross-origin mutations and unsupported download hosts/redirects are rejected. Browser snapshots and instance backups travel directly to the runner, never through this gateway or repository.

When moving from GitHub Pages, export each instance on the old site and import it into the new site. IndexedDB storage is scoped to each domain. Updated exports include settings and mod metadata but never Microsoft credentials.

Checks: `python -m unittest discover -s Hosting`, `python -m unittest discover -s Client/tests`, `npm --prefix Web test`, and `npm --prefix Web run build`.
