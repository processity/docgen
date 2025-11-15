// Common TypeScript interfaces and types

export interface HealthStatus {
  status: 'ok';
}

export interface ReadinessStatus {
  ready: boolean;
  checks?: {
    database?: boolean;
    salesforce?: boolean;
    keyVault?: boolean;
    jwks?: boolean;
  };
}

export interface AppConfig {
  port: number;
  nodeEnv: string;
  logLevel: string;
  sfDomain?: string;
  azureTenantId?: string;
  clientId?: string;
  keyVaultUri?: string;
  imageAllowlist?: string[];
  // Azure AD JWT validation settings (T-08)
  issuer?: string;
  audience?: string;
  jwksUri?: string;
  // Salesforce JWT Bearer Flow settings (T-09)
  sfUsername?: string;
  sfClientId?: string;
  sfPrivateKey?: string;
  // Salesforce SFDX Auth URL (alternative to JWT Bearer)
  sfdxAuthUrl?: string;
  // LibreOffice conversion settings (T-11)
  conversionTimeout: number;
  conversionWorkdir: string;
  conversionMaxConcurrent: number;
  // Worker Poller settings (T-14)
  poller: PollerConfig;
  // Azure Application Insights settings (T-15)
  azureMonitorConnectionString?: string;
  enableTelemetry: boolean;
}

export interface CorrelationContext {
  correlationId: string;
}

// Docgen Request/Response Types

export interface DocgenOptions {
  storeMergedDocx: boolean;
  returnDocxToBrowser: boolean;
}

/**
 * Parent record IDs for ContentDocumentLink creation
 * Each property is optional and nullable to support various linking scenarios
 */
export interface DocgenParents {
  AccountId?: string | null;
  OpportunityId?: string | null;
  CaseId?: string | null;
}

/**
 * Document generation request
 *
 * @property parents - Optional parent record IDs for file linking
 *   NOTE: If provided, must be an object (not null). To indicate "no parents",
 *   either omit the field entirely or provide an object with null properties.
 *   Schema validation will reject `parents: null`.
 *
 * @example Valid parents usage:
 * ```typescript
 * // Option 1: Omit field entirely
 * { templateId: "...", ... }
 *
 * // Option 2: Provide object with null values
 * { templateId: "...", parents: { AccountId: null, OpportunityId: null, CaseId: null } }
 *
 * // Option 3: Provide specific parent IDs
 * { templateId: "...", parents: { AccountId: "001xxx", OpportunityId: null, CaseId: null } }
 * ```
 */
export interface DocgenRequest {
  templateId: string;
  outputFileName: string;
  outputFormat: 'PDF' | 'DOCX';
  locale: string;
  timezone: string;
  options: DocgenOptions;
  data: Record<string, any>;
  parents?: DocgenParents;
  requestHash?: string;
  generatedDocumentId?: string; // T-12: Apex passes this for status updates
}

export interface DocgenResponse {
  downloadUrl: string;
  contentVersionId: string;
  correlationId: string;
}

// Salesforce Authentication Types (T-09)

/**
 * Salesforce OAuth2 token response from JWT Bearer Flow
 */
export interface SalesforceTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number; // seconds
  scope: string;
  instance_url?: string;
  id?: string;
}

/**
 * Cached token with expiry tracking
 */
export interface CachedToken {
  accessToken: string;
  expiresAt: number; // Unix timestamp in milliseconds
  instanceUrl?: string;
}

// Template Cache Types (T-10)

/**
 * Cache entry for a template
 * Templates are immutable (keyed by ContentVersionId), so no TTL needed
 */
export interface TemplateCacheEntry {
  contentVersionId: string;
  buffer: Buffer;
  sizeBytes: number;
  cachedAt: number; // Unix timestamp in milliseconds
  lastAccessedAt: number; // For LRU eviction
}

/**
 * Template cache statistics
 */
export interface TemplateCacheStats {
  hits: number;
  misses: number;
  evictions: number;
  currentSize: number; // bytes
  entryCount: number;
}

/**
 * Options for template merging
 */
export interface MergeOptions {
  locale: string;
  timezone: string;
  imageAllowlist?: string[];
}

/**
 * Salesforce ContentVersion metadata
 */
export interface ContentVersionMetadata {
  Id: string;
  Title: string;
  VersionData?: string; // URL to binary data
  FileExtension?: string;
  ContentSize?: number;
}

// LibreOffice Conversion Types (T-11)

/**
 * Options for DOCX to PDF conversion
 */
export interface ConversionOptions {
  /** Timeout in milliseconds (default: 60000) */
  timeout?: number;
  /** Working directory for temp files (default: /tmp) */
  workdir?: string;
  /** Correlation ID for logging and tracing */
  correlationId?: string;
}

/**
 * Conversion pool statistics
 * Tracks job execution and pool state for observability
 */
export interface ConversionPoolStats {
  /** Number of currently active conversion jobs */
  activeJobs: number;
  /** Number of jobs waiting in queue */
  queuedJobs: number;
  /** Total number of successfully completed conversions */
  completedJobs: number;
  /** Total number of failed conversions */
  failedJobs: number;
  /** Total number of conversion attempts (completed + failed) */
  totalConversions: number;
}

// Salesforce File Upload Types (T-12)

/**
 * Request payload for creating a ContentVersion in Salesforce
 * Represents a file upload to Salesforce Files
 */
export interface ContentVersionCreateRequest {
  /** Base64-encoded binary data of the file */
  VersionData: string;
  /** Title of the file (displayed in Salesforce UI) */
  Title: string;
  /** Full filename with extension (e.g., "Invoice_12345.pdf") */
  PathOnClient: string;
  /** Optional: Record ID to link the file to on creation */
  FirstPublishLocationId?: string;
}

