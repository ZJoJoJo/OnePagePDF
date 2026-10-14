const fs = require('node:fs/promises');
const {PDFDocument, PDFName, PDFNumber} = require('pdf-lib');

async function ready(contents) {
  return contents.executeJavaScript(`(async()=>{
    await document.fonts.ready;
    await Promise.all([...document.images].map(async image => {
      if (!image.complete) await new Promise(resolve=>{image.onload=resolve;image.onerror=resolve;setTimeout(resolve,15000)});
      if (image.complete && image.naturalWidth) await image.decode().catch(()=>{});
    }));
    // Fit an entire equation as one vector object instead of clipping or wrapping it.
    for(const math of document.querySelectorAll('.katex')) {
      if(math.closest('.katex-display') && math.parentElement.className!=='katex-display') continue;
      const parent=math.closest('.katex-display') || math.parentElement;
      const available=parent.clientWidth;
      const natural=math.getBoundingClientRect().width;
      if(available>0 && natural>available) math.style.zoom=available/natural;
    }
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const article=document.querySelector('article');
    return {width:article.getBoundingClientRect().width,height:Math.ceil(article.getBoundingClientRect().height),
      brokenImages:[...document.images].filter(i=>!i.naturalWidth).map(i=>i.alt||'未命名图片'),
      overflow:Math.max(0,article.scrollWidth-article.clientWidth),
      overflowNodes:[...article.querySelectorAll('p,table,pre,eqn,.katex-display,.row')].filter(e=>e.scrollWidth>e.clientWidth+2).slice(0,5).map(e=>({tag:e.tagName,width:e.clientWidth,scroll:e.scrollWidth,text:e.textContent.slice(0,100)}))};
  })()`, true);
}

async function exportPDF(contents, outputPath, title) {
  const metrics = await ready(contents);
  if (metrics.brokenImages.length) throw new Error(`存在未加载完成的图片：${metrics.brokenImages.join('、')}`);
  if (metrics.overflow > 2) throw new Error('内容超过版面宽度，请调大宽度或调小字号后导出，以免公式或表格被裁切。'+JSON.stringify(metrics.overflowNodes));
  // Chromium has a finite paper size. Uniform CSS zoom keeps the same layout;
  // PDF UserUnit restores physical dimensions without rasterizing any text.
  const factor = Math.min(1, 18000 / (metrics.height + 8));
  let bytes;
  try {
    await contents.executeJavaScript(`document.querySelector('article').style.zoom=${factor};document.body.style.width='${metrics.width*factor}px'`, true);
    const height = await contents.executeJavaScript(`Math.ceil(document.querySelector('article').getBoundingClientRect().height)+4`, true);
    bytes = await contents.printToPDF({
      printBackground:true, displayHeaderFooter:false, scale:1,
      margins:{top:0,bottom:0,left:0,right:0},
      pageSize:{width:metrics.width * factor / 96, height:height / 96},
      preferCSSPageSize:false
    });
  } finally {
    await contents.executeJavaScript("document.querySelector('article').style.zoom='';document.body.style.width=''", true);
  }
  const pdf = await PDFDocument.load(bytes);
  if (pdf.getPageCount() !== 1) throw new Error(`导出产生了 ${pdf.getPageCount()} 页，已取消保存以避免内容断页。`);
  if (factor < 1) pdf.getPage(0).node.set(PDFName.of('UserUnit'), PDFNumber.of(1 / factor));
  pdf.setTitle(title); pdf.setCreator('Markdown 连续PDF'); pdf.setProducer('Chromium / pdf-lib');
  const data = await pdf.save();
  await fs.writeFile(outputPath, data);
  return {...metrics, pages:1, bytes:data.length, factor, outputPath};
}
module.exports = {ready, exportPDF};
