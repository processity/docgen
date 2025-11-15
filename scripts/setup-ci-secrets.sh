#!/bin/bash

# Script to set up GitHub CI environment and secrets
# Run this after creating the CI environment in GitHub UI

set -e

REPO="bigmantra/docgen"
ENVIRONMENT="ci"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo "================================================"
echo "Setting up CI Environment Secrets"
echo "================================================"
echo ""

# Check if gh CLI is installed
if ! command -v gh &> /dev/null; then
    echo -e "${RED}Error: GitHub CLI (gh) is not installed${NC}"
    echo "Install it from: https://cli.github.com/"
    exit 1
fi

# Check if logged in
if ! gh auth status &> /dev/null; then
    echo -e "${RED}Error: Not logged in to GitHub CLI${NC}"
    echo "Run: gh auth login"
    exit 1
fi

echo -e "${YELLOW}First, create the CI environment in GitHub:${NC}"
echo "1. Go to: https://github.com/$REPO/settings/environments"
echo "2. Click 'New environment'"
echo "3. Name it: ci"
echo "4. Click 'Configure environment'"
echo "5. No protection rules needed for CI"
echo ""
read -p "Press Enter after creating the CI environment..."
echo ""

# Azure credentials from azure-ad-config.md
# Note: CLIENT_SECRET should be read from environment or azure-ad-config.md
TENANT_ID="d8353d2a-b153-4d17-8827-902c51f72357"
CLIENT_ID="f42d24be-0a17-4a87-bfc5-d6cd84339302"
SUBSCRIPTION_ID="e6890ad9-401e-4696-bee4-c50fe72aa287"
ACR_NAME="docgenstaging"

# Read CLIENT_SECRET from environment or prompt user
if [ -z "$AZURE_CLIENT_SECRET" ]; then
    echo -e "${YELLOW}Azure Client Secret not found in environment${NC}"
    echo "Please get it from azure-ad-config.md (line 14)"
    echo ""
    read -sp "Enter AZURE_CLIENT_SECRET: " CLIENT_SECRET
    echo ""
else
    CLIENT_SECRET="$AZURE_CLIENT_SECRET"
fi

# Create AZURE_CREDENTIALS JSON
AZURE_CREDENTIALS=$(cat <<EOF
{"clientId":"$CLIENT_ID","clientSecret":"$CLIENT_SECRET","subscriptionId":"$SUBSCRIPTION_ID","tenantId":"$TENANT_ID"}
EOF
)

# Helper function to set a secret
set_secret() {
    local secret_name=$1
    local secret_value=$2
    local description=$3

    echo -n "Setting $secret_name... "
    if echo "$secret_value" | gh secret set "$secret_name" --env "$ENVIRONMENT" -R "$REPO" 2>/dev/null; then
        echo -e "${GREEN}✓${NC} $description"
    else
        echo -e "${RED}✗${NC} Failed to set $secret_name"
        echo "  Try manually: gh secret set $secret_name --env $ENVIRONMENT -R $REPO"
    fi
}

echo "================================================"
echo "Setting Azure Infrastructure Secrets"
echo "================================================"
echo ""

set_secret "AZURE_CREDENTIALS" "$AZURE_CREDENTIALS" "Service principal credentials (JSON)"
set_secret "AZURE_SUBSCRIPTION_ID" "$SUBSCRIPTION_ID" "Azure subscription ID"
set_secret "AZURE_TENANT_ID" "$TENANT_ID" "Azure AD tenant ID"
set_secret "ACR_NAME" "$ACR_NAME" "Azure Container Registry name"

echo ""
echo "================================================"
echo "Setting AAD Secrets (for Named Credential)"
echo "================================================"
echo ""

set_secret "AAD_CLIENT_ID" "$CLIENT_ID" "AAD client ID for Named Credential"
set_secret "AAD_CLIENT_SECRET" "$CLIENT_SECRET" "AAD client secret for Named Credential"

echo ""
echo "================================================"
echo "Setting Salesforce Secrets"
echo "================================================"
echo ""
echo "Copying from repository-level secrets..."
echo ""

# Get existing repository secrets and copy to CI environment
if gh secret list -R "$REPO" | grep -q "SF_PRIVATE_KEY"; then
    echo "Note: You need to manually copy these secrets from repository to CI environment:"
    echo "  - SF_PRIVATE_KEY → CI_SF_PRIVATE_KEY"
    echo "  - SF_CLIENT_ID → CI_SF_CLIENT_ID"
    echo "  - SF_USERNAME → CI_SF_USERNAME"
    echo ""
    echo "Run these commands:"
    echo ""
    echo "  # Get the values from staging environment and set them to CI"
    echo "  gh secret list --env staging -R $REPO"
    echo ""
    echo "Then manually set:"
    echo "  gh secret set CI_SF_PRIVATE_KEY --env ci -R $REPO"
    echo "  gh secret set CI_SF_CLIENT_ID --env ci -R $REPO"
    echo "  gh secret set CI_SF_USERNAME --env ci -R $REPO"
    echo "  gh secret set SF_PRIVATE_KEY --env ci -R $REPO"
    echo "  gh secret set SF_CLIENT_ID --env ci -R $REPO"
    echo ""
    echo -e "${YELLOW}Note: You'll need to paste the secret values when prompted${NC}"
else
    echo -e "${RED}Warning: Repository secrets not found${NC}"
fi

echo ""
echo "================================================"
echo "✅ Azure and AAD secrets configured!"
echo "================================================"
echo ""
echo "Summary:"
echo "  ✓ AZURE_CREDENTIALS (JSON with clientId, clientSecret, subscriptionId, tenantId)"
echo "  ✓ AZURE_SUBSCRIPTION_ID"
echo "  ✓ AZURE_TENANT_ID"
echo "  ✓ ACR_NAME"
echo "  ✓ AAD_CLIENT_ID"
echo "  ✓ AAD_CLIENT_SECRET"
echo ""
echo "Still needed (manual setup):"
echo "  ⚠ CI_SF_PRIVATE_KEY"
echo "  ⚠ CI_SF_CLIENT_ID"
echo "  ⚠ CI_SF_USERNAME"
echo "  ⚠ SF_PRIVATE_KEY"
echo "  ⚠ SF_CLIENT_ID"
echo ""
echo "Next steps:"
echo "1. Set the Salesforce secrets listed above"
echo "2. Run the e2e-tests workflow to verify CI deployment"
echo ""
