# Licensed Japanese Fonts

The runtime always installs Noto Sans CJK JP as a regular/bold fallback. To
render PDFs with the exact Microsoft Meiryo UI family, place licensed Meiryo
`.ttf` or `.ttc` files in this directory before building the Docker image.

Font binaries in this directory are ignored by Git and must not be committed.
They must come from a properly licensed Windows or Microsoft Office
installation.

Verify the built image with:

```bash
fc-match "Meiryo UI"
fc-match "Meiryo UI:style=Bold"
```

When licensed Meiryo UI files are present, both commands should report Meiryo.
Without them, the commands should report Noto Sans CJK JP rather than
DroidSansFallback.
