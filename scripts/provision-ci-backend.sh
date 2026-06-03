#!/bin/bash
# ============================================================================
# Provision CI Backend for Local E2E Testing
# ============================================================================
# This script replicates the GitHub Actions workflow for deploying a dedicated
# CI backend that can connect to ephemeral scratch orgs for e2e testing.
#
# Usage:
#   ./scripts/provision-ci-backend.sh
#
# Prerequisites:
#   - Azure CLI logged in: az login
#   - Docker installed and running
#   - Salesforce Connected App for CI (see docs/salesforce-jwt-setup.md)
#   - Private key file at: ~/.ssh/salesforce-ci.key
#
# Cost: ~$35-65/month (safe to keep running for CI tests)
# ============================================================================

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
AZURE_REGION="eastus"
RESOURCE_GROUP="docgen-ci-rg"
APP_NAME="docgen-ci"
KEY_VAULT_NAME="docgen-ci-kv"
ACR_NAME="docgenstaging"
IMAGE_TAG="ci-$(date +%Y%m%d-%H%M%S)"

# Salesforce Connected App for CI (see docs/salesforce-jwt-setup.md)
CI_SF_CLIENT_ID="${CI_SF_CLIENT_ID:-}"  # Set via environment or prompt
CI_SF_USERNAME="${CI_SF_USERNAME:-}"    # Set via environment or prompt
CI_SF_PRIVATE_KEY_PATH="${CI_SF_PRIVATE_KEY_PATH:-$HOME/.ssh/salesforce-ci.key}"

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

check_prerequisites() {
    log_info "Checking prerequisites..."

    # Check Azure CLI
    if ! command -v az &> /dev/null; then
        log_error "Azure CLI not found. Install from: https://docs.microsoft.com/en-us/cli/azure/install-azure-cli"
        exit 1
    fi

    # Check Azure login
    if ! az account show &> /dev/null; then
        log_error "Not logged into Azure. Run: az login"
        exit 1
    fi

    # Check Docker
    if ! command -v docker &> /dev/null; then
        log_error "Docker not found. Install from: https://www.docker.com/get-started"
        exit 1
    fi

    if ! docker info &> /dev/null; then
        log_error "Docker daemon not running. Start Docker Desktop."
        exit 1
    fi

    log_success "Prerequisites checked"
}

prompt_salesforce_config() {
    log_info "Salesforce Connected App Configuration"
    echo ""
    echo "You need a Salesforce Connected App with JWT Bearer flow enabled."
    echo "See: docs/salesforce-jwt-setup.md for setup instructions"
    echo ""

    # Prompt for Client ID if not set
    if [ -z "$CI_SF_CLIENT_ID" ]; then
        read -p "Enter Salesforce Connected App Client ID: " CI_SF_CLIENT_ID
    fi

    # Prompt for Username if not set
    if [ -z "$CI_SF_USERNAME" ]; then
        read -p "Enter Salesforce Integration User Username: " CI_SF_USERNAME
    fi

    # Check private key file
    if [ ! -f "$CI_SF_PRIVATE_KEY_PATH" ]; then
        log_error "Private key not found at: $CI_SF_PRIVATE_KEY_PATH"
        log_info "Generate one with: openssl genrsa -out $CI_SF_PRIVATE_KEY_PATH 2048"
        exit 1
    fi

    log_success "Salesforce configuration collected"
}

ensure_resource_group() {
    log_info "Ensuring resource group exists..."

    if ! az group show --name "$RESOURCE_GROUP" &>/dev/null; then
        log_info "Creating resource group $RESOURCE_GROUP..."
        az group create \
          --name "$RESOURCE_GROUP" \
          --location "$AZURE_REGION" \
          --tags \
            Owner="girish.lakshmanan@uipath.com" \
            Project="Personal Sandbox" \
            Environment=ci \
            Purpose=E2E-Testing \
            ManagedBy=LocalScript
        log_success "Resource group created"
    else
        log_success "Resource group already exists"
    fi
}

build_and_push_image() {
    log_info "Building and pushing Docker image..."

    # Login to ACR
    az acr login --name "$ACR_NAME"

    # Build image
    log_info "Building Docker image (this may take several minutes)..."
    docker build \
      -t "${ACR_NAME}.azurecr.io/docgen-api:${IMAGE_TAG}" \
      -f Dockerfile \
      .

    # Push image
    log_info "Pushing image to ACR..."
    docker push "${ACR_NAME}.azurecr.io/docgen-api:${IMAGE_TAG}"

    log_success "Docker image built and pushed: ${IMAGE_TAG}"
}

