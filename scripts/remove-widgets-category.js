const fs = require('fs');
const path = require('path');
const axios = require('axios');
require('dotenv').config();

const API_KEY = process.env.HELPSCOUT_API_KEY;
if (!API_KEY) {
  console.error("HELPSCOUT_API_KEY manquant. Définissez-la dans '.env'.");
  process.exit(1);
}

const axiosInstance = axios.create({
  baseURL: 'https://docsapi.helpscout.net/v1/',
  auth: { username: API_KEY, password: 'X' },
  headers: { Accept: 'application/json' },
  timeout: 30000
});

function norm(s) { return String(s || '').trim().toLowerCase(); }

async function listCollections(siteId) {
  const all = [];
  let page = 1, pages = 1;
  while (page <= pages) {
    const { data } = await axiosInstance.get(`collections?page=${page}${siteId ? `&siteId=${siteId}` : ''}`);
    const items = Array.isArray(data?.collections?.items) ? data.collections.items : (Array.isArray(data?.items) ? data.items : []);
    all.push(...items);
    pages = Number(data?.pages || data?.collections?.pages || 1);
    page++;
  }
  return all;
}

async function listCategories(collectionId) {
  const all = [];
  let page = 1, pages = 1;
  while (page <= pages) {
    const { data } = await axiosInstance.get(`collections/${collectionId}/categories?page=${page}`);
    const items = Array.isArray(data?.categories?.items) ? data.categories.items : (Array.isArray(data?.items) ? data.items : []);
    all.push(...items);
    pages = Number(data?.pages || data?.categories?.pages || 1);
    page++;
  }
  return all;
}

async function deleteCategory(categoryId, apply) {
  if (!apply) return { id: categoryId, action: 'dryrun-delete' };
  await axiosInstance.delete(`categories/${categoryId}`);
  return { id: categoryId, action: 'deleted' };
}

async function hideCategory(categoryId, apply) {
  const body = { visibility: 'private' };
  if (!apply) return { id: categoryId, action: 'dryrun-hide' };
  await axiosInstance.put(`categories/${categoryId}`, body);
  return { id: categoryId, action: 'hidden' };
}

async function main() {
  const siteId = process.env.HELPSCOUT_SITE_ID || '';
  const apply = process.argv.includes('--apply');
  const preferDelete = process.env.WIDGETS_DELETE === '1';
  const targetNames = new Set(['widgets']);

  const results = [];
  const collections = await listCollections(siteId);
  for (const c of collections) {
    const cats = await listCategories(c.id);
    for (const cat of cats) {
      if (targetNames.has(norm(cat.name))) {
        try {
          const r = preferDelete ? await deleteCategory(cat.id, apply) : await hideCategory(cat.id, apply);
          results.push({ collection: c.name, category: cat.name, ...r });
        } catch (e) {
          results.push({ collection: c.name, category: cat.name, error: (e.response?.data && (e.response.data.error || JSON.stringify(e.response.data))) || e.message });
        }
      }
    }
  }

  const outDir = path.join(process.cwd(), '.mapping');
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, `remove-widgets-category-${apply ? 'applied' : 'dryrun'}-${Date.now()}.json`);
  fs.writeFileSync(out, JSON.stringify(results, null, 2));
  console.log(`${apply ? 'Suppression' : 'Dry-run'} catégorie Widgets:`, out);
}

main().catch((e) => {
  console.error('Erreur remove-widgets-category:', e.response?.status, e.response?.data || e.message);
  process.exit(1);
});


