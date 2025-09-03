const fs = require('fs');
const path = require('path');
try { require('dotenv').config(); } catch (_) {}
const axios = require('axios');

const API_KEY = process.env.HELPSCOUT_API_KEY;
if (!API_KEY) {
  console.error("HELPSCOUT_API_KEY manquant. Définissez-la dans '.env' ou l'environnement.");
  process.exit(1);
}

// Helper for Basic Auth with API key (username = API key, password = X)
const axiosInstance = axios.create({
  baseURL: 'https://docsapi.helpscout.net/v1/',
  auth: { username: API_KEY, password: 'X' },
  headers: {
    Accept: 'application/json'
  },
  timeout: 30000
});

function extractItemsAndPages(data, key) {
  const result = { items: [], pages: 1 };
  if (!data) return result;
  const readPages = (src) => Number(src?.pages || src?.totalPages || src?.page?.pages || src?.pageCount || 1);
  if (Array.isArray(data.items)) {
    result.items = data.items;
    result.pages = readPages(data);
    return result;
  }
  if (Array.isArray(data[key])) {
    result.items = data[key];
    result.pages = readPages(data);
    return result;
  }
  if (data[key] && typeof data[key] === 'object') {
    const node = data[key];
    if (Array.isArray(node.items)) {
      result.items = node.items;
      result.pages = readPages(node) || readPages(data);
      return result;
    }
    if (Array.isArray(node._embedded)) {
      result.items = node._embedded;
      result.pages = readPages(node) || readPages(data);
      return result;
    }
  }
  if (data._embedded) {
    if (Array.isArray(data._embedded)) {
      result.items = data._embedded;
      result.pages = readPages(data);
      return result;
    }
    if (Array.isArray(data._embedded[key])) {
      result.items = data._embedded[key];
      result.pages = readPages(data);
      return result;
    }
  }
  result.pages = readPages(data);
  return result;
}

// Get all sites
async function getSites() {
  try {
    const { data } = await axiosInstance.get(`sites`);
    const { items } = extractItemsAndPages(data, 'sites');
    return items;
  } catch (err) {
    console.error('Erreur getSites', err.response?.status, err.response?.data || err.message);
    return [];
  }
}

// Get all collections
async function getCollections() {
  let page = 1, results = [], pages = 1;
  while (page <= pages) {
    try {
      const siteParam = process.env.HELPSCOUT_SITE_ID ? `&siteId=${process.env.HELPSCOUT_SITE_ID}` : '';
      const { data } = await axiosInstance.get(`collections?page=${page}${siteParam}`);
      const { items, pages: p } = extractItemsAndPages(data, 'collections');
      if (page === 1) {
        try {
          const snapshotRoot = path.join(__dirname, '.snapshot', 'helpscout');
          fs.mkdirSync(snapshotRoot, { recursive: true });
          fs.writeFileSync(path.join(snapshotRoot, 'collections-raw.json'), JSON.stringify(data, null, 2));
        } catch (_) {}
      }
      if (items.length === 0 && page === 1) {
        console.warn('Avertissement: aucune collection reçue. Clés de la réponse:', Object.keys(data || {}));
      }
      results.push(...items);
      pages = p;
      page++;
    } catch (err) {
      console.error('Erreur getCollections page', page, err.response?.status, err.response?.data || err.message);
      throw err;
    }
  }
  return results;
}

// Get all categories for a collection
async function getCategories(collectionId) {
  let page = 1, results = [], pages = 1;
  while (page <= pages) {
    try {
      const { data } = await axiosInstance.get(`collections/${collectionId}/categories?page=${page}`);
      const { items, pages: p } = extractItemsAndPages(data, 'categories');
      results.push(...items);
      pages = p;
      page++;
    } catch (err) {
      console.error('Erreur getCategories', { collectionId, page }, err.response?.status, err.response?.data || err.message);
      throw err;
    }
  }
  return results;
}

// Get all articles from a collection or category
async function getArticles(refType, id) {
  let page = 1, results = [], pages = 1;
  while (page <= pages) {
    try {
      const { data } = await axiosInstance.get(`${refType}/${id}/articles?page=${page}&pageSize=100`);
      const { items, pages: p } = extractItemsAndPages(data, 'articles');
      results.push(...items);
      pages = p;
      page++;
    } catch (err) {
      console.error('Erreur getArticles', { refType, id, page }, err.response?.status, err.response?.data || err.message);
      throw err;
    }
  }
  return results;
}

// Get full article data by article ID
async function getArticle(articleId) {
  try {
    const { data } = await axiosInstance.get(`articles/${articleId}`);
    return data.item || data;
  } catch (err) {
    console.error('Erreur getArticle', { articleId }, err.response?.status, err.response?.data || err.message);
    throw err;
  }
}

(async () => {
  const allArticles = [];
  const allCategories = [];

  // 1. Récupérer toutes les collections
  const sites = await getSites();
  const collections = await getCollections();

  // 2. Récupérer catégories et articles
  for (const collection of collections) {
    const colId = collection.id || collection.collectionId || collection.number;
    if (!colId) continue;

    // Articles directement dans la collection
    const articlesInCollection = await getArticles('collections', colId);
    for (const artRef of articlesInCollection) {
      const artId = artRef.id || artRef.articleId || artRef.number;
      if (!artId) continue;
      allArticles.push(await getArticle(artId));
    }

    // Catégories de la collection
    const categories = await getCategories(colId);
    allCategories.push(...categories);
    for (const category of categories) {
      const catId = category.id || category.categoryId || category.number;
      if (!catId) continue;
      const articlesInCategory = await getArticles('categories', catId);
      for (const artRef of articlesInCategory) {
        const artId = artRef.id || artRef.articleId || artRef.number;
        if (!artId) continue;
        allArticles.push(await getArticle(artId));
      }
    }
  }

  // Log titres
  for (const article of allArticles) {
    console.log(article.name || article.title, article.id || article.articleId);
  }

  // Snapshot local JSON/HTML
  const snapshotRoot = path.join(__dirname, '.snapshot', 'helpscout');
  const articlesDir = path.join(snapshotRoot, 'articles');
  fs.mkdirSync(articlesDir, { recursive: true });

  fs.writeFileSync(path.join(snapshotRoot, 'collections.json'), JSON.stringify(collections, null, 2));
  fs.writeFileSync(path.join(snapshotRoot, 'categories.json'), JSON.stringify(allCategories, null, 2));
  fs.writeFileSync(path.join(snapshotRoot, 'articles.json'), JSON.stringify(allArticles, null, 2));
  fs.writeFileSync(path.join(snapshotRoot, 'sites.json'), JSON.stringify(sites, null, 2));

  for (const article of allArticles) {
    const html = article.text || article.body || '';
    const slug = (article.slug || article.number || article.id || 'article').toString();
    const id = article.id || article.articleId || article.number || 'unknown';
    fs.writeFileSync(path.join(articlesDir, `${slug}-${id}.html`), html);
    fs.writeFileSync(path.join(articlesDir, `${slug}-${id}.json`), JSON.stringify(article, null, 2));
  }

  console.log(`Snapshot Help Scout écrit dans ${snapshotRoot}`);
})();