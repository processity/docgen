# Apex Scripts

This directory contains Anonymous Apex scripts for managing the Docgen system.

## Worker Control Scripts

Three scripts are provided to control the worker poller from the command line:

### Start Worker

Start the document generation worker poller:

```bash
sf apex run --file scripts/StartWorker.apex
```

**Output**:
```
✅ Worker started successfully
Message: Poller started successfully
```

### Stop Worker

Stop the document generation worker poller:

```bash
sf apex run --file scripts/StopWorker.apex
```

**Output**:
```
✅ Worker stopped successfully
Message: Poller stopped successfully
```

### Check Worker Status

Check the current status of the worker poller:

```bash
sf apex run --file scripts/CheckWorkerStatus.apex
```

**Output**:
```
=== Worker Status ===
Is Running: true
Current Queue Depth: 0
Last Poll Time: 2025-11-17T18:40:38.728Z
✅ Worker is RUNNING
```

## External Credential Configuration

### Configure External Credential

Configure the Azure AD External Credential for CI/CD environments:

```bash
# Set environment variables
export AAD_CLIENT_ID="your-client-id"
export AAD_CLIENT_SECRET="your-client-secret"

# Generate and run the script
sed -e "s|{{CLIENT_ID}}|$AAD_CLIENT_ID|g" \
    -e "s|{{CLIENT_SECRET}}|$AAD_CLIENT_SECRET|g" \
    scripts/ConfigureExternalCredential.apex > /tmp/configure-cred.apex

sf apex run --file /tmp/configure-cred.apex
```

**What it does**:
- Creates or updates the `Docgen_AAD_Credential_CI` External Credential
- Sets the `clientId` and `clientSecret` for the `CI` named principal
- Idempotent - safe to run multiple times

## Usage in E2E Tests

These scripts can be called from Playwright E2E tests using the TypeScript utilities in `e2e/utils/worker-control.ts`:

```typescript
import { startWorker, stopWorker, getWorkerStatus } from './utils/worker-control';

// Start worker before test
await startWorker();

// Check status
const status = await getWorkerStatus();
console.log('Worker running:', status.isRunning);

// Stop worker after test
await stopWorker();
```

See `e2e/README.md` for more details on using these utilities in tests.

## Error Handling

All scripts follow these conventions:

- **Success**: Script completes without throwing an exception
- **Failure**: Script throws an exception with a descriptive error message
- **Logging**: All scripts use `System.debug()` for detailed logging

Exit codes:
- `0`: Success
- `1`: Failure (exception thrown)

## Requirements

- Salesforce CLI (`sf`) must be installed
- A default org must be set: `sf org set default --org <alias>`
- The org must have the `DocgenStatusController` Apex class deployed
- The org must have a Named Credential configured (see `Docgen_Settings__c`)
- The backend API must be accessible from the Salesforce org
