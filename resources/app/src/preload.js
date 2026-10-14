const {contextBridge, ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('desktop', {
  choose: () => ipcRenderer.invoke('choose'),
  render: options => ipcRenderer.invoke('render', options),
  export: () => ipcRenderer.invoke('export'),
  reveal: () => ipcRenderer.invoke('reveal'),
  initial: () => ipcRenderer.invoke('initial'),
  onFile: callback => ipcRenderer.on('file', (_, file) => callback(file))
});
