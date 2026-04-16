const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  // Storage
  storageGet: () => ipcRenderer.invoke("storage-get"),
  storageSet: (value) => ipcRenderer.invoke("storage-set", value),
  storageSetSync: (value) => ipcRenderer.sendSync("storage-set-sync", value),
  // Encryption
  checkEncryption: () => ipcRenderer.invoke("check-encryption"),
  unlockMaster: (pw) => ipcRenderer.invoke("unlock-master", pw),
  enableEncryption: (pw, hint) => ipcRenderer.invoke("enable-encryption", pw, hint),
  disableEncryption: (pw) => ipcRenderer.invoke("disable-encryption", pw),
  changeMasterPassword: (oldPw, newPw) => ipcRenderer.invoke("change-master-password", oldPw, newPw),
  checkPasswordStrength: (pw) => ipcRenderer.invoke("check-password-strength", pw),
  lockApp: () => ipcRenderer.invoke("lock-app"),
  setHint: (hint) => ipcRenderer.invoke("set-hint", hint),
  // Notebook encryption
  encryptNotebookSections: (json, pw) => ipcRenderer.invoke("encrypt-notebook-sections", json, pw),
  decryptNotebookSections: (blob, pw) => ipcRenderer.invoke("decrypt-notebook-sections", blob, pw),
  reencryptNotebookSections: (json, nbKeyId) => ipcRenderer.invoke("reencrypt-notebook-sections", json, nbKeyId),
  forgetNotebookKey: (nbKeyId) => ipcRenderer.invoke("forget-notebook-key", nbKeyId),
  // Backup
  exportBackup: () => ipcRenderer.invoke("export-backup"),
  restoreBackup: () => ipcRenderer.invoke("restore-backup"),
  // Config
  getConfig: () => ipcRenderer.invoke("get-config"),
  setConfig: (key, value) => ipcRenderer.invoke("set-config", key, value),
  checkForUpdates: () => ipcRenderer.invoke("check-for-updates"),
  // Export / Print
  exportHTML: (title, html, isLocked) => ipcRenderer.invoke("export-html", title, html, !!isLocked),
  exportText: (title, text, isLocked) => ipcRenderer.invoke("export-text", title, text, !!isLocked),
  printWithWarning: (isLocked) => ipcRenderer.invoke("print-with-warning", isLocked),
  openDataFolder: () => ipcRenderer.invoke("open-data-folder"),
  // Menu
  onMenuAction: (cb) => {
    const handler = (_e, action) => cb(action);
    ipcRenderer.on("menu-action", handler);
    return () => ipcRenderer.removeListener("menu-action", handler);
  },
});
