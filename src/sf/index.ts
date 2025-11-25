/**
 * Salesforce Integration Module
 *
 * Exports authentication and API client functionality for
 * interacting with Salesforce via JWT Bearer Flow.
 */

export {
  SalesforceAuth,
  createSalesforceAuth,
  getSalesforceAuth,
  resetSalesforceAuth,
  type SalesforceAuthConfig,
} from './auth';

export { SalesforceApi, type RequestOptions } from './api';

export {
  uploadContentVersion,
  updateGeneratedDocument,
  uploadAndLinkFiles,
} from './files';
