const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
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

function readJSON(file) {
  const p = path.join(process.cwd(), '.snapshot', 'helpscout', file);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function readMapping() {
  const p = path.join(process.cwd(), '.mapping', 'mapping.yaml');
  const yaml = require('js-yaml');
  return yaml.load(fs.readFileSync(p, 'utf8'));
}

function ensureConverted(file) {
  const base = path.basename(file, path.extname(file));
  const out = path.join(process.cwd(), '.converted', base + '.html');
  const metaPath = path.join(process.cwd(), '.converted', base + '.meta.json');

  const needs = (() => {
    if (!fs.existsSync(out)) return true;
    if (process.env.FORCE_RECONVERT === '1') return true;
    try {
      const src = fs.statSync(path.join(process.cwd(), file));
      const outStat = fs.statSync(out);
      if (src.mtimeMs > outStat.mtimeMs) return true;
      const conv = fs.statSync(path.join(process.cwd(), 'scripts', 'convert-md-to-html.js'));
      if (conv.mtimeMs > outStat.mtimeMs) return true;
    } catch (_) { return true; }
    return false;
  })();

  if (needs) {
  const res = spawnSync(process.execPath, [path.join(process.cwd(), 'scripts', 'convert-md-to-html.js'), file], { stdio: 'inherit' });
  if (res.status !== 0 || !fs.existsSync(out)) {
    throw new Error('Conversion échouée pour ' + file);
  }
  }

  const html = fs.readFileSync(out, 'utf8');
  let title = null;
  if (fs.existsSync(metaPath)) {
    try { title = JSON.parse(fs.readFileSync(metaPath, 'utf8')).title || null; } catch (_) {}
  }
  return { html, title };
}

async function main() {
  // Charger snapshots et index live
  const collections = readJSON('collections.json') || [];
  const categories = readJSON('categories.json') || [];
  const liveIndex = readJSON('live-index.json') || { slugToId: {}, titleToId: {} };
  const slugToId = liveIndex.slugToId || {};
  const titleToId = liveIndex.titleToId || {};

  // Construire une table des collections Help Scout et leurs catégories
  const norm = (s) => String(s || '').trim().toLowerCase();
  const byCollectionName = new Map();
  for (const c of collections) {
    byCollectionName.set(norm(c.name), { collectionId: c.id, siteId: c.siteId, catNameToId: new Map(), generalId: null });
  }
  for (const cat of categories) {
    const parent = collections.find(c => String(c.id) === String(cat.collectionId));
    if (!parent) continue;
    const entry = byCollectionName.get(norm(parent.name));
    if (!entry) continue;
    const key = norm(cat.name);
    entry.catNameToId.set(key, cat.id);
    if (key === 'general') entry.generalId = cat.id;
  }

  const mapping = readMapping();
  const results = [];
  for (const section of mapping.collections || []) {
    const sectionNameRaw = section.name || '';
    const sectionName = norm(sectionNameRaw);

    // Choisir la bonne collection HS selon la section du mapping
    let targetCollectionName = 'installing and using fundpop';
    if (sectionName.includes('faq')) targetCollectionName = 'faqs';
    else if (sectionName.includes('ressource')) targetCollectionName = 'ressources and contact';

    const coll = byCollectionName.get(targetCollectionName);
    if (!coll) {
      results.push({ section: section.name, error: `Collection Help Scout introuvable: ${targetCollectionName}` });
      continue;
    }

    // Catégorie par nom de section dans la collection ciblée, sinon fallback General
    let catId = coll.catNameToId.get(sectionName);
    if (!catId) catId = coll.generalId || coll.catNameToId.get('general');
    const { collectionId, siteId } = coll;
    if (!catId) {
      results.push({ section: section.name, error: 'Aucune catégorie trouvée (ni General) dans la collection cible' });
      continue;
    }
    const articles = (section.categories && section.categories[0] && section.categories[0].articles) || [];
    for (const art of articles) {
      try {
        const file = art.file;
        const slug = art.slug;
        const { html, title: inferred } = ensureConverted(file);
        // Titre préféré: H1 extrait (avec emoji) sinon label SUMMARY, sinon fallback basename
        const summaryTitles = (() => {
          try {
            const md = fs.readFileSync(path.join(process.cwd(), 'SUMMARY.md'), 'utf8');
            const re = /\*\s+\[(.*?)\]\(([^)]+)\)/g; const map = new Map(); let m;
            while ((m = re.exec(md)) !== null) { map.set(m[2], m[1]); }
            return map;
          } catch (_) { return new Map(); }
        })();
        const fromSummary = summaryTitles.get(file);
        const title = inferred || fromSummary || art.title || path.basename(file, path.extname(file));
        const id = slugToId[slug] || titleToId[normalizeTitle(title)];
        // Utiliser le champ 'categories' (array) pour l'affectation, cf. API Update Article
        // https://developer.helpscout.com/docs-api/articles/update/
        const updateBody = { name: title, slug, text: html, status: 'published', categories: [catId] };
        if (id) {
          await axiosInstance.put(`articles/${id}`, updateBody);
          results.push({ section: section.name, slug, id, action: 'update' });
        } else {
          const createBody = { name: title, slug, text: html, status: 'published', collectionId, categories: [catId], siteId };
          const { data } = await axiosInstance.post('articles', createBody);
          results.push({ section: section.name, slug, id: data?.item?.id || data?.id, action: 'create' });
        }
      } catch (e) {
        results.push({ section: section.name, file: art.file, error: (e.response?.data && (e.response.data.error || JSON.stringify(e.response.data))) || e.message });
      }
    }
  }

  const out = path.join(process.cwd(), '.mapping', `publish-all-by-index-${Date.now()}.json`);
  fs.writeFileSync(out, JSON.stringify(results, null, 2));
  console.log('Publication lot écrite dans', out);
}

main().catch((e) => {
  console.error('Erreur publish-all-by-index:', e.response?.status, e.response?.data || e.message);
  process.exit(1);
});


