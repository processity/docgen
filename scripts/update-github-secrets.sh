#!/bin/bash

# ============================================================================
# GitHub Secrets Update Script for Staging Deployment
# ============================================================================
# This script updates all required GitHub secrets for the staging environment
# using the GitHub CLI (gh command).
#
# Prerequisites:
# - GitHub CLI installed and authenticated (gh auth login)
# - Repository access with secrets management permissions
# - Azure AD service principal created with appropriate permissions
# ============================================================================

set -e  # Exit on error

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Repository details
REPO="bigmantra/docgen"
ENVIRONMENT="staging"

echo "============================================================================"
echo "GitHub Secrets Update Script for Staging Deployment"
echo "Repository: $REPO"
echo "Environment: $ENVIRONMENT"
echo "============================================================================"

# Check if gh CLI is authenticated
echo -e "\n${YELLOW}Checking GitHub CLI authentication...${NC}"
if ! gh auth status > /dev/null 2>&1; then
    echo -e "${RED}Error: GitHub CLI is not authenticated. Please run 'gh auth login' first.${NC}"
    exit 1
fi
echo -e "${GREEN}✓ GitHub CLI is authenticated${NC}"

# Azure Configuration
AZURE_TENANT_ID="d8353d2a-b153-4d17-8827-902c51f72357"
AZURE_CLIENT_ID="f42d24be-0a17-4a87-bfc5-d6cd84339302"
AZURE_SUBSCRIPTION_ID="e6890ad9-401e-4696-bee4-c50fe72aa287"

# Read Azure client secret from azure-ad-config.md file if it exists
AZURE_AD_CONFIG_FILE="azure-ad-config.md"
if [ -f "$AZURE_AD_CONFIG_FILE" ]; then
    AZURE_CLIENT_SECRET=$(grep "Client Secret" "$AZURE_AD_CONFIG_FILE" | grep -o '\`[^`]*\`' | head -1 | tr -d '`')
    if [ -n "$AZURE_CLIENT_SECRET" ]; then
        echo -e "${GREEN}✓ Found Azure client secret in $AZURE_AD_CONFIG_FILE${NC}"
    else
        echo -e "${RED}Error: Could not extract client secret from $AZURE_AD_CONFIG_FILE${NC}"
        echo -e "${YELLOW}Please set AZURE_CLIENT_SECRET environment variable or update the script.${NC}"
        exit 1
    fi
else
    echo -e "${RED}Error: $AZURE_AD_CONFIG_FILE not found${NC}"
    echo -e "${YELLOW}Please ensure the file exists or set AZURE_CLIENT_SECRET environment variable.${NC}"
    exit 1
fi

# Resource names for staging
ACR_NAME="docgenstaging"
RESOURCE_GROUP="docgen-staging-rg"
APP_NAME="docgen-staging"
KEY_VAULT_NAME="docgen-staging-kv"

# Salesforce configuration
SF_DOMAIN="bigmantra.my.salesforce.com"
SF_USERNAME="giri@bigmantra.com"
SF_CLIENT_ID="3MVG9DREgiBqN9WljXt5vxSKJbEFrNef6bySvvkrTi_c70O81l_2axMRAhy4u_KVAjxak6BUaUOmDGS0crZXT"

# Read the private key from file
SF_PRIVATE_KEY_PATH="./keys/server.key"
if [ -f "$SF_PRIVATE_KEY_PATH" ]; then
    SF_PRIVATE_KEY=$(cat "$SF_PRIVATE_KEY_PATH")
    echo -e "${GREEN}✓ Found Salesforce private key at $SF_PRIVATE_KEY_PATH${NC}"
else
    echo -e "${YELLOW}Warning: Salesforce private key not found at $SF_PRIVATE_KEY_PATH${NC}"
    echo -e "${YELLOW}Please ensure the key file exists or update the SF_PRIVATE_KEY variable manually.${NC}"
    SF_PRIVATE_KEY=""
fi

