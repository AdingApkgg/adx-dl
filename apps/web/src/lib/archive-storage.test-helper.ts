export function createMemoryArchiveStorage(failWrite = false) {
  const files = new Map<string, Uint8Array[]>();
  const removed: string[] = [];
  const directory = {
    async getFileHandle(name: string) {
      files.set(name, []);
      return {
        async createWritable() {
          return new WritableStream<Uint8Array>({
            write(chunk) {
              if (failWrite) throw new DOMException("Disk quota exceeded", "QuotaExceededError");
              files.get(name)!.push(chunk.slice());
            },
          });
        },
        async getFile() { return new File(files.get(name)! as BlobPart[], name); },
      };
    },
    async removeEntry(name: string) { files.delete(name); removed.push(name); },
  };
  const storage = {
    async estimate() { return { quota: 1024 ** 3, usage: 0 }; },
    async getDirectory() { return { async getDirectoryHandle() { return directory; } }; },
  };
  return { files, removed, storage };
}
