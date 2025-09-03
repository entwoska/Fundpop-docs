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

function normalize(s) {
  return String(s || '').trim().toLowerCase();
}

// Default collection descriptions (EN)
const DESCRIPTION_BY_COLLECTION = new Map([
  ['installing and using fundpop', 'Guides for installing, configuring, and using Fundpop.'],
  ['faqs', 'Answers to the most frequently asked questions about Fundpop.'],
  ['ressources and contact', 'Contact details and helpful resources to reach our team.']
]);

async function listCollections(siteId) {
  const items = [];
  let page = 1, pages = 1;
  while (page <= pages) {
    const { data } = await axiosInstance.get(`collections?page=${page}${siteId ? `&siteId=${siteId}` : ''}`);
    const arr = Array.isArray(data?.collections?.items) ? data.collections.items : (Array.isArray(data?.items) ? data.items : []);
    items.push(...arr);
    pages = Number(data?.pages || data?.collections?.pages || 1);
    page++;
  }
  return items;
}

async function updateCollectionDescription(collection) {
  const name = collection.name || '';
  const current = String(collection.description || '').trim();
  const desired = DESCRIPTION_BY_COLLECTION.get(normalize(name));
  if (!desired) return { id: collection.id, name, skipped: true, reason: 'no-default-description' };
  if (current === desired) return { id: collection.id, name, skipped: true, reason: 'already-up-to-date' };
  const body = { name, description: desired, visibility: collection.visibility || 'public', order: collection.order || 1 };
  await axiosInstance.put(`collections/${collection.id}`, body);
  return { id: collection.id, name, updated: true };
}

async function main() {
  const siteId = process.env.HELPSCOUT_SITE_ID || '';
  const collections = await listCollections(siteId);
  const results = [];
  for (const c of collections) {
    try {
      const r = await updateCollectionDescription(c);
      results.push(r);
    } catch (e) {
      results.push({ id: c.id, name: c.name, error: (e.response?.data && (e.response.data.error || JSON.stringify(e.response.data))) || e.message });
    }
  }
  const out = path.join(process.cwd(), '.mapping', `update-collections-description-${Date.now()}.json`);
  fs.writeFileSync(out, JSON.stringify(results, null, 2));
  console.log('Descriptions collections mises à jour. Rapport:', out);
}

main().catch((e) => {
  console.error('Erreur update-collections-description:', e.response?.status, e.response?.data || e.message);
  process.exit(1);
});


