const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const MarkdownIt = require('markdown-it');
const katex = require('katex');
const sanitize = require('sanitize-html');
const hljs = require('highlight.js');

const escape = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let cachedCSS;
function styles() {
  if (!cachedCSS) {
    const katexDir = path.dirname(require.resolve('katex/dist/katex.min.css'));
    const math = fs.readFileSync(path.join(katexDir, 'katex.min.css'), 'utf8').replace(/,url\(fonts\/[^)]+\.(?:woff|ttf)\) format\("[^"]+"\)/g,'').replace(/url\(([^)]+)\)/g, (match, ref) => {
      const name = ref.replace(/["']/g, '');
      if (!name.endsWith('.woff2')) return match;
      return `url(data:font/woff2;base64,${fs.readFileSync(path.join(katexDir, name)).toString('base64')})`;
    });
    cachedCSS = math + fs.readFileSync(require.resolve('highlight.js/styles/github.css'), 'utf8') + fs.readFileSync(path.join(__dirname, 'document.css'), 'utf8');
  }
  return cachedCSS;
}

function renderDocument(source, filename, options = {}) {
  const warnings = [];
  const width = Math.min(1600, Math.max(600, Number(options.width) || 900));
  const fontSize = Math.min(24, Math.max(12, Number(options.fontSize) || 16));
  const padding = Math.min(100, Math.max(16, Number(options.padding) || 40));
  const md = new MarkdownIt({ html: true, breaks: true, linkify: true,
    highlight(code, language) {
      return language && hljs.getLanguage(language) ? hljs.highlight(code, {language}).value : escape(code);
    }
  });
  for (const plugin of ['sub', 'sup', 'mark', 'abbr', 'attributes', 'footnote', 'imsize', 'task-lists']) {
    const loaded = require(`markdown-it-${plugin}`); md.use(loaded.default || loaded);
  }
  md.use(require('markdown-it-multimd-table'), {multiline: true, rowspan: true, headerless: true, multibody: true});
  md.use(require('./math'), (tex, displayMode) => {
      try { return katex.renderToString(tex, {displayMode, throwOnError: true, strict: false, trust: false}); }
      catch (error) { warnings.push(`公式无法解析：${tex.slice(0, 90)}（${error.message}）`); return `<span class="math-error">${escape(tex)}</span>`; }
  });
  for (const name of ['tip', 'warning', 'danger', 'info', 'note', 'details', 'row', 'col', 'success']) {
    md.use(require('markdown-it-container'), name, {
      render(tokens, i) {
        if (tokens[i].nesting === -1) return '</section>\n';
        const title = tokens[i].info.trim().slice(name.length).trim();
        return `<section class="container ${name}">${title ? `<div class="container-title">${md.renderInline(title)}</div>` : ''}\n`;
      }
    });
  }
  // Parse a TOC as its own block, so its attributes do not become a paragraph style.
  md.block.ruler.before('paragraph', 'toc', (state, start, end, silent) => {
    const line = state.src.slice(state.bMarks[start] + state.tShift[start], state.eMarks[start]);
    const match = /^\[toc\](?:\{(.*)\})?\s*$/i.exec(line);
    if (!match) return false;
    if (!silent) { const token = state.push('toc', '', 0); token.content = match[1] || ''; token.map = [start, start + 1]; state.line = start + 1; }
    return true;
  });
  const headings = [];
  const seen = new Map();
  md.core.ruler.push('heading-ids', state => {
    state.tokens.forEach((token, i) => {
      if (token.type !== 'heading_open') return;
      const text = state.tokens[i + 1].content;
      const base = text.toLowerCase().replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-|-$/g, '') || 'section';
      const count = seen.get(base) || 0; seen.set(base, count + 1);
      const id = token.attrGet('id') || base + (count ? `-${count}` : '');
      token.attrSet('id', id); headings.push({id, text, level: Number(token.tag.slice(1))});
    });
  });
  md.renderer.rules.toc = (tokens, i) => {
    const attrs = tokens[i].content;
    const levels = /level\s*:\s*\[([\d,\s]+)\]/.exec(attrs)?.[1].split(',').map(Number) || [1,2,3];
    const tag = /type\s*:\s*["']?ol/.test(attrs) ? 'ol' : 'ul';
    return `<nav class="toc"><${tag}>${headings.filter(h => levels.includes(h.level)).map(h => `<li style="margin-left:${(h.level - Math.min(...levels)) * 16}px"><a href="#${escape(h.id)}">${escape(h.text)}</a></li>`).join('')}</${tag}></nav>`;
  };
  const languages = [...source.matchAll(/^\s*```([^\s`]*)/gm)].map(m => m[1]);
  for (const language of languages) if (['mermaid','plantuml','drawio'].includes(language)) warnings.push(`${language} 图形暂以代码显示；可先在 Yank Note 中导出为图片再引用。`);
  if (/--echarts--|--applet--|\[=|\.mindmap/.test(source)) warnings.push('文档含动态扩展或思维导图，当前版本保留静态内容，不执行脚本或宏。');
  if (/^---\r?\n/.test(source)) source = source.replace(/^---\r?\n[\s\S]*?\r?\n---\s*\r?\n/, '');
  const imageCache = new Map();
  let images = 0;
  const mime = {'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.svg':'image/svg+xml','.bmp':'image/bmp'};
  const body = sanitize(md.render(source), {
    allowedTags: [...sanitize.defaults.allowedTags, 'img','input','section','nav','details','summary','mark','s','del','span','div','eq','eqn','svg','path','g','line','rect','math','semantics','mrow','mi','mo','mn','msup','msub','msubsup','mfrac','msqrt','mroot','mtext','mspace','mtable','mtr','mtd','mover','munder','munderover','mpadded','mstyle','annotation','menclose'],
    allowedAttributes: {'*':['id','class','style','title','aria-hidden'],a:['href','name','target'],img:['src','alt','width','height','class','style'],input:['type','checked','disabled'],td:['colspan','rowspan','style'],th:['colspan','rowspan','style'],math:['xmlns','display'],annotation:['encoding'],mo:['stretchy','fence','separator','lspace','rspace'],mspace:['width','height'],mtd:['columnalign'],mtable:['columnalign','rowspacing','columnspacing'],mpadded:['height','width','depth','lspace'],mstyle:['scriptlevel','displaystyle'],svg:['xmlns','width','height','viewbox','preserveaspectratio','focusable'],path:['d','fill','stroke','stroke-width'],g:['fill','stroke','transform'],line:['x1','x2','y1','y2','stroke'],rect:['x','y','width','height','fill']},
    allowedSchemes: ['http','https','mailto','data'], allowedSchemesByTag: {img:['data']},
    transformTags: {
      input: (tag, attrs) => ({tagName: 'input', attribs:{type:'checkbox', disabled:'', ...(Object.hasOwn(attrs,'checked') ? {checked:''} : {})}}),
      img: (tag, attrs) => {
        images++;
        const original = attrs.src || '';
        if (/^data:image\//i.test(original)) return {tagName:tag, attribs:attrs};
        try {
          let ref = original.split('?')[0].split('#')[0];
          if (/^https?:/i.test(ref)) throw new Error('离线模式不下载网络图片');
          ref = /^file:/i.test(ref) ? fileURLToPath(ref) : decodeURIComponent(ref);
          const absolute = path.resolve(path.dirname(filename), ref);
          const type = mime[path.extname(absolute).toLowerCase()];
          if (!type) throw new Error('不支持的图片格式');
          if (!imageCache.has(absolute)) imageCache.set(absolute, `data:${type};base64,${fs.readFileSync(absolute).toString('base64')}`);
          return {tagName: tag, attribs: {...attrs, src:imageCache.get(absolute)}};
        } catch (error) {
          warnings.push(`图片读取失败：${original}（${error.message}）`);
          return {tagName:'span', attribs:{class:'missing-image', title:original}, text:`[图片缺失：${original}]`};
        }
      }
    }
  });
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; script-src 'none'"><style>${styles()}</style></head><body><article id="document" style="width:${width}px;padding:${padding}px;font-size:${fontSize}px">${body}</article></body></html>`;
  return {html, warnings:[...new Set(warnings)], images, headings: headings.length, width, fontSize, padding};
}
module.exports = {renderDocument};
