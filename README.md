# Markdown Viewer

A [Herdr](https://herdr.dev) app mod that shows Markdown files rendered, in a pane beside your
terminals. It reloads when the file changes, and a toggle switches to the highlighted source.

- `mdv README.md` in any Herdr terminal opens that file in a pane to the right.
- `mdv` alone opens a picker: the Markdown files of the git repo (or folder) you are in. Click
  one to read it in the same pane; `←` goes back to the list.
- **Rendered / Source** toggle and `↻` in the pane header.
- Works on files on other machines too (`on` prop), re-read every 3 s.

Requires Herdr app with mods (`herdr-app check` available). macOS, Linux and Windows for the
pane itself; the `mdv` helper is a POSIX shell script (macOS, Linux, WSL).

## Install

```sh
git clone https://github.com/<you>/herdr-markdown-viewer
cd herdr-markdown-viewer
cp -R mods/markdown-viewer ~/.config/herdr-app/mods/     # or $HERDR_APP_HOME/mods
herdr-app check ~/.config/herdr-app/mods/markdown-viewer
install -m 755 bin/mdv ~/.local/bin/mdv                  # anywhere on your PATH
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
pane's folder. It runs no other programs, uses no network, and writes nothing. Mods are trusted
code, not sandboxed: read `main.js` and `find.js` (about 200 lines) before installing.

## Not done yet

- No link following (relative `.md` links) or in-page search.
- No Files-tab integration: the shipped Files panel still shows raw text.
- No `preview.png`; add one before submitting to herdr.dev/mods (topic `herdr-mod`).

See [RECIPE.md](RECIPE.md) for the brief to rebuild it from scratch. MIT licensed.
