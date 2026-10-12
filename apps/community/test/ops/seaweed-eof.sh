#!/usr/bin/env bash
# Exercise the actual relay against a real HTTP upstream that closes keep-alive.
set -euo pipefail
[[ $(uname -s) == Linux ]] || { echo REMOTE_LINUX_REQUIRED; exit 1; }
OPS=$(realpath "${1:?pass the ops/seaweed directory}")
IMAGE=${SEAWEED_RUNTIME_TEST_IMAGE:?pass the community Seaweed image}
APP=${SEAWEED_RUNTIME_TEST_APP_IMAGE:?pass the community app image}
ROOT=$(mktemp -d)
chmod 700 "$ROOT"
OWNER=adxc-seaweed-eof-regression
UP="adxc-seaweed-eof-up-$(basename "$ROOT")"
RELAY="adxc-seaweed-eof-relay-$(basename "$ROOT")"
cleanup() {
  for name in "$RELAY" "$UP"; do
    if [[ $(docker inspect --format '{{index .Config.Labels "org.astrodx.owner"}}' "$name" 2>/dev/null || true) == "$OWNER" ]]; then
      docker rm -f "$name" >/dev/null
    fi
  done
  rm -rf -- "$ROOT"
}
trap cleanup EXIT
# The transport is real; replacing the unrelated storage process avoids a port
# collision with the controlled upstream. No test hooks enter production code.
printf '#!/bin/sh\nexec sleep 300\n' > "$ROOT/weed"
chmod 755 "$ROOT/weed"
docker run -d --pull=never --name "$UP" --label "org.astrodx.owner=$OWNER" --network none --memory 128m --pids-limit 64 \
  --entrypoint bun "$APP" -e 'import {createServer} from "node:http"; createServer((q,r)=>{q.resume();q.on("end",()=>{r.writeHead(200,{"content-length":"0"});r.end();setTimeout(()=>q.socket.end(),100);});}).listen(8334,"127.0.0.1");' >/dev/null
docker run -d --pull=never --name "$RELAY" --label "org.astrodx.owner=$OWNER" --network "container:$UP" --memory 128m --pids-limit 64 \
  --mount "type=bind,src=$OPS,dst=/opt/community-seaweed,readonly" \
  --mount "type=bind,src=$ROOT/weed,dst=/usr/bin/weed,readonly" \
  --entrypoint /opt/community-seaweed/entrypoint.sh "$IMAGE" >/dev/null
timeout --signal=TERM --kill-after=2s 20s docker run --rm --pull=never --network "container:$UP" \
  --entrypoint bun "$APP" -e '
import {createS3Driver} from "./src/server/storage/s3";
import {parseStorageEnv} from "./src/server/storage/env";
await Bun.sleep(500); let failures=0;
for(const port of [8334,8333]) {
  const driver=createS3Driver(parseStorageEnv({PUBLIC_ORIGIN:"https://example.test",STORAGE_S3_ENDPOINT:`http://127.0.0.1:${port}`,STORAGE_TEMP_DIR:"/tmp",STORAGE_RECIPE_BUILD:"test",STORAGE_WEB_ACCESS_KEY_ID:"fixture-only",STORAGE_WEB_SECRET_ACCESS_KEY:"fixture-only",STORAGE_INTERNAL_MEDIA_SECRET:"fixture-secret-long-enough-for-test"},"web"),{requestTimeoutMs:1000});
  for(let round=0;round<2;round++) {
    try {
      await driver.put({bucket:"original",key:"fixture",size:8,mime:"application/octet-stream",sha256:"a".repeat(64),body:new ReadableStream({start(c){c.enqueue(new Uint8Array(8));c.close();}})});
      console.log(JSON.stringify({port,round,result:"ok"}));
    } catch(error) { failures++;console.log(JSON.stringify({port,round,result:error.code})); }
    await Bun.sleep(400);
  }
}
console.log(failures ? "RELAY_UPSTREAM_EOF_NOT_PROPAGATED" : "SEAWEED_EOF_REGRESSION_PASSED");
process.exit(failures ? 1 : 0);
' </dev/null
