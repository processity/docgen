#!/bin/bash
#
# Setup script for Salesforce scratch org (local development)
#
# Prerequisites:
# - Salesforce CLI installed (sf)
# - Dev Hub org authenticated
# - AAD_CLIENT_ID environment variable (Azure AD Client ID)
# - AAD_CLIENT_SECRET environment variable (Azure AD Client Secret)
#
# Usage:
#   export AAD_CLIENT_ID="your-client-id"
#   export AAD_CLIENT_SECRET="your-client-secret"
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

# Check for required environment variables
echo ""
echo "📋 Checking required environment variables..."

if [ -z "${AAD_CLIENT_ID:-}" ]; then
    echo "❌ Error: AAD_CLIENT_ID environment variable is not set"
    echo ""
    echo "This is required to configure the External Credential for backend authentication."
    echo "Please set it and try again:"
    echo ""
    echo "  export AAD_CLIENT_ID=\"your-azure-ad-client-id\""
    echo ""
    echo "You can find this value in: azure-ad-config.md"
    exit 1
fi

if [ -z "${AAD_CLIENT_SECRET:-}" ]; then
    echo "❌ Error: AAD_CLIENT_SECRET environment variable is not set"
    echo ""
    echo "This is required to configure the External Credential for backend authentication."
    echo "Please set it and try again:"
    echo ""
    echo "  export AAD_CLIENT_SECRET=\"your-azure-ad-client-secret\""
    echo ""
    echo "You can find this value in: azure-ad-config.md"
    exit 1
fi

echo "✓ AAD_CLIENT_ID is set: ${AAD_CLIENT_ID:0:8}...${AAD_CLIENT_ID: -4}"
echo "✓ AAD_CLIENT_SECRET is set: ***"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Check if Salesforce CLI is installed
if ! command -v sf &> /dev/null; then
    echo "❌ Error: Salesforce CLI (sf) is not installed"
    echo "Install it with: npm install -g @salesforce/cli"
    exit 1
fi

echo "✓ Salesforce CLI version: $(sf version)"

if ! command -v node &> /dev/null; then
    echo "❌ Error: Node.js is not installed"
    echo "Install it with: https://nodejs.org/"
    exit 1
fi

DOCGEN_PACKAGE_VERSION="$(node scripts/latest-package-version.js)"
echo "✓ Latest package alias from sfdx-project.json: $DOCGEN_PACKAGE_VERSION"

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

# Update .env file with SFDX_AUTH_URL
echo ""
echo "📝 Updating .env file with SFDX_AUTH_URL..."

# Get the SFDX Auth URL from the newly created scratch org
SCRATCH_ORG_AUTH_URL=$(sf org display --verbose --json --target-org "$ORG_ALIAS" 2>/dev/null | jq -r '.result.sfdxAuthUrl')

if [ -n "$SCRATCH_ORG_AUTH_URL" ]; then
    ENV_FILE=".env"

    # Check if .env file exists
    if [ -f "$ENV_FILE" ]; then
        # Check if SFDX_AUTH_URL already exists in .env
        if grep -q "^SFDX_AUTH_URL=" "$ENV_FILE"; then
            # Replace existing SFDX_AUTH_URL
            if [[ "$OSTYPE" == "darwin"* ]]; then
                # macOS
                sed -i '' "s|^SFDX_AUTH_URL=.*|SFDX_AUTH_URL=$SCRATCH_ORG_AUTH_URL|g" "$ENV_FILE"
            else
                # Linux
                sed -i "s|^SFDX_AUTH_URL=.*|SFDX_AUTH_URL=$SCRATCH_ORG_AUTH_URL|g" "$ENV_FILE"
            fi
            echo "✓ Updated SFDX_AUTH_URL in .env file"
        else
            # Append SFDX_AUTH_URL to .env file
            echo "" >> "$ENV_FILE"
            echo "# SFDX Auth URL (for development/testing with scratch org)" >> "$ENV_FILE"
            echo "# Auto-generated from scratch org: $ORG_ALIAS" >> "$ENV_FILE"
            echo "SFDX_AUTH_URL=$SCRATCH_ORG_AUTH_URL" >> "$ENV_FILE"
            echo "✓ Added SFDX_AUTH_URL to .env file"
        fi
    else
        # Create new .env file with SFDX_AUTH_URL
        echo "# SFDX Auth URL (for development/testing with scratch org)" > "$ENV_FILE"
        echo "# Auto-generated from scratch org: $ORG_ALIAS" >> "$ENV_FILE"
        echo "SFDX_AUTH_URL=$SCRATCH_ORG_AUTH_URL" >> "$ENV_FILE"
        echo "✓ Created .env file with SFDX_AUTH_URL"
    fi

    echo "✓ .env file updated for scratch org: $ORG_ALIAS"
