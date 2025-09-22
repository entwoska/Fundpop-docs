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

function normalize(s) {
  return String(s || '').trim().toLowerCase();
}

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

async function renameCollectionIfNeeded(collection, apply) {
  const originalName = collection.name || '';
  if (normalize(originalName) !== 'general') {
    return { id: collection.id, from: originalName, skipped: true, reason: 'not-general' };
  }

  const categories = await listCategories(collection.id);
  // Candidats de renommage: on privilégie 'FAQs', sinon 'Ressources and Contact'.
  let targetName = null;
  for (const cat of categories) {
    const n = normalize(cat.name);
    if (n.includes('faq')) { targetName = 'FAQs'; break; }
  }
  if (!targetName) {
    for (const cat of categories) {
      const n = normalize(cat.name);
      if (n.startsWith('ressources') || n.startsWith('resources')) { targetName = 'Ressources and Contact'; break; }
    }
  }
  // Si rien trouvé, on prend la première catégorie non "general" s'il y en a une
  if (!targetName) {
    const nonGeneral = categories.find(c => normalize(c.name) !== 'general');
    if (nonGeneral && nonGeneral.name) targetName = nonGeneral.name.trim();
  }

  if (!targetName) {
    return { id: collection.id, from: originalName, skipped: true, reason: 'no-suitable-category-found' };
  }
  if (normalize(targetName) === normalize(originalName)) {
    return { id: collection.id, from: originalName, to: targetName, skipped: true, reason: 'already-correct' };
  }

  const body = {
    name: targetName,
    description: collection.description || '',
    visibility: collection.visibility || 'public',
    order: collection.order || 1
  };

  if (apply) {
    await axiosInstance.put(`collections/${collection.id}`, body);
    return { id: collection.id, from: originalName, to: targetName, updated: true };
  }
  return { id: collection.id, from: originalName, to: targetName, updated: false, dryRun: true };
}

async function main() {
  const siteId = process.env.HELPSCOUT_SITE_ID || '';
  const apply = process.argv.includes('--apply');

  const collections = await listCollections(siteId);
  const results = [];
  for (const c of collections) {
    try {
      const r = await renameCollectionIfNeeded(c, apply);
      results.push(r);
    } catch (e) {
      const err = (e.response?.data && (e.response.data.error || JSON.stringify(e.response.data))) || e.message;
      results.push({ id: c.id, from: c.name, error: err });
    }
  }

  const outDir = path.join(process.cwd(), '.mapping');
  try { fs.mkdirSync(outDir, { recursive: true }); } catch (_) {}
  const out = path.join(outDir, `rename-collections-${apply ? 'apply' : 'dryrun'}-${Date.now()}.json`);
  fs.writeFileSync(out, JSON.stringify(results, null, 2));
  console.log(`${apply ? 'Renommage appliqué' : 'Dry-run terminé'}. Rapport:`, out);
}

main().catch((e) => {
  console.error('Erreur rename-general-collections:', e.response?.status, e.response?.data || e.message);
  process.exit(1);
});


