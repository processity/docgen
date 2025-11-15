#!/usr/bin/env bash
# ============================================================================
# Configure CI Backend for Scratch Org
# ============================================================================
# This script configures the CI backend (Azure Container App) to authenticate
# against an ephemeral Salesforce scratch org using SFDX Auth URL.
#
# Purpose:
#   - Extract SFDX Auth URL from current scratch org
#   - Update Azure Key Vault secret
#   - Restart Container App to pick up new credentials
#   - Wait for backend to become healthy
#
# Usage:
#   ./scripts/configure-ci-backend-for-scratch-org.sh [org-alias]
#
# Arguments:
#   org-alias    Optional. Salesforce org alias/username. Defaults to default org.
#
# Prerequisites:
#   - Salesforce CLI (sf) installed and authenticated
#   - Azure CLI (az) installed and logged in
#   - Scratch org already created
#   - CI backend deployed (resource group: docgen-ci-rg)
#
# Example:
#   # Use default org
#   ./scripts/configure-ci-backend-for-scratch-org.sh
#
#   # Use specific org alias
#   ./scripts/configure-ci-backend-for-scratch-org.sh docgen-dev
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
RESOURCE_GROUP="docgen-ci-rg"
APP_NAME="docgen-ci"
KEY_VAULT_NAME="docgen-ci-kv"
SECRET_NAME="SFDX-AUTH-URL"

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

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."

    # Check Salesforce CLI
    if ! command -v sf &> /dev/null; then
        log_error "Salesforce CLI (sf) not found. Please install: npm install -g @salesforce/cli"
        exit 1
    fi

    # Check Azure CLI
    if ! command -v az &> /dev/null; then
        log_error "Azure CLI (az) not found. Please install: https://docs.microsoft.com/en-us/cli/azure/install-azure-cli"
        exit 1
    fi

    # Check jq
    if ! command -v jq &> /dev/null; then
        log_error "jq not found. Please install: brew install jq (macOS) or apt-get install jq (Linux)"
        exit 1
    fi

    log_success "Prerequisites checked"
}

