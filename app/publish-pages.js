#!/usr/bin/env node
/* Push the app to the public GitHub Pages repository the staff install from.
 *
 *   node app/publish-pages.js ["why this change"]
 *
 * The published repository is generated, not edited: this clones it fresh,
 * copies over the files the app actually needs at runtime, and pushes if
 * anything changed. Editing it directly would be silently undone the next time
 * this runs.
 *
 * Only the seven runtime files go. The local server and the icon script stay
 * in the private repository — they are not needed to run the app, and the
 * smaller the public surface the less there is to get wrong.
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");

const REPO = "https://github.com/hadibaghdadi2005-svg/chinahub-warehouse-app.git";
const LIVE = "https://hadibaghdadi2005-svg.github.io/chinahub-warehouse-app/";
const FILES = [
  "index.html", "app.js", "styles.css", "sw.js", "manifest.webmanifest", "icon-180.png",
  "logo.png", "logo-mark.png", "icon-192.png", "icon-512.png", "icon-maskable-512.png",
];
const why = process.argv[2] || "Update the app";

const work = fs.mkdtempSync(path.join(os.tmpdir(), "chinahub-pages-"));
const git = (...args) =>
  execFileSync("git", args, { cwd: work, stdio: ["ignore", "pipe", "pipe"] }).toString().trim();

try {
  execFileSync("git", ["clone", "--depth", "1", REPO, work],
    { stdio: ["ignore", "pipe", "pipe"] });

  for (const f of FILES) fs.copyFileSync(path.join(__dirname, f), path.join(work, f));

  /* Stamp the build. Both of these have to change on every publish: the page
     so anyone can say which version they are looking at, and the worker
     because a browser that sees identical bytes keeps the old one — and with
     it the old app. The local copies keep saying "dev". */
  const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(2, 13);
  const bump = (f, from, to) => {
    const p = path.join(work, f);
    const before = fs.readFileSync(p, "utf8");
    const after = before.replace(from, to);
    if (before === after) throw new Error("could not stamp the build into " + f);
    fs.writeFileSync(p, after);
  };
  bump("app.js", 'const BUILD = "dev";', 'const BUILD = "' + stamp + '";');
  bump("sw.js", '"chinahub-dev"', '"chinahub-' + stamp + '"');

  /* Stage first, then ask. On Windows a copied file can look modified to
     `git status` purely from line endings and come out identical once git has
     normalised it, so the only honest check is against what is staged.
     `diff --cached --quiet` exits 1 when there is something to commit. */
  git("add", "-A");
  let changed = false;
  try {
    execFileSync("git", ["diff", "--cached", "--quiet"],
      { cwd: work, stdio: ["ignore", "pipe", "pipe"] });
  } catch (_) { changed = true; }

  if (!changed) {
    console.log("nothing changed — already published");
    console.log(LIVE);
    process.exit(0);
  }
  execFileSync("git", [
    "-c", "user.name=Hadi", "-c", "user.email=hadibaghdadi11@gmail.com",
    "commit", "-q", "-m", why,
  ], { cwd: work, stdio: ["ignore", "pipe", "pipe"] });
  git("push", "-q", "origin", "HEAD:main");

  console.log("published: " + why);
  console.log(LIVE);
  console.log("\nGitHub takes a minute or so to rebuild. The app also caches");
  console.log("itself, so an already-installed copy picks the change up on its");
  console.log("next start rather than instantly.");
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
