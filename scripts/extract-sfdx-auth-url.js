#!/usr/bin/env node

const fs = require('fs');

function normalizeInstanceUrl(instanceUrl) {
  return String(instanceUrl || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
}

function isSfdxAuthUrl(value) {
  return typeof value === 'string' && value.startsWith('force://');
}

function buildSfdxAuthUrl({ createResult, displayResult }) {
  const create = createResult?.result || {};
  const display = displayResult?.result || {};

  if (isSfdxAuthUrl(display.sfdxAuthUrl)) {
    return display.sfdxAuthUrl;
  }
  if (isSfdxAuthUrl(create.sfdxAuthUrl)) {
    return create.sfdxAuthUrl;
  }

  const authFields = create.authFields || display.authFields || {};
  const clientId = authFields.clientId || display.clientId || create.clientId || 'PlatformCLI';
  const clientSecret = authFields.clientSecret || display.clientSecret || '';
  const refreshToken = authFields.refreshToken || display.refreshToken || create.refreshToken;
  const instanceUrl = normalizeInstanceUrl(
    authFields.instanceUrl || display.instanceUrl || create.instanceUrl
  );

  if (!clientId || !refreshToken || !instanceUrl) {
    throw new Error(
      'Unable to build SFDX auth URL: missing clientId, refreshToken, or instanceUrl'
    );
  }

  return `force://${clientId}:${clientSecret}:${refreshToken}@${instanceUrl}`;
}

function readJson(path) {
  if (!path) {
    return undefined;
  }
  return JSON.parse(fs.readFileSync(path, 'utf8'));
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined) {
      throw new Error('Usage: extract-sfdx-auth-url.js --create <path> --display <path> --out <path>');
    }
    args[key.slice(2)] = value;
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.out) {
    throw new Error('Missing required --out argument');
  }

  const authUrl = buildSfdxAuthUrl({
    createResult: readJson(args.create),
    displayResult: readJson(args.display),
  });

  fs.writeFileSync(args.out, authUrl, { mode: 0o600 });
  console.log(`Prepared SFDX auth URL (${authUrl.length} characters)`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

module.exports = {
  buildSfdxAuthUrl,
  normalizeInstanceUrl,
};
