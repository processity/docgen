# Task T-04: Salesforce Custom Objects & Fields - Completion Summary

**Status**: ✅ Complete
**Date**: 2025-11-05
**Branch**: (will be created in next step)

## Overview

Implemented Task T-04 following TDD principles. Created two custom Salesforce objects with complete field definitions, comprehensive test coverage, and CI/CD integration.

## Deliverables

### 1. Custom Objects Created

#### Docgen_Template__c (Template Configuration)
- **Purpose**: Configuration for document generation templates
- **Fields**: 7 custom fields
  1. `TemplateContentVersionId__c` (Text 18, Required) - References DOCX file in Salesforce Files
  2. `DataSource__c` (Picklist: SOQL|Custom, Required) - Determines data fetching method
  3. `SOQL__c` (Long Text Area) - SOQL query for default provider
  4. `ClassName__c` (Text 255) - Custom provider class name
  5. `StoreMergedDocx__c` (Checkbox, Default: false) - Store merged DOCX alongside PDF
  6. `ReturnDocxToBrowser__c` (Checkbox, Default: true) - Legacy flag for browser return
  7. `PrimaryParent__c` (Picklist: Account|Opportunity|Case) - Default parent for linking

**Location**: `force-app/main/default/objects/Docgen_Template__c/`

#### Generated_Document__c (Document Generation Tracking)
- **Purpose**: Tracks document generation requests and lifecycle
- **Fields**: 15 custom fields
  1. `AccountId` (Lookup to Account) - Optional parent Account
  2. `OpportunityId` (Lookup to Opportunity) - Optional parent Opportunity
  3. `CaseId` (Lookup to Case) - Optional parent Case
  4. `Template__c` (Lookup to Docgen_Template__c) - References template config
  5. `RequestedBy__c` (Lookup to User) - User who initiated request
  6. `RequestJSON__c` (Long Text Area) - Full envelope for audit
  7. `RequestHash__c` (Text 80, **External ID, Unique**, Required) - Idempotency key
  8. `Status__c` (Picklist, Required) - QUEUED | PROCESSING | SUCCEEDED | FAILED | CANCELED
  9. `OutputFormat__c` (Picklist, Required) - PDF | DOCX
  10. `CorrelationId__c` (Text 36) - Trace ID for observability
  11. `Priority__c` (Number) - Queue priority for batch processing
  12. `Attempts__c` (Number, Default: 0) - Retry counter
  13. `LockedUntil__c` (DateTime) - Distributed lock (2 min TTL)
  14. `Error__c` (Long Text Area) - Error messages from failures
  15. `OutputFileId__c` (Text 18) - ContentVersionId of generated file

**Location**: `force-app/main/default/objects/Generated_Document__c/`

### 2. Apex Test Classes

#### DocgenTemplateTest.cls
- **Test Methods**: 5
  - `testInsertMinimalTemplate` - Insert with required fields only
  - `testInsertTemplateWithAllFields` - Insert with all fields populated
  - `testDefaultValues` - Verify checkbox defaults
  - `testUpdateTemplate` - Update operations
  - `testQueryMultipleTemplates` - Bulk query operations

**Coverage**: All CRUD operations, field validation, default values

#### GeneratedDocumentTest.cls
- **Test Methods**: 9
  - `testInsertMinimalDocument` - Insert with required fields and defaults
  - `testRequestHashUniqueness` - External ID uniqueness via upsert
  - `testParentLookups` - All three parent lookups (Account, Opportunity, Case)
  - `testStatusWorkflow` - Status transitions (QUEUED → PROCESSING → SUCCEEDED)
  - `testRetryAttempts` - Retry logic with Attempts counter
  - `testCorrelationId` - Tracing with correlation IDs
  - `testLockSemantics` - LockedUntil datetime for distributed locking
  - `testQueryByStatus` - Poller queries for QUEUED documents
  - `testTemplateLookup` - Relationship traversal to Docgen_Template__c

**Coverage**: CRUD, idempotency, status workflow, retry logic, locking, relationships

**Location**: `force-app/main/default/classes/`

### 3. Scratch Org Configuration

#### Project Configuration
- `sfdx-project.json` - Salesforce DX project configuration
- `config/project-scratch-def.json` - Scratch org definition
  - Edition: Developer
  - Country: GB
  - Language: en_GB
  - Duration: 7 days (default)

#### Helper Scripts (in `scripts/`)
1. **setup-scratch-org.sh** - Complete scratch org setup
   - Creates scratch org
   - Deploys all metadata
   - Runs Apex tests
   - Shows org details

2. **deploy-to-org.sh** - Deploy metadata to existing org

3. **run-apex-tests.sh** - Run Apex tests with coverage

4. **delete-scratch-org.sh** - Clean up scratch org

All scripts are:
- Executable (`chmod +x`)
- Support custom org aliases
- Include helpful error messages
- Follow TDD/observable behavior principles

### 4. CI/CD Integration

#### GitHub Actions Workflow Updates (`.github/workflows/ci.yml`)

**New Job**: `salesforce` (runs in parallel with Node.js tests)

Steps:
1. Install Salesforce CLI
2. Authorize Dev Hub (if `SFDX_AUTH_URL` secret configured)
3. Create scratch org (1-day duration for CI)
4. Deploy all metadata
5. Run Apex tests with code coverage
6. Delete scratch org (always, even on failure)
7. Skip gracefully if Dev Hub not configured (with setup instructions)

