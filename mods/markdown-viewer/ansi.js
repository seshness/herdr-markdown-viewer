// Turns the ANSI text `glow` prints into lines of styled spans: [[{ text, fg, bg, bold, italic }]].
// Colors 0-15 are the theme's own ansi0..ansi15; the rest are the xterm 256 palette or truecolor.

const hex = (n) => n.toString(16).padStart(2, "0");
const rgb = (r, g, b) => `#${hex(r)}${hex(g)}${hex(b)}`;

function indexed(n, t) {
  if (n < 16) return t[`ansi${n}`] ?? null;
  if (n < 232) {
    const c = n - 16, level = (v) => (v === 0 ? 0 : 55 + v * 40);
    return rgb(level(Math.floor(c / 36)), level(Math.floor(c / 6) % 6), level(c % 6));
  }
  const g = 8 + (n - 232) * 10;
  return rgb(g, g, g);
}

// Relative brightness 0..1 of "#rrggbb" (anything else counts as dark).
export function brightness(color) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(color ?? "");
  return m ? (0.299 * parseInt(m[1], 16) + 0.587 * parseInt(m[2], 16) + 0.114 * parseInt(m[3], 16)) / 255 : 0;
}

// Applies one SGR parameter list to a style.
function sgr(params, s, t) {
  for (let i = 0; i < params.length; i++) {
    const p = params[i];
    if (p === 0) { s.fg = s.bg = null; s.bold = s.italic = false; }
    else if (p === 1) s.bold = true;
    else if (p === 3) s.italic = true;
    else if (p === 22) s.bold = false;
    else if (p === 23) s.italic = false;
    else if (p >= 30 && p <= 37) s.fg = indexed(p - 30, t);
    else if (p >= 90 && p <= 97) s.fg = indexed(p - 90 + 8, t);
    else if (p >= 40 && p <= 47) s.bg = indexed(p - 40, t);
    else if (p >= 100 && p <= 107) s.bg = indexed(p - 100 + 8, t);
    else if (p === 39) s.fg = null;
    else if (p === 49) s.bg = null;
    else if (p === 38 || p === 48) {
      const key = p === 38 ? "fg" : "bg";
      if (params[i + 1] === 5) { s[key] = indexed(params[i + 2] ?? 0, t); i += 2; }
      else if (params[i + 1] === 2) { s[key] = rgb(params[i + 2] ?? 0, params[i + 3] ?? 0, params[i + 4] ?? 0); i += 4; }
    }
  }
}

// Escape sequences other than SGR (cursor moves, OSC 8 links…) are dropped.
const SEQ = /\x1b\[([0-9;:]*)([@-~])|\x1b\](?:[^\x07\x1b]*)(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g;

export function parseAnsi(text, t, maxLines = 5000) {
  const lines = [[]];
  const style = { fg: null, bg: null, bold: false, italic: false };
  const push = (chunk) => {
    const parts = chunk.split("\n");
    parts.forEach((part, i) => {
      if (i > 0) lines.push([]);
      part = part.replace(/\r/g, "").replace(/\t/g, "    ");
      if (!part) return;
      const line = lines[lines.length - 1], last = line[line.length - 1];
      if (last && last.fg === style.fg && last.bg === style.bg && last.bold === style.bold && last.italic === style.italic) last.text += part;
      else line.push({ text: part, ...style });
    });
  };
  let at = 0, m;
  SEQ.lastIndex = 0;
  while ((m = SEQ.exec(text))) {
    push(text.slice(at, m.index));
    at = SEQ.lastIndex;
    if (m[2] === "m") sgr(m[1] === "" ? [0] : m[1].split(/[;:]/).map((n) => parseInt(n, 10) || 0), style, t);
    if (lines.length > maxLines) break;
  }
  if (lines.length <= maxLines) push(text.slice(at));
  while (lines.length && !lines[lines.length - 1].some((sp) => sp.text.trim())) lines.pop();
  return lines.slice(0, maxLines);
}
