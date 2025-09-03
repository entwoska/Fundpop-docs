const fs = require('fs');
const path = require('path');
const axios = require('axios');
require('dotenv').config();

const API_KEY = process.env.HELPSCOUT_API_KEY;
if (!API_KEY) {
  console.error("HELPSCOUT_API_KEY manquant. Définissez-la dans '.env'.");
  process.exit(1);
}

const DRY_RUN = process.env.PUBLISH === '1' ? false : true;
const TARGET_COLLECTION_NAME = process.env.TARGET_COLLECTION || 'Installing and using Fundpop';
const TARGET_CATEGORY_NAME = process.env.TARGET_CATEGORY || 'Getting Started';
const SECTION_NAME = process.env.SECTION_NAME || TARGET_CATEGORY_NAME; // section de mapping à utiliser
const TARGET_IDS = (process.env.TARGET_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
const TARGET_FILE = process.env.TARGET_FILE || '';
const DEBUG_LOG = process.env.DEBUG_LOG === '1';

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

function normalizeTitle(s) {
  if (!s) return '';
  try {
    const withoutEmoji = String(s).replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, '');
    return withoutEmoji.replace(/\s+/g, ' ').trim().toLowerCase();
  } catch (_) {
    return String(s).trim().toLowerCase();
  }
}

function loadSnapshot(file) {
  const p = path.join(process.cwd(), '.snapshot', 'helpscout', file);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function loadSummaryTitles() {
  const titles = new Map();
  const p = path.join(process.cwd(), 'SUMMARY.md');
  if (!fs.existsSync(p)) return titles;
  const md = fs.readFileSync(p, 'utf8');
  const re = /\*\s+\[(.*?)\]\(([^)]+)\)/g;
  let m;
  while ((m = re.exec(md)) !== null) {
    const label = m[1];
    const file = m[2];
    titles.set(file, label);
  }
  return titles;
}

function loadFullMapping() {
  const p = path.join(process.cwd(), '.mapping', 'mapping.yaml');
  if (!fs.existsSync(p)) return { collections: [] };
  const yaml = require('js-yaml');
  return yaml.load(fs.readFileSync(p, 'utf8'));
}

function findCollectionIdByName(collections, name) {
  const c = (collections || []).find(c => (c.name || '').trim().toLowerCase() === name.trim().toLowerCase());
  return c ? c.id : null;
}

function findCategoryIdByName(categories, collectionId, name) {
  const c = (categories || []).find(cat => String(cat.collectionId) === String(collectionId) && (cat.name || '').trim().toLowerCase() === name.trim().toLowerCase());
  return c ? c.id : null;
}

