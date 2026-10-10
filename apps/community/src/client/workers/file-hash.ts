import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

/** Bounded reads are also used for part hashes; no whole-file buffer is allocated. */
export async function hashChunks(file: File, onProgress?: (progress: number) => void): Promise<string> {
  const hash = sha256.create();
  for (let offset = 0; offset < file.size; offset += 1_048_576) {
    const end = Math.min(offset + 1_048_576, file.size);
    hash.update(new Uint8Array(await file.slice(offset, end).arrayBuffer()));
    onProgress?.(end / file.size);
  }
  return bytesToHex(hash.digest());
}

// Importing the function in server tests must not install a global message handler.
if (typeof document === "undefined" && "postMessage" in globalThis) {
  globalThis.onmessage = async (event: MessageEvent<File>) => {
    try {
      const hash = await hashChunks(event.data, (progress) => globalThis.postMessage({ progress }));
      globalThis.postMessage({ hash });
    } catch {
      globalThis.postMessage({ error: true });
    }
  };
}
