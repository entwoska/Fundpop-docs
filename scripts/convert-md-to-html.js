const fs = require('fs');
const path = require('path');

let DEPS = null;
async function loadDeps() {
  if (DEPS) return DEPS;
  const unifiedMod = await import('unified');
  const remarkParseMod = await import('remark-parse');
  const remarkGfmMod = await import('remark-gfm');
  const remarkDirectiveMod = await import('remark-directive');
  const remarkRehypeMod = await import('remark-rehype');
  const rehypeRawMod = await import('rehype-raw');
  const rehypeSanitizeMod = await import('rehype-sanitize');
  // Schéma de sanitisation par défaut (pour lister/étendre les balises autorisées)
  let sanitizeSchemaMod = null;
  try {
    // hast-util-sanitize >=5 exporte defaultSchema en ESM
    sanitizeSchemaMod = await import('hast-util-sanitize');
  } catch (_) {
    sanitizeSchemaMod = null;
  }
  const rehypeSlugMod = await import('rehype-slug');
  const rehypeStringifyMod = await import('rehype-stringify');
  const visitMod = await import('unist-util-visit');
  DEPS = {
    unified: unifiedMod.unified || unifiedMod.default || unifiedMod,
    remarkParse: remarkParseMod.default || remarkParseMod,
    remarkGfm: remarkGfmMod.default || remarkGfmMod,
    remarkDirective: remarkDirectiveMod.default || remarkDirectiveMod,
    remarkRehype: remarkRehypeMod.default || remarkRehypeMod,
    rehypeRaw: rehypeRawMod.default || rehypeRawMod,
    rehypeSanitize: rehypeSanitizeMod.default || rehypeSanitizeMod,
    defaultSanitizeSchema: (sanitizeSchemaMod && (sanitizeSchemaMod.defaultSchema || sanitizeSchemaMod.github || sanitizeSchemaMod.default)) || null,
    rehypeSlug: rehypeSlugMod.default || rehypeSlugMod,
    rehypeAutolinkHeadings: null,
    rehypeStringify: rehypeStringifyMod.default || rehypeStringifyMod,
    visit: visitMod.visit || visitMod.default || visitMod
  };
  return DEPS;
}

function hintStyle(type) {
  const styles = {
    note: { border: '#3b82f6', bg: '#f8fafc', label: 'Note.' },
    tip: { border: '#10b981', bg: '#ecfdf5', label: 'Astuce.' },
    warning: { border: '#f59e0b', bg: '#fffbeb', label: 'Attention.' },
    danger: { border: '#ef4444', bg: '#fef2f2', label: 'Important.' },
  };
  return styles[type] || styles.note;
}

function deriveDefaultAssetBaseUrl() {
  // Tente de déduire https://raw.githubusercontent.com/<owner>/<repo>/<branch>
  try {
    const { spawnSync } = require('child_process');
    const remote = spawnSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' });
    if (remote.status !== 0) throw new Error('no git remote');
    const rawUrl = String(remote.stdout || '').trim();
    if (!rawUrl) throw new Error('empty remote');
    // Formats possibles: https://github.com/owner/repo.git ou git@github.com:owner/repo.git
    let m = rawUrl.match(/github\.com[/:]([^/]+)\/([^\.]+)(?:\.git)?$/i);
    if (!m) throw new Error('not github');
    const owner = m[1];
    const repo = m[2];
    let branch = 'main';
    const br = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' });
    if (br.status === 0) {
      const b = String(br.stdout || '').trim();
      if (b) branch = b;
    }
    return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}`;
  } catch (_) {
    // Fallback GitHub Actions
    const repo = process.env.GITHUB_REPOSITORY; // owner/repo
    const ref = process.env.GITHUB_REF_NAME || 'main';
    if (repo) return `https://raw.githubusercontent.com/${repo}/${ref}`;
    return '';
  }
}

