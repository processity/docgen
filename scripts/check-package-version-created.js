#!/usr/bin/env node

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const projectFile = 'sfdx-project.json';
const metadataRoot = 'force-app/main/default/';
const baseRef = process.env.BASE_SHA || 'origin/main';
const headRef = process.env.HEAD_SHA || '';

function runGit(args) {
  return execFileSync('git', args, {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function parseProjectJson(contents, source) {
  try {
    return JSON.parse(contents);
  } catch (error) {
    fail(`Could not parse ${source}: ${error.message}`);
  }
}

function findPackageDirectory(project, source) {
  const directory =
    (project.packageDirectories || []).find((entry) => entry.default && entry.package) ||
    (project.packageDirectories || []).find((entry) => entry.package);

  if (!directory) {
    fail(`No package directory with a package name found in ${source}.`);
  }

  return directory;
}

function subscriberPackageAliases(project, packageName) {
  const escapedPackageName = packageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const aliasPattern = new RegExp(`^${escapedPackageName}@\\d+\\.\\d+\\.\\d+-\\d+$`);

  return Object.entries(project.packageAliases || {})
    .filter(([alias, id]) => aliasPattern.test(alias) && String(id).startsWith('04t'))
    .map(([alias, id]) => ({ alias, id }));
}

try {
  runGit(['cat-file', '-e', `${baseRef}^{commit}`]);
} catch (error) {
  fail(`Could not resolve base commit "${baseRef}". Ensure the CI checkout fetches the PR base commit.`);
}

if (headRef) {
  try {
    runGit(['cat-file', '-e', `${headRef}^{commit}`]);
  } catch (error) {
    fail(`Could not resolve head commit "${headRef}".`);
  }
}

const diffArgs = ['diff', '--name-only', '--diff-filter=ACMRD', baseRef];

if (headRef) {
  diffArgs.push(headRef);
}

const changedFilesOutput = runGit(diffArgs);
const changedMetadataFiles = changedFilesOutput
  .split('\n')
  .filter(Boolean)
  .filter((file) => file.startsWith(metadataRoot));

if (changedMetadataFiles.length === 0) {
  console.log(`No packaged Salesforce metadata changes found under ${metadataRoot}.`);
  process.exit(0);
}

let baseProjectContents;
try {
  baseProjectContents = runGit(['show', `${baseRef}:${projectFile}`]);
} catch (error) {
  fail(`Could not read ${projectFile} from base commit "${baseRef}".`);
}

const currentProjectPath = path.resolve(__dirname, '..', projectFile);
const currentProjectContents = fs.readFileSync(currentProjectPath, 'utf8');
const baseProject = parseProjectJson(baseProjectContents, `${baseRef}:${projectFile}`);
const currentProject = parseProjectJson(currentProjectContents, projectFile);
const basePackageDirectory = findPackageDirectory(baseProject, `${baseRef}:${projectFile}`);
const currentPackageDirectory = findPackageDirectory(currentProject, projectFile);
const packageName = currentPackageDirectory.package;
const basePackageIds = new Set(subscriberPackageAliases(baseProject, basePackageDirectory.package).map(({ id }) => id));
const newPackageAliases = subscriberPackageAliases(currentProject, packageName).filter(({ id }) => !basePackageIds.has(id));

if (newPackageAliases.length === 0) {
  const sample = changedMetadataFiles.slice(0, 20).map((file) => `  - ${file}`).join('\n');
  const suffix = changedMetadataFiles.length > 20 ? `\n  ...and ${changedMetadataFiles.length - 20} more` : '';

  fail(
    [
      `Packaged Salesforce metadata changed under ${metadataRoot}, but ${projectFile} does not contain a new subscriber package version alias for "${packageName}".`,
      'Create the Salesforce package version manually, then commit the CLI-updated sfdx-project.json before merging.',
      `Expected a new packageAliases entry like "${packageName}@x.y.z-n": "04t..." that is not present on the PR base branch.`,
      `Changed packaged metadata files (${changedMetadataFiles.length}):`,
      `${sample}${suffix}`,
    ].join('\n')
  );
}

const aliases = newPackageAliases.map(({ alias, id }) => `${alias} (${id})`).join(', ');
console.log(`Packaged Salesforce metadata changed and ${projectFile} includes new package version alias: ${aliases}.`);
