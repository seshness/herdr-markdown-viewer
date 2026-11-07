// The picker's directory tree: relative file paths in, visible rows out.

// { dirs: Map(name -> node), files: [name], path } with folders first when flattened.
export function buildTree(files) {
  const root = { path: "", dirs: new Map(), files: [] };
  for (const rel of files) {
    const parts = rel.split("/");
    let node = root;
    for (const dir of parts.slice(0, -1)) {
      if (!node.dirs.has(dir)) node.dirs.set(dir, { path: node.path ? `${node.path}/${dir}` : dir, dirs: new Map(), files: [] });
      node = node.dirs.get(dir);
    }
    node.files.push(parts[parts.length - 1]);
  }
  return root;
}

const byName = (a, b) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });

// A folder holding a single folder and no file shows as one row ("docs/guides"), as editors do.
function compact(name, node) {
  while (node.files.length === 0 && node.dirs.size === 1) {
    const [[child, next]] = node.dirs;
    name = `${name}/${child}`;
    node = next;
  }
  return { name, node };
}

// Rows to draw: { dir, name, path, depth, count } where path is the full relative path of the
// folder (a key for `open`) or file; count is how many Markdown files a folder holds.
export function rows(tree, open) {
  const out = [];
  const count = (n) => n.files.length + [...n.dirs.values()].reduce((s, d) => s + count(d), 0);
  const walk = (node, depth) => {
    for (const name of [...node.dirs.keys()].sort(byName)) {
      const c = compact(name, node.dirs.get(name));
      out.push({ dir: true, name: c.name, path: c.node.path, depth, count: count(c.node) });
      if (open.has(c.node.path)) walk(c.node, depth + 1);
    }
    for (const name of [...node.files].sort(byName)) {
      out.push({ dir: false, name, path: node.path ? `${node.path}/${name}` : name, depth });
    }
  };
  walk(tree, 0);
  return out;
}

// Every folder path a tree shows (after compacting), to open them all.
export function folders(tree) {
  const out = [];
  const walk = (node) => {
    for (const [name, child] of node.dirs) {
      const c = compact(name, child);
      out.push(c.node.path);
      walk(c.node);
    }
  };
  walk(tree);
  return out;
}
