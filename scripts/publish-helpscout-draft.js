const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { spawnSync } = require('child_process');

function readMapping() {
  const p = path.join(process.cwd(), '.mapping', 'mapping.yaml');
  if (!fs.existsSync(p)) {
    console.error('mapping.yaml introuvable (.mapping/mapping.yaml).');
    process.exit(1);
  }
  return yaml.load(fs.readFileSync(p, 'utf8'));
}

function ensureConverted(file) {
  const base = path.basename(file, path.extname(file));
  const out = path.join(process.cwd(), '.converted', base + '.html');
  if (!fs.existsSync(out)) {
    // Convertir à la volée
    const res = spawnSync(process.execPath, [path.join(process.cwd(), 'scripts', 'convert-md-to-html.js'), file], {
      stdio: 'inherit'
    });
    if (res.status !== 0 || !fs.existsSync(out)) {
      console.error(`Échec de conversion pour ${file}`);
      process.exit(res.status || 1);
    }
  }
  return fs.readFileSync(out, 'utf8');
}

function main() {
  const mapping = readMapping();
  const plan = [];
  for (const collection of mapping.collections || []) {
    for (const category of (collection.categories || [])) {
      for (const art of (category.articles || [])) {
        const html = ensureConverted(art.file);
        plan.push({
          collectionName: collection.name,
          categoryName: category.name,
          articleTitle: art.title,
          slug: art.slug,
          hasId: Boolean(art.id),
          action: art.id ? 'update' : 'create',
          htmlLength: html.length
        });
      }
    }
  }
  const out = path.join(process.cwd(), '.mapping', 'publish-plan.json');
  fs.writeFileSync(out, JSON.stringify(plan, null, 2));
  console.log(`Dry-run publication: plan écrit dans ${out}`);
}

main();
