import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  newQuickJSWASMModuleFromVariant,
  newVariant,
  shouldInterruptAfterDeadline,
  type QuickJSSyncVariant,
  type QuickJSWASMModule,
} from "quickjs-emscripten-core";
import releaseSync from "@jitl/quickjs-wasmfile-release-sync";

const TRANSFORM_TIMEOUT_MS = 1_000;
const MEMORY_LIMIT_BYTES = 8 * 1024 * 1024;
const MAX_STACK_BYTES = 1024 * 512;
const MAX_SCRIPT_CHARS = 64_000;

const RELEASE_SYNC = releaseSync as unknown as QuickJSSyncVariant;

function wasmFilePath(): string {
  // Bundled binary lives at bin/universal-dashboard; wasm sibling is bin/quickjs.wasm
  return join(dirname(fileURLToPath(import.meta.url)), "quickjs.wasm");
}

let modulePromise: Promise<QuickJSWASMModule> | null = null;

async function getQuickModule(): Promise<QuickJSWASMModule> {
  if (!modulePromise) {
    modulePromise = (async () => {
      const wasmPath = wasmFilePath();
      const variant = newVariant(RELEASE_SYNC, {
        wasmBinary: async () => {
          const buf = readFileSync(wasmPath);
          return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
        },
      });
      return newQuickJSWASMModuleFromVariant(variant);
    })();
  }
  return modulePromise;
}

function assertJsonSerializable(value: unknown): unknown {
  if (value === undefined) {
    throw new Error("transform must return a value (got undefined)");
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    throw new Error("transform result is not JSON-serializable");
  }
}

/**
 * Run agent-authored transform body in QuickJS WASM.
 * Contract: sync function body receiving `data`, must `return` JSON value.
 * No host FS/network bridges.
 */
export async function runTransform(script: string, data: unknown): Promise<unknown> {
  const body = String(script || "");
  if (!body.trim()) {
    throw new Error("transform script is empty");
  }
  if (body.length > MAX_SCRIPT_CHARS) {
    throw new Error(`transform script too large (max ${MAX_SCRIPT_CHARS} chars)`);
  }

  const QuickJS = await getQuickModule();
  const dataJson = JSON.stringify(data);
  // Inject data via JSON.parse inside the guest — no host object bridge.
  // Top-level `return` is invalid; wrap in IIFE.
  const code = `(function() {
"use strict";
var data = JSON.parse(${JSON.stringify(dataJson)});
return (function(data) {
${body}
})(data);
})()`;

  try {
    const result = QuickJS.evalCode(code, {
      shouldInterrupt: shouldInterruptAfterDeadline(Date.now() + TRANSFORM_TIMEOUT_MS),
      memoryLimitBytes: MEMORY_LIMIT_BYTES,
      maxStackSizeBytes: MAX_STACK_BYTES,
    });
    return assertJsonSerializable(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === "interrupted" || /interrupted/i.test(message)) {
      throw new Error(`transform timed out after ${TRANSFORM_TIMEOUT_MS}ms`);
    }
    throw new Error(`transform failed: ${message}`);
  }
}
