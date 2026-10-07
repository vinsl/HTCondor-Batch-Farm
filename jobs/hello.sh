#!/bin/sh
# Smallest possible job: report where it ran, then sleep so it stays visible in condor_q.
echo "hello from $(hostname) at $(date -u +%T)"
sleep "${1:-5}"
