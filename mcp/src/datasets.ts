import { readFileSync, existsSync, unlinkSync, readdirSync } from "node:fs";
import {
  datasetsDir,
  datasetsIndexPath,
  datasetFilePath,
  ensureDirs,
  writeAtomic,
  nowIso,
} from "./paths.js";
import { runTransform } from "./transform.js";

export type DatasetSource = {
  /** HTTP GET URL returning JSON */
  url: string;
  /** Optional request headers */
  headers?: Record<string, string>;
  /**
   * Dot path into the JSON body (e.g. "items.0").
   * Empty / omitted = whole body.
   */
  jsonPath?: string;
};

export type DatasetRecord = {
  key: string;
  source: DatasetSource;
  /**
   * Optional QuickJS function body `(data) => …` run after GET+jsonPath.
   * Sync only; must return JSON-serializable value.
   */
  transform?: string;
  /** Minimum 60. Plugin refreshes when nextRefreshAt is due. */
  refreshIntervalSec: number;
  data: unknown;
  fetchedAt: string | null;
  error: string | null;
  nextRefreshAt: string | null;
  updatedAt: string;
};

export type DatasetMeta = {
  key: string;
  refreshIntervalSec: number;
  fetchedAt: string | null;
  error: string | null;
  nextRefreshAt: string | null;
  updatedAt: string;
  hasData: boolean;
};

const KEY_RE = /^[a-z][a-z0-9-]*$/;
const MIN_INTERVAL = 60;
const FETCH_TIMEOUT_MS = 20_000;

export function isPersistedDatasetKey(key: string): boolean {
  return KEY_RE.test(key) && !key.startsWith("_");
}

export function isEphemeralDatasetKey(key: string): boolean {
  return key.startsWith("_screen.") || key.startsWith("_url.");
}

function assertPersistedKey(key: string) {
  if (!isPersistedDatasetKey(key)) {
    throw new Error(
      `Invalid dataset key "${key}" — use a slug like orders-live (not _screen.* / _url.*)`,
    );
  }
}

function readIndex(): DatasetMeta[] {
  ensureDirs();
  if (!existsSync(datasetsIndexPath())) return [];
  try {
    const raw = JSON.parse(readFileSync(datasetsIndexPath(), "utf8"));
    return Array.isArray(raw.datasets) ? (raw.datasets as DatasetMeta[]) : [];
  } catch {
    return [];
  }
}

function writeIndex(datasets: DatasetMeta[]) {
  writeAtomic(datasetsIndexPath(), JSON.stringify({ datasets }, null, 2) + "\n");
}

function toMeta(rec: DatasetRecord): DatasetMeta {
  return {
    key: rec.key,
    refreshIntervalSec: rec.refreshIntervalSec,
    fetchedAt: rec.fetchedAt,
    error: rec.error,
    nextRefreshAt: rec.nextRefreshAt,
    updatedAt: rec.updatedAt,
    hasData: rec.data !== undefined && rec.data !== null,
  };
}

function syncIndexEntry(rec: DatasetRecord) {
  const meta = toMeta(rec);
  const index = readIndex();
  const i = index.findIndex((d) => d.key === rec.key);
  if (i >= 0) index[i] = meta;
  else index.push(meta);
  writeIndex(index);
}

export function listDatasets(): DatasetMeta[] {
  return readIndex().slice().sort((a, b) => a.key.localeCompare(b.key));
}

export function getDataset(key: string): DatasetRecord | null {
  assertPersistedKey(key);
  const path = datasetFilePath(key);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as DatasetRecord;
  } catch {
    return null;
  }
}

function persistDataset(rec: DatasetRecord): DatasetRecord {
  writeAtomic(datasetFilePath(rec.key), JSON.stringify(rec, null, 2) + "\n");
  syncIndexEntry(rec);
  return rec;
}

function parseSource(raw: unknown): DatasetSource {
  if (!raw || typeof raw !== "object") throw new Error("source is required");
  const obj = raw as Record<string, unknown>;
  const url = String(obj.url || "").trim();
  if (!url) throw new Error("source.url is required");
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid source.url: ${url}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("source.url must be http(s)");
  }
  const headers =
    obj.headers && typeof obj.headers === "object" && !Array.isArray(obj.headers)
      ? Object.fromEntries(
          Object.entries(obj.headers as Record<string, unknown>).map(([k, v]) => [k, String(v)]),
        )
      : undefined;
  const jsonPath =
    obj.jsonPath !== undefined && obj.jsonPath !== null && String(obj.jsonPath).trim()
      ? String(obj.jsonPath).trim()
      : undefined;
  return { url, headers, jsonPath };
}

export function upsertDataset(input: {
  key: string;
  source: unknown;
  refreshIntervalSec?: number;
  /** Function body; pass null to clear. Omit to keep existing. */
  transform?: string | null;
}): DatasetRecord {
  const key = String(input.key || "")
    .trim()
    .toLowerCase();
  assertPersistedKey(key);
  const source = parseSource(input.source);
  const refreshIntervalSec = Math.max(MIN_INTERVAL, Math.floor(input.refreshIntervalSec ?? 600));
  const existing = getDataset(key);
  const now = nowIso();

  let transform: string | undefined = existing?.transform;
  if (input.transform === null) transform = undefined;
  else if (typeof input.transform === "string") {
    const t = input.transform;
    if (t.length > 64_000) throw new Error("transform too large (max 64000 chars)");
    transform = t.trim() ? t : undefined;
  }

  const rec: DatasetRecord = {
    key,
    source,
    ...(transform !== undefined ? { transform } : {}),
    refreshIntervalSec,
    data: existing?.data ?? null,
    fetchedAt: existing?.fetchedAt ?? null,
    error: existing?.error ?? null,
    nextRefreshAt: now,
    updatedAt: now,
  };
  return persistDataset(rec);
}

