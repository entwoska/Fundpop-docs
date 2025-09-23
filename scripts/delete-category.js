const fs = require('fs');
const path = require('path');
require('dotenv').config();
const axios = require('axios');

const API_KEY = process.env.HELPSCOUT_API_KEY;
if (!API_KEY) {
  console.error("HELPSCOUT_API_KEY manquant. Définissez-la dans '.env'.");
  process.exit(1);
}

const APPLY = process.env.APPLY === '1';
const TARGET_CATEGORY = (process.env.TARGET_CATEGORY || 'Theme Integration').trim();
const TARGET_COLLECTION = (process.env.TARGET_COLLECTION || 'Installing and using Fundpop').trim();

const axiosInstance = axios.create({
  baseURL: 'https://docsapi.helpscout.net/v1/',
  auth: { username: API_KEY, password: 'X' },
  headers: { Accept: 'application/json' },
  timeout: 30000
});

function normalize(s) { return String(s || '').trim().toLowerCase(); }

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

async function listArticlesInCategory(categoryId) {
  const items = [];
  let page = 1, pages = 1;
  while (page <= pages) {
    const { data } = await axiosInstance.get(`categories/${categoryId}/articles?page=${page}&pageSize=100`);
    const list = Array.isArray(data?.articles?.items) ? data.articles.items : (Array.isArray(data?.items) ? data.items : []);
    items.push(...list);
    pages = Number(data?.pages || data?.articles?.pages || 1);
    page++;
  }
  return items;
}

async function deleteArticle(id) {
  if (!APPLY) return { id, action: 'dryrun-delete' };
  await axiosInstance.delete(`articles/${id}`);
  return { id, action: 'deleted' };
}

async function deleteCategory(categoryId) {
  if (!APPLY) return { id: categoryId, action: 'dryrun-delete-category' };
  await axiosInstance.delete(`categories/${categoryId}`);
  return { id: categoryId, action: 'deleted-category' };
}

(async () => {
  const results = [];
  try {
    const siteId = process.env.HELPSCOUT_SITE_ID || '';
    const collections = await listCollections(siteId);
    const collection = collections.find(c => normalize(c.name) === normalize(TARGET_COLLECTION));
    if (!collection) {
      console.error(`Collection introuvable: ${TARGET_COLLECTION}`);
      process.exit(1);
    }
    const categories = await listCategories(collection.id);
    const category = categories.find(cat => normalize(cat.name) === normalize(TARGET_CATEGORY));
    if (!category) {
      console.error(`Catégorie introuvable: ${TARGET_CATEGORY} dans la collection ${collection.name}`);
      process.exit(1);
    }

    const arts = await listArticlesInCategory(category.id);
    for (const it of arts) {
      const artId = it.id || it.articleId || it.number;
      if (!artId) continue;
      try {
        const r = await deleteArticle(artId);
        results.push({ category: category.name, ...r });
      } catch (e) {
        results.push({ category: category.name, articleId: artId, error: (e.response?.data && (e.response.data.error || JSON.stringify(e.response.data))) || e.message });
      }
    }

    try {
      const r = await deleteCategory(category.id);
      results.push({ collection: collection.name, category: category.name, ...r });
    } catch (e) {
      results.push({ collection: collection.name, category: category.name, error: (e.response?.data && (e.response.data.error || JSON.stringify(e.response.data))) || e.message });
    }

    const outDir = path.join(process.cwd(), '.mapping');
    fs.mkdirSync(outDir, { recursive: true });
    const out = path.join(outDir, `delete-category-${normalize(TARGET_CATEGORY).replace(/\s+/g,'-')}-${APPLY ? 'applied' : 'dryrun'}-${Date.now()}.json`);
    fs.writeFileSync(out, JSON.stringify(results, null, 2));
    console.log(`${APPLY ? 'Suppression' : 'Dry-run'} catégorie ${TARGET_CATEGORY}: ${out}`);
  } catch (e) {
    console.error('Erreur suppression catégorie:', e.response?.status, e.response?.data || e.message);
    process.exit(1);
  }
})();


