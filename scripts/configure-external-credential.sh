#!/usr/bin/env bash
# ============================================================================
# Configure External Credential for Scratch Org
# ============================================================================
# This script configures the AAD External Credential in a Salesforce org
# with the Azure AD Client ID and Client Secret.
#
# Purpose:
#   - Set AAD Client ID and Client Secret on the External Credential
#   - Enables the scratch org to authenticate with the Node.js backend
#
# Usage:
#   ./scripts/configure-external-credential.sh [org-alias] [environment] [client-id] [client-secret]
#
# Arguments:
#   org-alias       Optional. Salesforce org alias. Defaults to 'docgen-dev'
#   environment     Optional. Environment mode: 'CI' or 'PRODUCTION'. Defaults to 'CI'
#   client-id       Optional. Azure AD Client ID. Falls back to AAD_CLIENT_ID env var
#   client-secret   Optional. Azure AD Client Secret. Falls back to AAD_CLIENT_SECRET env var
#
# Environment Variables:
#   AAD_CLIENT_ID       Azure AD Application (client) ID
#   AAD_CLIENT_SECRET   Azure AD Client Secret value
#
# Example:
#   # Use defaults from environment for CI
#   export AAD_CLIENT_ID="f42d24be-0a17-4a87-bfc5-d6cd84339302"
#   export AAD_CLIENT_SECRET="your-secret-here"
#   ./scripts/configure-external-credential.sh
#
#   # Configure for PRODUCTION environment
#   ./scripts/configure-external-credential.sh UIPATH_UATFULL PRODUCTION "client-id" "secret"
#
#   # Configure for CI environment
#   ./scripts/configure-external-credential.sh docgen-dev CI "client-id" "secret"
#
# ============================================================================

set -euo pipefail

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
ORG_ALIAS="${1:-docgen-dev}"
ENVIRONMENT="${2:-CI}"
CLIENT_ID="${3:-${AAD_CLIENT_ID:-}}"
CLIENT_SECRET="${4:-${AAD_CLIENT_SECRET:-}}"
APEX_TEMPLATE="scripts/ConfigureExternalCredential.apex"

# Set environment-specific values
if [ "$ENVIRONMENT" = "PRODUCTION" ]; then
    EXTERNAL_CREDENTIAL="Docgen_AAD_Credential"
    NAMED_CREDENTIAL="Docgen_Node_API"
    PRINCIPAL_NAME="Main"  # The principal name in Docgen_AAD_Credential is "Main"
elif [ "$ENVIRONMENT" = "CI" ]; then
    EXTERNAL_CREDENTIAL="Docgen_AAD_Credential_CI"
    NAMED_CREDENTIAL="Docgen_Node_API_CI"
    PRINCIPAL_NAME="CI"
else
    log_error "Invalid environment: $ENVIRONMENT. Must be 'CI' or 'PRODUCTION'"
    exit 1
fi

# Functions
log_info() {
    echo -e "${BLUE}ℹ${NC} $1"
}

log_success() {
    echo -e "${GREEN}✓${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

log_error() {
    echo -e "${RED}✗${NC} $1"
}

# Validate inputs
if [ -z "$CLIENT_ID" ]; then
    log_error "Client ID not provided"
    log_info "Usage: $0 [org-alias] [client-id] [client-secret]"
    log_info "Or set AAD_CLIENT_ID environment variable"
    exit 1
fi

if [ -z "$CLIENT_SECRET" ]; then
    log_error "Client Secret not provided"
    log_info "Usage: $0 [org-alias] [client-id] [client-secret]"
    log_info "Or set AAD_CLIENT_SECRET environment variable"
    exit 1
fi

# Check if Apex template exists
if [ ! -f "$APEX_TEMPLATE" ]; then
    log_error "Apex template not found: $APEX_TEMPLATE"
    exit 1
fi

echo ""
log_info "==================================================="
log_info "Configure External Credential for Salesforce Org"
log_info "==================================================="
echo ""

log_info "Org Alias: $ORG_ALIAS"
log_info "Environment: $ENVIRONMENT"
log_info "Client ID: ${CLIENT_ID:0:8}...${CLIENT_ID: -4}"
log_info "External Credential: $EXTERNAL_CREDENTIAL"
log_info "Principal: $PRINCIPAL_NAME"
echo ""

# Create temporary file for the Apex script
TEMP_APEX=$(mktemp /tmp/configure-external-credential.XXXXXX.apex)
TEMP_SETTINGS_APEX=""

# Ensure cleanup on exit
cleanup() {
    rm -f "$TEMP_APEX" "$TEMP_SETTINGS_APEX"
}
trap cleanup EXIT

# Substitute placeholders in the Apex template
log_info "Preparing Apex script..."
sed -e "s|{{CLIENT_ID}}|$CLIENT_ID|g" \
    -e "s|{{CLIENT_SECRET}}|$CLIENT_SECRET|g" \
    -e "s|{{EXTERNAL_CREDENTIAL}}|$EXTERNAL_CREDENTIAL|g" \
    -e "s|{{PRINCIPAL_NAME}}|$PRINCIPAL_NAME|g" \
    "$APEX_TEMPLATE" > "$TEMP_APEX"

log_success "Apex script prepared"

# Run the Apex script
log_info "Executing Apex script on org: $ORG_ALIAS"
echo ""

if sf apex run --file "$TEMP_APEX" --target-org "$ORG_ALIAS"; then
    echo ""
    log_success "==================================================="
    log_success "External Credential configured successfully!"
    log_success "==================================================="
    echo ""
    log_info "The org can now authenticate with the backend"
    log_info "Principal '$PRINCIPAL_NAME' has been configured with:"
    log_info "  - Client ID: ${CLIENT_ID:0:8}...${CLIENT_ID: -4}"
    log_info "  - Client Secret: (encrypted)"
    echo ""

    # Configure custom settings to use the appropriate Named Credential
    log_info "Configuring Custom Settings to use Named Credential..."

    TEMP_SETTINGS_APEX=$(mktemp /tmp/configure-settings.XXXXXX.apex)

    sed -e "s|{{NAMED_CREDENTIAL}}|$NAMED_CREDENTIAL|g" \
        "scripts/ConfigureCustomSettings.apex" > "$TEMP_SETTINGS_APEX"

    if sf apex run --file "$TEMP_SETTINGS_APEX" --target-org "$ORG_ALIAS" >/dev/null 2>&1; then
        log_success "Custom Settings configured to use: $NAMED_CREDENTIAL"
    else
        log_warning "Failed to configure Custom Settings (non-critical)"
    fi

    echo ""
else
    echo ""
    log_error "Failed to configure External Credential"
    exit 1
fi