export function deleteDatasetFile(key: string): void {
  assertPersistedKey(key);
  const path = datasetFilePath(key);
  if (existsSync(path)) unlinkSync(path);
  writeIndex(readIndex().filter((d) => d.key !== key));
}

function readPath(data: unknown, path?: string): unknown {
  if (!path) return data;
  const parts = path.split(".").filter(Boolean);
  let cur: unknown = data;
  for (const part of parts) {
    if (cur === null || cur === undefined) return undefined;
    if (Array.isArray(cur)) {
      const idx = Number(part);
      if (!Number.isInteger(idx)) return undefined;
      cur = cur[idx];
      continue;
    }
    if (typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

async function fetchJson(source: DatasetSource): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(source.url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        ...(source.headers || {}),
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    const body = await res.json();
    const sliced = readPath(body, source.jsonPath);
    if (sliced === undefined) {
      throw new Error(`jsonPath "${source.jsonPath}" not found in response`);
    }
    return sliced;
  } finally {
    clearTimeout(timer);
  }
}

function nextRefreshIso(intervalSec: number, from = Date.now()): string {
  return new Date(from + intervalSec * 1000).toISOString();
}

export function summarizeDataset(rec: DatasetRecord) {
  const data = Array.isArray(rec.data)
    ? { kind: "array", rows: rec.data.length, preview: rec.data.slice(0, 3), truncated: rec.data.length > 3 }
    : rec.data && typeof rec.data === "object"
      ? { kind: "object", preview: rec.data, truncated: false }
      : { kind: "other", preview: rec.data, truncated: false };
  const transform = rec.transform
    ? {
        chars: rec.transform.length,
        preview: rec.transform.length > 240 ? rec.transform.slice(0, 240) + "…" : rec.transform,
      }
    : null;
  return {
    key: rec.key,
    source: rec.source,
    transform,
    refreshIntervalSec: rec.refreshIntervalSec,
    fetchedAt: rec.fetchedAt,
    error: rec.error,
    nextRefreshAt: rec.nextRefreshAt,
    updatedAt: rec.updatedAt,
    data,
  };
}

export async function refreshDatasetRecord(key: string): Promise<DatasetRecord> {
  assertPersistedKey(key);
  const rec = getDataset(key);
  if (!rec) throw new Error(`Dataset not found: ${key}`);
  const now = nowIso();
  try {
    let data = await fetchJson(rec.source);
    if (rec.transform) {
      data = await runTransform(rec.transform, data);
    }
    const next: DatasetRecord = {
      ...rec,
      data,
      fetchedAt: now,
      error: null,
      nextRefreshAt: nextRefreshIso(rec.refreshIntervalSec),
      updatedAt: now,
    };
    return persistDataset(next);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const next: DatasetRecord = {
      ...rec,
      error: message,
      nextRefreshAt: nextRefreshIso(rec.refreshIntervalSec),
      updatedAt: now,
    };
    persistDataset(next);
    throw new Error(`Refresh failed for ${key}: ${message}`);
  }
}

export async function refreshDueDatasetRecords(): Promise<{
  refreshed: DatasetRecord[];
  failed: Array<{ key: string; error: string }>;
  skipped: string[];
}> {
  ensureDirs();
  if (readIndex().length === 0 && existsSync(datasetsDir())) {
    for (const name of readdirSync(datasetsDir())) {
      if (!name.endsWith(".json")) continue;
      const key = name.slice(0, -5);
      if (!isPersistedDatasetKey(key)) continue;
      const rec = getDataset(key);
      if (rec) syncIndexEntry(rec);
    }
  }

  const now = Date.now();
  const refreshed: DatasetRecord[] = [];
  const failed: Array<{ key: string; error: string }> = [];
  const skipped: string[] = [];

  for (const meta of listDatasets()) {
    const rec = getDataset(meta.key);
    if (!rec) continue;
    const due =
      !rec.nextRefreshAt ||
      Number.isNaN(Date.parse(rec.nextRefreshAt)) ||
      Date.parse(rec.nextRefreshAt) <= now;
    if (!due) {
      skipped.push(rec.key);
      continue;
    }
    try {
      refreshed.push(await refreshDatasetRecord(rec.key));
    } catch (err) {
      failed.push({
        key: rec.key,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { refreshed, failed, skipped };
}

/** Collect persisted dataset payloads for keys referenced by a view/screen. */
export function cacheForKeys(keys: Iterable<string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (!isPersistedDatasetKey(key)) continue;
    const rec = getDataset(key);
    if (rec && rec.data !== undefined && rec.data !== null) {
      out[key] = rec.data;
    }
  }
  return out;
}
