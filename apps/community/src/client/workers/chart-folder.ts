import { Zip, ZipPassThrough } from "fflate";
import type { FolderFile } from "../lib/chart-input";

// STORED ZIP packaging and bounded file reads stay in this Worker. Termination cancels both.
self.onmessage = async (event: MessageEvent<FolderFile[]>) => {
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let failed = false;
  const fail = (code: string) => { if (!failed) self.postMessage({ error: code }); failed = true; };
  const zip = new Zip((error, chunk, final) => {
    if (failed) return;
    if (error) { fail("CHART_PACKAGE_INVALID"); return; }
    bytes += chunk.length;
    if (bytes > 64 * 1024 * 1024) { fail("FILE_TOO_LARGE"); zip.terminate(); return; }
    chunks.push(chunk);
    if (final) {
      const output = new Uint8Array(bytes);
      let offset = 0;
      for (const part of chunks) { output.set(part, offset); offset += part.length; }
      self.postMessage({ zip: output.buffer }, { transfer: [output.buffer] });
    }
  });
  try {
    for (const { file, path } of event.data) {
      if (failed) return;
      const entry = new ZipPassThrough(path);
      entry.mtime = new Date(1980, 0, 1);
      zip.add(entry);
      if (!file.size) entry.push(new Uint8Array(), true);
      for (let offset = 0; offset < file.size; offset += 1024 * 1024) {
        if (failed) return;
        const end = Math.min(file.size, offset + 1024 * 1024);
        entry.push(new Uint8Array(await file.slice(offset, end).arrayBuffer()), end === file.size);
      }
    }
    if (!failed) zip.end();
  } catch { fail("CHART_PACKAGE_INVALID"); zip.terminate(); }
};
