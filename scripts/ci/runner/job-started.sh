#!/bin/sh
# Installed read-only outside the runner directory. Python isolated mode avoids
# PYTHONPATH/user-site injection; never execute a checkout's policy script.
exec /usr/bin/python3 -I /etc/gha-runner/job-policy.py
