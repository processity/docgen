# Docgen - Salesforce PDF Generation Service

A Node.js-based document generation service that creates PDF documents from Salesforce data using docx-templates and LibreOffice, deployed on Azure Container Apps.

## Architecture Overview

```mermaid
sequenceDiagram
  autonumber
  participant U as User (Browser)
  participant L as LWC Button
  participant AX as Apex Controller
  participant NC as Named Credential (AAD client creds)
  participant N as Node (Fastify API + Worker)
  participant SF as Salesforce (REST & Files)
  rect rgb(235,245,255)
  Note over U,L,AX,N,SF: Interactive flow (upload-first, return download link)
  U->>L: Click "Generate PDF"
  L->>AX: @AuraEnabled invoke(recordId, templateId)
  AX->>AX: Build JSON envelope (preformatting, RequestHash)
  AX->>NC: Call POST /generate (AAD client credentials)
  NC->>N: POST /generate (Bearer <AAD JWT>)
  N->>SF: Fetch Template (ContentVersion <ContentVersionId>)
  N->>N: Merge DOCX (docx-templates)
  N->>N: Convert to PDF (soffice --headless)
  N->>SF: Upload ContentVersion + ContentDocumentLink(s)
  N-->>NC: 200 {downloadUrl, contentVersionId}
  AX-->>L: Return downloadUrl
  L-->>U: Open PDF in new tab
  end
  rect rgb(245,235,255)
  Note over AX,N,SF: Batch flow (ACA poller)
  AX->>SF: Batch/Queueable inserts Generated Document rows (QUEUED)
  loop every 15s
    N->>SF: Poll up to 50 rows where Status=QUEUED, not locked
    N->>SF: Lock rows (LockedUntil = now+2m; Status=PROCESSING)
    par up to 8 concurrent
      N->>SF: Fetch Template (by ContentVersionId)
      N->>N: Merge DOCX -> PDF
      N->>SF: Upload ContentVersion; update OutputFileId; set Status=SUCCEEDED
    and on failure
      N->>SF: Increment Attempts; set next run per backoff (1m/5m/15m); set FAILED if >3
    end
  end
  end
```

## Features

- **Interactive Document Generation**: User-initiated via LWC button with immediate download
- **Batch Processing**: Mass document generation via Apex Batch/Queueable with polling worker
- **Template-Based**: Uses DOCX templates with field-path substitution via docx-templates
- **PDF Conversion**: LibreOffice headless conversion with bounded concurrency (8 max per instance)
- **Idempotency**: RequestHash-based deduplication prevents duplicate work
- **Secure**: AAD OAuth2 inbound, JWT Bearer Flow outbound to Salesforce
- **Scalable**: Horizontal scaling on Azure Container Apps with distributed locking
- **Observable**: Azure Application Insights integration with correlation IDs and custom metrics

## Quick Start

### Prerequisites

- Node.js 20+ (see `.nvmrc`)
- npm or yarn
- Salesforce CLI (sfdx) for Apex development
- Docker (for containerization)

### Installation

```bash
# Install dependencies
npm install

# Run tests
npm test

# Run in development mode
npm run dev

# Build for production
npm run build

# Start production server
npm start
```

### Environment Variables

```bash
PORT=8080
NODE_ENV=development
SF_DOMAIN=<your-salesforce-instance>.my.salesforce.com
AZURE_TENANT_ID=<azure-tenant-id>
CLIENT_ID=<azure-client-id>
KEY_VAULT_URI=<azure-key-vault-uri>
IMAGE_ALLOWLIST=cdn.example.com,images.company.com
```

## Project Structure

```
docgen/
├── src/              # TypeScript source code
│   ├── routes/       # Fastify routes
│   ├── plugins/      # Fastify plugins
│   ├── config/       # Configuration management
│   └── utils/        # Utility functions
├── test/             # Jest tests
├── force-app/        # Salesforce Apex and metadata
├── docs/             # Documentation and ADRs
└── dist/             # Compiled JavaScript (gitignored)
```

## Testing

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage
```

## Documentation

- [Architecture Decision Records (ADRs)](./docs/adr/)
- [Development Context](./development-context.md)
- [Development Tasks](./development-tasks.md)

## Technology Stack

- **Runtime**: Node.js 20+ with TypeScript
- **Web Framework**: Fastify
- **Testing**: Jest + ts-jest + Supertest + Nock
- **Document Processing**: docx-templates + LibreOffice
- **Authentication**: Azure AD (inbound), JWT Bearer (outbound to Salesforce)
- **Hosting**: Azure Container Apps (UK South, 2 vCPU / 4 GB RAM)
- **Observability**: Azure Application Insights

## License

ISC
