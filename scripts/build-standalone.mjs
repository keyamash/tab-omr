import { mkdir, readFile, rm, writeFile } from "node:fs/promises";

const read = (path, encoding = "utf8") => readFile(new URL(`../${path}`, import.meta.url), encoding);
const [htmlSource, cssSource, extraCss, appJs, og, favicon] = await Promise.all([
  read("standalone/index.html"),
  read("frontend/src/styles.css"),
  read("standalone/extra.css"),
  read("standalone/app.js"),
  read("public/og.jpg", null),
  read("public/favicon.svg"),
]);
const apiBase = process.env.PUBLIC_API_BASE_URL ?? "";
const html = htmlSource.replace(
  '<script src="/app.js" defer></script>',
  `<script>globalThis.TAB_OMR_API_BASE=${JSON.stringify(apiBase)}</script><script src="/app.js" defer></script>`,
);
const css = `${cssSource}\n${extraCss}`;
const ogBase64 = og.toString("base64");
const worker = `const files={
"/":{body:${JSON.stringify(html)},type:"text/html; charset=utf-8"},
"/index.html":{body:${JSON.stringify(html)},type:"text/html; charset=utf-8"},
"/app.css":{body:${JSON.stringify(css)},type:"text/css; charset=utf-8"},
"/app.js":{body:${JSON.stringify(appJs)},type:"text/javascript; charset=utf-8"},
"/favicon.svg":{body:${JSON.stringify(favicon)},type:"image/svg+xml"},
"/og.jpg":{body:Uint8Array.from(atob(${JSON.stringify(ogBase64)}),c=>c.charCodeAt(0)),type:"image/jpeg"}
};
export default {async fetch(request){const url=new URL(request.url);const file=files[url.pathname]??files["/"];return new Response(request.method==="HEAD"?null:file.body,{status:files[url.pathname]||url.pathname==="/"?200:404,headers:{"content-type":file.type,"cache-control":url.pathname==="/"?"no-cache":"public, max-age=86400","x-content-type-options":"nosniff","referrer-policy":"strict-origin-when-cross-origin"}})}};`;
const root = new URL("../dist/", import.meta.url);
await rm(root, { recursive: true, force: true });
await mkdir(new URL("server/", root), { recursive: true });
await writeFile(new URL("server/index.js", root), worker);
console.log("Standalone Sites build complete");

