#!/bin/bash
#
# Delete a scratch org
#
# Usage:
#   ./scripts/delete-scratch-org.sh [org-alias]
#
# If no alias provided, defaults to 'docgen-dev'

set -e

ORG_ALIAS="${1:-docgen-dev}"

echo "🗑️  Deleting scratch org: $ORG_ALIAS"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

sf org delete scratch --target-org "$ORG_ALIAS" --no-prompt

echo ""
echo "✅ Scratch org deleted: $ORG_ALIAS"
