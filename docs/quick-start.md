# Quick Start Guide

This guide will help you get Docgen up and running in your development environment.

## Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js 20+** (see `.nvmrc` in project root)
- **npm** or **yarn**
- **Salesforce CLI** (for Apex development and scratch org management)
- **Docker** (for containerization and local testing)
- **Azure CLI** (optional, for deployment and E2E testing)

### Install Node.js

```bash
# Using nvm (recommended)
nvm install 20
nvm use 20

# Verify installation
node --version  # Should show v20.x.x
npm --version
```

### Install Salesforce CLI

```bash
# macOS
brew install sf

# Windows
# Download from https://developer.salesforce.com/tools/salesforcecli

# Verify installation
sf --version
```

### Install Docker

Download and install Docker Desktop from [https://www.docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop)

```bash
# Verify installation
docker --version
```

## Installation

### 1. Clone the Repository

```bash
git clone https://github.com/bigmantra/docgen.git
cd docgen
```

### 2. Install Dependencies

```bash
npm install
```

This will install all Node.js dependencies including:
- Fastify (web framework)
- docx-templates (template merging)
- TypeScript and build tools
- Testing frameworks (Jest, Playwright)

### 3. Run Tests

```bash
# Run all Node.js tests
npm test

# Run with coverage
npm run test:coverage

# Run type checking
npm run type-check
```

## Salesforce Setup

### Option 1: Automated Scratch Org Setup (Recommended)

The quickest way to get started is using the automated setup script:

```bash
# Authenticate to your Dev Hub (one-time setup)
sf org login web --set-default-dev-hub --alias DevHub

# Set Azure AD credentials (required for backend authentication)
# You can find these values in: azure-ad-config.md
export AAD_CLIENT_ID="your-client-id"
export AAD_CLIENT_SECRET="your-azure-ad-client-secret"

# Create and configure a scratch org
./scripts/setup-scratch-org.sh

# This script will:
# - Validate environment variables (AAD_CLIENT_ID, AAD_CLIENT_SECRET)
# - Create a new scratch org (default alias: docgen-dev)
# - Deploy all metadata (custom objects, Apex classes, LWC components)
# - Configure External Credential with AAD credentials
# - Configure Custom Settings for CI Named Credential
# - Test Named Credential connectivity with backend
# - Assign permission sets
# - Run Apex tests to verify deployment
```

**Note:** The script requires `AAD_CLIENT_ID` and `AAD_CLIENT_SECRET` environment variables to configure backend authentication. It will fail early with helpful error messages if these are not set.

### Option 2: Manual Scratch Org Setup

If you prefer manual control:

```bash
# 1. Authenticate to Dev Hub
sf org login web --set-default-dev-hub --alias DevHub

# 2. Create scratch org
sf org create scratch \
  --definition-file config/project-scratch-def.json \
  --alias docgen-dev \
  --set-default \
  --duration-days 7

# 3. Deploy metadata
sf project deploy start --source-dir force-app

# 4. Assign permission set
sf org assign permset --name Docgen_User

# 5. Run tests
sf apex run test --test-level RunLocalTests --result-format human

# 6. Open the org
sf org open
```

### Useful Salesforce Scripts

The project includes several helper scripts in the `scripts/` directory:

**Scratch Org Management:**
- **`setup-scratch-org.sh [alias]`** - Create and fully configure scratch org (including AAD credentials)
- **`delete-scratch-org.sh [alias]`** - Delete scratch org
- **`deploy-to-org.sh [alias]`** - Deploy metadata to existing org
- **`run-apex-tests.sh [alias]`** - Run Apex tests

**Credential Configuration:**
- **`configure-external-credential.sh [alias] [client-id] [secret]`** - Configure AAD External Credential
- **`configure-named-credential.sh [alias] [backend-url]`** - Configure Named Credential URL
- **`configure-ci-backend-for-scratch-org.sh [alias]`** - Configure CI backend to use scratch org

**Testing & Verification:**
- **`TestNamedCredentialCallout.apex`** - Test Named Credential connectivity (authenticated endpoint)
- **`VerifyCredentialStatus.apex`** - Check External Credential and Named Credential status

All scripts accept an optional org alias parameter (defaults to `docgen-dev`).

**Environment Variables:** Most configuration scripts use environment variables:
- `AAD_CLIENT_ID` - Azure AD Application (client) ID
- `AAD_CLIENT_SECRET` - Azure AD Client Secret
- `BACKEND_URL` - Backend API URL (for Named Credential)

## Local Development

### 1. Configure Environment Variables

Create a `.env` file in the project root:

```bash
# Server Configuration
PORT=8080
NODE_ENV=development

# Salesforce Configuration
SF_DOMAIN=your-instance.my.salesforce.com
SF_CLIENT_ID=your-connected-app-client-id
SF_USERNAME=your-username@example.com

# Azure AD (Optional - can bypass in development)
AUTH_BYPASS_DEVELOPMENT=true
AZURE_TENANT_ID=your-tenant-id
CLIENT_ID=your-client-id

# Optional: Template Features
IMAGE_ALLOWLIST=cdn.example.com,images.company.com
```

See [docs/provisioning.md](./provisioning.md) for complete environment variable reference.

### 2. Run the Development Server

```bash
# Start in development mode (with auto-reload)
npm run dev

# The server will start on http://localhost:8080

# Check health endpoint
curl http://localhost:8080/healthz
# Expected: {"status":"ok"}
```

### 3. Build for Production

```bash
# Compile TypeScript
npm run build

# Start production server
npm start
```

## First Document Generation

### 1. Upload a Template to Salesforce

1. Open your scratch org: `sf org open`
2. Navigate to the **Docgen** app
3. Go to the **Docgen Templates** tab
4. Create a new template record
5. Upload a DOCX file with merge fields (see [Template Authoring Guide](./template-authoring.md))

### 2. Add the LWC Button to a Page

1. Navigate to an Account, Opportunity, or Case record
2. Click the gear icon → **Edit Page**
3. Drag the **docgenButton** component onto the page
4. Save and activate the page

### 3. Generate a Document

1. On the record page, click the **Generate Document** button
2. Select your template from the dropdown
3. Choose output format (PDF or DOCX)
4. Click **Generate**
5. The PDF will open in a new tab, and the file will be attached to the record

**Note**: For local development, the backend must be accessible from Salesforce. Consider using:
- **Ngrok** for tunneling: `ngrok http 8080`
- **Azure Dev Environment** (recommended for E2E testing)

## Testing

### Run All Tests

```bash
# Node.js unit tests
npm test

# Apex tests (in scratch org)
npm run test:apex

# LWC tests
npm run test:lwc

# E2E tests (requires backend and scratch org)
npm run test:e2e:local
```

See [docs/testing.md](./testing.md) for comprehensive testing documentation.

## Salesforce Components

After deploying, you'll have access to:

### Custom App: Docgen
- **Docgen Templates** tab - Manage template configurations
- **Generated Documents** tab - Track document generation history
- **Docgen Test Page** tab - E2E testing interface

### Custom Objects
- **Docgen_Template__c** - Template configuration (7 fields)
- **Generated_Document__c** - Document tracking (15 fields)
- **Supported_Object__mdt** - Multi-object configuration (Custom Metadata)

### Apex Classes
- **DocgenController** - Interactive generation controller
- **DocgenEnvelopeService** - Request envelope builder
- **DocgenDataProvider** - Data collection interface
- **StandardSOQLProvider** - Default SOQL-based provider
- **BatchDocgenEnqueue** - Batch processing for mass generation
- 7 test classes with 112 tests (86% coverage)

### Lightning Web Components
- **docgenButton** - Document generation button (deployable to any page)
- **docgenTestPage** - Testing wrapper component

## Multi-Object Support

Docgen supports multiple Salesforce objects out of the box:

- Account
- Opportunity
- Case
- Contact
- Lead

You can add support for additional objects via Custom Metadata configuration. See [docs/admin-guide.md](./admin-guide.md) for instructions.

## Docker Setup (Optional)

### Build the Docker Image

```bash
docker build --platform linux/amd64 -t docgen-api:latest .
```

### Run Locally with Docker

```bash
docker run -p 8080:8080 \
  -e NODE_ENV=development \
  -e SF_DOMAIN=your-instance.my.salesforce.com \
  -e AUTH_BYPASS_DEVELOPMENT=true \
  docgen-api:latest
```

## Next Steps

Now that you have Docgen running:

1. **Create Templates** - Learn about template syntax in [Template Authoring Guide](./template-authoring.md)
2. **Explore Architecture** - Understand the system design in [Architecture Guide](./architecture.md)
3. **Deploy to Azure** - Follow [Deployment Guide](./deploy.md) for production setup
4. **Configure Monitoring** - Set up dashboards using [Monitoring Guide](./dashboards.md)

## Troubleshooting

### Common Issues

#### "LibreOffice not found" Error
```bash
# macOS
brew install libreoffice

# Linux (Ubuntu/Debian)
sudo apt-get update
sudo apt-get install -y libreoffice

# Verify
soffice --version
```

#### "Salesforce authentication failed"
- Verify `SF_DOMAIN`, `SF_CLIENT_ID`, and `SF_USERNAME` in `.env`
- Ensure Connected App is configured (see [docs/provisioning.md](./provisioning.md))
- Check JWT Bearer Flow setup

#### "Template not found" (404)
- Verify ContentVersionId is correct
- Ensure the scratch org user has access to the file
- Check Salesforce file sharing settings

#### Port already in use
```bash
# Change port in .env
PORT=3000

# Or kill process using port 8080
lsof -ti:8080 | xargs kill -9
```

For more troubleshooting, see [docs/troubleshooting-index.md](./troubleshooting-index.md).

## Getting Help

- **GitHub Issues**: [https://github.com/bigmantra/docgen/issues](https://github.com/bigmantra/docgen/issues)
- **Documentation**: [docs/](../docs/)
- **Architecture Decision Records**: [docs/adr/](./adr/)

## Related Documentation

- [Architecture Guide](./architecture.md) - Technical implementation details
- [Testing Guide](./testing.md) - Running tests and CI/CD
- [Deployment Guide](./deploy.md) - Production deployment
- [Admin Guide](./admin-guide.md) - Salesforce admin configuration
- [Template Authoring](./template-authoring.md) - Creating DOCX templates
