import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface ScratchOrgInfo {
  instanceUrl: string;
  accessToken: string;
  username: string;
  orgId: string;
}

/**
 * Get information about the current default scratch org
 * Uses `sf org display --json` to fetch credentials
 */
export async function getScratchOrgInfo(): Promise<ScratchOrgInfo> {
  try {
    // Get org info from SFDX CLI
    // Use SF_FORMAT_JSON=true to ensure clean JSON output without colors
    // In CI, use SF_USERNAME env var if available to explicitly target the org
    const targetOrg = process.env.SF_USERNAME;
    const targetOrgFlag = targetOrg ? ` --target-org ${targetOrg}` : '';
    const { stdout, stderr } = await execAsync(`sf org display${targetOrgFlag} --json`, {
      env: { ...process.env, SF_FORMAT_JSON: 'true', SF_DISABLE_COLORS: 'true' }
    });

    // Log stderr if present for debugging
    if (stderr) {
      console.error('SF CLI stderr:', stderr);
    }

    // Strip any ANSI color codes that might still be present
    const cleanStdout = stdout.replace(/\x1B\[[0-9;]*[mGKHF]/g, '');
    const orgData = JSON.parse(cleanStdout);

    if (orgData.status !== 0) {
      throw new Error(`Failed to get org info: ${orgData.message}`);
    }

    const result = orgData.result;

    // Check if we have the required fields
    if (!result.instanceUrl || !result.accessToken || !result.username) {
      throw new Error(
        'Missing required org information. Make sure a scratch org is set as default.'
      );
    }

    return {
      instanceUrl: result.instanceUrl,
      accessToken: result.accessToken,
      username: result.username,
      orgId: result.id,
    };
  } catch (error) {
    if (error instanceof Error) {
      const stderr = (error as any).stderr || '';
      const stderrInfo = stderr ? `\nStderr: ${stderr}` : '';
      throw new Error(
        `Failed to get scratch org info: ${error.message}${stderrInfo}\n\n` +
          'Make sure you have:\n' +
          '1. Salesforce CLI installed (sf)\n' +
          '2. A scratch org created and set as default\n' +
          '3. Run `npm run e2e:setup` to create a test scratch org'
      );
    }
    throw error;
  }
}

export interface ApexExecutionResult {
  success: boolean;
  compiled: boolean;
  compileProblem?: string;
  exceptionMessage?: string;
  exceptionStackTrace?: string;
  logs?: string;
}

/**
 * Execute Anonymous Apex code in the scratch org
 * Useful for setting up test state or enabling test modes
 */
export async function executeAnonymousApex(apexCode: string): Promise<ApexExecutionResult> {
  try {
    // Write Apex code to temporary file (use unique filename to avoid race conditions)
    const tempFile = `/tmp/apex-temp-${Date.now()}-${Math.random().toString(36).substring(7)}.apex`;
    const fs = require('fs');
    fs.writeFileSync(tempFile, apexCode);

    // In CI, use SF_USERNAME env var if available to explicitly target the org
    const targetOrg = process.env.SF_USERNAME;
    const targetOrgFlag = targetOrg ? ` --target-org ${targetOrg}` : '';

    // Execute via CLI (disable colors for JSON output)
    const { stdout } = await execAsync(
      `sf apex run --file ${tempFile}${targetOrgFlag} --json`,
      { env: { ...process.env, SF_FORMAT_JSON: 'true', SF_DISABLE_COLORS: 'true' } }
    );

    // Strip ANSI color codes and parse result
    const cleanStdout = stdout.replace(/\x1B\[[0-9;]*[mGKHF]/g, '');
    const result = JSON.parse(cleanStdout);

    // Clean up
    fs.unlinkSync(tempFile);

    return result.result;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to execute Anonymous Apex: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Create a record via Salesforce REST API (for binary data like ContentVersion)
 */
async function createRecordViaRestAPI(
  objectType: string,
  fields: Record<string, any>
): Promise<string> {
  const orgInfo = await getScratchOrgInfo();

  // Write JSON to temp file
  const fs = require('fs');
  const tempFile = `/tmp/sf-record-rest-${Date.now()}.json`;
  fs.writeFileSync(tempFile, JSON.stringify(fields));

  try {
    const url = `${orgInfo.instanceUrl}/services/data/v65.0/sobjects/${objectType}`;

    const command = `curl -X POST "${url}" \\
      -H "Authorization: Bearer ${orgInfo.accessToken}" \\
      -H "Content-Type: application/json" \\
      -d @${tempFile}`;

    const { stdout } = await execAsync(command, {
      maxBuffer: 10 * 1024 * 1024 // 10MB buffer for large responses
    });

    const result = JSON.parse(stdout);

    // Clean up temp file
    if (fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile);
    }

    if (!result.success || !result.id) {
      throw new Error(`REST API creation failed: ${JSON.stringify(result)}`);
    }

    return result.id;
  } catch (error) {
    // Clean up temp file on error
    const fs = require('fs');
    if (fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile);
    }
    throw error;
  }
}

/**
 * Query Salesforce records using SOQL
 */
export async function querySalesforce(soql: string): Promise<any[]> {
  try {
    // In CI, use SF_USERNAME env var if available to explicitly target the org
    const targetOrg = process.env.SF_USERNAME;
    const targetOrgFlag = targetOrg ? ` --target-org ${targetOrg}` : '';
    const command = `sf data query --query "${soql}"${targetOrgFlag} --json`;

    console.log('Executing query:', command);

    const { stdout, stderr } = await execAsync(command, {
      env: { ...process.env, SF_FORMAT_JSON: 'true', SF_DISABLE_COLORS: 'true' }
    });

    // Log stderr if present for debugging
    if (stderr) {
      console.error('SF CLI stderr (query):', stderr);
    }

    const cleanStdout = stdout.replace(/\x1B\[[0-9;]*[mGKHF]/g, '');
    const result = JSON.parse(cleanStdout);

    if (result.status !== 0) {
      throw new Error(`Query failed: ${result.message}`);
    }

    console.log(`Query returned ${result.result.records?.length || 0} records`);

    return result.result.records || [];
  } catch (error) {
    if (error instanceof Error) {
      const stderr = (error as any).stderr || '';
      const stdout = (error as any).stdout || '';
      const stderrInfo = stderr ? `\nStderr: ${stderr}` : '';
      const stdoutInfo = stdout ? `\nStdout: ${stdout}` : '';
      throw new Error(`Failed to query Salesforce: ${error.message}${stdoutInfo}${stderrInfo}`);
    }
    throw error;
  }
}

/**
 * Create a Salesforce record
 */
export async function createRecord(
  objectType: string,
  fields: Record<string, any>
): Promise<string> {
  try {
    // For ContentVersion and other objects with binary data, use REST API via curl
    if (objectType === 'ContentVersion' || Object.keys(fields).some(k => k === 'VersionData')) {
      return await createRecordViaRestAPI(objectType, fields);
    }

    // For records with complex JSON fields (like RequestJSON__c), use REST API
    // SF CLI has issues with nested JSON in --values parameter
    const hasComplexJson = Object.entries(fields).some(([key, value]) => {
      // Check if it's an object (not null, not array)
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        return true;
      }
      // Check if it's a JSON string field (field name ends with JSON__c and value is a non-empty string)
      if (key.endsWith('JSON__c') && typeof value === 'string' && value.length > 0) {
        return true;
      }
      return false;
    });

    if (hasComplexJson) {
      console.log(`Creating ${objectType} via REST API (complex JSON fields)...`);
      return await createRecordViaRestAPI(objectType, fields);
    }

    // Use Salesforce CLI for reliable record creation with JSON output
    // Build field values string for SF CLI --values parameter
    const fieldValues = Object.entries(fields)
      .map(([key, value]) => {
        if (value === null) {
          return `${key}=null`;
        } else if (typeof value === 'string') {
          // Escape single quotes in string values
          const escapedValue = value.replace(/'/g, "\\'");
          return `${key}='${escapedValue}'`;
        } else if (typeof value === 'boolean') {
          return `${key}=${value}`;
        } else if (typeof value === 'number') {
          return `${key}=${value}`;
        } else if (typeof value === 'object') {
          // For complex objects (like RequestJSON__c), stringify and escape double quotes for shell
          const jsonStr = JSON.stringify(value).replace(/"/g, '\\"');
          return `${key}='${jsonStr}'`;
        }
        return `${key}=${value}`;
      })
      .filter(Boolean)
      .join(' ');

    // Use target org from environment (for CI compatibility)
    const targetOrg = process.env.SF_USERNAME;
    const targetOrgFlag = targetOrg ? ` --target-org ${targetOrg}` : '';

    // Execute sf data create record with JSON output
    const command = `sf data create record --sobject ${objectType} --values "${fieldValues}"${targetOrgFlag} --json`;

    console.log(`Creating ${objectType} record via SF CLI...`);

    const { stdout, stderr } = await execAsync(command, {
      env: { ...process.env, SF_FORMAT_JSON: 'true', SF_DISABLE_COLORS: 'true' }
    });

    // Log stderr for debugging
    if (stderr) {
      console.error('SF CLI stderr:', stderr);
    }

    // Parse JSON response
    const cleanStdout = stdout.replace(/\x1B\[[0-9;]*[mGKHF]/g, '');
    const result = JSON.parse(cleanStdout);

    if (result.status !== 0) {
      throw new Error(`Record creation failed: ${result.message || JSON.stringify(result)}`);
    }

    if (!result.result?.id) {
      throw new Error(`No record ID returned from CLI: ${JSON.stringify(result)}`);
    }

    console.log(`✓ Created ${objectType}: ${result.result.id}`);
    return result.result.id;
  } catch (error) {
    if (error instanceof Error) {
      // SF CLI often returns error details in stdout even when command fails
      const stdout = (error as any).stdout || '';
      const stderr = (error as any).stderr || '';

      console.error('Command failed with error:', error.message);
      if (stdout) console.error('Stdout:', stdout);
      if (stderr) console.error('Stderr:', stderr);

      const stderrInfo = stderr ? `\nStderr: ${stderr}` : '';
      const stdoutInfo = stdout ? `\nStdout: ${stdout}` : '';
      throw new Error(`Failed to create record: ${error.message}${stdoutInfo}${stderrInfo}`);
    }
    throw error;
  }
}

/**
 * Update a Salesforce record
 */
export async function updateRecord(
  objectType: string,
  recordId: string,
  fields: Record<string, any>
): Promise<void> {
  try {
    // Build field values string
    const fieldValues = Object.entries(fields)
      .map(([key, value]) => {
        // Escape single quotes in string values
        const escapedValue =
          typeof value === 'string' ? value.replace(/'/g, "\\'") : value;
        return `${key}='${escapedValue}'`;
      })
      .join(' ');

    // In CI, use SF_USERNAME env var if available to explicitly target the org
    const targetOrg = process.env.SF_USERNAME;
    const targetOrgFlag = targetOrg ? ` --target-org ${targetOrg}` : '';

    // Log command for debugging in CI
    const command = `sf data update record --sobject ${objectType} --record-id ${recordId} --values "${fieldValues}"${targetOrgFlag} --json`;
    console.log('Executing:', command);

    const { stdout, stderr } = await execAsync(command, {
      env: { ...process.env, SF_FORMAT_JSON: 'true', SF_DISABLE_COLORS: 'true' }
    });

    // Log stderr if present for debugging
    if (stderr) {
      console.error('SF CLI stderr (update):', stderr);
    }

    const cleanStdout = stdout.replace(/\x1B\[[0-9;]*[mGKHF]/g, '');
    const result = JSON.parse(cleanStdout);

    if (result.status !== 0) {
      console.error('SF CLI error response:', JSON.stringify(result, null, 2));
      throw new Error(`Record update failed: ${result.message}`);
    }

    console.log(`✓ Updated ${objectType} record: ${recordId}`);
  } catch (error) {
    if (error instanceof Error) {
      const stdout = (error as any).stdout || '';
      const stderr = (error as any).stderr || '';

      console.error('Command failed with error:', error.message);
      if (stdout) console.error('Stdout:', stdout);
      if (stderr) console.error('Stderr:', stderr);

      const stderrInfo = stderr ? `\nStderr: ${stderr}` : '';
      const stdoutInfo = stdout ? `\nStdout: ${stdout}` : '';
      throw new Error(`Failed to update record: ${error.message}${stdoutInfo}${stderrInfo}`);
    }
    throw error;
  }
}

/**
 * Delete Salesforce records by IDs
 */
export async function deleteRecords(
  objectType: string,
  recordIds: string[]
): Promise<void> {
  if (recordIds.length === 0) return;

  try {
    const idsString = recordIds.join(',');
    // In CI, use SF_USERNAME env var if available to explicitly target the org
    const targetOrg = process.env.SF_USERNAME;
    const targetOrgFlag = targetOrg ? ` --target-org ${targetOrg}` : '';
    await execAsync(
      `sf data delete record --sobject ${objectType} --record-id "${idsString}"${targetOrgFlag} --json`,
      { env: { ...process.env, SF_FORMAT_JSON: 'true', SF_DISABLE_COLORS: 'true' } }
    );
  } catch (error) {
    // Ignore deletion errors (record might not exist)
    console.warn(
      `Warning: Failed to delete ${objectType} records:`,
      error instanceof Error ? error.message : error
    );
  }
}

/**
 * Wait for Salesforce records to appear by polling with retries
 * Useful for CI environments where database commits may be delayed
 */
export async function waitForSalesforceRecord(
  queryFn: () => Promise<any[]>,
  options: {
    maxAttempts?: number;
    delayMs?: number;
    description?: string;
  } = {}
): Promise<any[]> {
  const {
    maxAttempts = process.env.CI ? 15 : 5,  // More attempts in CI
    delayMs = 2000,
    description = 'records'
  } = options;

  console.log(`Waiting for ${description} (max ${maxAttempts} attempts with ${delayMs}ms delay)...`);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] Attempt ${attempt}/${maxAttempts}: Querying for ${description}...`);

    try {
      const results = await queryFn();

      if (results && results.length > 0) {
        console.log(`[${timestamp}] Success! Found ${results.length} ${description}`);
        return results;
      }

      console.log(`[${timestamp}] No records found yet`);
    } catch (error) {
      console.error(`[${timestamp}] Query failed:`, error instanceof Error ? error.message : error);
      // Continue trying unless it's the last attempt
      if (attempt === maxAttempts) {
        throw error;
      }
    }

    // Wait before next attempt (unless it's the last one)
    if (attempt < maxAttempts) {
      console.log(`[${timestamp}] Waiting ${delayMs}ms before next attempt...`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }

  throw new Error(
    `No ${description} found after ${maxAttempts} attempts (${maxAttempts * delayMs / 1000}s total wait time). ` +
    `This may indicate:\n` +
    `1. The Apex transaction is taking longer than expected to commit\n` +
    `2. There's an error preventing record creation\n` +
    `3. Network latency is higher than anticipated in CI\n` +
    `Consider increasing maxAttempts or delayMs for CI environments.`
  );
}

/**
 * ScratchOrgHelper class
 * Provides a higher-level interface for test operations
 */
export class ScratchOrgHelper {
  constructor(
    _page: any, // Playwright Page (unused but kept for interface compatibility)
    public scratchOrgConfig: ScratchOrgInfo
  ) {}

  async query<T = any>(soql: string): Promise<T[]> {
    return await querySalesforce(soql);
  }

  async createRecord(objectType: string, fields: Record<string, any>): Promise<{ id: string }> {
    const id = await createRecord(objectType, fields);
    return { id };
  }

  async updateRecord(objectType: string, recordId: string, fields: Record<string, any>): Promise<void> {
    await updateRecord(objectType, recordId, fields);
  }

  async deleteRecords(objectType: string, recordIds: string[]): Promise<void> {
    await deleteRecords(objectType, recordIds);
  }

  async executeAnonymousApex(apexCode: string): Promise<ApexExecutionResult> {
    return await executeAnonymousApex(apexCode);
  }

  async waitForRecord(
    queryFn: () => Promise<any[]>,
    options?: {
      maxAttempts?: number;
      delayMs?: number;
      description?: string;
    }
  ): Promise<any[]> {
    return await waitForSalesforceRecord(queryFn, options);
  }
}
