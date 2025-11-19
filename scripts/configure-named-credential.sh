#!/usr/bin/env bash
# ============================================================================
# Configure Named Credential URL for Scratch Org
# ============================================================================
# This script configures the Named Credential in a Salesforce org
# with the backend URL.
#
# Purpose:
#   - Set the backend URL on the Named Credential
#   - Enables the scratch org to make callouts to the backend
#
# Usage:
#   ./scripts/configure-named-credential.sh [org-alias] [backend-url]
#
# Arguments:
#   org-alias       Optional. Salesforce org alias. Defaults to 'docgen-dev'
#   backend-url     Optional. Backend URL. Falls back to BACKEND_URL env var
#
# Environment Variables:
#   BACKEND_URL     Backend URL (e.g., https://docgen-ci.bravemeadow-58840dba.eastus.azurecontainerapps.io)
#
# Example:
#   # Use default from environment
#   export BACKEND_URL="https://docgen-ci.bravemeadow-58840dba.eastus.azurecontainerapps.io"
#   ./scripts/configure-named-credential.sh
#
#   # Specify org and URL
#   ./scripts/configure-named-credential.sh docgen-dev "https://your-backend.com"
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
BACKEND_URL="${2:-${BACKEND_URL:-}}"
APEX_TEMPLATE="scripts/ConfigureNamedCredential.apex"

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
if [ -z "$BACKEND_URL" ]; then
    log_error "Backend URL not provided"
    log_info "Usage: $0 [org-alias] [backend-url]"
    log_info "Or set BACKEND_URL environment variable"
    exit 1
fi

# Validate URL format
if [[ ! "$BACKEND_URL" =~ ^https:// ]]; then
    log_error "Backend URL must start with https://"
    exit 1
fi

# Check if Apex template exists
if [ ! -f "$APEX_TEMPLATE" ]; then
    log_error "Apex template not found: $APEX_TEMPLATE"
    exit 1
fi

echo ""
log_info "==================================================="
log_info "Configure Named Credential for Salesforce Org"
log_info "==================================================="
echo ""

log_info "Org Alias: $ORG_ALIAS"
log_info "Backend URL: $BACKEND_URL"
log_info "Named Credential: Docgen_Node_API_CI"
echo ""

# Create temporary file for the Apex script
TEMP_APEX=$(mktemp /tmp/configure-named-credential.XXXXXX.apex)

# Ensure cleanup on exit
trap "rm -f '$TEMP_APEX'" EXIT

# Substitute placeholder in the Apex template
log_info "Preparing Apex script..."
sed -e "s|{{BACKEND_URL}}|$BACKEND_URL|g" \
    "$APEX_TEMPLATE" > "$TEMP_APEX"

log_success "Apex script prepared"

# Run the Apex script
log_info "Executing Apex script on org: $ORG_ALIAS"
echo ""

if sf apex run --file "$TEMP_APEX" --target-org "$ORG_ALIAS"; then
    echo ""
    log_success "==================================================="
    log_success "Named Credential configured successfully!"
    log_success "==================================================="
    echo ""
    log_info "The scratch org can now make callouts to:"
    log_info "  $BACKEND_URL"
    echo ""
else
    echo ""
    log_error "Failed to configure Named Credential"
    exit 1
fi
