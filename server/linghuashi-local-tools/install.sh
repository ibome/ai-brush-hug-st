#!/bin/sh
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
if [ ! -x .venv/bin/python ]; then
  python3 -c 'import sys; sys.exit(0 if (3,10) <= sys.version_info[:2] <= (3,12) else 1)' || {
    printf '%s\n' 'Use Python 3.10-3.12 (3.12 recommended).' >&2
    exit 1
  }
  python3 -m venv .venv
fi
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python diagnostics.py --output environment-diagnostics.json
printf '%s\n' 'Installed. Run: sh start.sh --allow-origin https://your-tavern.example'
