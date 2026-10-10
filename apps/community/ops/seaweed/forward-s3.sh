#!/bin/sh
# Preserve existing S3/app streaming deadlines; no new whole-transfer timeout.
exec nc 127.0.0.1 8334