function ensureConverted(file) {
  const base = path.basename(file, path.extname(file));
  const out = path.join(process.cwd(), '.converted', base + '.html');
  const meta = path.join(process.cwd(), '.converted', base + '.meta.json');

  const shouldReconvert = (() => {
    if (process.env.FORCE_RECONVERT === '1') return true;
    if (!fs.existsSync(out)) return true;
    try {
      const srcStat = fs.statSync(path.join(process.cwd(), file));
      const outStat = fs.statSync(out);
      // Reconvertir si la source est plus récente que la sortie
      if (srcStat.mtimeMs > outStat.mtimeMs) return true;
      // Reconvertir si le script de conversion a changé depuis
      const convPath = path.join(process.cwd(), 'scripts', 'convert-md-to-html.js');
      const convStat = fs.statSync(convPath);
      if (convStat.mtimeMs > outStat.mtimeMs) return true;
    } catch (_) { return true; }
    return false;
  })();

  if (shouldReconvert) {
    const { spawnSync } = require('child_process');
    const res = spawnSync(process.execPath, [path.join(process.cwd(), 'scripts', 'convert-md-to-html.js'), file], { stdio: 'inherit' });
    if (res.status !== 0 || !fs.existsSync(out)) {
      console.error(`Échec de conversion pour ${file}`);
      process.exit(res.status || 1);
    }
  }

  const html = fs.readFileSync(out, 'utf8');
  let title = null;
  if (fs.existsSync(meta)) {
    try { title = JSON.parse(fs.readFileSync(meta, 'utf8')).title || null; } catch (_) {}
  }
  return { html, title };
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

async function createOrUpdateArticle({ collectionId, categoryId, siteId, title, slug, html, existingBySlug, existingByTitle }) {
  const match = existingBySlug.get(slug) || existingByTitle.get(normalizeTitle(String(title))) || null;
  if (match) {
    if (DRY_RUN) {
      return { action: 'update', id: match.id, slug, title, status: 'published' };
    }
    // Affecter la catégorie via le champ 'categories' (array) cf. docs
    // https://developer.helpscout.com/docs-api/articles/update/
    const body = { name: title, slug, text: html, status: 'published', categories: [categoryId] };
    await axiosInstance.put(`articles/${match.id}`, body);
    return { action: 'update', id: match.id, slug, title, status: 'published' };
  } else {
    if (DRY_RUN) {
      return { action: 'create', slug, title, status: 'published' };
    }
    const body = { name: title, slug, text: html, status: 'published', collectionId, categories: [categoryId], siteId };
    try {
      const { data } = await axiosInstance.post('articles', body);
      const id = data?.item?.id || data?.id;
      return { action: 'create', id, slug, title, status: 'published' };
    } catch (e) {
      const msg = (e.response?.data && (e.response.data.error || JSON.stringify(e.response.data))) || e.message;
      if (/name is already in use/i.test(msg)) {
        let fallback = existingByTitle.get(normalizeTitle(String(title)));
        if (!fallback) {
          // Chercher globalement dans tous les articles du site par titre normalisé
          const all = loadSnapshot('articles.json') || [];
          const key = normalizeTitle(String(title));
          const g = all.find(a => normalizeTitle(a.name) === key);
          if (g) fallback = g;
        }
        if (fallback) {
          await axiosInstance.put(`articles/${fallback.id}`, { ...body, collectionId: undefined });
          return { action: 'update', id: fallback.id, slug, title, status: 'published' };
        }
      }
      throw e;
    }
  }
}

function loadMappingSection(name) {
  const p = path.join(process.cwd(), '.mapping', 'mapping.yaml');
  if (!fs.existsSync(p)) return [];
  const yaml = require('js-yaml');
  const mapping = yaml.load(fs.readFileSync(p, 'utf8'));
  const section = (mapping.collections || []).find(s => (s.name || '').toLowerCase() === String(name).toLowerCase());
  if (!section) return [];
  const cat = (section.categories || [])[0] || { articles: [] };
  return cat.articles || [];
}

async function main() {
  const collections = loadSnapshot('collections.json') || [];
  const categories = loadSnapshot('categories.json') || [];
  if (!collections.length) {
    console.error('Aucune collection trouvée dans le snapshot. Exécutez npm run snapshot:helpscout');
    process.exit(1);
  }
  const siteId = process.env.HELPSCOUT_SITE_ID || collections[0].siteId;
  const collectionId = findCollectionIdByName(collections, TARGET_COLLECTION_NAME);
  if (!collectionId) {
    console.error(`Collection '${TARGET_COLLECTION_NAME}' introuvable.`);
    process.exit(1);
  }
  const targetCategoryName = process.env.TARGET_CATEGORY || SECTION_NAME || TARGET_CATEGORY_NAME;
  const categoryId = findCategoryIdByName(categories, collectionId, targetCategoryName);
  if (!categoryId) {
    console.error(`Catégorie '${targetCategoryName}' introuvable dans la collection '${TARGET_COLLECTION_NAME}'.`);
    process.exit(1);
  }

  const existing = await listArticlesInCategory(categoryId);
  const existingBySlug = new Map();
  const existingByTitle = new Map();
  for (const it of existing) {
    const slug = it.slug || (it.publicUrl ? String(it.publicUrl).split('/').pop() : undefined);
    if (slug) existingBySlug.set(slug, it);
    if (it.name) existingByTitle.set(normalizeTitle(String(it.name)), it);
  }

  // Index global de tous les articles (toutes catégories)
  const allArticles = loadSnapshot('articles.json') || [];
  const globalBySlug = new Map();
  const globalByTitle = new Map();
  for (const wrap of allArticles) {
    const it = wrap && wrap.article ? wrap.article : wrap;
    if (!it) continue;
    const gSlug = it.slug || (it.publicUrl ? String(it.publicUrl).split('/').pop() : undefined);
    if (gSlug && !globalBySlug.has(gSlug)) globalBySlug.set(gSlug, it);
    if (it.name) {
      const key = normalizeTitle(String(it.name));
      if (!globalByTitle.has(key)) globalByTitle.set(key, it);
    }
  }

  const toPublish = loadMappingSection(SECTION_NAME);
  const summaryTitles = loadSummaryTitles();
  const results = [];

  // Mode ciblé par IDs (diagnostic/force update)
  if (TARGET_IDS.length > 0) {
    const full = loadFullMapping();
    // Construire un index slug->file depuis tout le mapping
    const slugToFile = new Map();
    const fileToSlug = new Map();
    for (const coll of full.collections || []) {
      for (const cat of (coll.categories || [])) {
        for (const art of (cat.articles || [])) {
          if (art.slug) slugToFile.set(art.slug, art.file);
          if (art.file) fileToSlug.set(art.file, art.slug);
        }
      }
    }

    for (const id of TARGET_IDS) {
      try {
        // Essayer de récupérer l'article existant pour obtenir son slug
        let current;
        try {
          const { data } = await axiosInstance.get(`articles/${id}`);
          current = data.item || data;
        } catch (e) {
          if (DEBUG_LOG) console.log('GET article failed', e.response?.status, e.response?.data || e.message);
        }
        let currentSlug = current?.slug;
        // Si TARGET_FILE fourni, déduire slug depuis mapping
        if (TARGET_FILE && fileToSlug.has(TARGET_FILE)) {
          currentSlug = fileToSlug.get(TARGET_FILE);
        }
        const file = (TARGET_FILE && TARGET_FILE) || (currentSlug && slugToFile.get(currentSlug));
        if (!file) {
          results.push({ action: 'error', id, error: 'Aucun fichier correspondant trouvé (slug inconnu dans mapping)' });
          continue;
        }
        const { html, title: inferred } = ensureConverted(file);
        const fromSummary = summaryTitles.get(file);
        const title = inferred || fromSummary || path.basename(file, path.extname(file));
        const slug = currentSlug || fileToSlug.get(file);
        const body = { name: title, slug, text: html, status: 'published', collectionId, categoryId, siteId };
        if (DEBUG_LOG) {
          console.log('PUT /articles/' + id, JSON.stringify(body).slice(0, 200) + '...');
        }
        const resp = await axiosInstance.put(`articles/${id}`, body);
        if (DEBUG_LOG) {
          console.log('Response', resp.status, JSON.stringify(resp.data || {}).slice(0, 200) + '...');
        }
        results.push({ action: 'update', id, slug, title, status: 'published' });
      } catch (e) {
        results.push({ action: 'error', id, error: (e.response?.data && (e.response.data.error || JSON.stringify(e.response.data))) || e.message });
      }
    }

    const out = path.join(process.cwd(), '.mapping', `publish-by-ids-${Date.now()}.json`);
    fs.writeFileSync(out, JSON.stringify(results, null, 2));
    console.log(`${DRY_RUN ? 'Dry-run' : 'Publication'} ciblée IDs: écrit dans ${out}`);
    return;
  }
  for (const art of toPublish) {
    try {
      const { html, title: inferred } = ensureConverted(art.file);
      const fromSummary = summaryTitles.get(art.file);
      const title = inferred || fromSummary || art.title || path.basename(art.file, path.extname(art.file));
      const slug = art.slug;
      // Fallback global: rechercher l'article par titre/slug sur tout le site
      const all = loadSnapshot('articles.json') || [];
      let globalMatch = null;
      for (const wrap of all) {
        const it = wrap && wrap.article ? wrap.article : wrap;
        if (!it) continue;
        const s = it.slug || (it.publicUrl ? String(it.publicUrl).split('/').pop() : undefined);
        if (s === slug || normalizeTitle(it.name) === normalizeTitle(title)) { globalMatch = it; break; }
      }
      if (!existingBySlug.get(slug) && !existingByTitle.get(normalizeTitle(title)) && globalMatch && globalMatch.id) {
        const body = { name: title, slug, text: html, status: 'published', collectionId, categoryId, siteId };
        await axiosInstance.put(`articles/${globalMatch.id}`, body);
        results.push({ action: 'update', id: globalMatch.id, slug, title, status: 'published' });
        continue;
      }
      // Chercher match local puis global; si global trouvé, le mettre à jour directement
      const localMatch = existingBySlug.get(slug) || existingByTitle.get(normalizeTitle(title));
      let res;
      if (localMatch) {
        res = await createOrUpdateArticle({ collectionId, categoryId, siteId, title, slug, html, existingBySlug, existingByTitle });
      } else {
        const globalMatch = globalBySlug.get(slug) || globalByTitle.get(normalizeTitle(title));
        if (globalMatch && globalMatch.id) {
          const body = { name: title, slug, text: html, status: 'published', collectionId, categoryId, siteId };
          await axiosInstance.put(`articles/${globalMatch.id}`, body);
          res = { action: 'update', id: globalMatch.id, slug, title, status: 'published' };
        } else {
          res = await createOrUpdateArticle({ collectionId, categoryId, siteId, title, slug, html, existingBySlug, existingByTitle });
        }
      }
      results.push(res);
    } catch (e) {
      results.push({ action: 'error', file: art.file, error: (e.response?.data && (e.response.data.error || JSON.stringify(e.response.data))) || e.message });
      continue;
    }
  }

  // Mise à jour des IDs dans mapping.yaml après création (si pas dry-run)
  if (!DRY_RUN) {
    try {
      const yaml = require('js-yaml');
      const mappingPath = path.join(process.cwd(), '.mapping', 'mapping.yaml');
      if (fs.existsSync(mappingPath)) {
        const mapping = yaml.load(fs.readFileSync(mappingPath, 'utf8'));
        const section = (mapping.collections || []).find(s => (s.name || '').toLowerCase() === String(SECTION_NAME).toLowerCase());
        if (section && section.categories && section.categories[0]) {
          const arts = section.categories[0].articles || [];
          for (const r of results) {
            if (r.action === 'create' && r.id) {
              const idx = arts.findIndex(a => a.slug === r.slug);
              if (idx >= 0) arts[idx].id = r.id;
            }
          }
          fs.writeFileSync(mappingPath, yaml.dump(mapping));
        }
      }
    } catch (e) {
      console.warn('Avertissement: impossible de mettre à jour mapping.yaml:', e.message);
    }
  }

  const out = path.join(process.cwd(), '.mapping', `publish-${String(SECTION_NAME).toLowerCase().replace(/\s+/g, '-')}-${DRY_RUN ? 'dryrun' : 'applied'}.json`);
  fs.writeFileSync(out, JSON.stringify(results, null, 2));
  console.log(`${DRY_RUN ? 'Dry-run' : 'Publication'} ${SECTION_NAME}: écrit dans ${out}`);
}

main().catch((e) => {
  console.error('Erreur de publication:', e.response?.status, e.response?.data || e.message);
  process.exit(1);
});
