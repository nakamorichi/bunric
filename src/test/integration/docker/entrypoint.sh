#!/bin/sh
set -euo pipefail

# AWS Lambda Runtime Interface Emulator entry script
# This script detects if we're running in Lambda (AWS_LAMBDA_RUNTIME_API is set)
# or locally (needs RIE), and executes the appropriate command.

echo "[ENTRY] Starting AWS Lambda Bun RIC"
echo "[ENTRY] AWS_LAMBDA_RUNTIME_API: ${AWS_LAMBDA_RUNTIME_API:-NOT_SET}"
echo "[ENTRY] Handler: $*"
echo "[ENTRY] Working directory: $(pwd)"
echo "[ENTRY] Available files: $(ls -la)"

if [ -z "${AWS_LAMBDA_RUNTIME_API:-}" ]; then
    echo "[ENTRY] No AWS_LAMBDA_RUNTIME_API detected, running with RIE"
    exec /usr/local/bin/aws-lambda-rie bun /home/app/.bun/bin/bunric "$@"
else
    echo "[ENTRY] AWS_LAMBDA_RUNTIME_API detected, running RIC directly"
    exec bun /home/app/.bun/bin/bunric "$@"
fi