function stripFrontmatter(src) {
  // Tolère BOM/espaces/retours avant '---' et supprime un bloc YAML initial
  const text = src.replace(/^\uFEFF?/, '');
  const m = text.match(/^[\s\r\n]*---[\s\S]*?\n---\s*\n?/);
  if (m) {
    return text.slice(m[0].length);
  }
  return text;
}

function replaceGitbookHints(md) {
  // Convert GitBook hint blocks to GitHub-style admonitions that our pipeline handles
  // {% hint style="info" %} ... {% endhint %} => > [!INFO]\n\n...
  return md.replace(/\{\%\s*hint\s+style\s*=\s*"(info|warning|danger|tip|success|note|important|caution)"\s*\%\}([\s\S]*?)\{\%\s*endhint\s*\%\}/gi,
    (_, type, body) => {
      const upper = String(type).toUpperCase();
      return `> [!${upper}]\n${body.trim()}\n`;
    }
  );
}

function extractTitleFromMarkdown(md) {
  const lines = md.split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^#\s+(.*)/);
    if (m) return m[1].trim();
  }
  return null;
}

function rehypeHints({ visit }) {
  return (tree) => {
    visit(tree, 'element', (node, index, parent) => {
      if (!parent) return;
      if (node.tagName === 'blockquote' && node.children && node.children[0]) {
        const first = node.children[0];
        let type = null;
        if (first.type === 'element' && first.tagName === 'p' && first.children && first.children[0] && first.children[0].type === 'text') {
          const text = first.children[0].value.trim().toLowerCase();
          const match = text.match(/^\[!([a-z]+)\]/i);
          if (match) type = match[1].toLowerCase();
        }
        if (type) {
          const style = hintStyle(type);
          node.tagName = 'div';
          node.properties = node.properties || {};
          node.properties.style = `border-left:4px solid ${style.border};padding:10px 12px;background:${style.bg};border-radius:6px;margin:10px 0`;
          if (node.children[0] && node.children[0].children && node.children[0].children[0]) {
            node.children[0].children[0].value = node.children[0].children[0].value.replace(/^\[![^\]]+\]\s*/i, '');
          }
          node.children.unshift({
            type: 'element',
            tagName: 'p',
            properties: {},
            children: [{ type: 'element', tagName: 'strong', properties: {}, children: [{ type: 'text', value: style.label }] }]
          });
        }
      }
    });
  };
}

