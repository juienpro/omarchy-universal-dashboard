import { mkdirSync, writeFileSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

export function passwdHome(): string {
  return process.env.HOME || homedir();
}

export function stateDir(): string {
  return join(passwdHome(), ".local", "state", "universal-dashboard");
}

export function screenPath(): string {
  return join(stateDir(), "screen.json");
}

export function viewsIndexPath(): string {
  return join(stateDir(), "views.json");
}

export function carouselPath(): string {
  return join(stateDir(), "carousel.json");
}

export function viewFilePath(id: string): string {
  return join(stateDir(), "views", `${id}.json`);
}

export function overlaysIndexPath(): string {
  return join(stateDir(), "overlays.json");
}

export function overlayFilePath(id: string): string {
  return join(stateDir(), "overlays", `${id}.json`);
}

export function datasetsDir(): string {
  return join(stateDir(), "datasets");
}

export function datasetsIndexPath(): string {
  return join(stateDir(), "datasets.json");
}

export function datasetFilePath(key: string): string {
  return join(datasetsDir(), `${key}.json`);
}

export function ensureDirs() {
  mkdirSync(join(stateDir(), "views"), { recursive: true, mode: 0o700 });
  mkdirSync(join(stateDir(), "overlays"), { recursive: true, mode: 0o700 });
  mkdirSync(datasetsDir(), { recursive: true, mode: 0o700 });
}

export function writeAtomic(path: string, text: string) {
  ensureDirs();
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, text, { encoding: "utf8", mode: 0o600 });
  renameSync(tmp, path);
}

export function nowIso(): string {
  return new Date().toISOString();
}
