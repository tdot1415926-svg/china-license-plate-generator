import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the license plate generator", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>牌研所｜中国机动车号牌生成器<\/title>/i);
  assert.match(html, /规则库 GA 36—2018/);
  assert.match(html, /大型汽车后牌/);
  assert.match(html, /大型新能源/);
  assert.match(html, /厂（场）内车辆/);
  assert.match(html, /临时号牌/);
  assert.doesNotMatch(html, /SAMPLE|仅供设计测试/i);
});

test("keeps physical dimensions and safe export rules in source", async () => {
  const [page, css, readme] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../README.md", import.meta.url), "utf8"),
  ]);

  assert.match(page, /yellowRear: \{ width: 440, height: 220 \}/);
  assert.match(page, /nevLarge: \{ width: 480, height: 140 \}/);
  assert.match(page, /temp: \{ width: 220, height: 140 \}/);
  assert.match(page, /renderPlate\(canvas, 6\)/);
  assert.match(page, /renderPlate\(previewCanvas\.current, 2\)/);
  assert.match(page, /请勿用于伪造证件或违法用途/);
  assert.match(css, /\.plate-energy \{ aspect-ratio:24\/7; \}/);
  assert.match(css, /\.plate-rear \{[^}]*aspect-ratio:2\/1/);
  assert.match(readme, /约 300 DPI/);
  assert.doesNotMatch(`${page}\n${css}`, /SAMPLE|仅供设计测试/);
});
