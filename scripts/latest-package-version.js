#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const projectPath = path.resolve(__dirname, '..', 'sfdx-project.json');
const project = JSON.parse(fs.readFileSync(projectPath, 'utf8'));

const packageDirectory =
  project.packageDirectories.find((directory) => directory.default && directory.package) ||
  project.packageDirectories.find((directory) => directory.package);

if (!packageDirectory) {
  console.error('No package directory with a package name found in sfdx-project.json.');
  process.exit(1);
}

const packageName = packageDirectory.package;
const escapedPackageName = packageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const aliasPattern = new RegExp(`^${escapedPackageName}@(\\d+)\\.(\\d+)\\.(\\d+)-(\\d+)$`);

const packageVersions = Object.entries(project.packageAliases || {})
  .map(([alias, id]) => {
    const match = alias.match(aliasPattern);

    if (!match || !String(id).startsWith('04t')) {
      return null;
    }

    return {
      alias,
      version: match.slice(1).map(Number),
    };
  })
  .filter(Boolean)
  .sort((left, right) => {
    for (let index = 0; index < left.version.length; index += 1) {
      const difference = right.version[index] - left.version[index];

      if (difference !== 0) {
        return difference;
      }
    }

    return 0;
  });

if (packageVersions.length === 0) {
  console.error(`No subscriber package version aliases found for package "${packageName}".`);
  process.exit(1);
}

console.log(packageVersions[0].alias);
