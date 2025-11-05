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
}

export interface CorrelationContext {
  correlationId: string;
}
