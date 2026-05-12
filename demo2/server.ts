import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

let cachedWorker: string | null = null;
let cachedBundle: string | null = null;

async function buildDemo(): Promise<{ demo: string; worker: string }> {
  const result = await Bun.build({
    entrypoints: [
      join(__dirname, "demo.ts"),
      join(root, "src/remux/transmuxer-worker.ts")
    ],
    target: "browser",
    format: "esm",
    outdir: "/tmp/hls-ts-demo-out",
    naming: "[name].[ext]",
    sourcemap: "none",
    minify: false,
  });

  if (!result.success) {
    const errors = result.logs.map((l) => l.message || String(l)).join("\n");
    throw new Error(`Build failed:\n${errors}`);
  }

  const demoOutput = result.outputs.find(o => o.path.endsWith("demo.js"));
  const workerOutput = result.outputs.find(o => o.path.endsWith("transmuxer-worker.js"));

  if (!demoOutput || !workerOutput) throw new Error("Missing outputs");

  return {
    demo: await demoOutput.text(),
    worker: await workerOutput.text()
  };
}

async function rebuild() {
  try {
    const { demo, worker } = await buildDemo();
    cachedWorker = worker;
    cachedBundle = demo;
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

    if (url.pathname === "/transmuxer-worker.js") {
      if (!cachedWorker) await rebuild();
      return new Response(cachedWorker, {
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
