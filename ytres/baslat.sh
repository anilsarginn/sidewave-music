#!/bin/sh
set -eu
# Updates are built and tested as a new image; startup never changes dependencies.
exec uvicorn app:app --host 0.0.0.0 --port "${PORT:-4455}" --log-level warning --no-access-log
