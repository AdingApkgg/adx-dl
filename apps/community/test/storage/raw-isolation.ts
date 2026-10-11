// Run in an uncredentialed peer on the Seaweed network, never on the storage host.
const host = process.env.STORAGE_ISOLATION_HOST ?? "seaweedfs";
const ports = [8888, 18888, 9333, 19333, 9340, 19340, 8334, 18334, 18333, 7333, 23646, 33646, 8181, 9101];
for (const port of ports) {
  let connected = false;
  try {
    const socket = await Bun.connect({ hostname: host, port, socket: {
      open(socket) { connected = true; socket.end(); }, data() {},
    } });
    socket.end();
  } catch (error) {
    if ((error as { code?: string }).code !== "ECONNREFUSED") throw error;
  }
  if (connected) throw new Error(`RAW_INTERFACE_REACHABLE:${port}`);
  console.log(`peer TCP ${port}: refused`);
}
const response = await fetch(`http://${host}:8333/blobs/sha256/cc/5b/cc5baad3c686a83b5385cf008af6ec8686bfe0aa32de477eeef87da3165a0ab5`, { signal: AbortSignal.timeout(5000) });
if (response.status !== 403) throw new Error(`ANONYMOUS_S3_STATUS:${response.status}`);
await response.arrayBuffer();
console.log("peer authenticated S3 surface: anonymous GET 403");

export {};
