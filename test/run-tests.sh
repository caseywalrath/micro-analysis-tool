#!/usr/bin/env bash
# Convenience wrapper for the golden-value tests so you don't have to remember
# the node invocation. Runs from anywhere.
#
#   bash test/run-tests.sh            # check everything
#   bash test/run-tests.sh --update   # re-record goldens (after a deliberate change)
#   bash test/run-tests.sh ridership  # only case files matching "ridership"
#
# Requires Node (already present in the Claude Code cloud environment).
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$DIR/run-golden.mjs" "$@"
