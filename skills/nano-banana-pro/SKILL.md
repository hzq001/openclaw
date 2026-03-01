---
name: nano-banana-pro
description: Generate or edit images via Gemini 3 Pro Image (Nano Banana Pro).
homepage: https://ai.google.dev/
metadata:
  {
    "openclaw":
      {
        "emoji": "🍌",
        "requires": { "bins": ["uv"], "env": [] },
        "install":
          [
            {
              "id": "uv-brew",
              "kind": "brew",
              "formula": "uv",
              "bins": ["uv"],
              "label": "Install uv (brew)",
            },
          ],
      },
  }
---

# Nano Banana Pro (Gemini 3 Pro Image)

Use the bundled script to generate or edit images.

Generate

```bash
uv run {baseDir}/scripts/generate_image.py --prompt "your image description" --filename "output.png" --resolution 1K
```

Edit (single image)

```bash
uv run {baseDir}/scripts/generate_image.py --prompt "edit instructions" --filename "output.png" -i "/path/in.png" --resolution 2K
```

Multi-image composition (up to 14 images)

```bash
uv run {baseDir}/scripts/generate_image.py --prompt "combine these into one scene" --filename "output.png" -i img1.png -i img2.png -i img3.png
```

Local proxy defaults (baked in)

This skill is configured to use a **local Gemini proxy** by default.

Stability note

- The script runs in a **stable mode** (no protocol probing). It uses the Google GenAI SDK against the configured base URL.
- If you see `503 UNAVAILABLE` / `MODEL_CAPACITY_EXHAUSTED`, it usually means the upstream server is temporarily out of capacity — retry later.

This skill is configured to use a **local Gemini proxy** by default:

- Base URL: `http://127.0.0.1:8317`
- Model: `gemini-3-pro-image-preview`
- API key (default): `123456`

So in the common case, you **do not need to set** `GEMINI_API_KEY`.

Overrides (optional)

- Pass `--api-key` / `--base-url` to the script, or
- Set env vars: `GEMINI_API_KEY` / `LOCAL_GEMINI_API_KEY`, `GEMINI_BASE_URL` / `LOCAL_GEMINI_BASE_URL`.

Notes

- Resolutions: `1K` (default), `2K`, `4K`.
- Use timestamps in filenames: `yyyy-mm-dd-hh-mm-ss-name.png`.
- The script prints a `MEDIA:` line for OpenClaw to auto-attach on supported chat providers.
- Do not read the image back; report the saved path only.