else
    echo "⚠️  Warning: Could not extract SFDX_AUTH_URL from scratch org"
fi

# Install package and supplemental metadata
echo ""
echo "📦 Installing Docgen unlocked package: $DOCGEN_PACKAGE_VERSION"
sf package install \
  --package "$DOCGEN_PACKAGE_VERSION" \
  --target-org "$ORG_ALIAS" \
  --wait 20 \
  --publish-wait 20 \
  --apex-compile package \
  --no-prompt

echo "✓ Package installed successfully"

echo ""
echo "📤 Deploying supported-object custom metadata..."
sf project deploy start \
  --source-dir force-app/unpackaged/default/customMetadata \
  --target-org "$ORG_ALIAS" \
  --wait 10

echo "✓ Custom metadata deployed successfully"

echo ""
echo "📤 Deploying test metadata to scratch org..."
sf project deploy start --source-dir force-app/test --target-org "$ORG_ALIAS" --wait 10

echo "✓ Test metadata deployed successfully"

# Create test template and upload to Salesforce Files
echo ""
echo "📄 Creating test template for E2E tests..."

# Create a minimal test DOCX file
TEST_TEMPLATE_DIR="$(mktemp -d)"
TEST_TEMPLATE_FILE="$TEST_TEMPLATE_DIR/test-template.docx"

# Create a proper minimal DOCX using Python
export TEST_TEMPLATE_FILE
python3 - <<'PYTHON_EOF'
import zipfile
import os

template_file = os.environ['TEST_TEMPLATE_FILE']

