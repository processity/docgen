import { createElement } from 'lwc';
import DocgenStatus from 'c/docgenStatus';
import getReconnectInfo from '@salesforce/apex/DocgenConnectionController.getReconnectInfo';

jest.mock('@salesforce/customPermission/Docgen_Manage_Connection', () => ({ default: false }), { virtual: true });
jest.mock('@salesforce/apex/DocgenConnectionController.getReconnectInfo', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/DocgenConnectionController.checkConnection', () => ({ default: jest.fn() }), { virtual: true });
jest.mock('@salesforce/apex/DocgenStatusController.getSystemStatus', () => ({ default: jest.fn().mockResolvedValue(null) }), { virtual: true });
jest.mock('@salesforce/apex/DocgenStatusController.getQueueMetrics', () => ({ default: jest.fn().mockResolvedValue(null) }), { virtual: true });
jest.mock('@salesforce/apex/DocgenStatusController.getRecentDocuments', () => ({ default: jest.fn().mockResolvedValue([]) }), { virtual: true });
jest.mock('@salesforce/apex/DocgenStatusController.getPerformanceMetrics', () => ({ default: jest.fn().mockResolvedValue(null) }), { virtual: true });
jest.mock('@salesforce/apex/DocgenStatusController.getResourceMetrics', () => ({ default: jest.fn().mockResolvedValue(null) }), { virtual: true });
jest.mock('@salesforce/apex/DocgenStatusController.getUsageMetrics', () => ({ default: jest.fn().mockResolvedValue(null) }), { virtual: true });

afterEach(() => { while (document.body.firstChild) document.body.removeChild(document.body.firstChild); });
it('does not expose connection administration to ordinary Docgen users', async () => {
  const element = createElement('c-docgen-status', { is: DocgenStatus });
  document.body.appendChild(element);
  await new Promise(resolve => setTimeout(resolve, 0));
  expect([...element.shadowRoot.querySelectorAll('lightning-button')].map(button => button.label)).not.toContain('Connect / Reconnect');
  expect(getReconnectInfo).not.toHaveBeenCalled();
});
