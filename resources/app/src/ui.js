const $ = id => document.getElementById(id);
let selected = null, working = false, valid = false, timer;
function status(text, error = false) { $('status').textContent = text; $('status').className = error ? 'error' : ''; }
function controls() {
  $('choose').disabled = working;
  $('refresh').disabled = working || !selected;
  $('export').disabled = working || !valid;
  for (const id of ['width','fontSize','padding']) $(id).disabled = working;
}
async function render() {
  if (!selected || working) return;
  working=true; valid=false; controls(); status('正在读取图片、渲染公式与排版…');
  try {
    const result=await window.desktop.render(Object.fromEntries(['width','fontSize','padding'].map(id=>[id,Number($(id).value)])));
    $('preview').src=result.previewURL; $('preview').hidden=false; $('empty').hidden=true;
    $('preview-title').textContent=selected.name;
    $('stats').textContent=`${result.images} 张图片 · ${result.headings} 个标题 · 宽 ${result.metrics.width} px · 长 ${result.metrics.height.toLocaleString()} px`;
    const warnings=[...result.warnings];
    if(result.metrics.overflow>2) warnings.push('内容超出宽度，请调大版面宽度或调小字号，避免裁切。');
    $('warnings').hidden=!warnings.length; $('warning-text').textContent=warnings.join('\n');
    valid=true; status(warnings.length ? '预览完成，请检查渲染提示。' : '预览完成，可以导出连续单页 PDF。');
  } catch(error) {status(error.message,true);} finally {working=false;controls();}
}
async function setFile(file) {
  if(!file)return; selected=file; $('filename').textContent=file.name; $('filepath').textContent=file.path;
  $('reveal').hidden=true; await render();
}
$('choose').addEventListener('click',async()=>{try{await setFile(await window.desktop.choose());}catch(error){status(error.message,true);}});
$('refresh').addEventListener('click',render);
for(const id of ['width','fontSize','padding']) $(id).addEventListener('change',()=>{clearTimeout(timer);valid=false;controls();timer=setTimeout(render,150);});
$('export').addEventListener('click',async()=>{
  working=true;controls();status('正在生成连续单页 PDF…');
  try {
    const result=await window.desktop.export();
    if(result){status(`导出成功 · 1 页 · ${(result.bytes/1024/1024).toFixed(2)} MB · ${result.outputPath}`);$('reveal').hidden=false;}
    else status('已取消导出。');
  }catch(error){status(error.message,true);}finally{working=false;controls();}
});
$('reveal').addEventListener('click',()=>window.desktop.reveal());
window.desktop.initial().then(setFile).catch(error=>status(error.message,true));
window.desktop.onFile(setFile);
