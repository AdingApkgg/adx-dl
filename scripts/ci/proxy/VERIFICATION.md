# Remote CI egress verification

Validated on `i@localhost-1.tailac9c6f.ts.net` on 2026-10-12 at 02:14 Asia/Shanghai. No local development server, build or runtime tests were used.

The installed sing-box binary reports version 1.14.0. Its configuration check succeeded with the downloaded local rule sets in a read-only, network-disabled container. The standalone `managed-ci-egress` service then started using the existing cached runner image, host networking, UID 1001, one CPU and 256MiB memory. It listens on `127.0.0.1:11092` and `172.17.0.1:11092`, with the existing `127.0.0.1:11090` auto proxy as its credential-free HTTP upstream.

Actual requests through the new local endpoint produced these results. All CONNECT handshakes returned HTTP 200; all HTTPS requests retained certificate validation.

| Target | Target HTTP response | Matching outbound log |
| --- | --- | --- |
| `registry.npmmirror.com:443` | 200 | `outbound/direct[direct]` |
| CN IP `223.5.5.5:443` DNS endpoint | 400, expected without a DNS query | `outbound/direct[direct]` |
| `api.github.com:443` | 200 | `outbound/http[upstream]` |
| `registry-1.docker.io:443` registry endpoint | 401, expected authentication challenge | `outbound/http[upstream]` |

The foreign upstream log entries retained domain names. The proxy does not globally resolve foreign destinations through the local DNS resolver. A second CN website, `www.baidu.com`, also returned HTTP 200 through the direct outbound. `www.qq.com` completed CONNECT through the direct outbound but returned HTTP 501 for both HEAD and GET, so the repeatable verification uses the CI-related npm mirror instead.

The official rule sets downloaded through the old proxy were:

| File | Bytes | SHA256 |
| --- | --- | --- |
| `geosite-cn.srs` | 56,189 | `7e5edaa3156918ebb732629f7b4ab3f03040b9940456438f976c2046033fc15c` |
| `geoip-cn.srs` | 34,185 | `ebee603fdf402314b44b9f653cdcf6d9cc9c41e84e2b3515e3123c5c920a93bc` |

The host and original DinD both had a `172.17.0.1/16` Docker bridge; requests from the original runner/DinD namespace to that address reached their own bridge. Host routes did not use `10.240.0.0/24` or `10.241.0.0/16` during this check. Runner/DinD access must therefore be checked again after the manager changes only an idle instance's inner bridge/address pool. This report proves the independent proxy and host-side routing; it does not claim that the still-unmodified CI instances already use it.

The existing host sing-box service and busy worker containers were neither modified nor restarted. No subscription, node password, token or administrative credentials were copied into the independent service or source.
