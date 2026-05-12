import { Hls, Events } from "../index";
import type { LevelParsed, LevelDetails, Fragment, FragmentStats, HlsError } from "../src/types";

const video = document.getElementById("video") as HTMLVideoElement;
const streamUrl = document.getElementById("streamUrl") as HTMLInputElement;
const loadBtn = document.getElementById("loadBtn") as HTMLButtonElement;
const playBtn = document.getElementById("playBtn") as HTMLButtonElement;
const pauseBtn = document.getElementById("pauseBtn") as HTMLButtonElement;
const presetSelect = document.getElementById("presetSelect") as HTMLSelectElement;
const statusText = document.getElementById("statusText") as HTMLSpanElement;
const logContainer = document.getElementById("logContainer") as HTMLDivElement;

const statState = document.getElementById("statState") as HTMLDivElement;
const statBw = document.getElementById("statBw") as HTMLDivElement;
const statRes = document.getElementById("statRes") as HTMLDivElement;
const statBuf = document.getElementById("statBuf") as HTMLDivElement;
const statTime = document.getElementById("statTime") as HTMLDivElement;
const statLevels = document.getElementById("statLevels") as HTMLDivElement;
const statCap = document.getElementById("statCap") as HTMLDivElement;

let hls: Hls | null = null;

function appendLog(msg: string, cls = "log-info") {
  const entry = document.createElement("div");
  entry.className = `log-entry ${cls}`;
  entry.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  logContainer.appendChild(entry);
  logContainer.scrollTop = logContainer.scrollHeight;
  if (logContainer.children.length > 50) {
    logContainer.removeChild(logContainer.firstChild!);
  }
}

function formatBitrate(bps: number): string {
  if (bps < 1000) return `${bps.toFixed(0)} bps`;
  if (bps < 1_000_000) return `${(bps / 1000).toFixed(0)} Kbps`;
  return `${(bps / 1_000_000).toFixed(2)} Mbps`;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function updateStats() {
  if (!hls) return;
  statBw.textContent = formatBitrate(hls.abr?.bwEstimate ?? 0);
  statCap.textContent = hls.autoLevelCapping >= 0 ? `Up to lvl ${hls.autoLevelCapping}` : "Auto";
  statLevels.textContent = `${hls.levels?.length ?? 0} levels`;
  if (video) statTime.textContent = formatDuration(video.currentTime);
}

function destroyHls() {
  if (hls) {
    try { hls.destroy(); } catch { /* ignore */ }
    hls = null;
  }
}

function loadSource(url: string) {
  destroyHls();

  if (!Hls.isSupported()) {
    statusText.textContent = "MSE not supported";
    appendLog("MediaSource Extensions not available", "log-error");
    return;
  }

  hls = new Hls({ debug: false, startLevel: -1 });
  streamUrl.value = url;
  statusText.textContent = "Loading...";
  appendLog(`Loading: ${url}`);
  playBtn.disabled = true;
  pauseBtn.disabled = true;

  hls.on(Events.MANIFEST_LOADING, ({ url: u }: { url: string }) => {
    appendLog(`Fetching manifest: ${u}`);
    statState.textContent = "Loading Manifest";
  });

  hls.on(Events.MANIFEST_LOADED, ({ data }: { data: string }) => {
    appendLog(`Manifest loaded (${(data.length / 1024).toFixed(1)} KB)`);
  });

  hls.on(Events.MANIFEST_PARSED, ({ levels }: { levels: LevelParsed[] }) => {
    appendLog(`Parsed: ${levels.length} quality level(s)`, "log-info");
    statState.textContent = "Playing";
    statusText.textContent = "Playing";
    playBtn.disabled = false;
    pauseBtn.disabled = false;
    if (levels.length > 0 && levels[0].width) {
      statRes.textContent = `${levels[0].width}x${levels[0].height}`;
    }
  });

  hls.on(Events.LEVEL_SWITCHING, ({ level }: { level: number }) => {
    appendLog(`Switching to level ${level}`, "log-warn");
  });

  hls.on(Events.LEVEL_SWITCHED, ({ level }: { level: number }) => {
    const lvl = hls?.levels?.[level];
    if (lvl) {
      statRes.textContent = lvl.width ? `${lvl.width}x${lvl.height}` : "N/A";
      appendLog(`Level ${level}: ${formatBitrate(lvl.bitrate)}${lvl.width ? ` @ ${lvl.width}x${lvl.height}` : ""}`, "log-info");
    }
  });

  hls.on(Events.LEVEL_UPDATED, ({ details }: { details: LevelDetails }) => {
    appendLog(`Level updated: ${details.fragments?.length ?? 0} fragments (${details.live ? "LIVE" : "VOD"})`);
  });

  hls.on(Events.FRAG_LOADING, ({ frag }: { frag: Fragment }) => {
    appendLog(`Loading fragment #${frag.sn}`);
  });

  hls.on(Events.FRAG_LOADED, ({ frag, stats }: { frag: Fragment; stats: FragmentStats }) => {
    const loadMs = stats.tload - stats.tfirst;
    const bw = loadMs > 0 ? (stats.loaded * 8 * 1000) / loadMs : 0;
    const sizeKB = (stats.loaded / 1024).toFixed(0);
    appendLog(`Fragment #${frag.sn}: ${sizeKB}KB in ${loadMs.toFixed(0)}ms (${formatBitrate(bw)})`);
    updateStats();
  });

  hls.on(Events.FRAG_PARSED, ({ frag }: { frag: Fragment }) => {
    appendLog(`Parsed fragment #${frag.sn}`);
  });

  hls.on(Events.FRAG_BUFFERED, ({ frag }: { frag: Fragment }) => {
    appendLog(`Buffered fragment #${frag.sn}`, "log-info");
    updateStats();
  });

  hls.on(Events.ERROR, (error: HlsError) => {
    const type = error.type || "unknown";
    const details = error.details || "";
    const fatal = error.fatal ? " FATAL" : "";
    appendLog(`Error${fatal}: ${type}/${details} - ${error.reason || ""}`, error.fatal ? "log-error" : "log-warn");
  });

  hls.on(Events.DESTROYING, () => {
    appendLog("Hls instance destroyed");
  });

  hls.attachMedia(video);
  hls.loadSource(url);
}

loadBtn.addEventListener("click", () => {
  const url = streamUrl.value.trim();
  if (url) loadSource(url);
});

presetSelect.addEventListener("change", () => {
  if (presetSelect.value) loadSource(presetSelect.value);
});

playBtn.addEventListener("click", () => video.play().catch(() => { }));
pauseBtn.addEventListener("click", () => video.pause());
streamUrl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") loadSource(streamUrl.value.trim());
});

video.addEventListener("timeupdate", () => {
  if (!video.buffered.length) return;
  let buffered = 0;
  for (let i = 0; i < video.buffered.length; i++) {
    if (video.currentTime >= video.buffered.start(i)) {
      buffered = video.buffered.end(i) - video.currentTime;
    }
  }
  statBuf.textContent = `${buffered.toFixed(1)}s`;
  updateStats();
});

setInterval(updateStats, 1000);

if (streamUrl.value) loadSource(streamUrl.value);
