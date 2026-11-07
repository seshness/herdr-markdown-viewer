// Finds the Markdown files around the focused pane, for the picker shown when no file is given.
import { spaces, panes, focused, exec } from "herdr";

export const MARKDOWN = /\.(md|mdx|markdown)$/i;

// Where to look: the focused pane's folder on its machine. A mod pane has no folder of its own,
// so then the first terminal of its tab.
export function location() {
  const space = spaces().find((s) => s.active), f = focused();
  const pane = f?.pane ? panes().find((p) => p.pane === f.pane) : null;
  let cwd = pane?.cwd || f?.cwd || null;
  if (pane && !pane.terminal) cwd = panes().find((p) => p.tab === pane.tab && p.terminal && p.cwd)?.cwd ?? null;
  return { cwd: cwd || space?.folder || null, on: space?.machine ?? null };
}

export const join = (root, rel) => `${root.replace(/[\\/]+$/, "")}/${rel}`;

const byFolder = (a, b) => {
  const da = a.includes("/"), db = b.includes("/");
  return da !== db ? (da ? 1 : -1) : a.localeCompare(b, undefined, { sensitivity: "base" });
};

// Resolves with { root, files: [paths relative to root] }: the git repo's tracked and
// untracked (not ignored) Markdown files, else up to four folder levels under cwd.
export async function markdownFiles({ cwd, on }) {
  if (!cwd) throw new Error("No folder");
  const top = await exec("git", ["-C", cwd, "rev-parse", "--show-toplevel"], { on }).catch(() => null);
  if (top?.code === 0) {
    const root = top.stdout.trim();
    const r = await exec("git", ["-C", root, "ls-files", "-z", "--cached", "--others", "--exclude-standard", "--",
      ":(icase)*.md", ":(icase)*.mdx", ":(icase)*.markdown"], { on });
    if (r.code !== 0) throw new Error(r.stderr.trim() || "git ls-files failed");
    return { root, files: [...new Set(r.stdout.split("\0").filter(Boolean))].sort(byFolder) };
  }
  const r = await exec("find", [".", "-maxdepth", "4", "(", "-name", ".*", "-o", "-name", "node_modules", ")", "-prune", "-o",
    "-type", "f", "(", "-iname", "*.md", "-o", "-iname", "*.mdx", "-o", "-iname", "*.markdown", ")", "-print0"], { cwd, on });
  if (r.code !== 0 && !r.stdout) throw new Error(r.stderr.trim() || "Cannot list this folder");
  return { root: cwd, files: r.stdout.split("\0").filter(Boolean).map((p) => p.replace(/^\.\//, "")).sort(byFolder).slice(0, 2000) };
}
