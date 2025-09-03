const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

function parseSummary(filePath) {
  const md = fs.readFileSync(filePath, 'utf8');
  const lines = md.split(/\r?\n/);
  const sections = [];
  let current = null;
  for (const line of lines) {
    const h2 = line.match(/^##\s+(.*)/);
    if (h2) {
      current = { name: h2[1].trim(), items: [] };
      sections.push(current);
      continue;
    }
    const item = line.match(/^\*\s+\[[^\]]+\]\(([^)]+)\)/);
    if (item && current) {
      const file = item[1];
      current.items.push(file);
    }
  }
  return sections;
}

function toSlug(filePath) {
  const base = path.basename(filePath, path.extname(filePath));
  return base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function buildMapping(sections) {
  const mapping = {
    site: process.env.HELPSCOUT_SITE_ID || null,
    collections: []
  };

  for (const section of sections) {
    const collection = {
      name: section.name,
      id: null,
      categories: [
        {
          name: section.name,
          id: null,
          articles: section.items.map((file, idx) => ({
            file,
            title: path.basename(file, path.extname(file)),
            slug: toSlug(file),
            id: null,
            order: idx + 1
          }))
        }
      ]
    };
    mapping.collections.push(collection);
  }
  return mapping;
}

function main() {
  const summaryPath = path.join(process.cwd(), 'SUMMARY.md');
  if (!fs.existsSync(summaryPath)) {
    console.error('SUMMARY.md introuvable.');
    process.exit(1);
  }
  const sections = parseSummary(summaryPath);
  const mapping = buildMapping(sections);
  const outDir = path.join(process.cwd(), '.mapping');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'mapping.yaml');
  fs.writeFileSync(outPath, yaml.dump(mapping), 'utf8');
  console.log(`Mapping initial écrit: ${outPath}`);
}

main();