function rehypeImages({ baseDir, assetBaseUrl, visit }) {
  const pathMod = require('path');
  const fsMod = require('fs');
  return (tree) => {
    visit(tree, 'element', (node) => {
      if (node.tagName === 'img' && node.properties && node.properties.src) {
        const originalSrc = String(node.properties.src || '');
        if (!/^https?:\/\//i.test(originalSrc)) {
          const isRootRelative = originalSrc.startsWith('/');
          const cleaned = originalSrc.replace(/^\.\//, '').replace(/^\//, '');
          // Résoudre le chemin absolu fichier: racine du repo si root-relative, sinon relatif au fichier courant
          const abs = isRootRelative
            ? pathMod.resolve(process.cwd(), cleaned)
            : pathMod.resolve(baseDir || process.cwd(), cleaned);
          let rel = pathMod.relative(process.cwd(), abs).split(pathMod.sep).join('/');
          rel = rel.replace(/^\.\//, '');
          // Si un ASSET_BASE_URL est fourni, émettre une URL absolue; sinon garder le chemin relatif propre
          if (assetBaseUrl) {
            node.properties.src = `${assetBaseUrl.replace(/\/$/, '')}/${encodeURI(rel)}`;
          } else {
            node.properties.src = rel;
          }
        }
        node.properties.alt = node.properties.alt || '';
        node.properties.style = (node.properties.style || '') + ';max-width:100%;height:auto;';
      }
    });
  };
}

function rehypeLinks({ linkMap, visit }) {
  return (tree) => {
    visit(tree, 'element', (node) => {
      if (node.tagName === 'a' && node.properties && node.properties.href) {
        const href = node.properties.href;
        if (/\.md($|#)/i.test(href)) {
          const clean = href.replace(/#.*$/, '').replace(/\.md$/i, '');
          if (linkMap && linkMap[clean]) {
            node.properties.href = linkMap[clean];
          }
        }
      }
    });
  };
}

async function convertFile(inputPath, { assetBaseUrl, linkMap, embedImages, fileMap }) {
  const {
    unified,
    remarkParse,
    remarkGfm,
    remarkDirective,
    remarkRehype,
    rehypeRaw,
    rehypeSanitize,
    rehypeSlug,
    rehypeAutolinkHeadings,
    rehypeStringify,
    visit
  } = await loadDeps();
  const mdRaw = fs.readFileSync(inputPath, 'utf8');
  const mdNoFm = stripFrontmatter(mdRaw);
  const mdPrepared = replaceGitbookHints(mdNoFm);
  const inferredTitle = extractTitleFromMarkdown(mdNoFm);
  const resolvedAssetBaseUrl = assetBaseUrl || deriveDefaultAssetBaseUrl();
  const file = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkDirective)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeSlug)
    // Autoriser figure/figcaption pour conserver les légendes d’images
    .use(rehypeSanitize, (() => {
      try {
        const base = DEPS.defaultSanitizeSchema || {};
        const schema = JSON.parse(JSON.stringify(base));
        schema.tagNames = Array.from(new Set([...(schema.tagNames || []), 'figure', 'figcaption']));
        schema.attributes = schema.attributes || {};
        schema.attributes.figure = Array.from(new Set([...(schema.attributes.figure || []), 'className', 'style']));
        schema.attributes.figcaption = Array.from(new Set([...(schema.attributes.figcaption || []), 'className', 'style']));
        schema.attributes.img = Array.from(new Set([...(schema.attributes.img || []), 'src', 'alt', 'title', 'width', 'height', 'loading', 'decoding', 'style']));
        return schema;
      } catch (_) {
        // fallback: laisser passer la config par défaut si le schéma n'est pas dispo
        return undefined;
      }
    })())
    .use(rehypeStringify)
    .process(mdPrepared);
  let rawHtml = String(file);
  // Si un titre H1 a été inféré, retirer le premier <h1>...</h1> du corps pour éviter le doublon
  const title = inferredTitle;
  if (title) {
    rawHtml = rawHtml.replace(/<h1[^>]*>[\s\S]*?<\/h1>/i, '');
  }
  const html = postProcessHtml(rawHtml, { assetBaseUrl: resolvedAssetBaseUrl, linkMap, baseDir: path.dirname(inputPath), embedImages, fileMap });
  return { html, title };
}

function postProcessHtml(html, { assetBaseUrl, linkMap, baseDir, embedImages, fileMap }) {
  let out = html;
  out = out.replace(/<blockquote>([\s\S]*?)<\/blockquote>/gi, (m, inner) => {
    // Supporte > [!TYPE]\n... (avec ou sans premier paragraphe)
    const typeMatch = inner.match(/\[!([A-Z]+)\]/i);
    if (!typeMatch) return m;
    const type = typeMatch[1].toLowerCase();
    const cleaned = inner.replace(/<p>\s*\[![^\]]+\]\s*<\/p>/i, '').replace(/\[![^\]]+\]\s*/i, '');
    const content = cleaned.trim();
    const styleMap = {
      note: { border: '#3b82f6', bg: '#f0f7ff', icon: '💡' },
      info: { border: '#3b82f6', bg: '#f0f7ff', icon: 'ℹ️' },
      tip: { border: '#06b6d4', bg: '#ecfeff', icon: '💡' },
      success: { border: '#10b981', bg: '#ecfdf5', icon: '✅' },
      warning: { border: '#f59e0b', bg: '#fffbeb', icon: '⚠️' },
      caution: { border: '#f59e0b', bg: '#fffbeb', icon: '⚠️' },
      important: { border: '#8b5cf6', bg: '#f5f3ff', icon: '❗' },
      danger: { border: '#ef4444', bg: '#fef2f2', icon: '⛔' },
    };
    const s = styleMap[type] || styleMap.note;
    // Resserre les marges internes si le contenu est un seul paragraphe
    const contentTight = /^\s*<p>[\s\S]*<\/p>\s*$/i.test(content)
      ? content.replace(/<p>/i, '<p style="margin:0">')
      : content;
    return `<div class="fp-hint fp-hint-${type}" style="border-left:4px solid ${s.border};background:${s.bg};border-radius:6px;padding:10px 12px;margin:10px 0"><div style="display:flex;gap:10px;align-items:flex-start"><div style="font-size:18px;line-height:1;margin-top:2px">${s.icon}</div><div style="margin:0">${contentTight}</div></div></div>`;
  });

  out = out.replace(/<img([^>]*?)\s+src="(?!https?:|data:)([^"]+)"/gi, (m, pre, src) => {
    const isRootRelative = /^\//.test(src);
    const cleaned = src.replace(/^\.\//, '').replace(/^\//, '');
    if (embedImages && baseDir) {
      try {
        const abs = require('path').resolve(isRootRelative ? process.cwd() : baseDir, cleaned);
        if (require('fs').existsSync(abs)) {
          const buf = require('fs').readFileSync(abs);
          const ext = (abs.split('.').pop() || '').toLowerCase();
          const mime = ext === 'png' ? 'image/png' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'gif' ? 'image/gif' : ext === 'svg' ? 'image/svg+xml' : ext === 'webp' ? 'image/webp' : 'application/octet-stream';
          const dataUri = `data:${mime};base64,${buf.toString('base64')}`;
          return `<img${pre} src="${dataUri}"`;
        }
      } catch (_) {}
    }
    if (assetBaseUrl) {
      const pathMod = require('path');
      const abs = pathMod.resolve(isRootRelative ? process.cwd() : (baseDir || process.cwd()), cleaned);
      let rel = pathMod.relative(process.cwd(), abs).split(pathMod.sep).join('/');
      rel = rel.replace(/^\.\//, '');
      const pref = assetBaseUrl.replace(/\/$/, '') + '/' + encodeURI(rel);
      return `<img${pre} src="${pref}"`;
    }
    return m;
  });

  // Appliquer un style par défaut aux figures/captions pour un rendu homogène dans Help Scout
  out = out.replace(/<figure>([\s\S]*?)<\/figure>/gi, (block) => {
    let b = block;
    // Image sans marge pour coller la légende
    b = b.replace(/<img([^>]*)>/i, (m2, pre) => {
      if (/style=/i.test(pre)) {
        return `<img${pre.replace(/style="([^"]*)"/i, (s, v) => ` style="${v};margin:0;max-width:100%;height:auto;"`)}>`;
      }
      return `<img${pre} style="margin:0;max-width:100%;height:auto;">`;
    });
    // Légende centrée, petite et grisée
    b = b.replace(/<figcaption([^>]*)>/i, (m3, pre) => {
      const style = 'text-align:center;color:#6a6a6a;font-size:14px;line-height:1.4;margin-top:8px';
      if (/style=/i.test(pre)) {
        return `<figcaption${pre.replace(/style="([^"]*)"/i, (s, v) => ` style="${v};${style}"`)}>`;
      }
      return `<figcaption${pre} style="${style}">`;
    });
    return b;
  });

  // Réécriture des liens relatifs .md vers URLs Help Scout absolues à partir du mapping + snapshot
  out = out.replace(/<a([^>]*?)\s+href="([^"]+?)"/gi, (m, pre, href) => {
    // Laisser passer les liens absolus externes
    if (/^(?:https?:)?\/\//i.test(href)) return m;
    // Ne traiter que les liens .md (avec ou sans ancre)
    if (!/\.md($|#)/i.test(href)) return m;
    const parts = href.split('#');
    const mdPathRaw = parts[0];
    const hash = parts[1] ? '#' + parts[1] : '';
    try {
      const abs = require('path').resolve(baseDir || process.cwd(), mdPathRaw);
      let rel = require('path').relative(process.cwd(), abs).split(require('path').sep).join('/');
      if (!/\.md$/i.test(rel)) rel += '.md';
      const finalUrl = fileMap && fileMap[rel];
      if (finalUrl) {
        return `<a${pre} href="${finalUrl}${hash}"`;
      }
    } catch (_) {}
    return m;
  });

  return out;
}

