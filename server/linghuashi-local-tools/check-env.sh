#!/bin/sh
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
if [ -x .venv/bin/python ]; then
  interpreter=.venv/bin/python
else
  interpreter=python3
fi
"$interpreter" diagnostics.py --output environment-diagnostics.json "$@"
printf '%s\n' 'Report: environment-diagnostics.json (import it in the component wizard).'
