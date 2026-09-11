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

export type DatasetHttpSource = {
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

export type DatasetDerivedSource = {
  /** Parent persisted dataset key — reads its cached `data` (no HTTP). */
  dataset: string;
  /**
   * Dot path into the parent payload (e.g. "items.0").
   * Empty / omitted = whole parent data.
   */
  jsonPath?: string;
};

export type DatasetMultiDerivedSource = {
  /**
   * Two or more parent keys. Resolve builds `{ [parentKey]: data }`.
   * No top-level jsonPath — slice/join in `transform`.
   */
  datasets: string[];
};

export type DatasetSource = DatasetHttpSource | DatasetDerivedSource | DatasetMultiDerivedSource;

export type DatasetRecord = {
  key: string;
  source: DatasetSource;
  /**
   * Optional QuickJS function body `(data) => …` run after resolve+jsonPath.
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

export function isSingleDerivedSource(source: DatasetSource): source is DatasetDerivedSource {
  return "dataset" in source && typeof (source as DatasetDerivedSource).dataset === "string";
}

export function isMultiDerivedSource(source: DatasetSource): source is DatasetMultiDerivedSource {
  return "datasets" in source && Array.isArray((source as DatasetMultiDerivedSource).datasets);
}

export function isDerivedSource(
  source: DatasetSource,
): source is DatasetDerivedSource | DatasetMultiDerivedSource {
  return isSingleDerivedSource(source) || isMultiDerivedSource(source);
}

export function isHttpSource(source: DatasetSource): source is DatasetHttpSource {
  return "url" in source && typeof (source as DatasetHttpSource).url === "string";
}

/** Parent dataset keys this source depends on (empty for HTTP). */
export function parentKeysOf(source: DatasetSource): string[] {
  if (isMultiDerivedSource(source)) return source.datasets.slice();
  if (isSingleDerivedSource(source)) return [source.dataset];
  return [];
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

function parseJsonPath(obj: Record<string, unknown>): string | undefined {
  return obj.jsonPath !== undefined && obj.jsonPath !== null && String(obj.jsonPath).trim()
    ? String(obj.jsonPath).trim()
    : undefined;
}

const MAX_MULTI_PARENTS = 16;

function parseSource(raw: unknown): DatasetSource {
  if (!raw || typeof raw !== "object") throw new Error("source is required");
  const obj = raw as Record<string, unknown>;
  const hasUrl = obj.url !== undefined && obj.url !== null && String(obj.url).trim() !== "";
  const hasDataset =
    obj.dataset !== undefined && obj.dataset !== null && String(obj.dataset).trim() !== "";
  const hasDatasets = obj.datasets !== undefined && obj.datasets !== null;

  const modes = [hasUrl, hasDataset, hasDatasets].filter(Boolean).length;
  if (modes > 1) {
    throw new Error("source must have exactly one of url, dataset, or datasets");
  }
  if (modes === 0) {
    throw new Error("source.url, source.dataset, or source.datasets is required");
  }

  const jsonPath = parseJsonPath(obj);

  if (hasDatasets) {
    if (jsonPath) {
      throw new Error("source.jsonPath is not supported with source.datasets — slice in transform");
    }
    if (!Array.isArray(obj.datasets)) {
      throw new Error("source.datasets must be an array of dataset keys");
    }
    if (obj.datasets.length < 2) {
      throw new Error("source.datasets needs at least 2 keys (use source.dataset for a single parent)");
    }
    if (obj.datasets.length > MAX_MULTI_PARENTS) {
      throw new Error(`source.datasets too many parents (max ${MAX_MULTI_PARENTS})`);
    }
    const parents: string[] = [];
    const seen = new Set<string>();
    for (const item of obj.datasets) {
      const parentKey = String(item || "")
        .trim()
        .toLowerCase();
      assertPersistedKey(parentKey);
      if (seen.has(parentKey)) {
        throw new Error(`source.datasets duplicate key: ${parentKey}`);
      }
      seen.add(parentKey);
      parents.push(parentKey);
    }
    return { datasets: parents };
  }

  if (hasDataset) {
    const parentKey = String(obj.dataset).trim().toLowerCase();
    assertPersistedKey(parentKey);
    return { dataset: parentKey, ...(jsonPath ? { jsonPath } : {}) };
  }

  const url = String(obj.url).trim();
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
  return { url, ...(headers ? { headers } : {}), ...(jsonPath ? { jsonPath } : {}) };
}

/**
 * Ensure derived source does not introduce a cycle: walk all ancestors of every
 * parent; if `key` appears, the new edge would close a loop.
 */
function assertAcyclicDerived(key: string, source: DatasetSource) {
  const roots = parentKeysOf(source);
  if (roots.length === 0) return;
  for (const p of roots) {
    if (p === key) {
      throw new Error(`Dataset "${key}" cannot derive from itself`);
    }
    if (!getDataset(p)) {
      throw new Error(`Parent dataset not found: ${p}`);
    }
  }
  const stack = roots.slice();
  const visited = new Set<string>();
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === key) {
      throw new Error(`Dataset cycle detected involving "${key}"`);
    }
    if (visited.has(cur)) continue;
    visited.add(cur);
    const rec = getDataset(cur);
    if (!rec) {
      throw new Error(`Parent dataset not found: ${cur}`);
    }
    for (const p of parentKeysOf(rec.source)) {
      stack.push(p);
    }
  }
}

/** Direct children that depend on `parentKey` via dataset or datasets. */
export function dependentsOf(parentKey: string): string[] {
  const out: string[] = [];
  for (const meta of listDatasets()) {
    const rec = getDataset(meta.key);
    if (!rec || !isDerivedSource(rec.source)) continue;
    if (parentKeysOf(rec.source).includes(parentKey)) out.push(rec.key);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

/** Topological order: parents before derived children. Isolated / HTTP first by key. */
function topoSortKeys(keys: string[]): string[] {
  const keySet = new Set(keys);
  const indegree = new Map<string, number>();
  const children = new Map<string, string[]>();
  for (const k of keys) {
    indegree.set(k, 0);
    children.set(k, []);
  }
  for (const k of keys) {
    const rec = getDataset(k);
    if (!rec || !isDerivedSource(rec.source)) continue;
    for (const p of parentKeysOf(rec.source)) {
      if (!keySet.has(p)) continue;
      children.get(p)!.push(k);
      indegree.set(k, (indegree.get(k) || 0) + 1);
    }
  }
  const queue = keys.filter((k) => (indegree.get(k) || 0) === 0).sort((a, b) => a.localeCompare(b));
  const ordered: string[] = [];
  while (queue.length) {
    const k = queue.shift()!;
    ordered.push(k);
    const next = (children.get(k) || []).slice().sort((a, b) => a.localeCompare(b));
    for (const c of next) {
      const d = (indegree.get(c) || 0) - 1;
      indegree.set(c, d);
      if (d === 0) queue.push(c);
    }
    queue.sort((a, b) => a.localeCompare(b));
  }
  // Cycle leftover (should not happen after upsert checks) — append remaining
  for (const k of keys) {
    if (!ordered.includes(k)) ordered.push(k);
  }
  return ordered;
}

export function upsertDataset(input: {
  key: string;
  /** Required on create; omit on update to keep the existing source. */
  source?: unknown;
  refreshIntervalSec?: number;
  /** Function body; pass null to clear. Omit to keep existing. */
  transform?: string | null;
}): DatasetRecord {
  const key = String(input.key || "")
    .trim()
    .toLowerCase();
  assertPersistedKey(key);
  const existing = getDataset(key);
  const hasSource = input.source !== undefined && input.source !== null;
  if (!existing && !hasSource) {
    throw new Error("source is required when creating a dataset");
  }
  const source = hasSource ? parseSource(input.source) : existing!.source;
  assertAcyclicDerived(key, source);
  const refreshIntervalSec =
    input.refreshIntervalSec !== undefined
      ? Math.max(MIN_INTERVAL, Math.floor(input.refreshIntervalSec))
      : (existing?.refreshIntervalSec ?? 600);
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

async function fetchHttpJson(source: DatasetHttpSource): Promise<unknown> {
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

function readParentPayload(parentKey: string): unknown {
  const parent = getDataset(parentKey);
  if (!parent) {
    throw new Error(`Parent dataset not found: ${parentKey}`);
  }
  if (parent.data === undefined || parent.data === null) {
    throw new Error(`Parent dataset "${parentKey}" has no data yet — refresh it first`);
  }
  return parent.data;
}

function resolveSingleDerivedData(source: DatasetDerivedSource): unknown {
  const payload = readParentPayload(source.dataset);
  const sliced = readPath(payload, source.jsonPath);
  if (sliced === undefined) {
    throw new Error(
      `jsonPath "${source.jsonPath}" not found in parent dataset "${source.dataset}"`,
    );
  }
  return sliced;
}

/** Build `{ [parentKey]: data }` for multi-parent sources. */
function resolveMultiDerivedData(source: DatasetMultiDerivedSource): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const parentKey of source.datasets) {
    out[parentKey] = readParentPayload(parentKey);
  }
  return out;
}

async function resolveSourceData(source: DatasetSource): Promise<unknown> {
  if (isMultiDerivedSource(source)) return resolveMultiDerivedData(source);
  if (isSingleDerivedSource(source)) return resolveSingleDerivedData(source);
  if (isHttpSource(source)) return fetchHttpJson(source);
  throw new Error("Invalid dataset source");
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

/** Refresh one dataset only (no cascade). Persists error and rethrows on failure. */
async function refreshOne(key: string): Promise<DatasetRecord> {
  assertPersistedKey(key);
  const rec = getDataset(key);
  if (!rec) throw new Error(`Dataset not found: ${key}`);
  if (isDerivedSource(rec.source)) {
    assertAcyclicDerived(key, rec.source);
  }
  const now = nowIso();
  try {
    let data = await resolveSourceData(rec.source);
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

/**
 * Refresh a dataset, then cascade to dependents (depth-first).
 * Returns every successfully refreshed record (primary first).
 * Dependent failures are recorded on those datasets but do not fail the parent.
 */
export async function refreshDatasetRecord(key: string): Promise<DatasetRecord[]> {
  const primary = await refreshOne(key);
  const out: DatasetRecord[] = [primary];
  for (const child of dependentsOf(key)) {
    try {
      const childTree = await refreshDatasetRecord(child);
      out.push(...childTree);
    } catch {
      // Child error already persisted by refreshOne
    }
  }
  return out;
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
  const done = new Set<string>();

  const allKeys = listDatasets().map((m) => m.key);
  for (const key of topoSortKeys(allKeys)) {
    if (done.has(key)) continue;
    const rec = getDataset(key);
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
      const tree = await refreshDatasetRecord(rec.key);
      for (const r of tree) {
        done.add(r.key);
        refreshed.push(r);
      }
    } catch (err) {
      done.add(rec.key);
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