# Create AZURE_CREDENTIALS JSON
AZURE_CREDENTIALS=$(cat <<EOF
{
  "clientId": "$AZURE_CLIENT_ID",
  "clientSecret": "$AZURE_CLIENT_SECRET",
  "subscriptionId": "$AZURE_SUBSCRIPTION_ID",
  "tenantId": "$AZURE_TENANT_ID"
}
EOF
)

echo -e "\n${YELLOW}Updating GitHub Secrets for $ENVIRONMENT environment...${NC}"
echo "============================================================================"

# Function to set a secret
set_secret() {
    local secret_name=$1
    local secret_value=$2
    local description=$3

    echo -n "Setting $secret_name... "
    if echo "$secret_value" | gh secret set "$secret_name" --env "$ENVIRONMENT" -R "$REPO" 2>/dev/null; then
        echo -e "${GREEN}✓${NC} $description"
    else
        echo -e "${RED}✗ Failed${NC}"
        echo -e "${RED}Error setting $secret_name. Please check your permissions.${NC}"
        return 1
    fi
}

# Update all secrets
echo ""

# Critical: AZURE_CREDENTIALS (the main issue causing deployment failure)
set_secret "AZURE_CREDENTIALS" "$AZURE_CREDENTIALS" "Azure service principal credentials (JSON)"

# Azure configuration
set_secret "AZURE_SUBSCRIPTION_ID" "$AZURE_SUBSCRIPTION_ID" "Azure subscription ID"
set_secret "AZURE_TENANT_ID" "$AZURE_TENANT_ID" "Azure AD tenant ID"

# Resource names
set_secret "ACR_NAME" "$ACR_NAME" "Azure Container Registry name"
set_secret "RESOURCE_GROUP" "$RESOURCE_GROUP" "Azure resource group name"
set_secret "APP_NAME" "$APP_NAME" "Application name"
set_secret "KEY_VAULT_NAME" "$KEY_VAULT_NAME" "Azure Key Vault name"

# Salesforce credentials
set_secret "SF_DOMAIN" "$SF_DOMAIN" "Salesforce domain"
set_secret "SF_USERNAME" "$SF_USERNAME" "Salesforce username"
set_secret "SF_CLIENT_ID" "$SF_CLIENT_ID" "Salesforce connected app client ID"

# Salesforce private key (handle carefully due to multiline content)
if [ -n "$SF_PRIVATE_KEY" ]; then
    set_secret "SF_PRIVATE_KEY" "$SF_PRIVATE_KEY" "Salesforce private key (PEM format)"
else
    echo -e "${YELLOW}⚠ Skipping SF_PRIVATE_KEY (not found)${NC}"
fi

echo ""
echo "============================================================================"
echo -e "${GREEN}Secret update complete!${NC}"
echo ""

# Verify secrets were set
echo -e "${YELLOW}Verifying secrets in $ENVIRONMENT environment...${NC}"
echo "----------------------------------------------------------------------------"
gh secret list --env "$ENVIRONMENT" -R "$REPO"

echo ""
echo "============================================================================"
echo -e "${GREEN}Next Steps:${NC}"
echo "1. Re-run the failed deployment workflow:"
echo "   gh workflow run deploy-staging.yml -R $REPO"
echo ""
echo "2. Monitor the deployment:"
echo "   gh run watch -R $REPO"
echo ""
echo "3. Check deployment status:"
echo "   gh run list --workflow=deploy-staging.yml -R $REPO"
echo ""
echo "============================================================================"

# Optional: Ask if user wants to trigger deployment now
echo ""
read -p "Do you want to trigger the staging deployment now? (y/n) " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${YELLOW}Triggering staging deployment...${NC}"
    if gh workflow run deploy-staging.yml -R "$REPO"; then
        echo -e "${GREEN}✓ Deployment triggered successfully!${NC}"
        echo "Run 'gh run watch -R $REPO' to monitor the deployment."
    else
        echo -e "${RED}Failed to trigger deployment. Please run manually.${NC}"
    fi
fi