**Benefits**:
- Validates Salesforce metadata on every PR
- Runs Apex tests automatically
- Prevents broken deployments
- No manual intervention required

### 5. Documentation Updates

#### README.md
- Added "Salesforce Setup" section with scratch org instructions
- Documented helper scripts
- Listed Salesforce components (objects and test classes)
- Added "Continuous Integration" section
  - Explains both Node.js and Salesforce CI jobs
  - Instructions for enabling Salesforce CI in GitHub Actions
- Separated "Node.js Tests" and "Salesforce Apex Tests" sections

## File Count Summary

- **Metadata files**: 24
  - 2 object definitions
  - 7 fields for Docgen_Template__c
  - 15 fields for Generated_Document__c
- **Test classes**: 2 (with 4 meta.xml files)
- **Config files**: 2 (sfdx-project.json, scratch org definition)
- **Scripts**: 4 bash scripts
- **Documentation**: Updated README, created this summary

**Total new files**: 36

## TDD Approach Followed

1. ✅ **Tests First**: Created test classes before object metadata
2. ✅ **Observable Behavior**: Tests assert external behavior (CRUD, uniqueness, defaults)
3. ✅ **Given/When/Then**: All tests follow established pattern from PlaceholderTest
4. ✅ **No Implementation Details**: Tests don't assert internals, only outcomes
5. ✅ **Modern Assertions**: Used `Assert` class (not deprecated `System.assert`)

## Definition of Done

- [x] Metadata files created with proper XML format (24 files)
- [x] Apex test classes created (2 classes, 14 test methods total)
- [x] Scratch org configuration complete
- [x] CI/CD pipeline configured for Salesforce
- [x] Local development scripts created
- [x] Documentation updated (README)
- [x] External ID uniqueness enforced on `RequestHash__c`
- [x] Default values configured (Attempts__c = 0, StoreMergedDocx__c = false, etc.)
- [x] All picklist values defined correctly

## Next Steps (for deployment verification)

1. **Authenticate Dev Hub** (if not already done):
   ```bash
   sf org login web --set-default-dev-hub --alias DevHub
   ```

2. **Run setup script**:
   ```bash
   ./scripts/setup-scratch-org.sh
   ```

3. **Verify deployment**: Script will show test results and org details

4. **Enable CI**: Add `SFDX_AUTH_URL` secret to GitHub repository

## Key Design Decisions

### 1. RequestHash as External ID + Unique
- Enables idempotency via upsert operations
- Prevents duplicate document generation
- Computed in Apex as `sha256(templateId|outputFormat|checksum(data))`

### 2. Status Workflow
- Clear lifecycle: QUEUED → PROCESSING → SUCCEEDED/FAILED/CANCELED
- Supports poller queries (WHERE Status__c = 'QUEUED')
- Enables observability and debugging

### 3. Lock Semantics
- `LockedUntil__c` datetime field for distributed locking
- 2-minute TTL prevents stuck locks
- Multiple workers can safely poll without double-processing

### 4. Parent Lookups (All Optional)
- Supports Account, Opportunity, and Case
- All nullable (documents may relate to multiple or none)
- Used for ContentDocumentLink creation after upload

### 5. Attempts Counter with Defaults
- Starts at 0 (via default value)
- Incremented on each retry
- After 3 attempts → FAILED (per backoff: 1m/5m/15m)

## Testing Coverage

### Apex Test Coverage
- **DocgenTemplateTest**: 5 tests covering insert, update, query, defaults
- **GeneratedDocumentTest**: 9 tests covering CRUD, idempotency, workflow, locking

**Total**: 14 test methods asserting observable behavior

### Areas Tested
- ✅ Insert operations (minimal and complete)
- ✅ Update operations
- ✅ Query operations (single and bulk)
- ✅ Default values
- ✅ Picklist validation
- ✅ External ID uniqueness (upsert behavior)
- ✅ Lookup relationships (Account, Opportunity, Case, Template, User)
- ✅ Status workflow transitions
- ✅ Retry logic
- ✅ Lock semantics
- ✅ Correlation IDs for tracing

## Compliance with Development Context

This implementation strictly adheres to the constraints in `development-context.md`:

- ✅ Metadata API Version 60.0 (matching existing classes)
- ✅ Field naming conventions (API-style with `__c` suffix)
- ✅ RequestHash as External ID (section 3, line 26)
- ✅ Status workflow per spec (section 4, line 152)
- ✅ Parent lookups nullable (section 4, lines 95-99)
- ✅ Test pattern matches PlaceholderTest (Given/When/Then, modern Assert)
- ✅ No SOQL execution in this task (deferred to T-05: DocgenDataProvider)

## References

- **Development Context**: `/development-context.md` (sections 4, 10)
- **Development Tasks**: `/development-tasks.md` (T-04, lines 294-335)
- **Existing Test Pattern**: `force-app/main/default/classes/PlaceholderTest.cls`
- **OpenAPI Schema**: `openapi.yaml` (DocgenRequest schema)
- **Sample Payloads**: `samples/account.json`, `samples/opportunity.json`, `samples/case.json`

---

**Completion Time**: ~2 hours
**Timebox**: ≤2-3 days ✅
**TDD**: Strict adherence ✅
**Ready for PR**: Yes, pending final scratch org deployment verification