async function main() {
  const inFiles = process.argv.slice(2);
  if (inFiles.length === 0) {
    console.error('Usage: node scripts/convert-md-to-html.js <file1.md> [file2.md...]');
    process.exit(1);
  }
  const outDir = path.join(process.cwd(), '.converted');
  fs.mkdirSync(outDir, { recursive: true });
  // Construire la table fichier -> URL publique Help Scout
  // 1) Charger mapping.yaml (file -> slug)
  // 2) Charger snapshot articles.json (slug -> publicUrl)
  // 3) fileMap: chemin relatif .md -> publicUrl absolue; fallback vers HELPSCOUT_BASE_URL/article/<slug>
  const linkMap = {};
  const fileMap = {};
  try {
    const yaml = require('js-yaml');
    const mappingPath = path.join(process.cwd(), '.mapping', 'mapping.yaml');
    const mapping = fs.existsSync(mappingPath) ? yaml.load(fs.readFileSync(mappingPath, 'utf8')) : { collections: [] };
    const arts = [];
    for (const coll of mapping.collections || []) {
      for (const cat of (coll.categories || [])) {
        for (const art of (cat.articles || [])) {
          arts.push({ file: art.file, slug: art.slug });
        }
      }
    }
    const snapshotPath = path.join(process.cwd(), '.snapshot', 'helpscout', 'articles.json');
    const baseUrl = process.env.HELPSCOUT_BASE_URL || 'https://fundpop-crowdfunding.helpscoutdocs.com';
    let slugToPublic = new Map();
    if (fs.existsSync(snapshotPath)) {
      try {
        const wrap = JSON.parse(fs.readFileSync(snapshotPath, 'utf8')) || [];
        for (const w of wrap) {
          const a = w && w.article ? w.article : w;
          if (a && a.slug && a.publicUrl) slugToPublic.set(String(a.slug), String(a.publicUrl));
        }
      } catch (_) {}
    }
    for (const a of arts) {
      if (!a || !a.file || !a.slug) continue;
      const rel = a.file.replace(/^\.\/?/, '');
      const pub = slugToPublic.get(String(a.slug)) || `${baseUrl.replace(/\/$/, '')}/article/${encodeURIComponent(a.slug)}`;
      fileMap[rel] = pub;
      // Variante sans extension pour compat
      const noext = rel.replace(/\.md$/i, '');
      fileMap[noext] = pub;
    }
  } catch (_) {}
  const assetBaseUrl = process.env.ASSET_BASE_URL || '';
  const embedImages = process.env.EMBED_IMAGES === '1';
  for (const f of inFiles) {
    const abs = path.isAbsolute(f) ? f : path.join(process.cwd(), f);
    const { html, title } = await convertFile(abs, { assetBaseUrl, linkMap, embedImages, fileMap });
    const base = path.basename(f, path.extname(f));
    const outPath = path.join(outDir, base + '.html');
    fs.writeFileSync(outPath, html, 'utf8');
    if (title) fs.writeFileSync(path.join(outDir, base + '.meta.json'), JSON.stringify({ title }, null, 2));
    console.log(`Converti: ${f} -> ${outPath}`);
  }
}

main();
