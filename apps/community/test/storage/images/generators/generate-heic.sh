#!/bin/sh
set -eu
cd /fixture-output
timeout -k 2s 10s dpkg-query -W -f='${Package}\t${Version}\n' > heic-generator-packages.tsv
timeout -k 2s 10s heif-enc --version > heic-generator-version.txt 2>&1
timeout -k 2s 10s heif-enc --list-encoders > heic-generator-encoders.txt 2>&1
timeout -k 2s 10s heif-dec --list-decoders > heic-generator-decoders.txt 2>&1
timeout -k 2s 10s python3 generate-png.py
timeout -k 2s 30s heif-enc -e x265 -q 60 --no-alpha -p x265:pools=none -p x265:frame-threads=1 -o own-solid-rgb32.heic own-solid-rgb32.png > heic-encode.txt 2>&1
timeout -k 2s 30s heif-info own-solid-rgb32.heic > own-solid-rgb32.info.txt 2>&1
timeout -k 2s 30s heif-info -d own-solid-rgb32.heic > own-solid-rgb32.boxes.txt 2>&1
timeout -k 2s 30s heif-dec own-solid-rgb32.heic own-solid-rgb32.decoded.png > own-solid-rgb32.decode.txt 2>&1
sha256sum own-solid-rgb32.png own-solid-rgb32.heic own-solid-rgb32.decoded.png > own-solid-rgb32.sha256
stat -c '%n %s' own-solid-rgb32.png own-solid-rgb32.heic own-solid-rgb32.decoded.png > own-solid-rgb32.sizes.txt
