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

function normalizeTitle(s) {
  if (!s) return '';
  try {
    const withoutEmoji = String(s).replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, '');
    return withoutEmoji.replace(/\s+/g, ' ').trim().toLowerCase();
  } catch (_) {
    return String(s).trim().toLowerCase();
  }
}

async function listCollections(siteId) {
  const out = [];
  let page = 1, pages = 1;
  while (page <= pages) {
    const { data } = await axiosInstance.get(`collections?page=${page}${siteId ? `&siteId=${siteId}` : ''}`);
    const items = Array.isArray(data?.collections?.items) ? data.collections.items : (Array.isArray(data?.items) ? data.items : []);
    out.push(...items);
    pages = Number(data?.pages || data?.collections?.pages || 1);
    page++;
  }
  return out;
}

async function listCategories(collectionId) {
  const out = [];
  let page = 1, pages = 1;
  while (page <= pages) {
    const { data } = await axiosInstance.get(`collections/${collectionId}/categories?page=${page}`);
    const items = Array.isArray(data?.categories?.items) ? data.categories.items : (Array.isArray(data?.items) ? data.items : []);
    out.push(...items);
    pages = Number(data?.pages || data?.categories?.pages || 1);
    page++;
  }
  return out;
}

async function listArticlesFor(refType, id) {
  const out = [];
  let page = 1, pages = 1;
  while (page <= pages) {
    const { data } = await axiosInstance.get(`${refType}/${id}/articles?page=${page}&pageSize=100&status=all`);
    const items = Array.isArray(data?.articles?.items) ? data.articles.items : (Array.isArray(data?.items) ? data.items : []);
    out.push(...items);
    pages = Number(data?.pages || data?.articles?.pages || 1);
    page++;
  }
  return out;
}

async function main() {
  const siteId = process.env.HELPSCOUT_SITE_ID || '';
  const collections = await listCollections(siteId);
  const slugToId = {};
  const titleToId = {};

  for (const c of collections) {
    // Articles au niveau collection
    const artsInCollection = await listArticlesFor('collections', c.id);
    for (const a of artsInCollection) {
      if (a.slug) slugToId[a.slug] = a.id;
      if (a.name) titleToId[normalizeTitle(a.name)] = a.id;
    }
    // Par catégories
    const cats = await listCategories(c.id);
    for (const cat of cats) {
      const arts = await listArticlesFor('categories', cat.id);
      for (const a of arts) {
        if (a.slug) slugToId[a.slug] = a.id;
        if (a.name) titleToId[normalizeTitle(a.name)] = a.id;
      }
    }
  }

  const dir = path.join(process.cwd(), '.snapshot', 'helpscout');
  fs.mkdirSync(dir, { recursive: true });
  const outPath = path.join(dir, 'live-index.json');
  fs.writeFileSync(outPath, JSON.stringify({ slugToId, titleToId }, null, 2));
  console.log('Index live écrit:', outPath);
}

main().catch((e) => {
  console.error('Erreur build-live-index:', e.response?.status, e.response?.data || e.message);
  process.exit(1);
});


