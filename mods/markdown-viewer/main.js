// Markdown viewer, by props:
// - { file, on }: the file in a pane, reloaded when it changes, as Rendered, Glow (when the `glow`
//   program is installed) or Source (on: the machine the file lives on, null for this one).
// - nothing: a directory tree of the Markdown files around the focused pane; a click shows one
//   in this same pane, and ← comes back to the tree.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, TextView, Editor, EditorState } from "gpui-base";
import { props, readTextFile, watchFolder, theme, settings, window, exec } from "herdr";
import { location, markdownFiles, join } from "./find.js";
import { buildTree, rows as treeRows, folders } from "./tree.js";
import { parseAnsi, brightness } from "./ansi.js";

const MAX = 400000; // characters rendered; the host reads at most 1 MiB anyway
const ROW = 28;
const GLOW_SIZE = 12, GLOW_LINE = 18; // Glow tab: font size and row height, px
const OPEN_ALL_UP_TO = 40; // the tree starts fully open when it has this many files or fewer

const dirOf = (file) => file.replace(/[\\/][^\\/]*$/, "") || "/";

// Front matter isn't prose; in MDX neither are the top-level import/export lines (not inside a code fence).
function prose(text, file) {
  const s = text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
  if (!/\.mdx$/i.test(file)) return s;
  let fence = null;
  return s.split("\n").filter((line) => {
    const m = line.match(/^\s*(`{3,}|~{3,})/);
    if (m && !fence) fence = m[1];
    else if (m && m[1][0] === fence[0] && m[1].length >= fence.length) fence = null;
    else if (!fence && /^(import|export)\s/.test(line)) return false;
    return true;
  }).join("\n");
}

export default class MarkdownViewer extends View {
  init(_props, cx) {
    const { file, on } = props() ?? {};
    this.on = on ?? null;
    this.mode = "rendered"; // rendered | glow | source
    this.version = 0; // which open()/list() the readings belong to
    this.rev = 0; // counts changes of the text, for the Glow output
    this.closed = false;
    this.watched = new Set(); // folders with a watch loop running: at most one each, never more
    this.failed = new Set(); // folders that can't be watched: read again by the timer
    this.glowAvail = new Map(); // machine -> glow installed?
    this.files = null; // the tree's files
    this.root = null;
    this.error = null;
    if (file) this.open(file, this.on, cx); else this.list(cx);
    // Another machine's file, or one in a folder that can't be watched, is read again every 3 s.
    cx.timer.every(3000, (cx) => {
      if (this.closed || !this.file || this.reading) return;
      if (this.on || this.failed.has(dirOf(this.file))) this.load(cx);
    });
  }

  // The last call for this copy: stop the watch loops at their next wake, free the editor.
  async close() {
    this.closed = true;
    this.code?.release();
    this.code = null;
  }

  // Show this file from now on, and watch it. The text shown before stays until the new one
  // is read, rather than a "Loading…" flash.
  open(file, on, cx) {
    this.file = file;
    this.on = on ?? null;
    this.error = null;
    this.code?.release(); this.code = null;
    this.glowOut = null; this.glowKey = null;
    ++this.version;
    this.load(cx);
    this.detectGlow(cx);
    if (!this.on) this.watch(dirOf(file), cx);
  }

  // One loop per folder: watchFolder can't be cancelled, so a loop stays (parked, cheap) after
  // the pane moves on, and any later file in that folder reuses it instead of starting another.
  watch(dir, cx) {
    if (this.watched.has(dir) || this.failed.has(dir)) return;
    this.watched.add(dir);
    cx.spawn(async (cx) => {
      while (!this.closed) {
        let changed;
        try { changed = await watchFolder(dir); }
        catch { // too many folders, or gone: the timer takes over
          this.watched.delete(dir);
          this.failed.add(dir);
          return;
        }
        if (this.closed) return;
        // A batch naming the folder itself means "anything may have changed".
        if (this.file && !this.on && dirOf(this.file) === dir && (changed.includes(this.file) || changed.includes(dir))) this.load(cx);
      }
    });
  }

  load(cx) {
    const mine = this.version, file = this.file, on = this.on;
    this.reading = true;
    cx.spawn(async (cx) => {
      try {
        const text = await readTextFile(file, { on });
        if (this.version !== mine || this.closed) return;
        if (text === null) { this.error = "File not found"; this.text = null; }
        else if (text.includes("\0")) { this.error = "Binary file"; this.text = null; }
        else if (text !== this.text) {
          this.error = null;
          this.text = text;
          this.rev++;
          this.code?.release(); this.code = null;
          if (this.mode === "source") this.buildSource(); // the open view follows the new text
          if (this.mode === "glow") this.runGlow(cx);
        }
      } catch {
        if (this.version === mine) this.error = "Cannot read this file (too large or unreadable)";
      } finally {
        this.reading = false;
        cx.notify();
      }
    });
  }

  list(cx) {
    this.version++;
    this.file = null;
    this.text = null;
    this.error = null;
    this.files = null;
    const mine = this.version;
    cx.spawn(async (cx) => {
      try {
        const where = location();
        this.on = where.on;
        const { root, files } = await markdownFiles(where);
        if (this.version === mine) {
          this.root = root;
          this.files = files;
          this.tree = buildTree(files);
          this.openDirs = new Set(files.length <= OPEN_ALL_UP_TO ? folders(this.tree) : []);
        }
      } catch (e) {
        if (this.version === mine) this.error = String(e?.message ?? e);
      }
      cx.notify();
    });
  }

  // ---- Glow ----

  hasGlow() { return this.glowAvail.get(this.on ?? "") === true; }

  // Is `glow` on the file's machine? Windows has no `sh` to force its colors, so no Glow tab there.
  detectGlow(cx) {
    const on = this.on, key = on ?? "";
    if (this.glowAvail.has(key)) return;
    this.glowAvail.set(key, false);
    if (!on && window()?.platform === "windows") return;
    cx.spawn(async (cx) => {
      try {
        const r = await exec("glow", ["--version"], { on, timeout: 5000 });
        this.glowAvail.set(key, r.code === 0);
      } catch { /* not installed */ }
      if (this.mode === "glow" && !this.hasGlow()) this.mode = "rendered";
      cx.notify();
    });
  }

  // Runs glow at the pane's width (colors forced: it prints none into a pipe) and keeps its
  // lines. One run at a time; a size change meanwhile runs once more afterwards.
  runGlow(cx) {
    if (!this.file || this.text === null || !this.cols) return;
    const style = brightness(theme().background) < 0.5 ? "dark" : "light";
    const key = `${this.rev}|${this.cols}|${style}`;
    if (this.glowKey === key) return;
    if (this.glowing) { this.glowAgain = true; return; }
    this.glowing = true;
    const mine = this.version, file = this.file, on = this.on, cols = this.cols;
    cx.spawn(async (cx) => {
      try {
        const r = await exec("sh", ["-c", 'CLICOLOR_FORCE=1 exec glow -s "$1" -w "$2" -- "$3"', "mdv", style, String(cols), file],
          { on, timeout: 15000 });
        if (this.version === mine && !this.closed) {
          if (r.code !== 0) { this.glowError = (r.stderr || "glow failed").trim().slice(0, 300); this.glowOut = null; }
          else { this.glowError = null; this.glowOut = parseAnsi(r.stdout, theme()); }
          this.glowKey = key;
        }
      } catch (e) {
        if (this.version === mine) { this.glowError = String(e?.message ?? e); this.glowOut = null; }
      } finally {
        this.glowing = false;
        if (this.glowAgain && !this.closed) { this.glowAgain = false; this.runGlow(cx); }
        cx.notify();
      }
    });
  }

  glowBody(t) {
    const font = settings().font_family;
    const line = (spans) => h_flex().h(GLOW_LINE).flex_none().items_center().font_family(font).text_size(GLOW_SIZE)
      .children(spans.map((s) => div().flex_none()
        .when(Boolean(s.fg), (el) => el.text_color(s.fg))
        .when(Boolean(s.bg), (el) => el.bg(s.bg))
        .when(s.bold, (el) => el.font_semibold())
        .when(s.italic, (el) => el.italic())
        .child(s.text)));
    return v_flex().id("mv-glow").flex_1().min_h(0)
      .on_size_change((size, cx) => {
        const cols = Math.max(20, Math.floor((size.width - 34) / (GLOW_SIZE * 0.602)));
        if (cols !== this.cols) { this.cols = cols; if (this.mode === "glow") this.runGlow(cx); }
      })
      .child(this.glowError
        ? div().p(16).text_size(12.5).text_color(t.dim).child(this.glowError)
        : !this.glowOut
          ? div().p(16).text_size(12.5).text_color(t.dim).child("Loading…")
          : v_flex().id("mv-glow-lines").size_full().overflow_y_scrollbar().px(12).py(10).children(this.glowOut.map(line)));
  }

  // ---- Source ----

  // EditorState.new can't run while rendering: build it when the text arrives and when Source is clicked.
  buildSource() {
    if (this.text === null) return;
    const t = theme();
    this.code?.release();
    this.code = EditorState.new({
      language: "markdown", readonly: true,
      value: this.text.length > MAX ? this.text.slice(0, MAX) + "\n… (truncated)" : this.text,
      font_family: settings().font_family, font_size: 12,
      syntax: { keyword: t.ansi5, string: t.ansi2, comment: t.dim, function: t.ansi4, type: t.ansi3, number: t.ansi1, constant: t.ansi6 },
    });
  }

  sourceView(t) {
    return this.code ? Editor.new(this.code).flex_1().min_h(0) : div().p(16).text_size(12.5).text_color(t.dim).child("Loading…");
  }

  // ---- Drawing ----

  button(id, label, active, onClick) {
    const t = theme();
    return div().id(id).flex_none().px(8).py(2).rounded(5).cursor_pointer()
      .text_color(active ? t.foreground : t.muted).when(active, (el) => el.bg(t.hover))
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click(onClick).child(label);
  }

  setMode(mode, cx) {
    this.mode = mode;
    if (mode === "source" && !this.code) this.buildSource();
    if (mode === "glow") this.runGlow(cx);
    cx.notify();
  }

  viewer(t) {
    const name = this.file.split(/[\\/]/).pop();
    const body = this.error
      ? div().p(16).text_size(12.5).text_color(t.dim).child(this.error)
      : this.text === null
        ? div().p(16).text_size(12.5).text_color(t.dim).child("Loading…")
        : this.mode === "source"
          ? this.sourceView(t)
          : this.mode === "glow" && this.hasGlow()
            ? this.glowBody(t)
            : div().flex_1().min_h(0).px(20).py(14).text_size(14)
              .child(TextView.markdown(`mv-${this.version}`, prose(this.text.length > MAX ? this.text.slice(0, MAX) : this.text, this.file)).scrollable(true).selectable(true).size_full());
    const mode = this.mode === "glow" && !this.hasGlow() ? "rendered" : this.mode;
    return v_flex().size_full().min_h(0)
      .child(h_flex().h(32).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border).text_size(12)
        .child(this.button("mv-back", "←", false, (_e, cx) => this.list(cx)))
        .child(div().font_semibold().truncate().child(name))
        .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(this.on ? `${this.on}:${this.file}` : this.file))
        .child(this.button("mv-rendered", "Rendered", mode === "rendered", (_e, cx) => this.setMode("rendered", cx)))
        .when(this.hasGlow(), (el) => el.child(this.button("mv-glow-tab", "Glow", mode === "glow", (_e, cx) => this.setMode("glow", cx))))
        .child(this.button("mv-source", "Source", mode === "source", (_e, cx) => this.setMode("source", cx)))
        .child(this.button("mv-reload", "↻", false, (_e, cx) => this.load(cx))))
      .child(body);
  }

  picker(t) {
    const all = this.tree ? folders(this.tree) : [];
    const allOpen = all.length > 0 && all.every((p) => this.openDirs.has(p));
    const list = this.tree ? treeRows(this.tree, this.openDirs).map((r) => {
      const open = this.openDirs.has(r.path);
      return h_flex().id(`mv-${r.dir ? "d" : "f"}-${r.path}`).h(ROW).flex_none().pl(8 + r.depth * 16).pr(8).gap(6).items_center().rounded(7).cursor_pointer()
        .hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => {
          if (r.dir) { open ? this.openDirs.delete(r.path) : this.openDirs.add(r.path); }
          else this.open(join(this.root, r.path), this.on, cx);
          cx.notify();
        })
        .child(div().w(10).flex_none().text_size(10).text_color(t.dim).child(r.dir ? (open ? "▾" : "▸") : ""))
        .child(div().flex_1().min_w(0).truncate().when(r.dir, (el) => el.text_color(t.muted)).child(r.name))
        .when(r.dir, (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(String(r.count))));
    }) : [];
    const note = this.error ?? (this.files === null ? "Loading…" : list.length ? null : "No Markdown files here");
    return v_flex().size_full().min_h(0)
      .child(h_flex().h(32).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border).text_size(12)
        .child(div().font_semibold().child("Markdown"))
        .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(this.root ?? ""))
        .when(all.length > 0, (el) => el.child(this.button("mv-fold", allOpen ? "Collapse" : "Expand", false, (_e, cx) => {
          this.openDirs = new Set(allOpen ? [] : all);
          cx.notify();
        })))
        .child(this.button("mv-refresh", "↻", false, (_e, cx) => this.list(cx))))
      .child(note
        ? div().p(16).text_size(12.5).text_color(t.dim).child(note)
        : v_flex().id("mv-list").flex_1().min_h(0).overflow_y_scrollbar().p(6).children(list));
  }

  render(cx) {
    const t = theme();
    return v_flex().id("markdown-viewer").size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(13)
      .child(this.file ? this.viewer(t) : this.picker(t));
  }
}
