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

function loadSnapshot() {
  const p = path.join(process.cwd(), '.snapshot', 'helpscout', 'articles.json');
  if (!fs.existsSync(p)) {
    console.error("Snapshot .snapshot/helpscout/articles.json introuvable. Exécutez 'npm run snapshot:helpscout'.");
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function parseDate(s) {
  const d = new Date(s);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

async function main() {
  const data = loadSnapshot();
  const entries = [];
  for (const wrap of data) {
    const it = wrap && (wrap.article || wrap);
    if (!it) continue;
    const name = String(it.name || '').toLowerCase();
    const slug = String(it.slug || '').toLowerCase();
    if (slug === 'campaign-timing' || name.includes('campaign timing')) {
      entries.push({
        id: it.id,
        name: it.name,
        slug: it.slug,
        lastPublishedAt: it.lastPublishedAt || it.updatedAt || it.createdAt,
        updatedAt: it.updatedAt,
        createdAt: it.createdAt,
        status: it.status
      });
    }
  }

  // Dédupliquer par id
  const byId = new Map();
  for (const e of entries) {
    if (!byId.has(e.id)) byId.set(e.id, e);
  }
  const uniq = Array.from(byId.values());

  if (uniq.length <= 1) {
    console.log('Aucun doublon à traiter (', uniq.length, 'entrée).');
    return;
  }

  uniq.sort((a, b) => parseDate(b.lastPublishedAt) - parseDate(a.lastPublishedAt));
  const keep = uniq[0];
  const toUnpublish = uniq.slice(1).filter(e => e.id !== keep.id);

  console.log('Conserver:', keep.id, keep.name, keep.lastPublishedAt);
  for (const it of toUnpublish) {
    try {
      const body = { status: 'notpublished' };
      await axiosInstance.put(`articles/${it.id}`, body);
      console.log('Dépublié (draft):', it.id, it.name, it.lastPublishedAt);
    } catch (e) {
      console.error('Erreur dépublication', it.id, e.response?.status, e.response?.data || e.message);
    }
  }
}

main().catch((e) => {
  console.error('Erreur script:', e.response?.status, e.response?.data || e.message);
  process.exit(1);
});


