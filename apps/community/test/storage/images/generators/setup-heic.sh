#!/bin/sh
set -eu
cd /fixture-output
cat /etc/apt/sources.list.d/debian.sources > debian-apt-sources.txt
timeout -k 3s 90s apt-get -o Acquire::Retries=0 -o Acquire::http::Timeout=20 update > apt-update.log 2>&1
apt-cache policy libheif1 libheif-examples libheif-plugin-x265 libheif-plugin-libde265 libx265-215 libde265-0 python3 > apt-policy.txt
v='1.23.4-1~deb13u1'
DEBIAN_FRONTEND=noninteractive timeout -k 3s 120s apt-get -o Acquire::Retries=0 -o Acquire::http::Timeout=20 install -y --no-install-recommends "libheif1=$v" "libheif-examples=$v" "libheif-plugin-x265=$v" "libheif-plugin-libde265=$v" "libx265-215=4.1-2" "libde265-0=1.0.15-1+deb13u2" python3 > apt-install.log 2>&1
dpkg-query -W -f='${Package}\t${Version}\n' > heic-generator-packages.tsv
