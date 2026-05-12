import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

let cachedBundle: string | null = null;

async function buildDemo(): Promise<string> {
  const result = await Bun.build({
    entrypoints: [join(__dirname, "demo.ts")],
    target: "browser",
    format: "esm",
    outdir: "/tmp/hls-ts-demo-out",
    naming: "[dir]/demo.[ext]",
    sourcemap: "none",
    minify: false,
  });

  if (!result.success) {
    const errors = result.logs.map((l) => l.message || String(l)).join("\n");
    throw new Error(`Build failed:\n${errors}`);
  }

  const output = result.outputs[0];
  if (!output) throw new Error("No output generated");

  return output.text();
}

async function rebuild() {
  try {
    cachedBundle = await buildDemo();
    console.log("[demo] Bundle rebuilt successfully");
  } catch (err) {
    console.error("[demo] Build error:", (err as Error).message);
  }
}

const server = Bun.serve({
  port: 3001,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/" || url.pathname === "/index.html") {
      const html = await Bun.file(join(__dirname, "index.html")).text();
      return new Response(html, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    if (url.pathname === "/demo.js") {
      if (!cachedBundle) await rebuild();
      return new Response(cachedBundle, {
        headers: { "Content-Type": "application/javascript; charset=utf-8" },
      });
    }

    if (url.pathname === "/__rebuild") {
      await rebuild();
      return new Response("OK");
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(`\n  hls-ts demo server running at:\n  → http://localhost:${server.port}\n`);

// Initial build
await rebuild();

console.log("[demo] Ready for requests. Use /__rebuild to rebuild the bundle.");
