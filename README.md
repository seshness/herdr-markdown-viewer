# Markdown Viewer

A [Herdr](https://herdr.dev) app mod that shows Markdown files rendered, in a pane beside your
terminals. It reloads when the file changes, and a toggle switches to the highlighted source.

- **⌘⇧M** (key in `keys.json`) opens the viewer beside the focused pane, on a directory tree of
  the Markdown files of the git repo (or folder) you are in. Click folders to fold them, a file to
  read it in the same pane; `←` goes back to the tree.
- `mdv README.md` in any Herdr terminal opens that file directly; `mdv` alone opens the tree.
- **Rendered / Glow / Source** in the pane header. *Glow* appears only when the
  [`glow`](https://github.com/charmbracelet/glow) program is installed (on the file's machine) and
  shows its terminal rendering at the pane's width, in your theme's colors.
- **Live:** the open file is re-read when it changes on disk, in every view. One watch per folder
  per pane, never more; a closed pane's watches end at their next wake. Files on other machines
  (or in folders too big to watch) are re-read every 3 s. `↻` rereads at once.

Requires Herdr app with mods (`herdr-app check` available). macOS, Linux and Windows for the
pane itself; the `mdv` helper is a POSIX shell script (macOS, Linux, WSL).

## Install

```sh
git clone https://github.com/<you>/herdr-markdown-viewer
cd herdr-markdown-viewer
cp -R mods/markdown-viewer ~/.config/herdr-app/mods/     # or $HERDR_APP_HOME/mods
herdr-app check ~/.config/herdr-app/mods/markdown-viewer
install -m 755 bin/mdv ~/.local/bin/mdv                  # anywhere on your PATH
# the ⌘⇧M key: add the line from keys.json to "global" in ~/.config/herdr-app/keys.json
```

Saving files under `mods/` reloads the mod in place; no restart.

## Use without the helper

```sh
herdr-app do pane.split --direction right --mod markdown-viewer --props '{"file":"/abs/path/README.md"}'
```

`props`: `file` (absolute path; omit for the picker) and `on` (machine name, omit for this one).
It can also sit in a layout as a block: `{ "mod": "markdown-viewer", "props": { "file": "…" } }`.

## What it does and doesn't touch

Reads the file you give it, and lists Markdown files with `git ls-files` or `find` in the focused
pane's folder. For the Glow tab it runs `glow` (and `sh`) on the file. It runs no other programs, uses no network, and writes nothing. Mods are trusted
code, not sandboxed: read `main.js` and `find.js` (about 200 lines) before installing.

## Not done yet

- Adding the key makes `keys.json` yours: Herdr then stops upgrading it with new default keys.
- No link following (relative `.md` links) or in-page search.
- No Files-tab integration: the shipped Files panel still shows raw text.
- No `preview.png`; add one before submitting to herdr.dev/mods (topic `herdr-mod`).

See [RECIPE.md](RECIPE.md) for the brief to rebuild it from scratch. MIT licensed.
