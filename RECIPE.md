# Markdown Viewer

A pane that shows a Markdown file rendered, beside the terminals. It reloads when the file
changes. Without a file it lists the Markdown files around the focused terminal to pick from.

## What you see

One mod pane, the theme's `background` and `foreground`, 13 px UI text.

- **Header**, 32 px, 14 px side padding, 8 px gap, 1 px bottom border in `border`, 12 px text.
  File view: `←` (back to the list), the file name (semibold, truncates), its full path in `dim`
  (`machine:path` for another machine's), then buttons *Rendered*, *Source*, `↻`. Buttons: 8 px
  × 2 px padding, 5 px radius, `muted` text, `hover` background and `foreground` text when
  pointed at; the active one of Rendered/Source is `foreground` on `hover`.
  Picker: *Markdown* (semibold), the root folder in `dim`, `↻`.
- **Rendered body**: `TextView.markdown`, 14 px, 20 px side and 14 px top padding, scrollable,
  selectable. YAML front matter is hidden; in `.mdx`, top-level `import`/`export` lines too (not
  inside a code fence).
- **Source body**: a read-only editor, language `markdown`, 12 px in the person's terminal font,
  syntax colors from the theme's ansi colors.
- **Picker rows**: 28 px, 8 px side padding, 7 px radius, 6 px around the list; file name, then
  its folder relative to the root in 11.5 px `dim`; top-level files first, then by folder.
- **Messages** in place of the body, 12.5 px `dim`: *Loading…*, *File not found*, *Binary file*,
  *Cannot read this file (too large or unreadable)*, *No Markdown files here*, or the error.

## How it behaves

- Props `{ file, on }` open that file; no `file` opens the picker. `on` is the machine the file
  is on (null: this one).
- Local files are watched with `watchFolder` on their folder and re-read when the file is in a
  batch. If the watch is refused, or the file is on another machine, it is re-read every 3 s.
  The old text stays until the new is read (no flash). Unchanged text redraws nothing new.
- Picker: the git repo's tracked and untracked, not ignored, `.md`/`.mdx`/`.markdown` files
  (case-insensitive); outside git, four folder levels under the pane's folder, skipping hidden
  folders and `node_modules`, at most 2000. A mod pane has no folder: the tab's first terminal's.
- Click a row: that file in this pane. `←`: the picker again. `↻` rereads.
- Text is capped at 400 000 characters rendered; the host reads at most 1 MiB.
- It shows no agents, so agent statuses don't change it.

## Built from

- `mods/markdown-viewer/mod.json` `{ "place": "none" }`: only opened by `pane.split`.
- `main.js`: `View` with `TextView.markdown`, `Editor`/`EditorState`; `props`, `readTextFile`,
  `watchFolder`, `theme`, `settings`, `cx.timer.every`, `cx.spawn`.
- `find.js`: `exec` of `git rev-parse`, `git ls-files`, `find`; `spaces`, `panes`, `focused`.
- `bin/mdv`: resolves the path, runs `herdr-app do pane.split --direction right --mod
  markdown-viewer --props '{"file":…}'`; with no argument, no props.

## Watch out

- Keep `cx` out of fields: every callback gets its own.
- `init` must not touch `props().file` when absent; `props()` can be null.
- `watchFolder` rejects huge trees: fall back to the timer, don't loop.
- Windows: `find` and `sh` aren't there; the picker works only inside git (via `git ls-files`)
  and `mdv` needs a POSIX shell. Untested there.

## Done when

- `herdr-app check mods/markdown-viewer` passes.
- `mdv README.md` splits a pane showing it rendered; editing the file updates the pane within
  a second; *Source* shows highlighted text and *Rendered* returns.
- `mdv` alone lists the repo's Markdown files; clicking one shows it; `←` comes back.
- A missing file shows *File not found*; a binary file shows *Binary file*.
