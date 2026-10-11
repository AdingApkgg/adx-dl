# CI egress proxy

Run this service only on `i@localhost-1.tailac9c6f.ts.net`. It is independent of the host's existing sing-box service and the CI worker containers. It reuses the installed sing-box 1.14 binary and the cached `managed-gha-runner:2.338.0` image; no additional image or credentials are required.

Copy this directory to a source directory on the remote server, then run there:

```sh
python3 manage.py install
python3 manage.py start
python3 manage.py verify
python3 manage.py status
python3 manage.py logs
python3 manage.py stop
```

The default runtime directory is `/home/i/.local/share/gha-runners/proxy`; `--root` can select another directory. A separate source directory is convenient, but installation also supports an in-place source/config directory without copying a file onto itself. Installation downloads the two official SagerNet CN binary rule sets through `http://127.0.0.1:11090`, saves their source URL and SHA256, and validates the configuration with the installed binary before starting anything.

`managed-ci-egress` runs with host networking, UID 1001, a read-only filesystem and mounts, no capabilities, at most one CPU and 256MiB memory. It binds only `127.0.0.1:11092` and the host Docker bridge `172.17.0.1:11092`, with HTTP and SOCKS on both ports. Its upstream is the existing credential-free auto proxy at `127.0.0.1:11090`.

CN domain rules and literal CN IP rules use the direct outbound. Private addresses remain direct. CN domain resolution uses AliDNS DoH at `223.5.5.5` with TLS certificate validation for `dns.alidns.com`. Domains that do not match the CN list retain their domain name and use the upstream HTTP proxy, including GitHub and Docker Hub; they are not resolved through the local resolver. An unknown domain uses the proxy conservatively. These maintained rule sets classify domains/IPs, rather than establishing an absolute physical location for every CDN response.

The configuration uses the current `rule_set`, route actions, typed DNS HTTPS server and `domain_resolver` schema. Deprecated `geosite`/`geoip` configuration fields are not used. Official references:

- https://sing-box.sagernet.org/configuration/route/
- https://sing-box.sagernet.org/configuration/route/rule_action/
- https://sing-box.sagernet.org/configuration/dns/server/https/
- https://sing-box.sagernet.org/configuration/outbound/http/
- https://github.com/SagerNet/sing-geosite/tree/rule-set
- https://github.com/SagerNet/sing-geoip/tree/rule-set

Before pointing runner/DinD/build traffic at `http://172.17.0.1:11092`, change only an idle DinD instance's inner default bridge to `10.240.0.1/24` and address pool to `10.241.0.0/16` (size 24), after checking host route conflicts. Otherwise its default `172.17.0.1` overlaps the host bridge and the endpoint refers to DinD itself. Existing busy instances must finish before reconfiguration.

Set proxy variables for the runner, daemon pulls and build steps; keep loopback, the private daemon endpoint and internal service addresses in `NO_PROXY`. Do not bypass GitHub, Docker Hub, registries or other foreign sites. Host management clients can use `http://127.0.0.1:11092`; an authorized SSH tunnel can expose that loopback endpoint to a remote administrative workstation.

`verify` checks real HTTP responses and matching outbound log lines for a CN domain, a CN IP, GitHub and Docker Hub. Update rule files with `python3 manage.py update-rules`; restarting only this egress service in a maintenance window loads the new files. The command does not restart or edit existing host proxy or CI worker services.
