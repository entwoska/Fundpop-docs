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

function normalize(s) { return String(s || '').trim().toLowerCase(); }

// Default descriptions for well-known categories (EN)
const DEFAULTS = new Map([
  ['introduction', 'Overview and key information to get started.'],
  ['getting started', 'Essential setup guides and first steps.'],
  ['customizations', 'Options to personalize Fundpop to your brand.'],
  ['widgets', 'Documentation for all Fundpop widgets and displays.'],
  ['campaign management', 'Manage orders, timing and performance analytics.'],
  ['advanced features', 'Premium tools like milestones and reward tiers.'],
  ['faqs', 'Frequently asked questions and answers.'],
  ['general', 'General information and common references.'],
  ['ressources', 'Resources and contact information.'],
  ['theme integration', 'Theme integration guidance and templates.'],
  ['best practices', 'Recommendations to optimize results and UX.']
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

async function updateCategory(cat) {
  const name = cat.name || '';
  const current = String(cat.description || '').trim();
  const key = normalize(name);
  const desired = DEFAULTS.get(key) || `${name} articles and guides.`;
  if (current === desired) return { id: cat.id, name, skipped: true, reason: 'already-up-to-date' };
  const body = { name, description: desired, order: cat.order || 1, visibility: cat.visibility || 'public' };
  await axiosInstance.put(`categories/${cat.id}`, body);
  return { id: cat.id, name, updated: true };
}

async function main() {
  const siteId = process.env.HELPSCOUT_SITE_ID || '';
  const collections = await listCollections(siteId);
  const results = [];
  for (const c of collections) {
    const cats = await listCategories(c.id);
    for (const cat of cats) {
      try {
        const r = await updateCategory(cat);
        results.push({ collection: c.name, ...r });
      } catch (e) {
        results.push({ collection: c.name, id: cat.id, name: cat.name, error: (e.response?.data && (e.response.data.error || JSON.stringify(e.response.data))) || e.message });
      }
    }
  }
  const out = path.join(process.cwd(), '.mapping', `update-categories-description-${Date.now()}.json`);
  fs.writeFileSync(out, JSON.stringify(results, null, 2));
  console.log('Descriptions catégories mises à jour. Rapport:', out);
}

main().catch((e) => {
  console.error('Erreur update-categories-description:', e.response?.status, e.response?.data || e.message);
  process.exit(1);
});


