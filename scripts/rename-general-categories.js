const fs = require('fs');
const path = require('path');
const axios = require('axios');
try { require('dotenv').config(); } catch (_) {}

const API_KEY = process.env.HELPSCOUT_API_KEY;
if (!API_KEY) {
  console.error("HELPSCOUT_API_KEY manquant. Définissez-la dans '.env' ou l'environnement.");
  process.exit(1);
}

const axiosInstance = axios.create({
  baseURL: 'https://docsapi.helpscout.net/v1/',
  auth: { username: API_KEY, password: 'X' },
  headers: { Accept: 'application/json' },
  timeout: 30000
});

function normalize(s) { return String(s || '').trim().toLowerCase(); }

async function listCollections(siteId) {
  const items = [];
  let page = 1, pages = 1;
  while (page <= pages) {
    const siteParam = siteId ? `&siteId=${siteId}` : '';
    const { data } = await axiosInstance.get(`collections?page=${page}${siteParam}`);
    const arr = Array.isArray(data?.collections?.items) ? data.collections.items : (Array.isArray(data?.items) ? data.items : []);
    items.push(...arr);
    pages = Number(data?.pages || data?.collections?.pages || 1);
    page++;
  }
  return items;
}

async function listCategories(collectionId) {
  const items = [];
  let page = 1, pages = 1;
  while (page <= pages) {
    const { data } = await axiosInstance.get(`collections/${collectionId}/categories?page=${page}`);
    const arr = Array.isArray(data?.categories?.items) ? data.categories.items : (Array.isArray(data?.items) ? data.items : []);
    items.push(...arr);
    pages = Number(data?.pages || data?.categories?.pages || 1);
    page++;
  }
  return items;
}

async function renameCategoryIfNeeded(category, parentCollection, apply) {
  const originalName = category.name || '';
  if (normalize(originalName) !== 'general') {
    return { id: category.id, from: originalName, skipped: true, reason: 'not-general' };
  }
  const targetName = parentCollection.name || '';
  if (!targetName) {
    return { id: category.id, from: originalName, skipped: true, reason: 'no-parent-name' };
  }
  if (normalize(targetName) === normalize(originalName)) {
    return { id: category.id, from: originalName, to: targetName, skipped: true, reason: 'already-correct' };
  }
  const body = {
    name: targetName,
    description: category.description || '',
    order: category.order || 1,
    visibility: category.visibility || 'public'
  };
  if (apply) {
    await axiosInstance.put(`categories/${category.id}`, body);
    return { id: category.id, from: originalName, to: targetName, updated: true };
  }
  return { id: category.id, from: originalName, to: targetName, updated: false, dryRun: true };
}

async function main() {
  const siteId = process.env.HELPSCOUT_SITE_ID || '';
  const apply = process.argv.includes('--apply');
  const collections = await listCollections(siteId);
  const byId = new Map(collections.map(c => [String(c.id), c]));
  const results = [];
  for (const c of collections) {
    const cats = await listCategories(c.id);
    for (const cat of cats) {
      try {
        const parent = byId.get(String(cat.collectionId)) || c;
        const r = await renameCategoryIfNeeded(cat, parent, apply);
        results.push({ collection: parent.name, ...r });
      } catch (e) {
        results.push({ collection: c.name, id: cat.id, name: cat.name, error: (e.response?.data && (e.response.data.error || JSON.stringify(e.response.data))) || e.message });
      }
    }
  }
  const outDir = path.join(process.cwd(), '.mapping');
  try { fs.mkdirSync(outDir, { recursive: true }); } catch (_) {}
  const out = path.join(outDir, `rename-categories-${apply ? 'apply' : 'dryrun'}-${Date.now()}.json`);
  fs.writeFileSync(out, JSON.stringify(results, null, 2));
  console.log(`${apply ? 'Renommage catégories appliqué' : 'Dry-run catégories terminé'}. Rapport:`, out);
}

main().catch((e) => {
  console.error('Erreur rename-general-categories:', e.response?.status, e.response?.data || e.message);
  process.exit(1);
});


