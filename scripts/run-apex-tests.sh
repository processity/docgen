#!/bin/bash
#
# Run Apex tests in Salesforce org
#
# Usage:
#   ./scripts/run-apex-tests.sh [org-alias] [test-level]
#
# Test levels: RunLocalTests (default), RunAllTestsInOrg, RunSpecifiedTests
#
# Examples:
#   ./scripts/run-apex-tests.sh                    # Default org, local tests
#   ./scripts/run-apex-tests.sh docgen-dev         # Named org, local tests
#   ./scripts/run-apex-tests.sh docgen-dev RunAllTestsInOrg

set -e

ORG_ALIAS="${1}"
TEST_LEVEL="${2:-RunLocalTests}"
ORG_FLAG=""

if [ -n "$ORG_ALIAS" ]; then
  ORG_FLAG="--target-org $ORG_ALIAS"
  echo "🧪 Running Apex tests in org: $ORG_ALIAS"
else
  echo "🧪 Running Apex tests in default org"
fi

echo "Test level: $TEST_LEVEL"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Run tests
sf apex run test \
  --test-level "$TEST_LEVEL" \
  --code-coverage \
  --result-format human \
  --wait 10 \
  $ORG_FLAG

echo ""
echo "✅ Test run complete!"
