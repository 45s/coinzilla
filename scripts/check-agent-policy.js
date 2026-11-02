import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));

function findInstructionDirectories(root) {
  const directories = [];
  for (const area of ['apps', 'packages']) {
    const areaPath = join(root, area);
    for (const entry of readdirSync(areaPath, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const relativePath = `${area}/${entry.name}`;
      if (readdirSync(join(root, relativePath)).includes('AGENTS.md')) directories.push(relativePath);
    }
  }
  return directories.sort();
}

export function findOwnershipGaps(directories, ownershipDocument, workflowDocument) {
  return directories.flatMap((directory) => {
    const gaps = [];
    if (!ownershipDocument.includes(`\`${directory}/\``)) gaps.push(`${directory} missing from DOMAIN_OWNERSHIP.md`);
    if (!workflowDocument.includes(`\`${directory}/**\``)) gaps.push(`${directory} missing from AI_AGENT_WORKFLOW.md`);
    return gaps;
  });
}

function main() {
  const directories = findInstructionDirectories(repositoryRoot);
  const ownershipDocument = readFileSync(join(repositoryRoot, 'docs/engineering/DOMAIN_OWNERSHIP.md'), 'utf8');
  const workflowDocument = readFileSync(join(repositoryRoot, 'AI_AGENT_WORKFLOW.md'), 'utf8');
  const gaps = findOwnershipGaps(directories, ownershipDocument, workflowDocument);
  if (gaps.length > 0) {
    console.error('Agent policy ownership check failed:');
    for (const gap of gaps) console.error(`- ${gap}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Agent policy ownership check passed (${directories.length} domain instruction files).`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
