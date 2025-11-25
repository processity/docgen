# API Reference

This document provides a reference for the Docgen REST API. For the complete OpenAPI specification, see [openapi.yaml](../openapi.yaml).

## Table of Contents

- [Authentication](#authentication)
- [Health & Readiness Endpoints](#health--readiness-endpoints)
- [Document Generation](#document-generation)
  - [Single-Template Generation](#post-generate)
  - [Composite Document Requests](#composite-document-requests)
- [Worker Management](#worker-management)
- [Error Responses](#error-responses)
- [Request/Response Examples](#requestresponse-examples)

---

## Authentication

All API endpoints (except health checks) require Azure AD OAuth 2.0 authentication.

### Authentication Method

**Type**: Bearer Token (JWT)
**Protocol**: OAuth 2.0 Client Credentials Flow
**Header**: `Authorization: Bearer <token>`

### Obtaining an Access Token

```bash
# Using Azure CLI
az account get-access-token \
  --resource api://<CLIENT_ID> \
  --query accessToken \
  --output tsv

# Using curl (client credentials flow)
curl -X POST "https://login.microsoftonline.com/<TENANT_ID>/oauth2/v2.0/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "client_id=<CLIENT_ID>" \
  -d "client_secret=<CLIENT_SECRET>" \
  -d "scope=api://<CLIENT_ID>/.default" \
  -d "grant_type=client_credentials"
```

### Salesforce Integration

Salesforce uses a **Named Credential** (`Docgen_Node_API`) to automatically obtain and inject tokens. No manual token management required in Apex code.

```apex
// Apex code - Named Credential handles auth automatically
HttpRequest req = new HttpRequest();
req.setEndpoint('callout:Docgen_Node_API/generate');
req.setMethod('POST');
req.setHeader('Content-Type', 'application/json');
req.setBody(JSON.serialize(envelope));
Http http = new Http();
HTTPResponse res = http.send(req);
```

See [Named Credential Setup](./named-credential-setup.md) for configuration details.

---

## Health & Readiness Endpoints

### GET /healthz

**Liveness probe** - Always returns 200 if the server is running.

**Authentication**: None required

**Response** (200 OK):
```json
{
  "status": "ok"
}
```

**Usage**:
```bash
curl http://localhost:8080/healthz
```

---

### GET /readyz

**Readiness probe** - Returns 200 when all dependencies are healthy, 503 otherwise.

**Authentication**: None required

**Checks**:
- JWKS endpoint connectivity (for JWT validation)
- Salesforce API connectivity
- Azure Key Vault connectivity (if configured)

**Response** (200 OK):
```json
{
  "ready": true,
  "checks": {
    "jwks": true,
    "salesforce": true,
    "keyVault": true
  }
}
```

**Response** (503 Service Unavailable):
```json
{
  "ready": false,
  "checks": {
    "jwks": true,
    "salesforce": false,
    "keyVault": true
  },
  "error": "Salesforce API unreachable"
}
```

**Usage**:
```bash
curl http://localhost:8080/readyz
```

---

## Document Generation

### POST /generate

Generate a PDF or DOCX document from a Salesforce template.

**Authentication**: Required (Azure AD Bearer token)

**Headers**:
- `Authorization: Bearer <token>` (required)
- `Content-Type: application/json` (required)
- `x-correlation-id: <uuid>` (optional, auto-generated if not provided)

**Request Body**:

```typescript
{
  // Template configuration
  templateId: string;              // ContentVersionId of template (required)
  outputFileName: string;          // Output file name (required)
  outputFormat: "PDF" | "DOCX";    // Output format (required)

  // Locale/timezone configuration
  locale?: string;                 // e.g., "en-US", "en-GB" (optional, default: "en-US")
  timezone?: string;               // e.g., "America/New_York" (optional, default: "UTC")

  // Options
  options?: {
    storeMergedDocx?: boolean;     // Store merged DOCX in Salesforce (default: false)
    returnDocxToBrowser?: boolean; // Return DOCX instead of PDF (default: false)
  };

  // Parent record IDs for linking
  parents?: {
    AccountId?: string | null;
    OpportunityId?: string | null;
    CaseId?: string | null;
    ContactId?: string | null;
    LeadId?: string | null;
  };

  // Template data
  data: Record<string, any>;       // Data to merge into template (required)

  // Idempotency
  requestHash?: string;            // SHA-256 hash for deduplication (optional)

  // Tracking
  generatedDocumentId?: string;    // Generated_Document__c record ID (optional)
}
```

**Response** (200 OK - Synchronous):
```json
{
  "downloadUrl": "https://example.my.salesforce.com/sfc/servlet.shepherd/version/download/068xx...",
  "contentVersionId": "068xx000000abcdXXX",
  "correlationId": "12345678-1234-4567-89ab-123456789012"
}
```

**Response** (202 Accepted - Async):
```json
{
  "correlationId": "12345678-1234-4567-89ab-123456789012",
  "message": "Document generation request accepted"
}
```

**Field Reference**:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `templateId` | string | Yes | ContentVersionId of the DOCX template |
| `outputFileName` | string | Yes | Name for generated file (supports merge fields like `{{Account.Name}}`) |
| `outputFormat` | string | Yes | "PDF" or "DOCX" |
| `locale` | string | No | Locale for number/date formatting (default: "en-US") |
| `timezone` | string | No | Timezone for date formatting (default: "UTC") |
| `options.storeMergedDocx` | boolean | No | Store merged DOCX in addition to PDF (default: false) |
| `options.returnDocxToBrowser` | boolean | No | Return DOCX URL instead of PDF (default: false) |
| `parents` | object | No | Parent record IDs for ContentDocumentLink creation |
| `data` | object | Yes | Template merge data (Salesforce field paths) |
| `requestHash` | string | No | Idempotency key (auto-computed if not provided) |
| `generatedDocumentId` | string | No | Generated_Document__c ID for status tracking |

**Data Structure**:

The `data` object should follow Salesforce field path conventions:

```json
{
  "data": {
    "Account": {
      "Name": "Acme Corporation",
      "AnnualRevenue": 5000000,
      "AnnualRevenue__formatted": "$5,000,000.00",
      "Phone": "+1-555-0123",
      "Industry": "Technology",
      "Owner": {
        "Name": "John Smith",
        "Email": "john.smith@example.com"
      }
    },
    "Opportunities": [
      {
        "Name": "Q1 Renewal",
        "Amount": 150000,
        "Amount__formatted": "$150,000.00",
        "CloseDate": "2024-03-31",
        "CloseDate__formatted": "March 31, 2024",
        "StageName": "Closed Won"
      }
    ]
  }
}
```

See [Field Path Conventions](./field-path-conventions.md) for details.

**Example Request**:

```bash
curl -X POST "https://docgen.azurecontainerapps.io/generate" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "x-correlation-id: $(uuidgen)" \
  -d @request.json
```

**Example Response**:

```json
{
  "downloadUrl": "https://myorg.my.salesforce.com/sfc/servlet.shepherd/version/download/068xx000000abcdXXX",
  "contentVersionId": "068xx000000abcdXXX",
  "correlationId": "a3f12d8e-9b4c-4a21-b8f3-c1d2e3f4a5b6"
}
```

**Sample Payloads**:

See the [samples/](../samples/) directory for complete example payloads:
- `account.json` - Account document generation
- `opportunity.json` - Opportunity with line items
- `case.json` - Case with related articles
- `contact.json` - Contact document generation
- `lead.json` - Lead document generation

---

### Composite Document Requests

Composite mode detected by presence of `compositeDocumentId`. Two strategies differ in template structure:

**Own Template**: Single `templateId`, data namespaced (`{Account: {...}, Terms: {...}}`), template uses `{{Namespace.Field}}`.

**Concatenate Templates**: Array of `templates[{templateId, namespace, sequence}]`, each template gets only its namespace data (no prefix).

**Key Fields**:
| Field | Own Template | Concatenate |
|-------|--------------|-------------|
| `compositeDocumentId` | Required | Required |
| `templateStrategy` | "Own Template" | "Concatenate Templates" |
| `templateId` | Required | Absent |
| `templates[]` | Absent | Required |
| `data` | Namespaced | Namespaced |

**Validation**: Own Template requires `templateId` + absent `templates`. Concatenate requires `templates` array + absent `templateId`. Missing namespace data returns 400.

**See**: [Field Paths](./field-path-conventions.md#namespace-scoped-field-paths-composite-documents)

---

## Worker Management

The worker endpoints control the batch processing poller.

### POST /worker/start

Start the worker poller for batch document processing.

**Authentication**: Required (Azure AD Bearer token)

**Response** (200 OK):
```json
{
  "status": "running",
  "message": "Worker started successfully"
}
```

**Response** (409 Conflict):
```json
{
  "statusCode": 409,
  "error": "Conflict",
  "message": "Worker is already running"
}
```

**Example**:
```bash
curl -X POST "https://docgen.azurecontainerapps.io/worker/start" \
  -H "Authorization: Bearer $TOKEN"
```

---

### POST /worker/stop

Stop the worker poller gracefully (waits for in-flight jobs to complete).

**Authentication**: Required (Azure AD Bearer token)

**Response** (200 OK):
```json
{
  "status": "stopped",
  "message": "Worker stopped successfully"
}
```

**Response** (409 Conflict):
```json
{
  "statusCode": 409,
  "error": "Conflict",
  "message": "Worker is not running"
}
```

**Example**:
```bash
curl -X POST "https://docgen.azurecontainerapps.io/worker/stop" \
  -H "Authorization: Bearer $TOKEN"
```

---

### GET /worker/status

Get current worker status.

**Authentication**: Required (Azure AD Bearer token)

**Response** (200 OK):
```json
{
  "running": true,
  "queueDepth": 42,
  "lastPollTime": "2024-01-15T10:30:00.000Z",
  "nextPollTime": "2024-01-15T10:30:15.000Z"
}
```

**Fields**:
- `running` - Whether the worker is currently running
- `queueDepth` - Number of documents currently queued (QUEUED status)
- `lastPollTime` - ISO 8601 timestamp of last poll
- `nextPollTime` - ISO 8601 timestamp of next scheduled poll

**Example**:
```bash
curl "https://docgen.azurecontainerapps.io/worker/status" \
  -H "Authorization: Bearer $TOKEN"
```

---

### GET /worker/stats

Get detailed worker statistics.

**Authentication**: Required (Azure AD Bearer token)

**Response** (200 OK):
```json
{
  "processed": 1523,
  "succeeded": 1487,
  "failed": 36,
  "retries": 52,
  "successRate": 0.9764,
  "uptime": 86400000
}
```

**Fields**:
- `processed` - Total documents processed
- `succeeded` - Total successful generations
- `failed` - Total failed generations (after all retries)
- `retries` - Total retry attempts
- `successRate` - Success rate (succeeded / processed)
- `uptime` - Worker uptime in milliseconds

**Example**:
```bash
curl "https://docgen.azurecontainerapps.io/worker/stats" \
  -H "Authorization: Bearer $TOKEN"
```

---

## Error Responses

All errors follow the Fastify error response format:

```json
{
  "statusCode": 400,
  "error": "Bad Request",
  "message": "body must have required property 'templateId'",
  "correlationId": "12345678-1234-4567-89ab-123456789012"
}
```

### HTTP Status Codes

| Status | Error | Description |
|--------|-------|-------------|
| 400 | Bad Request | Invalid request payload or parameters |
| 401 | Unauthorized | Missing or invalid authentication token |
| 403 | Forbidden | Valid token but insufficient permissions |
| 404 | Not Found | Template or resource not found |
| 409 | Conflict | Resource conflict (e.g., worker already running) |
| 422 | Unprocessable Entity | Valid request but business logic error |
| 500 | Internal Server Error | Unexpected server error |
| 503 | Service Unavailable | Service or dependency unavailable |

### Common Error Scenarios

#### Missing Authentication

**Request**:
```bash
curl -X POST "https://docgen.azurecontainerapps.io/generate" \
  -H "Content-Type: application/json" \
  -d '{...}'
```

**Response** (401):
```json
{
  "statusCode": 401,
  "error": "Unauthorized",
  "message": "Missing Authorization header"
}
```

#### Invalid Token

**Response** (401):
```json
{
  "statusCode": 401,
  "error": "Unauthorized",
  "message": "Invalid or expired token"
}
```

#### Template Not Found

**Response** (404):
```json
{
  "statusCode": 404,
  "error": "Not Found",
  "message": "Template not found: ContentVersionId '068xx000000abcdXXX'",
  "correlationId": "12345678-1234-4567-89ab-123456789012"
}
```

#### Validation Error

**Response** (400):
```json
{
  "statusCode": 400,
  "error": "Bad Request",
  "message": "body must have required property 'templateId'",
  "validation": [
    {
      "instancePath": "",
      "schemaPath": "#/required",
      "keyword": "required",
      "params": { "missingProperty": "templateId" }
    }
  ]
}
```

#### Conversion Timeout

**Response** (500):
```json
{
  "statusCode": 500,
  "error": "Internal Server Error",
  "message": "LibreOffice conversion timed out after 60000ms",
  "correlationId": "12345678-1234-4567-89ab-123456789012"
}
```

---

## Request/Response Examples

### Basic PDF Generation

**Request**:
```bash
curl -X POST "https://docgen.azurecontainerapps.io/generate" \
  -H "Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGc..." \
  -H "Content-Type: application/json" \
  -d '{
    "templateId": "068xx000000abcdXXX",
    "outputFileName": "Account_Summary.pdf",
    "outputFormat": "PDF",
    "parents": {
      "AccountId": "001xx000000abcdXXX"
    },
    "data": {
      "Account": {
        "Name": "Acme Corporation",
        "AnnualRevenue__formatted": "$5,000,000.00",
        "Phone": "+1-555-0123"
      }
    }
  }'
```

**Response**:
```json
{
  "downloadUrl": "https://myorg.my.salesforce.com/sfc/servlet.shepherd/version/download/068yy000000xyzXXX",
  "contentVersionId": "068yy000000xyzXXX",
  "correlationId": "a3f12d8e-9b4c-4a21-b8f3-c1d2e3f4a5b6"
}
```

---

### Generate with Locale/Timezone

**Request**:
```bash
curl -X POST "https://docgen.azurecontainerapps.io/generate" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "templateId": "068xx000000abcdXXX",
    "outputFileName": "UK_Account_Report.pdf",
    "outputFormat": "PDF",
    "locale": "en-GB",
    "timezone": "Europe/London",
    "parents": {
      "AccountId": "001xx000000abcdXXX"
    },
    "data": {
      "Account": {
        "Name": "British Industries Ltd",
        "AnnualRevenue__formatted": "£3,500,000.00",
        "CreatedDate__formatted": "15/01/2024"
      }
    }
  }'
```

---

### Generate and Store Merged DOCX

**Request**:
```bash
curl -X POST "https://docgen.azurecontainerapps.io/generate" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "templateId": "068xx000000abcdXXX",
    "outputFileName": "Contract.pdf",
    "outputFormat": "PDF",
    "options": {
      "storeMergedDocx": true
    },
    "parents": {
      "OpportunityId": "006xx000000abcdXXX"
    },
    "data": {
      "Opportunity": {
        "Name": "Q1 Contract Renewal",
        "Amount__formatted": "$150,000.00"
      }
    }
  }'
```

**Response**:
```json
{
  "downloadUrl": "https://myorg.my.salesforce.com/sfc/servlet.shepherd/version/download/068yy000000pdfXXX",
  "contentVersionId": "068yy000000pdfXXX",
  "docxContentVersionId": "068zz000000docxXXX",
  "correlationId": "a3f12d8e-9b4c-4a21-b8f3-c1d2e3f4a5b6"
}
```

---

### Multi-Parent Linking

**Request**:
```bash
curl -X POST "https://docgen.azurecontainerapps.io/generate" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "templateId": "068xx000000abcdXXX",
    "outputFileName": "Opportunity_Summary.pdf",
    "outputFormat": "PDF",
    "parents": {
      "AccountId": "001xx000000abcdXXX",
      "OpportunityId": "006xx000000xyzXXX",
      "CaseId": null
    },
    "data": {
      "Opportunity": {
        "Name": "Enterprise Deal",
        "Amount__formatted": "$500,000.00"
      },
      "Account": {
        "Name": "Global Corp"
      }
    }
  }'
```

---

## Rate Limits

Currently, there are no enforced rate limits on the API. However, be mindful of:

- **LibreOffice Pool**: Max 8 concurrent conversions per instance
- **Salesforce API Limits**: Standard Salesforce API limits apply for file uploads and API calls
- **Token Expiry**: Azure AD tokens expire after 1 hour

## Related Documentation

- [OpenAPI Specification](../openapi.yaml) - Complete machine-readable API spec
- [Field Path Conventions](./field-path-conventions.md) - Data structure guide
- [Architecture Guide](./architecture.md) - Technical implementation
- [Named Credential Setup](./named-credential-setup.md) - Salesforce authentication
- [Sample Payloads](../samples/) - Example request/response payloads
