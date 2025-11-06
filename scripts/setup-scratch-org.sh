#!/bin/bash
#
# Setup script for Salesforce scratch org (local development)
#
# Prerequisites:
# - Salesforce CLI installed (sf)
# - Dev Hub org authenticated
#
# Usage:
#   ./scripts/setup-scratch-org.sh [org-alias]
#
# If no alias provided, defaults to 'docgen-dev'

set -e

# Configuration
ORG_ALIAS="${1:-docgen-dev}"
SCRATCH_DEF="config/project-scratch-def.json"
DURATION_DAYS=7

echo "🚀 Setting up Salesforce scratch org: $ORG_ALIAS"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Check if Salesforce CLI is installed
if ! command -v sf &> /dev/null; then
    echo "❌ Error: Salesforce CLI (sf) is not installed"
    echo "Install it with: npm install -g @salesforce/cli"
    exit 1
fi

echo "✓ Salesforce CLI version: $(sf version)"

# Check if Dev Hub is authenticated
if ! sf org list --all | grep -q "DevHub"; then
    echo "⚠️  Warning: No Dev Hub org found with alias 'DevHub'"
    echo "Authenticate to your Dev Hub org with:"
    echo "  sf org login web --set-default-dev-hub --alias DevHub"
    echo ""
    read -p "Press Enter to continue with authentication, or Ctrl+C to cancel..."
    sf org login web --set-default-dev-hub --alias DevHub
fi

echo "✓ Dev Hub authenticated"

# Create scratch org
echo ""
echo "📦 Creating scratch org '$ORG_ALIAS' (${DURATION_DAYS} days)..."
sf org create scratch \
  --definition-file "$SCRATCH_DEF" \
  --alias "$ORG_ALIAS" \
  --set-default \
  --duration-days "$DURATION_DAYS" \
  --wait 10

echo "✓ Scratch org created: $ORG_ALIAS"

# Deploy metadata
echo ""
echo "📤 Deploying metadata to scratch org..."
sf project deploy start --source-dir force-app --wait 10

echo "✓ Metadata deployed successfully"

# Run Apex tests
echo ""
echo "🧪 Running Apex tests..."
sf apex run test --test-level RunLocalTests --result-format human --wait 10

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Scratch org setup complete!"
echo ""
echo "Org details:"
sf org display --target-org "$ORG_ALIAS"
echo ""
echo "To open the org:"
echo "  sf org open --target-org $ORG_ALIAS"
echo ""
echo "To delete the org:"
echo "  sf org delete scratch --target-org $ORG_ALIAS --no-prompt"
echo ""
