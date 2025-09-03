const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

function readJSON(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function normalize(s) {
  if (!s) return '';
  try { return String(s).normalize('NFKD'); } catch { return String(s); }
}

function normalizeTitle(s) {
  if (!s) return '';
  try {
    const withoutEmoji = String(s).replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, '');
    return withoutEmoji.replace(/\s+/g, ' ').trim().toLowerCase();
  } catch (_) {
    return String(s).trim().toLowerCase();
  }
}

function main() {
  const root = path.join(process.cwd(), '.snapshot', 'helpscout');
  const collections = readJSON(path.join(root, 'collections.json')) || [];
  const categories = readJSON(path.join(root, 'categories.json')) || [];
  const articlesWrap = readJSON(path.join(root, 'articles.json')) || [];
  if (!collections.length || !categories.length) {
    console.error('Snapshots absents. Exécutez d\'abord: npm run snapshot:helpscout');
    process.exit(1);
  }

  // Aplatissement des articles
  const articles = articlesWrap.map(w => w && w.article ? w.article : w).filter(Boolean);

  // Index catégories et collection
  const catIdTo = new Map();
  for (const c of categories) catIdTo.set(String(c.id), { id: c.id, name: c.name, collectionId: c.collectionId });
  const collIdTo = new Map();
  for (const c of collections) collIdTo.set(String(c.id), { id: c.id, name: c.name });

  // Index articles par slug et titre
  const bySlug = new Map();
  const byTitle = new Map();
  for (const a of articles) {
    const slug = a.slug || (a.publicUrl ? String(a.publicUrl).split('/').pop() : undefined);
    if (slug) bySlug.set(slug, a);
    if (a.name) byTitle.set(normalizeTitle(a.name), a);
  }

  // Charger mapping GitBook
  const mappingPath = path.join(process.cwd(), '.mapping', 'mapping.yaml');
  const mapping = yaml.load(fs.readFileSync(mappingPath, 'utf8'));

  const expected = [];
  for (const section of mapping.collections || []) {
    const sectionName = section.name;
    const articlesList = (section.categories && section.categories[0] && section.categories[0].articles) || [];
    for (const art of articlesList) {
      expected.push({ section: sectionName, file: art.file, slug: art.slug, title: art.title });
    }
  }

  // Contrôles
  const missingInHS = [];
  const wrongCategory = [];
  const extraInHS = [];

  for (const e of expected) {
    const a = bySlug.get(e.slug) || byTitle.get(normalizeTitle(e.title));
    if (!a) {
      missingInHS.push(e);
      continue;
    }
    // Vérifier catégorie et collection
    const coll = collIdTo.get(String(a.collectionId));
    const cats = (a.categories || []).map(id => catIdTo.get(String(id))).filter(Boolean);
    const inSection = cats.some(c => normalize(c?.name) === normalize(e.section));
    if (!inSection) {
      wrongCategory.push({ slug: e.slug, title: a.name, currentCategories: cats.map(c => c?.name), expectedSection: e.section });
    }
  }

  // Extra: articles HS présents mais non mappés
  const expectedSlugs = new Set(expected.map(x => x.slug));
  for (const a of articles) {
    const slug = a.slug || '';
    if (!expectedSlugs.has(slug)) {
      const cats = (a.categories || []).map(id => catIdTo.get(String(id))?.name).filter(Boolean);
      extraInHS.push({ slug, title: a.name, categories: cats, collection: collIdTo.get(String(a.collectionId))?.name });
    }
  }

  const report = {
    summary: {
      expectedCount: expected.length,
      hsArticleCount: articles.length,
      missingInHS: missingInHS.length,
      wrongCategory: wrongCategory.length,
      extraInHS: extraInHS.length
    },
    missingInHS,
    wrongCategory,
    extraInHS
  };

  const outDir = path.join(process.cwd(), '.mapping');
  const out = path.join(outDir, 'audit-structure-report.json');
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  console.log('Audit structure écrit:', out);
}

main();