deploy_infrastructure() {
    log_info "Deploying CI backend infrastructure..."

    DEPLOYMENT_OUTPUT=$(az deployment group create \
      --resource-group "$RESOURCE_GROUP" \
      --template-file infra/main.bicep \
      --parameters infra/parameters/ci.bicepparam \
      --parameters imageTag="$IMAGE_TAG" \
      --mode Incremental \
      --output json)

    log_success "CI backend infrastructure deployed"

    # Extract and display URL
    APP_FQDN=$(echo "$DEPLOYMENT_OUTPUT" | jq -r '.properties.outputs.appFqdn.value')
    BACKEND_URL="https://${APP_FQDN}"

    log_success "CI Backend URL: $BACKEND_URL"
    echo "$BACKEND_URL" > .ci-backend-url
}

populate_secrets() {
    log_info "Populating CI Key Vault secrets..."

    # Set SF private key
    az keyvault secret set \
      --vault-name "$KEY_VAULT_NAME" \
      --name SF-PRIVATE-KEY \
      --file "$CI_SF_PRIVATE_KEY_PATH" \
      --encoding utf-8 \
      --output none

    # Set SF client ID
    az keyvault secret set \
      --vault-name "$KEY_VAULT_NAME" \
      --name SF-CLIENT-ID \
      --value "$CI_SF_CLIENT_ID" \
      --output none

    # Set SF username
    az keyvault secret set \
      --vault-name "$KEY_VAULT_NAME" \
      --name SF-USERNAME \
      --value "$CI_SF_USERNAME" \
      --output none

    # Set SF domain (placeholder, will be updated per scratch org)
    az keyvault secret set \
      --vault-name "$KEY_VAULT_NAME" \
      --name SF-DOMAIN \
      --value "test.salesforce.com" \
      --output none

    # Set Azure Monitor connection string
    APP_INSIGHTS_CONN=$(az monitor app-insights component show \
      --app docgen-ci-insights \
      --resource-group "$RESOURCE_GROUP" \
      --query 'connectionString' -o tsv)

    az keyvault secret set \
      --vault-name "$KEY_VAULT_NAME" \
      --name AZURE-MONITOR-CONNECTION-STRING \
      --value "$APP_INSIGHTS_CONN" \
      --output none

    log_success "CI Key Vault secrets populated"
}

health_check() {
    log_info "Waiting for backend to be ready..."

    BACKEND_URL=$(cat .ci-backend-url)
    MAX_ATTEMPTS=30
    ATTEMPT=0

    while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
        if curl -f -s "${BACKEND_URL}/healthz" > /dev/null 2>&1; then
            log_success "Backend is healthy!"

            # Test readiness
            RESPONSE=$(curl -s "${BACKEND_URL}/readyz")
            if echo "$RESPONSE" | jq -e '.ready == true' > /dev/null 2>&1; then
                log_success "Backend is ready!"
            else
                log_warning "Backend is not fully ready yet (Key Vault secrets may still be propagating)"
            fi

            return 0
        fi

        ATTEMPT=$((ATTEMPT + 1))
        log_info "Attempt $ATTEMPT/$MAX_ATTEMPTS failed, retrying in 10s..."
        sleep 10
    done

    log_error "Backend failed to become healthy after $MAX_ATTEMPTS attempts"
    exit 1
}

print_summary() {
    BACKEND_URL=$(cat .ci-backend-url)

    echo ""
    echo "========================================================================"
    echo "CI Backend Provisioned Successfully!"
    echo "========================================================================"
    echo ""
    echo "Backend URL: $BACKEND_URL"
    echo "Resource Group: $RESOURCE_GROUP"
    echo "Key Vault: $KEY_VAULT_NAME"
    echo ""
    echo "Next Steps:"
    echo "  1. Configure a scratch org for testing:"
    echo "     npm run e2e:setup"
    echo ""
    echo "  2. Update CI backend to point to your scratch org:"
    echo "     ./scripts/configure-ci-backend-for-scratch-org.sh docgen-dev"
    echo ""
    echo "  3. Run E2E tests with backend:"
    echo "     BACKEND_URL=$BACKEND_URL npm run test:e2e"
    echo ""
    echo "Cost Estimate: ~\$35-65/month"
    echo "========================================================================"
}

# ============================================================================
# Main Script
# ============================================================================

main() {
    echo ""
    echo "========================================================================"
    echo "Provisioning CI Backend for Local E2E Testing"
    echo "========================================================================"
    echo ""

    check_prerequisites
    prompt_salesforce_config
    ensure_resource_group
    build_and_push_image
    deploy_infrastructure
    populate_secrets
    health_check
    print_summary
}

main "$@"