/**
 * Salesforce response after creating a ContentVersion
 */
export interface ContentVersionCreateResponse {
  /** ContentVersion record ID (18-char Salesforce ID) */
  id: string;
  /** Whether the creation was successful */
  success: boolean;
  /** Array of errors if creation failed */
  errors: Array<{ message: string; statusCode: string }>;
}

/**
 * Full ContentVersion record after querying Salesforce
 * Used to get ContentDocumentId after upload
 */
export interface ContentVersionRecord {
  /** ContentVersion record ID */
  Id: string;
  /** Parent ContentDocument ID (needed for linking) */
  ContentDocumentId: string;
  /** Title of the file */
  Title: string;
  /** File extension */
  FileExtension?: string;
  /** Size in bytes */
  ContentSize?: number;
}

/**
 * Request payload for creating a ContentDocumentLink in Salesforce
 * Links a ContentDocument (file) to a parent record
 */
export interface ContentDocumentLinkCreateRequest {
  /** ContentDocument ID to link */
  ContentDocumentId: string;
  /** Parent record ID (Account, Opportunity, Case, etc.) */
  LinkedEntityId: string;
  /** Share type: 'V' = Viewer, 'C' = Collaborator, 'I' = Inferred */
  ShareType: 'V' | 'C' | 'I';
  /** Visibility: 'AllUsers' | 'InternalUsers' | 'SharedUsers' */
  Visibility: 'AllUsers' | 'InternalUsers' | 'SharedUsers';
}

/**
 * Salesforce response after creating a ContentDocumentLink
 */
export interface ContentDocumentLinkCreateResponse {
  /** ContentDocumentLink record ID */
  id: string;
  /** Whether the creation was successful */
  success: boolean;
  /** Array of errors if creation failed */
  errors: Array<{ message: string; statusCode: string }>;
}

/**
 * Fields that can be updated on Generated_Document__c
 */
export interface GeneratedDocumentUpdateFields {
  /** Processing status (QUEUED | PROCESSING | SUCCEEDED | FAILED | CANCELED) */
  Status__c?: string;
  /** ContentVersionId of the generated PDF */
  OutputFileId__c?: string;
  /** Optional: ContentVersionId of the merged DOCX (if storeMergedDocx=true) */
  MergedDocxFileId__c?: string;
  /** Error message if Status__c = FAILED */
  Error__c?: string;
  /** Number of processing attempts */
  Attempts__c?: number;
}

/**
 * Result of uploading files and creating links
 */
export interface FileUploadResult {
  /** ContentVersionId of the uploaded PDF */
  pdfContentVersionId: string;
  /** Optional: ContentVersionId of the uploaded DOCX */
  docxContentVersionId?: string;
  /** ContentDocumentId of the PDF (for linking) */
  pdfContentDocumentId: string;
  /** Optional: ContentDocumentId of the DOCX */
  docxContentDocumentId?: string;
  /** Number of ContentDocumentLinks successfully created */
  linkCount: number;
  /** Any errors encountered during linking (non-fatal) */
  linkErrors: string[];
}

/**
 * Options for Salesforce API calls with correlation tracking
 */
export interface CorrelationOptions {
  correlationId?: string;
}

// Worker Poller Types (T-14)

/**
 * Queued document record from Salesforce
 * Represents a Generated_Document__c record with Status__c = 'QUEUED'
 */
export interface QueuedDocument {
  Id: string;
  Status__c: 'QUEUED' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED' | 'CANCELED';
  RequestJSON__c: string;
  CorrelationId__c: string;
  Template__c: string;
  Attempts__c: number;
  CreatedDate: string;
  Account__c?: string | null;
  Opportunity__c?: string | null;
  Case__c?: string | null;
  LockedUntil__c?: string | null;
  Priority__c?: number;
  Error__c?: string | null;
}

/**
 * Configuration for the poller worker
 */
export interface PollerConfig {
  /** Whether the poller is enabled (default: false) */
  enabled: boolean;
  /** Polling interval in milliseconds when active (default: 15000 = 15s) */
  intervalMs: number;
  /** Polling interval in milliseconds when idle (default: 60000 = 60s) */
  idleIntervalMs: number;
  /** Number of documents to fetch per batch (default: 20) */
  batchSize: number;
  /** Lock TTL in milliseconds (default: 120000 = 2min) */
  lockTtlMs: number;
  /** Maximum number of retry attempts (default: 3) */
  maxAttempts: number;
}

/**
 * Runtime statistics for the poller
 */
export interface PollerStats {
  /** Whether the poller is currently running */
  isRunning: boolean;
  /** Current queue depth (documents found in last poll) */
  currentQueueDepth: number;
  /** Last poll timestamp (ISO 8601) */
  lastPollTime: string | null;
  /** Total documents processed since startup */
  totalProcessed: number;
  /** Total successful completions since startup */
  totalSucceeded: number;
  /** Total failures since startup */
  totalFailed: number;
  /** Total retries since startup */
  totalRetries: number;
  /** Uptime in seconds since poller started */
  uptimeSeconds: number;
}

/**
 * Result of processing a single document
 */
export interface ProcessingResult {
  /** Document ID */
  documentId: string;
  /** Whether processing succeeded */
  success: boolean;
  /** ContentVersionId if successful */
  contentVersionId?: string;
  /** Error message if failed */
  error?: string;
  /** Whether the error is retryable */
  retryable?: boolean;
  /** Whether a retry was scheduled */
  retried?: boolean;
}