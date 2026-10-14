const {app, BrowserWindow, ipcMain, dialog, shell, Menu} = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const {pathToFileURL} = require('node:url');
const {renderDocument} = require('./render');
const {ready, exportPDF} = require('./export');
let window, selected, rendered, documentWindow, lastOutput, busy = false;
const verifyMode = process.argv.includes('--verify');
const temporary = new Set();
function cleanup() { for(const file of temporary) { try{fsSync.unlinkSync(file);}catch{} } temporary.clear(); }

function secure(win) {
  win.webContents.setWindowOpenHandler(() => ({action:'deny'}));
  win.webContents.on('will-navigate', event => event.preventDefault());
}
async function loadDocument(result) {
  if (documentWindow && !documentWindow.isDestroyed()) documentWindow.destroy();
  documentWindow = new BrowserWindow({show:false,width:result.width,height:900,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  secure(documentWindow);
  const file = path.join(app.getPath('temp'), `continuous-md-${process.pid}-${Date.now()}.html`);
  temporary.add(file);
  await fs.writeFile(file, result.html);
  await documentWindow.loadFile(file);
  const metrics = await ready(documentWindow.webContents);
  await fs.writeFile(file, await documentWindow.webContents.executeJavaScript("'<!doctype html>'+document.documentElement.outerHTML",true));
  return {...result, html:undefined, previewURL:pathToFileURL(file).href, metrics};
}
async function selectFile(file) {
  if (!/\.(md|markdown)$/i.test(file)) throw new Error('请选择 .md 或 .markdown 文件');
  const stat = await fs.stat(file);
  if (stat.size > 50 * 1024 * 1024) throw new Error('文件超过 50 MB，请先拆分文档。');
  selected = {path:file,name:path.basename(file)};
  rendered = null;
  return selected;
}
function register() {
  ipcMain.handle('initial', () => selected || null);
  ipcMain.handle('choose', async () => {
    if (busy) throw new Error('请等待当前操作完成');
    const result = await dialog.showOpenDialog(window, {title:'选择 Markdown 文件',properties:['openFile'],filters:[{name:'Markdown 文档',extensions:['md','markdown']}]});
    return result.canceled ? null : selectFile(result.filePaths[0]);
  });
  ipcMain.handle('render', async (_, options) => {
    if (busy || !selected) throw new Error(busy ? '正在处理，请稍候' : '请先选择 Markdown 文件');
    busy = true; rendered = null;
    try {
      const result = renderDocument(await fs.readFile(selected.path,'utf8'), selected.path, options);
      rendered = await loadDocument(result);
      return rendered;
    } finally { busy = false; }
  });
  ipcMain.handle('export', async () => {
    if (busy || !rendered) throw new Error('请先生成预览');
    busy = true;
    try {
      if (rendered.warnings.length || rendered.metrics.overflow > 2) {
        const answer = await dialog.showMessageBox(window,{type:'warning',title:'检查导出内容',message:'预览中有需要检查的内容',detail:rendered.warnings.join('\n') + (rendered.metrics.overflow > 2 ? '\n内容超过宽度，请调整版面。' : ''),buttons:['返回检查','继续导出'],defaultId:0,cancelId:0});
        if (answer.response === 0) return null;
      }
      const result = await dialog.showSaveDialog(window,{title:'保存连续单页 PDF',defaultPath:selected.path.replace(/\.(md|markdown)$/i,'-连续.pdf'),filters:[{name:'PDF 文档',extensions:['pdf']}]});
      if (result.canceled) return null;
      const output = result.filePath.toLowerCase().endsWith('.pdf') ? result.filePath : result.filePath+'.pdf';
      const stats = await exportPDF(documentWindow.webContents,output,selected.name.replace(/\.[^.]+$/,''));
      lastOutput = output; return stats;
    } finally { busy = false; }
  });
  ipcMain.handle('reveal', () => { if (lastOutput) shell.showItemInFolder(lastOutput); });
}

async function verify() {
  const root = path.resolve(__dirname,'../..');
  const out = path.resolve(__dirname,'../output');
  await fs.mkdir(out,{recursive:true});
  const reports = [];
  const inputs = (await fs.readdir(root)).filter(f=>f.endsWith('.md'));
  for (const filename of inputs) {
    const full = path.join(root,filename);
    const result = renderDocument(await fs.readFile(full,'utf8'),full);
    const loaded = await loadDocument(result);
    const output = path.join(out,filename.replace(/\.md$/,'-连续.pdf'));
    const metrics = await exportPDF(documentWindow.webContents,output,filename);
    reports.push({filename,images:result.images,headings:result.headings,warnings:result.warnings,...metrics});
    console.log(JSON.stringify(reports.at(-1)));
    // Render representative portions using the same engine, at readable scale.
    if (['第一章 理论基础.md','第二章 核心模块.md'].includes(filename)) {
      for (const [name,y] of [['top',0],['middle',Math.floor(metrics.height/2)],['bottom',Math.max(0,metrics.height-900)]]) {
        await documentWindow.webContents.executeJavaScript(`window.scrollTo(0,${y})`,true);
        const picture = await documentWindow.webContents.capturePage();
        await fs.writeFile(path.join(out,filename.replace('.md','')+'-'+name+'.png'),picture.toPNG());
      }
    }
  }
  // Exercise the UserUnit path with a document beyond Chromium's paper limit.
  const stress = renderDocument('# 超长文档检查\n\n'+Array.from({length:1200},(_,i)=>`段落 ${i+1}：连续排版测试，公式 $x^2+1$。\n\n`).join('')+'结束标记：END-1200',path.join(root,'stress.md'));
  await loadDocument(stress);
  reports.push({filename:'stress',...await exportPDF(documentWindow.webContents,path.join(out,'stress.pdf'),'超长验证')});
  await fs.writeFile(path.join(out,'verification.json'),JSON.stringify(reports,null,2));
  if (reports.some(r=>r.warnings?.length || r.pages!==1)) throw new Error('验证中存在渲染警告');
}

app.whenReady().then(async()=>{
  Menu.setApplicationMenu(null);
  if (verifyMode) {
    try {await verify();cleanup();app.exit(0);} catch(error){console.error(error);cleanup();app.exit(1);} return;
  }
  const file = process.argv.find(arg=>/\.(md|markdown)$/i.test(arg));
  if (file) await selectFile(path.resolve(file)).catch(()=>{});
  register();
  window = new BrowserWindow({show:!process.argv.includes('--ui-test'),width:1280,height:880,minWidth:980,minHeight:650,title:'Markdown 连续PDF',backgroundColor:'#f5f7fb',webPreferences:{preload:path.join(__dirname,'preload.js'),sandbox:true,contextIsolation:true,nodeIntegration:false}});
  secure(window);
  await window.loadFile(path.join(__dirname,'index.html'));
  window.on('closed',()=>app.quit());
});
app.on('before-quit',cleanup);
app.on('window-all-closed',()=>{if(!verifyMode && window?.isDestroyed()) app.quit();});
