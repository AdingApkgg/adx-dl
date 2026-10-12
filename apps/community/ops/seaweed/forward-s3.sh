#!/bin/sh
# Propagate EOF in both directions so an upstream close cannot leave a stale
# application keep-alive socket. No new whole-transfer or idle timeout.
exec socat TCP-LISTEN:8333,bind=0.0.0.0,reuseaddr,fork TCP:127.0.0.1:8334
