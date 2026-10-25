# Tools

Nothing here is part of the userscript. It's what checks it, draws the README images and builds the character-parts data.

| Folder | What it is |
|---|---|
| [`tests/`](tests/README.md) | Browser tests: the real userscript on a demo page in headless Chromium |
| [`assets/`](assets/README.md) | Renders the images in `docs/img/` with the real userscript |
| [`components/`](components/README.md) | Builds `data/components.tsv.gz` (character parts) with Python: `sh tools/components/build.sh` |

Tests and images use Node and Playwright. `run.sh` runs them with your own Node if you have it, otherwise in the Playwright container through podman (or docker), so nothing needs to be installed but the container runtime.

## First time

```sh
cd tools/assets
sh fetch-deps.sh             # dictionaries + fonts, about 30 MB, not committed
npm install                  # Playwright; skip if you only use the container
npx playwright install chromium   # likewise
```

Tests and images both need `fetch-deps.sh`. In the container, `npm install` still has to have run once (`node_modules/` is read from the mounted folder): `podman run --rm -v "$PWD":/w:Z -w /w mcr.microsoft.com/playwright:v1.64.1-noble npm ci`.

## Everyday

From the repository root:

```sh
sh tools/run.sh test             # node --check on the script, then every tools/tests/*.test.js
sh tools/run.sh test settings    # one test file (tools/tests/settings.test.js)
sh tools/run.sh images           # rebuild docs/img/*.png
sh tools/run.sh poster           # also tools/assets/out/poster.png
```

Run the tests after every change to `zhuyin-anywhere.user.js`. Rebuild the images when something visible changes (a popup, a setting's default, the settings panel); the README text should match what they show.

The container image's Playwright version must match `tools/assets/package-lock.json` (now 1.64.1), otherwise its browsers are missing. Change both together.
