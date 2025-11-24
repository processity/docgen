#!/bin/bash
set -e

#######################################
# Repoint Staging to New Salesforce Org
#
# This script updates the staging environment's Key Vault secrets
# to point to a new Salesforce org. This is useful when staging
# sandboxes are refreshed or when switching to a different org.
#
# Prerequisites:
# - Azure CLI installed and authenticated
# - Key Vault access permissions (Key Vault Secrets Officer role)
# - Container App permissions (Contributor access)
# - Private key file matching the public key in Salesforce Connected App
#######################################

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Azure Configuration (Fixed for Staging)
RESOURCE_GROUP="docgen-staging-rg"
KEY_VAULT_NAME="docgen-staging-kv"
CONTAINER_APP_NAME="docgen-staging"
LOCATION="eastus"

# Default values
PRIVATE_KEY_PATH="./keys/server.key"
DRY_RUN=false
BACKUP_CURRENT=false

# Function to print colored output
print_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Function to display usage
usage() {
    cat << EOF
Usage: $0 [OPTIONS]

Repoint the staging environment to a new Salesforce org by updating Key Vault secrets.

OPTIONS:
    -d, --domain DOMAIN          Salesforce domain (e.g., company.my.salesforce.com)
    -u, --username USERNAME      Integration user username
    -c, --client-id CLIENT_ID    Connected App Client ID (Consumer Key)
    -k, --key-file PATH          Path to private key file (default: ./keys/server.key)
    -b, --backup                 Backup current values before updating
    --dry-run                    Show what would be done without making changes
    -h, --help                   Display this help message

EXAMPLES:
    # Interactive mode (will prompt for required values)
    $0

    # Provide all values via command line
    $0 -d mycompany.my.salesforce.com -u integration@mycompany.com -c 3MVG9xxx -k ./keys/server.key

    # Dry run to see what would be changed
    $0 --dry-run -d mycompany.my.salesforce.com -u integration@mycompany.com -c 3MVG9xxx

EOF
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -d|--domain)
            SF_DOMAIN="$2"
            shift 2
            ;;
        -u|--username)
            SF_USERNAME="$2"
            shift 2
            ;;
        -c|--client-id)
            SF_CLIENT_ID="$2"
            shift 2
            ;;
        -k|--key-file)
            PRIVATE_KEY_PATH="$2"
            shift 2
            ;;
        -b|--backup)
            BACKUP_CURRENT=true
            shift
            ;;
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            print_error "Unknown option: $1"
            usage
            exit 1
            ;;
    esac
done

# Header
echo ""
echo "========================================"
echo "  Repoint Staging to Salesforce Org"
echo "========================================"
echo ""

# Check Azure CLI authentication
print_info "Checking Azure CLI authentication..."
if ! az account show > /dev/null 2>&1; then
    print_error "Not logged in to Azure. Please run 'az login' first."
    exit 1
fi

CURRENT_SUBSCRIPTION=$(az account show --query name -o tsv)
print_success "Authenticated to Azure (Subscription: $CURRENT_SUBSCRIPTION)"

# Check if Key Vault exists
print_info "Verifying access to Key Vault: $KEY_VAULT_NAME..."
if ! az keyvault show --name "$KEY_VAULT_NAME" --resource-group "$RESOURCE_GROUP" > /dev/null 2>&1; then
    print_error "Cannot access Key Vault $KEY_VAULT_NAME. Please check your permissions."
    exit 1
fi
print_success "Key Vault access verified"

# Interactive input if values not provided
if [ -z "$SF_DOMAIN" ]; then
    echo ""
    read -p "Enter Salesforce Domain (e.g., company.my.salesforce.com): " SF_DOMAIN
fi

if [ -z "$SF_USERNAME" ]; then
    read -p "Enter Integration User Username: " SF_USERNAME
fi

if [ -z "$SF_CLIENT_ID" ]; then
    read -p "Enter Connected App Client ID (Consumer Key): " SF_CLIENT_ID
fi

# Validate inputs
echo ""
print_info "Validating inputs..."

