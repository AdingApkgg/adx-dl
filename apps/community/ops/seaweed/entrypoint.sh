#!/bin/sh
# Seaweed 4.48 binds its HTTP and internal gRPC listeners to the same address.
# Keep every Seaweed listener on loopback; expose only authenticated S3 bytes.
set -eu
mini_pid=
relay_pid=
stop() {
  trap '' TERM INT
  [ -z "$relay_pid" ] || kill -TERM "$relay_pid" 2>/dev/null || true
  [ -z "$mini_pid" ] || kill -TERM "$mini_pid" 2>/dev/null || true
  [ -z "$relay_pid" ] || wait "$relay_pid" 2>/dev/null || true
  [ -z "$mini_pid" ] || wait "$mini_pid" 2>/dev/null || true
}
trap 'stop; exit 0' TERM INT
trap stop EXIT
weed mini -dir=/data -ip=127.0.0.1 -ip.bind=127.0.0.1 \
  -s3.port=8334 -s3.port.grpc=18334 -s3.config=/config/s3.json \
  -bucket=blobs,derived -admin.ui=false -webdav=false \
  -s3.port.iceberg=0 -s3.port.lance=0 &
mini_pid=$!
# BusyBox nc -lk forks a handler per connection. No HTTP parsing or credentials.
nc -l -k -s 0.0.0.0 -p 8333 -e /opt/community-seaweed/forward-s3.sh &
relay_pid=$!
# Either child exiting is a service failure, even with exit status zero.
wait -n "$mini_pid" "$relay_pid" || true
exit 1
