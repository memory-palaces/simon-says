// Electron shell for Simon Says.
//
// Why: the File System Access API (real save-back-to-file) only exists in
// Chromium. Firefox/Safari users fall back to download-each-time. Electron bundles
// Chromium, so running the app here gives everyone a native window AND working save.
//
// Dev:   npm run electron:dev   (point at the Vite dev server on :5173)
// Build: npm run electron       (build to dist/, then open it offline)
const { app, BrowserWindow, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const DEV_URL = process.env.SIMON_DEV_URL;

function createWindow() {
  const win = new BrowserWindow({
    width: 1360,
    height: 860,
    backgroundColor: '#0a0a0b',
    title: 'Simon Says',
    autoHideMenuBar: true,
    webPreferences: {
      // The app is our own trusted code and needs no Node in the renderer; keep the
      // renderer sandboxed. The File System Access API works without node access.
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const distIndex = path.join(__dirname, '..', 'dist', 'index.html');
  if (DEV_URL) {
    win.loadURL(DEV_URL);
  } else if (fs.existsSync(distIndex)) {
    win.loadFile(distIndex);
  } else {
    win.loadURL(
      'data:text/html,' +
        encodeURIComponent('<h2 style="font-family:sans-serif;padding:2rem">Run <code>npm run build</code> first, or use <code>npm run electron:dev</code>.</h2>'),
    );
  }

  // Open any external links in the user's real browser, not inside the app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