if [ -z "$SF_DOMAIN" ] || [ -z "$SF_USERNAME" ] || [ -z "$SF_CLIENT_ID" ]; then
    print_error "All required fields must be provided"
    exit 1
fi

if [ ! -f "$PRIVATE_KEY_PATH" ]; then
    print_error "Private key file not found at: $PRIVATE_KEY_PATH"
    exit 1
fi

print_success "All inputs validated"

# Display configuration
echo ""
echo "Configuration Summary:"
echo "======================"
echo "  Salesforce Domain:    $SF_DOMAIN"
echo "  Integration Username: $SF_USERNAME"
echo "  Client ID:           ${SF_CLIENT_ID:0:20}..."
echo "  Private Key File:    $PRIVATE_KEY_PATH"
echo "  Key Vault:           $KEY_VAULT_NAME"
echo "  Resource Group:      $RESOURCE_GROUP"
echo "  Container App:       $CONTAINER_APP_NAME"
if [ "$DRY_RUN" = true ]; then
    echo "  Mode:               ${YELLOW}DRY RUN${NC}"
fi
echo ""

# Get current values for comparison (optional)
if [ "$BACKUP_CURRENT" = true ] || [ "$DRY_RUN" = true ]; then
    print_info "Retrieving current values from Key Vault..."
    CURRENT_DOMAIN=$(az keyvault secret show --vault-name "$KEY_VAULT_NAME" --name SF-DOMAIN --query value -o tsv 2>/dev/null || echo "Not set")
    CURRENT_USERNAME=$(az keyvault secret show --vault-name "$KEY_VAULT_NAME" --name SF-USERNAME --query value -o tsv 2>/dev/null || echo "Not set")
    CURRENT_CLIENT_ID=$(az keyvault secret show --vault-name "$KEY_VAULT_NAME" --name SF-CLIENT-ID --query value -o tsv 2>/dev/null || echo "Not set")

    echo ""
    echo "Current Values:"
    echo "  Domain:    $CURRENT_DOMAIN"
    echo "  Username:  $CURRENT_USERNAME"
    echo "  Client ID: ${CURRENT_CLIENT_ID:0:20}..."
    echo ""
fi

# Backup current values
if [ "$BACKUP_CURRENT" = true ] && [ "$DRY_RUN" = false ]; then
    BACKUP_FILE="staging-backup-$(date +%Y%m%d-%H%M%S).txt"
    print_info "Backing up current values to $BACKUP_FILE..."
    cat > "$BACKUP_FILE" << EOF
# Staging Environment Backup - $(date)
SF_DOMAIN=$CURRENT_DOMAIN
SF_USERNAME=$CURRENT_USERNAME
SF_CLIENT_ID=$CURRENT_CLIENT_ID
# Note: Private key not backed up for security reasons
EOF
    print_success "Backup saved to $BACKUP_FILE"
fi

# Confirmation
if [ "$DRY_RUN" = false ]; then
    echo ""
    print_warning "This will update the staging environment's Salesforce connection."
    read -p "Do you want to proceed? (yes/no): " CONFIRM
    if [ "$CONFIRM" != "yes" ]; then
        print_info "Operation cancelled"
        exit 0
    fi
fi

# Update Key Vault Secrets
echo ""
print_info "Updating Key Vault secrets..."

# Function to update a secret
update_secret() {
    local SECRET_NAME=$1
    local SECRET_VALUE=$2
    local FROM_FILE=$3

    if [ "$DRY_RUN" = true ]; then
        if [ "$FROM_FILE" = true ]; then
            print_info "[DRY RUN] Would update $SECRET_NAME from file: $SECRET_VALUE"
        else
            print_info "[DRY RUN] Would update $SECRET_NAME"
        fi
    else
        print_info "Updating $SECRET_NAME..."
        if [ "$FROM_FILE" = true ]; then
            az keyvault secret set \
                --vault-name "$KEY_VAULT_NAME" \
                --name "$SECRET_NAME" \
                --file "$SECRET_VALUE" \
                --output none
        else
            az keyvault secret set \
                --vault-name "$KEY_VAULT_NAME" \
                --name "$SECRET_NAME" \
                --value "$SECRET_VALUE" \
                --output none
        fi
        print_success "$SECRET_NAME updated"
    fi
}

