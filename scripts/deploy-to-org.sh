#!/bin/bash
#
# Deploy metadata to an existing Salesforce org
#
# Usage:
#   ./scripts/deploy-to-org.sh [org-alias]
#
# If no alias provided, uses default org

set -e

ORG_ALIAS="${1}"
ORG_FLAG=""

if [ -n "$ORG_ALIAS" ]; then
  ORG_FLAG="--target-org $ORG_ALIAS"
  echo "📤 Deploying to org: $ORG_ALIAS"
else
  echo "📤 Deploying to default org"
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Deploy
sf project deploy start --source-dir force-app $ORG_FLAG --wait 10

echo ""
echo "✅ Deployment complete!"
