import uatCertificate from '@salesforce/resourceUrl/DocgenUatJwtCertificate';

// Public deployment assets, separate from the shared connection workflow.
// Add another certificate only after verifying it against that backend's signing key.
const CERTIFICATES = [
    {
        backendUrl: 'https://docgen-uat.mangostone-78031136.eastus.azurecontainerapps.io',
        url: uatCertificate,
        fileName: 'uat_server.crt',
        label: 'Download backend public certificate (uat_server.crt)'
    }
];

export function getConnectionCertificate(backendUrl) {
    const normalized = backendUrl?.replace(/\/$/, '');
    return CERTIFICATES.find(asset => asset.backendUrl === normalized);
}
