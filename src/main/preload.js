const { contextBridge, ipcRenderer } = require('electron');

const invoke = (ch) => (...a) => ipcRenderer.invoke(ch, ...a);

contextBridge.exposeInMainWorld('synapse', {
  settings: { get: invoke('settings:get'), set: invoke('settings:set') },
  key: { set: invoke('key:set'), test: invoke('key:test') },
  models: { list: invoke('models:list') },
  orKey: { set: invoke('orkey:set'), test: invoke('orkey:test') },
  orModels: invoke('ormodels:list'),
  catalog: { refresh: invoke('catalog:refresh'), onChanged: (fn) => ipcRenderer.on('catalog:changed', () => fn()) },
  cli: { detect: invoke('cli:detect'), login: invoke('cli:login') },
  chats: { list: invoke('chats:list'), get: invoke('chats:get'), save: invoke('chats:save'), remove: invoke('chats:delete') },
  task: {
    run: invoke('task:run'),
    cancel: invoke('task:cancel'),
    onEvent: (cb) => {
      const h = (_e, ev) => cb(ev);
      ipcRenderer.on('task:event', h);
      return () => ipcRenderer.removeListener('task:event', h);
    },
  },
  projects: { list: invoke('projects:list'), save: invoke('projects:save'), remove: invoke('projects:delete') },
  media: invoke('media:list'),
  recentFolders: invoke('folders:recent'),
  pickFolder: invoke('dialog:folder'),
  pickCli: invoke('dialog:cli'),
  net: { test: invoke('net:test') },
  limits: { codex: invoke('limits:codex') },
  fw: { status: invoke('fw:status'), apply: invoke('fw:apply'), remove: invoke('fw:remove') },
  memory: { get: invoke('memory:get'), set: invoke('memory:set'), openClaudeMd: invoke('memory:openClaudeMd') },
  tunnel: {
    status: invoke('tunnel:status'), test: invoke('tunnel:test'), pickKey: invoke('tunnel:pickKey'),
    onStatus: (fn) => ipcRenderer.on('tunnel:status', (_e, d) => fn(d)),
  },
  ws: {
    open: invoke('ws:open'), list: invoke('ws:list'), read: invoke('ws:read'),
    reveal: invoke('ws:reveal'), openExternal: invoke('ws:openExternal'),
    onChanged: (fn) => ipcRenderer.on('ws:changed', (_e, d) => fn(d)),
  },
  term: {
    start: invoke('term:start'), run: invoke('term:run'), kill: invoke('term:kill'),
    onEvent: (fn) => ipcRenderer.on('term:event', (_e, d) => fn(d)),
  },
  ext: {
    mcpList: invoke('ext:mcp:list'), mcpAdd: invoke('ext:mcp:add'), mcpToggle: invoke('ext:mcp:toggle'), mcpRemove: invoke('ext:mcp:remove'),
    mcpLogin: invoke('ext:mcp:login'), mcpTest: invoke('ext:mcp:test'), connectors: invoke('ext:connectors'),
    registry: invoke('ext:registry'), registrySpec: invoke('ext:registry:spec'),
    skills: invoke('ext:skills:list'), skillRead: invoke('ext:skills:read'), skillSave: invoke('ext:skills:save'),
    skillRemove: invoke('ext:skills:remove'), skillCopy: invoke('ext:skills:copy'), skillImport: invoke('ext:skills:import'),
    plugins: invoke('ext:plugins'), plugin: invoke('ext:plugin'), market: invoke('ext:market'), codexPlugin: invoke('ext:codexPlugin'),
  },
  arena: { roster: invoke('arena:roster'), apply: invoke('arena:apply'), files: invoke('arena:files'), open: invoke('arena:open') },
  open: invoke('shell:open'),
  openUrl: invoke('shell:url'),
  reveal: invoke('shell:reveal'),
  saveAs: invoke('file:saveAs'),
  usage: invoke('usage:read'),
  stats: invoke('stats:get'),
  changelog: invoke('changelog:get'),
  captureScreen: invoke('screen:capture'),
});
