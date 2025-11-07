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
}

export interface DocgenResponse {
  downloadUrl: string;
  contentVersionId: string;
  correlationId: string;
}
