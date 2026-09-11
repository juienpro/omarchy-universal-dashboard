import { spawn } from "node:child_process";

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

/**
 * Format tries, loosest last. Lives often have only HLS (91–95) — not progressive `b`.
 * Avoid insisting on `b[protocol*=m3u8]` which yt-dlp rejects when that combo is absent.
 */
const FORMAT_TRIES = [
  "95/94/93/92/91/90/96",
  "b",
  "best",
  "best*",
  "bv*+ba/b",
] as const;

export type YoutubeResolved = {
  videoId: string;
  title: string | null;
  src: string;
  protocol: string | null;
  ext: string | null;
  isLive: boolean;
  resolvedAt: string;
};

export function parseYoutubeId(input: string): string | null {
  const raw = String(input || "").trim();
  if (!raw) return null;
  if (VIDEO_ID_RE.test(raw)) return raw;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  if (host === "youtu.be") {
    const id = url.pathname.split("/").filter(Boolean)[0] || "";
    return VIDEO_ID_RE.test(id) ? id : null;
  }
  if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
    const v = url.searchParams.get("v");
    if (v && VIDEO_ID_RE.test(v)) return v;
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length >= 2 && ["embed", "live", "shorts", "v", "e"].includes(parts[0]!)) {
      const id = parts[1]!;
      return VIDEO_ID_RE.test(id) ? id : null;
    }
  }
  return null;
}

export function youtubeWatchUrl(input: string): string {
  const id = parseYoutubeId(input);
  if (id) return `https://www.youtube.com/watch?v=${id}`;
  const trimmed = String(input || "").trim();
  if (!trimmed) throw new Error("YouTube URL or video id required");
  return trimmed;
}

function runYtDlp(args: string[], timeoutMs = 90_000): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("yt-dlp", args, {
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`yt-dlp timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        reject(new Error("yt-dlp not found on PATH — install yt-dlp for Youtube widgets"));
      } else {
        reject(err);
      }
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        const msg = (stderr || stdout || `yt-dlp exited ${code}`).trim().split("\n").slice(-4).join(" ");
        reject(new Error(msg || `yt-dlp exited ${code}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

type YtFormat = {
  format_id?: string;
  url?: string;
  protocol?: string;
  ext?: string;
  vcodec?: string;
  acodec?: string;
  height?: number | null;
  tbr?: number | null;
  format_note?: string;
};

type YtDlpJson = {
  id?: string;
  title?: string;
  url?: string;
  protocol?: string;
  ext?: string;
  is_live?: boolean | null;
  was_live?: boolean | null;
  live_status?: string | null;
  formats?: YtFormat[];
  requested_formats?: YtFormat[];
};

function isHttpUrl(u: string | undefined): u is string {
  return !!u && /^https?:\/\//i.test(u);
}

function isHls(f: YtFormat): boolean {
  const p = String(f.protocol || "").toLowerCase();
  const e = String(f.ext || "").toLowerCase();
  return p.includes("m3u8") || e === "m3u8";
}

function hasVideo(f: YtFormat): boolean {
  return !!f.vcodec && f.vcodec !== "none";
}

function hasAudio(f: YtFormat): boolean {
  return !!f.acodec && f.acodec !== "none";
}

/** Prefer muxed HLS, then progressive A+V, then any video URL (height ≤720 when possible). */
function pickStreamUrl(data: YtDlpJson): { src: string; protocol: string | null; ext: string | null } | null {
  if (isHttpUrl(data.url) && (!data.requested_formats || data.requested_formats.length <= 1)) {
    return { src: data.url, protocol: data.protocol ?? null, ext: data.ext ?? null };
  }

  const formats = (data.formats || []).filter((f) => isHttpUrl(f.url) && hasVideo(f));
  if (!formats.length) return null;

  const score = (f: YtFormat): number => {
    let s = 0;
    if (isHls(f)) s += 1000;
    if (hasAudio(f)) s += 500;
    const h = typeof f.height === "number" ? f.height : 0;
    // Prefer ≤720 for panel; still accept higher
    if (h > 0 && h <= 720) s += h;
    else if (h > 720) s += 720 - Math.min(h - 720, 400);
    if (typeof f.tbr === "number") s += Math.min(f.tbr, 5000) / 100;
    return s;
  };

  formats.sort((a, b) => score(b) - score(a));
  const best = formats[0]!;
  return {
    src: best.url!,
    protocol: best.protocol ?? null,
    ext: best.ext ?? null,
  };
}

async function resolveViaFormatTry(watch: string): Promise<string> {
  let lastErr: Error | null = null;
  for (const format of FORMAT_TRIES) {
    try {
      const { stdout } = await runYtDlp([
        "--no-playlist",
        "--no-warnings",
        "--extractor-args",
        "youtube:player_client=android,web",
        "-f",
        format,
        "-g",
        watch,
      ]);
      const lines = stdout
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => /^https?:\/\//i.test(l));
      if (lines.length === 1) return lines[0]!;
      // DASH split (2+ lines): prefer skipping — Qt needs one URL. Try next format.
      if (lines.length > 1) {
        // If any line looks like m3u8, prefer that single playlist
        const hls = lines.find((u) => /m3u8/i.test(u));
        if (hls) return hls;
        lastErr = new Error(`format ${format} returned ${lines.length} URLs (DASH split)`);
        continue;
      }
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
    }
  }
  throw lastErr || new Error("No playable YouTube format found");
}

/**
 * Resolve a YouTube watch URL / id to a direct media URL (signed; refresh before expiry).
 */
export async function resolveYoutube(input: string): Promise<YoutubeResolved> {
  const watch = youtubeWatchUrl(input);
  const idHint = parseYoutubeId(input);

  let data: YtDlpJson;
  try {
    const { stdout } = await runYtDlp([
      "--no-playlist",
      "--no-warnings",
      "--extractor-args",
      "youtube:player_client=android,web",
      "-J",
      watch,
    ]);
    data = JSON.parse(stdout) as YtDlpJson;
  } catch (e) {
    // Metadata dump failed — still try format ladder with -g
    const src = await resolveViaFormatTry(watch);
    const videoId = idHint;
    if (!videoId) throw e instanceof Error ? e : new Error(String(e));
    return {
      videoId,
      title: null,
      src,
      protocol: null,
      ext: null,
      isLive: false,
      resolvedAt: new Date().toISOString(),
    };
  }

  const liveStatus = String(data.live_status || "").toLowerCase();
  const isLive =
    data.is_live === true || liveStatus === "is_live" || liveStatus === "is_upcoming";

  let picked = pickStreamUrl(data);
  let src = picked?.src ?? "";
  let protocol = picked?.protocol ?? null;
  let ext = picked?.ext ?? null;

  if (!src) {
    src = await resolveViaFormatTry(watch);
  }

  if (!src || !/^https?:\/\//i.test(src)) {
    throw new Error("yt-dlp did not return an http(s) media URL (try: yt-dlp -U)");
  }

  const videoId = (data.id && VIDEO_ID_RE.test(data.id) ? data.id : null) || idHint;
  if (!videoId) throw new Error("Could not determine YouTube video id");

  return {
    videoId,
    title: typeof data.title === "string" ? data.title : null,
    src,
    protocol,
    ext,
    isLive,
    resolvedAt: new Date().toISOString(),
  };
}

export async function ytDlpAvailable(): Promise<boolean> {
  try {
    await runYtDlp(["--version"], 10_000);
    return true;
  } catch {
    return false;
  }
}