# Update each secret
update_secret "SF-DOMAIN" "$SF_DOMAIN" false
update_secret "SF-USERNAME" "$SF_USERNAME" false
update_secret "SF-CLIENT-ID" "$SF_CLIENT_ID" false
update_secret "SF-PRIVATE-KEY" "$PRIVATE_KEY_PATH" true

if [ "$DRY_RUN" = false ]; then
    print_success "All Key Vault secrets updated successfully"
fi

# Restart Container App
echo ""
print_info "Restarting Container App to apply new configuration..."

if [ "$DRY_RUN" = true ]; then
    print_info "[DRY RUN] Would restart Container App: $CONTAINER_APP_NAME"
else
    # Get the current active revision
    CURRENT_REVISION=$(az containerapp revision list \
        --name "$CONTAINER_APP_NAME" \
        --resource-group "$RESOURCE_GROUP" \
        --query "[?properties.active==\`true\`].name" \
        --output tsv | head -n1)

    if [ -z "$CURRENT_REVISION" ]; then
        print_warning "Could not find active revision. Attempting to restart latest revision..."
        CURRENT_REVISION=$(az containerapp revision list \
            --name "$CONTAINER_APP_NAME" \
            --resource-group "$RESOURCE_GROUP" \
            --query "[0].name" \
            --output tsv)
    fi

    if [ -n "$CURRENT_REVISION" ]; then
        print_info "Restarting revision: $CURRENT_REVISION"
        az containerapp revision restart \
            --name "$CONTAINER_APP_NAME" \
            --resource-group "$RESOURCE_GROUP" \
            --revision "$CURRENT_REVISION" \
            --output none
        print_success "Container App restarted"
    else
        print_warning "Could not restart Container App automatically. Please restart manually."
    fi
fi

# Health checks
echo ""
print_info "Waiting for application to be ready..."
if [ "$DRY_RUN" = false ]; then
    sleep 10  # Give the app time to restart

    BASE_URL="https://docgen-staging.greenocean-24bbbaf2.eastus.azurecontainerapps.io"

    # Check health endpoint
    print_info "Checking health endpoint..."
    HEALTH_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/healthz" || echo "000")
    if [ "$HEALTH_RESPONSE" = "200" ]; then
        print_success "Health check passed"
    else
        print_warning "Health check returned: $HEALTH_RESPONSE"
    fi

    # Check readiness endpoint (includes Salesforce connectivity)
    print_info "Checking Salesforce connectivity..."
    READY_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/readyz" || echo "000")
    if [ "$READY_RESPONSE" = "200" ]; then
        print_success "Salesforce connectivity verified"
    else
        print_warning "Readiness check returned: $READY_RESPONSE"
        print_warning "The application may still be starting up or there may be a connection issue."
        print_warning "Please check Application Insights for detailed logs."
    fi
fi

# Summary
echo ""
echo "========================================"
if [ "$DRY_RUN" = true ]; then
    echo "  DRY RUN COMPLETE"
    echo ""
    echo "No changes were made. Remove --dry-run flag to apply changes."
else
    echo "  REPOINTING COMPLETE"
    echo ""
    print_success "Staging environment has been repointed to the new Salesforce org"
    echo ""
    echo "Next Steps:"
    echo "1. Verify connectivity at: https://docgen-staging.greenocean-24bbbaf2.eastus.azurecontainerapps.io/readyz"
    echo "2. Test document generation from the Salesforce UI"
    echo "3. Monitor Application Insights for any authentication errors"
    echo ""
    if [ "$BACKUP_CURRENT" = true ]; then
        echo "Rollback Instructions:"
        echo "If you need to rollback, use the values from: $BACKUP_FILE"
    fi
fi
echo "========================================"
echo ""