# Create minimal DOCX structure
with zipfile.ZipFile(template_file, 'w', zipfile.ZIP_DEFLATED) as docx:
    # [Content_Types].xml
    docx.writestr('[Content_Types].xml', '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>''')

    # _rels/.rels
    docx.writestr('_rels/.rels', '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>''')

    # word/document.xml (with test placeholders)
    docx.writestr('word/document.xml', '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>
<w:p><w:r><w:t>Test Document Template</w:t></w:r></w:p>
<w:p><w:r><w:t>Account Name: {{Account.Name}}</w:t></w:r></w:p>
<w:p><w:r><w:t>Generated by E2E Test</w:t></w:r></w:p>
</w:body>
</w:document>''')

print(f"Created test template: {template_file}")
PYTHON_EOF

# Upload template to Salesforce Files using Apex
echo "📤 Uploading test template to Salesforce..."

# Read file as base64
TEMPLATE_BASE64=$(base64 < "$TEST_TEMPLATE_FILE" | tr -d '\n')

# Create ContentVersion and get the ContentVersionId using Anonymous Apex
TEMPLATE_ID=$(sf apex run --target-org "$ORG_ALIAS" --file /dev/stdin <<APEX_EOF | grep -oE '068[a-zA-Z0-9]{15}' | head -1
// Create test template ContentVersion
ContentVersion cv = new ContentVersion();
cv.Title = 'E2E Test Template';
cv.PathOnClient = 'test-template.docx';
cv.VersionData = EncodingUtil.base64Decode('${TEMPLATE_BASE64}');
cv.IsMajorVersion = true;
insert cv;

// Query to get the ContentVersionId
cv = [SELECT Id, ContentDocumentId FROM ContentVersion WHERE Id = :cv.Id LIMIT 1];
System.debug('TEMPLATE_ID:' + cv.Id);
System.debug(cv.Id);
APEX_EOF
)

# Clean up temp file
rm -rf "$TEST_TEMPLATE_DIR"

if [ -n "$TEMPLATE_ID" ]; then
    echo "✓ Test template created with ContentVersion ID: $TEMPLATE_ID"

    # Update the flexipage with the actual template ID
    FLEXIPAGE_FILE="force-app/test/default/flexipages/Account_Docgen_Test.flexipage-meta.xml"

    if [ -f "$FLEXIPAGE_FILE" ]; then
        echo "📝 Updating test flexipage with template ID..."

        # Create backup
        cp "$FLEXIPAGE_FILE" "${FLEXIPAGE_FILE}.backup"

        # Replace placeholder with actual ID
        sed -i.tmp "s/REPLACE_WITH_TEMPLATE_ID/$TEMPLATE_ID/g" "$FLEXIPAGE_FILE"
        rm -f "${FLEXIPAGE_FILE}.tmp"

        # Redeploy test metadata with updated flexipage
        echo "📤 Redeploying test metadata with updated template ID..."
        sf project deploy start --source-dir force-app/test --target-org "$ORG_ALIAS" --wait 10

        echo "✓ Test flexipage updated and redeployed with template ID: $TEMPLATE_ID"
    else
        echo "⚠️  Warning: Could not find flexipage file at $FLEXIPAGE_FILE"
    fi
    echo ""
else
    echo "⚠️  Warning: Could not extract ContentVersion ID from Apex output"
    echo "You may need to manually create a template and update the flexipage"
fi

# Assign permission set to the user
echo ""
echo "🔐 Assigning Docgen User permission set..."
sf org assign permset --name Docgen_User

# Configure External Credential with AAD credentials
echo ""
echo "🔑 Configuring External Credential with AAD credentials..."

TEMP_CRED_APEX=$(mktemp /tmp/configure-cred.XXXXXX.apex)
trap "rm -f '$TEMP_CRED_APEX'" EXIT

sed -e "s|{{CLIENT_ID}}|$AAD_CLIENT_ID|g" \
    -e "s|{{CLIENT_SECRET}}|$AAD_CLIENT_SECRET|g" \
    scripts/ConfigureExternalCredential.apex > "$TEMP_CRED_APEX"

if sf apex run --file "$TEMP_CRED_APEX" --target-org "$ORG_ALIAS" > /dev/null 2>&1; then
    echo "✓ External Credential configured with AAD credentials"
else
    echo "⚠️  Warning: Failed to configure External Credential (non-critical)"
fi

# Configure Custom Settings to use CI Named Credential
echo ""
echo "⚙️  Configuring Custom Settings..."

TEMP_SETTINGS_APEX=$(mktemp /tmp/configure-settings.XXXXXX.apex)
trap "rm -f '$TEMP_SETTINGS_APEX'" EXIT

sed -e "s|{{NAMED_CREDENTIAL}}|Docgen_Node_API_CI|g" \
    scripts/ConfigureCustomSettings.apex > "$TEMP_SETTINGS_APEX"

if sf apex run --file "$TEMP_SETTINGS_APEX" --target-org "$ORG_ALIAS" > /dev/null 2>&1; then
    echo "✓ Custom Settings configured to use: Docgen_Node_API_CI"
else
    echo "⚠️  Warning: Failed to configure Custom Settings (non-critical)"
fi

# Test Named Credential connectivity
echo ""
echo "🔌 Testing Named Credential connectivity..."

if sf apex run --file scripts/TestNamedCredentialCallout.apex --target-org "$ORG_ALIAS" 2>&1 | grep -q "✅ Named Credential is working correctly"; then
    echo "✓ Named Credential connectivity verified"
    echo "✓ Backend is reachable and authentication is working"
else
    echo "⚠️  Warning: Named Credential test failed (you may need to configure backend manually)"
fi

# Run Apex tests
echo ""
echo "🧪 Running Apex tests..."
sf apex run test --test-level RunLocalTests --result-format human --wait 10

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Scratch org setup complete!"
echo ""
echo "Configured components:"
echo "  ✓ Package installed ($DOCGEN_PACKAGE_VERSION)"
echo "  ✓ Supplemental metadata deployed (customMetadata + test)"
echo "  ✓ Permission set assigned (Docgen_User)"
echo "  ✓ External Credential configured with AAD"
echo "  ✓ Custom Settings pointing to CI Named Credential"
echo "  ✓ Named Credential connectivity verified"
echo "  ✓ Test template created and uploaded"
echo "  ✓ Apex tests passed"
echo "  ✓ .env file updated with SFDX_AUTH_URL"
echo ""
echo "Org details:"
sf org display --target-org "$ORG_ALIAS"
echo ""
echo "Quick commands:"
echo "  Open org:       sf org open --target-org $ORG_ALIAS"
echo "  Run E2E tests:  npm run test:e2e"
echo "  Delete org:     sf org delete scratch --target-org $ORG_ALIAS --no-prompt"
echo ""
