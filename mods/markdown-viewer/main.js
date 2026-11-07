// Markdown viewer, by props:
// - { file, on }: the file rendered in a pane, reloaded when it changes, with a Rendered / Source
//   toggle (on: the machine the file lives on, null for this one).
// - nothing: a picker listing the Markdown files around the focused pane; a click shows one
//   in this same pane, and ← comes back to the list.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, TextView, Editor, EditorState } from "gpui-base";
import { props, readTextFile, watchFolder, theme, settings, panes, focused } from "herdr";
import { MARKDOWN, location, markdownFiles, join } from "./find.js";

const MAX = 400000; // characters rendered; the host reads at most 1 MiB anyway
const ROW = 28;

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
    this.source = false; // Rendered or Source
    this.version = 0; // which open() the readings belong to
    this.files = null; // the picker's list
    this.root = null;
    this.error = null;
    if (file) this.open(file, this.on, cx); else this.list(cx);
    // watchFolder only sees this machine: another's file (or one it can't watch) is read again every 3 s.
    cx.timer.every(3000, (cx) => {
      if (!this.file || !this.polling || this.reading) return;
      this.load(cx);
    });
  }

  // Show this file from now on, and watch it. The text shown before stays until the new one
  // is read, rather than a "Loading…" flash.
  open(file, on, cx) {
    this.file = file;
    this.on = on ?? null;
    this.error = null;
    this.code = null;
    const mine = ++this.version;
    this.load(cx);
    this.polling = Boolean(this.on);
    if (this.on) return;
    const dir = file.replace(/[\\/][^\\/]*$/, "") || "/";
    this.polling = false;
    cx.spawn(async (cx) => {
      while (this.version === mine) {
        let changed;
        // Not watchable (folder too big, gone): the 3 s timer in init() takes over.
        try { changed = await watchFolder(dir); } catch { this.polling = true; return; }
        if (this.version === mine && changed.includes(file)) this.load(cx);
      }
    });
  }

  load(cx) {
    const mine = this.version, file = this.file, on = this.on;
    this.reading = true;
    cx.spawn(async (cx) => {
      try {
        const text = await readTextFile(file, { on });
        if (this.version !== mine) return;
        if (text === null) { this.error = "File not found"; this.text = null; }
        else if (text.includes("\0")) { this.error = "Binary file"; this.text = null; }
        else if (text !== this.text) {
          this.error = null;
          this.text = text;
          this.code = null; // the Source view is rebuilt from the new text
        }
      } catch (e) {
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
        if (this.version === mine) { this.root = root; this.files = files; }
      } catch (e) {
        if (this.version === mine) this.error = String(e?.message ?? e);
      }
      cx.notify();
    });
  }

  // The Source view: a read-only editor with Markdown highlighting.
  sourceView() {
    if (!this.code) {
      const t = theme();
      this.code = EditorState.new({
        language: "markdown", readonly: true,
        value: this.text.length > MAX ? this.text.slice(0, MAX) + "\n… (truncated)" : this.text,
        font_family: settings().font_family, font_size: 12,
        syntax: { keyword: t.ansi5, string: t.ansi2, comment: t.dim, function: t.ansi4, type: t.ansi3, number: t.ansi1, constant: t.ansi6 },
      });
    }
    return Editor.new(this.code).flex_1().min_h(0);
  }

  button(id, label, active, onClick) {
    const t = theme();
    return div().id(id).flex_none().px(8).py(2).rounded(5).cursor_pointer()
      .text_color(active ? t.foreground : t.muted).when(active, (el) => el.bg(t.hover))
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_click(onClick).child(label);
  }

  viewer(t) {
    const name = this.file.split(/[\\/]/).pop();
    const body = this.error
      ? div().p(16).text_size(12.5).text_color(t.dim).child(this.error)
      : this.text === null
        ? div().p(16).text_size(12.5).text_color(t.dim).child("Loading…")
        : this.source
          ? this.sourceView()
          : div().flex_1().min_h(0).px(20).py(14).text_size(14)
            .child(TextView.markdown(`mv-${this.version}`, prose(this.text.length > MAX ? this.text.slice(0, MAX) : this.text, this.file)).scrollable(true).selectable(true).size_full());
    return v_flex().size_full().min_h(0)
      .child(h_flex().h(32).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border).text_size(12)
        .child(this.button("mv-back", "←", false, (_e, cx) => this.list(cx)))
        .child(div().font_semibold().truncate().child(name))
        .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(this.on ? `${this.on}:${this.file}` : this.file))
        .child(this.button("mv-rendered", "Rendered", !this.source, (_e, cx) => { this.source = false; cx.notify(); }))
        .child(this.button("mv-source", "Source", this.source, (_e, cx) => { this.source = true; cx.notify(); }))
        .child(this.button("mv-reload", "↻", false, (_e, cx) => this.load(cx))))
      .child(body);
  }

  picker(t) {
    const rows = (this.files ?? []).map((rel) => {
      const slash = rel.lastIndexOf("/");
      return h_flex().id(`mv-${rel}`).h(ROW).flex_none().px(8).gap(7).items_center().rounded(7).cursor_pointer()
        .hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => { this.open(join(this.root, rel), this.on, cx); cx.notify(); })
        .child(div().flex_none().truncate().child(rel.slice(slash + 1)))
        .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(slash > 0 ? rel.slice(0, slash) : ""));
    });
    const note = this.error ?? (this.files === null ? "Loading…" : rows.length ? null : "No Markdown files here");
    return v_flex().size_full().min_h(0)
      .child(h_flex().h(32).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border).text_size(12)
        .child(div().font_semibold().child("Markdown"))
        .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(this.root ?? ""))
        .child(this.button("mv-refresh", "↻", false, (_e, cx) => this.list(cx))))
      .child(note
        ? div().p(16).text_size(12.5).text_color(t.dim).child(note)
        : v_flex().id("mv-list").flex_1().min_h(0).overflow_y_scrollbar().p(6).children(rows));
  }

  render(cx) {
    const t = theme();
    return v_flex().id("markdown-viewer").size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(13)
      .child(this.file ? this.viewer(t) : this.picker(t));
  }
}