# Get SFDX Auth URL from scratch org
get_sfdx_auth_url() {
    local org_alias="${1:-}"

    log_info "Getting SFDX Auth URL from scratch org..."

    local sf_cmd="sf org display --verbose --json"
    if [ -n "$org_alias" ]; then
        sf_cmd="$sf_cmd --target-org $org_alias"
        log_info "Using org alias: $org_alias"
    else
        log_info "Using default org"
    fi

    # Execute sf command and extract auth URL
    local sf_output
    if ! sf_output=$($sf_cmd 2>&1); then
        log_error "Failed to get org info: $sf_output"
        exit 1
    fi

    # Extract sfdxAuthUrl from JSON
    local auth_url
    auth_url=$(echo "$sf_output" | jq -r '.result.sfdxAuthUrl // empty')

    if [ -z "$auth_url" ]; then
        log_error "Could not extract sfdxAuthUrl from sf org display output"
        log_error "Output: $sf_output"
        exit 1
    fi

    # Validate format
    if [[ ! "$auth_url" =~ ^force:// ]]; then
        log_error "Invalid SFDX Auth URL format: $auth_url"
        exit 1
    fi

    # Extract instance URL for display (mask the refresh token)
    local instance_url
    instance_url=$(echo "$auth_url" | sed -E 's/.*@(.+)$/\1/')

    log_success "Got SFDX Auth URL for: $instance_url"

    echo "$auth_url"
}

# Update Key Vault secret
update_key_vault_secret() {
    local auth_url="$1"

    log_info "Updating Azure Key Vault secret..."

    # Check if Key Vault exists
    if ! az keyvault show --name "$KEY_VAULT_NAME" --output none 2>/dev/null; then
        log_error "Key Vault '$KEY_VAULT_NAME' not found. Has the CI backend been deployed?"
        exit 1
    fi

    # Update secret
    if ! az keyvault secret set \
        --vault-name "$KEY_VAULT_NAME" \
        --name "$SECRET_NAME" \
        --value "$auth_url" \
        --output none 2>/dev/null; then
        log_error "Failed to update Key Vault secret. Check permissions."
        exit 1
    fi

    log_success "Key Vault secret updated: $SECRET_NAME"
}

# Restart Container App
restart_container_app() {
    log_info "Restarting Container App to pick up new secret..."

    # Check if Container App exists
    if ! az containerapp show \
        --name "$APP_NAME" \
        --resource-group "$RESOURCE_GROUP" \
        --output none 2>/dev/null; then
        log_error "Container App '$APP_NAME' not found in resource group '$RESOURCE_GROUP'"
        exit 1
    fi

    # Restart by updating with current image (triggers new revision)
    # This forces the app to reload secrets from Key Vault
    if ! az containerapp update \
        --name "$APP_NAME" \
        --resource-group "$RESOURCE_GROUP" \
        --output none 2>/dev/null; then
        log_error "Failed to restart Container App"
        exit 1
    fi

    log_success "Container App restart initiated"
}

# Wait for backend to be healthy
wait_for_health() {
    log_info "Waiting for backend to become healthy..."

    # Get Container App URL
    local app_url
    app_url=$(az containerapp show \
        --name "$APP_NAME" \
        --resource-group "$RESOURCE_GROUP" \
        --query "properties.configuration.ingress.fqdn" \
        --output tsv)

    if [ -z "$app_url" ]; then
        log_error "Could not get Container App URL"
        exit 1
    fi

    local backend_url="https://$app_url"
    local health_url="$backend_url/readyz"

    log_info "Health endpoint: $health_url"

    local max_attempts=30
    local attempt=0
    local wait_seconds=10

    while [ $attempt -lt $max_attempts ]; do
        attempt=$((attempt + 1))

        log_info "Attempt $attempt/$max_attempts: Checking health..."

        # Check /readyz endpoint
        local http_code
        http_code=$(curl -s -o /dev/null -w "%{http_code}" "$health_url" || echo "000")

        if [ "$http_code" = "200" ]; then
            # Verify JSON response shows ready: true
            local response
            response=$(curl -s "$health_url")

            if echo "$response" | jq -e '.ready == true' > /dev/null 2>&1; then
                log_success "Backend is healthy and ready!"
                log_info "Backend URL: $backend_url"
                return 0
            else
                log_warning "Backend returned 200 but not fully ready: $response"
            fi
        else
            log_warning "Backend returned HTTP $http_code (expected 200)"
        fi

        if [ $attempt -lt $max_attempts ]; then
            log_info "Waiting $wait_seconds seconds before retry..."
            sleep $wait_seconds
        fi
    done

    log_error "Backend failed to become healthy after $max_attempts attempts ($(( max_attempts * wait_seconds )) seconds)"
    log_warning "The backend may still be starting up. Check logs:"
    log_info "  az containerapp logs show --name $APP_NAME --resource-group $RESOURCE_GROUP --tail 50"
    exit 1
}

# Main execution
main() {
    local org_alias="${1:-}"

    echo ""
    log_info "==================================================="
    log_info "Configure CI Backend for Scratch Org"
    log_info "==================================================="
    echo ""

    # Step 1: Check prerequisites
    check_prerequisites

    # Step 2: Get SFDX Auth URL
    local auth_url
    auth_url=$(get_sfdx_auth_url "$org_alias")

    # Step 3: Update Key Vault secret
    update_key_vault_secret "$auth_url"

    # Step 4: Restart Container App
    restart_container_app

    # Step 5: Wait for health
    wait_for_health

    echo ""
    log_success "==================================================="
    log_success "CI Backend configured successfully!"
    log_success "==================================================="
    echo ""
    log_info "Next steps:"
    log_info "  1. Run e2e tests: npm run test:e2e"
    log_info "  2. Check backend logs if needed:"
    log_info "     az containerapp logs show --name $APP_NAME --resource-group $RESOURCE_GROUP --tail 50"
    echo ""
}

# Run main function
main "$@"
