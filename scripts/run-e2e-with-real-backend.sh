#!/bin/bash
# ============================================================================
# Run E2E Tests with Real Backend (Local Reproduction of CI)
# ============================================================================
# This script orchestrates all steps needed to run e2e tests locally with
# the real backend, replicating what happens in GitHub Actions CI.
#
# Usage:
#   ./scripts/run-e2e-with-real-backend.sh [scratch-org-alias]
#
# Example:
#   ./scripts/run-e2e-with-real-backend.sh docgen-dev
#
# What it does:
#   1. Configures CI backend to point to your scratch org
#   2. Deploys required auth metadata to scratch org
#   3. Configures External Credential in scratch org
#   4. Runs E2E tests with real backend
#
# Prerequisites:
#   - CI backend already provisioned (run once):
#     ./scripts/provision-ci-backend.sh
#   - Scratch org created:
#     npm run e2e:setup
#   - Azure AD credentials set in environment or as arguments
# ============================================================================

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get scratch org alias from command line argument
SCRATCH_ORG_ALIAS="${1:-docgen-dev}"

# Azure AD credentials for External Credential configuration
AAD_CLIENT_ID="${AAD_CLIENT_ID:-f42d24be-0a17-4a87-bfc5-d6cd84339302}"
AAD_CLIENT_SECRET="${AAD_CLIENT_SECRET:-}"

# ============================================================================
# Helper Functions
# ============================================================================

log_info() {
    echo -e "${BLUE}ℹ${NC} $1"
}

log_success() {
    echo -e "${GREEN}✅${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

log_error() {
    echo -e "${RED}❌${NC} $1"
}

log_step() {
    echo ""
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}========================================${NC}"
    echo ""
}

check_aad_credentials() {
    if [ -z "$AAD_CLIENT_SECRET" ]; then
        log_warning "AAD_CLIENT_SECRET not set in environment"
        read -sp "Enter Azure AD Client Secret: " AAD_CLIENT_SECRET
        echo ""
        export AAD_CLIENT_SECRET
    fi
}

configure_backend_for_scratch_org() {
    log_step "Step 1: Configure CI Backend for Scratch Org"

    ./scripts/configure-ci-backend-for-scratch-org.sh "$SCRATCH_ORG_ALIAS"

    log_success "Backend configured for $SCRATCH_ORG_ALIAS"
}

deploy_auth_metadata() {
    log_step "Step 2: Deploy Required Auth Metadata to Scratch Org"

    log_info "Deploying External Credential and Named Credential metadata..."

    sf project deploy start \
      --metadata ExternalCredential:Docgen_AAD_Credential_CI \
      --metadata NamedCredential:Docgen_Node_API_CI \
      --metadata PermissionSet:Docgen_User \
      --target-org "$SCRATCH_ORG_ALIAS"

    log_success "Auth metadata deployed"
}

configure_external_credential() {
    log_step "Step 3: Configure External Credential Principal Secrets"

    log_info "Updating External Credential with AAD client ID and secret..."

    # Substitute placeholders in template
    sed "s/{{CLIENT_ID}}/${AAD_CLIENT_ID}/g; s/{{CLIENT_SECRET}}/${AAD_CLIENT_SECRET}/g" \
      scripts/ConfigureExternalCredential.apex > /tmp/configure-cred.apex

    # Execute anonymous Apex
    sf apex run \
      --file /tmp/configure-cred.apex \
      --target-org "$SCRATCH_ORG_ALIAS"

    # Clean up
    rm /tmp/configure-cred.apex

    log_success "External Credential configured"
}

run_e2e_tests() {
    log_step "Step 4: Run E2E Tests with Real Backend"

    # Get scratch org username
    SF_USERNAME=$(sf org display --target-org "$SCRATCH_ORG_ALIAS" --json | jq -r '.result.username')

    # Get backend URL
    BACKEND_URL=$(cat .ci-backend-url)

    log_info "Test configuration:"
    log_info "  Scratch Org: $SCRATCH_ORG_ALIAS"
    log_info "  Username: $SF_USERNAME"
    log_info "  Backend URL: $BACKEND_URL"

    # Run tests
    export SF_USERNAME="$SF_USERNAME"
    export BACKEND_URL="$BACKEND_URL"

    npm run test:e2e -- -g "generates PDF successfully"

    log_success "E2E tests completed!"
}

print_summary() {
    BACKEND_URL=$(cat .ci-backend-url)

    echo ""
    echo "========================================================================"
    echo "E2E Test Run Complete"
    echo "========================================================================"
    echo ""
    echo "Configuration:"
    echo "  Scratch Org: $SCRATCH_ORG_ALIAS"
    echo "  Backend URL: $BACKEND_URL"
    echo ""
    echo "To run tests again:"
    echo "  export BACKEND_URL=$BACKEND_URL"
    echo "  npm run test:e2e"
    echo ""
    echo "========================================================================"
}

# ============================================================================
# Main Script
# ============================================================================

main() {
    echo ""
    echo "========================================================================"
    echo "Running E2E Tests with Real Backend (CI Reproduction)"
    echo "========================================================================"
    echo ""
    echo "Scratch Org: $SCRATCH_ORG_ALIAS"
    echo ""

    check_aad_credentials
    configure_backend_for_scratch_org
    deploy_auth_metadata
    configure_external_credential
    run_e2e_tests
    print_summary
}

main "$@"
