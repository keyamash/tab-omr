import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";

const root = new URL("../pages-dist/", import.meta.url);
const read = (path) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");
const [htmlSource, css, extraCss] = await Promise.all([
  read("standalone/index.html"),
  read("frontend/src/styles.css"),
  read("standalone/extra.css"),
]);
const apiBase = process.env.PUBLIC_API_BASE_URL ?? "";
const html = htmlSource
  .replace(
    '<script src="./app.js" defer></script>',
    `<script>globalThis.TAB_OMR_API_BASE=${JSON.stringify(apiBase)}</script><script src="./app.js" defer></script>`,
  )
  .replace(
    'content="./og.jpg"',
    'content="https://keyamash.github.io/tab-omr/og.jpg"',
  );

await rm(root, { recursive: true, force: true });
await mkdir(root, { recursive: true });
await Promise.all([
  writeFile(new URL("index.html", root), html),
  writeFile(new URL("app.css", root), `${css}\n${extraCss}`),
  writeFile(new URL(".nojekyll", root), ""),
  copyFile(
    new URL("../standalone/app.js", import.meta.url),
    new URL("app.js", root),
  ),
  copyFile(
    new URL("../standalone/overlap.js", import.meta.url),
    new URL("overlap.js", root),
  ),
  copyFile(
    new URL("../public/og.jpg", import.meta.url),
    new URL("og.jpg", root),
  ),
  copyFile(
    new URL("../public/favicon.svg", import.meta.url),
    new URL("favicon.svg", root),
  ),
]);
console.log("GitHub Pages build complete");
