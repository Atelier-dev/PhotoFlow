import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import path from 'path'
import fs from 'fs'
import yauzl from 'yauzl'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
process.env.DIST = path.join(__dirname, '../dist')
process.env.VITE_PUBLIC = app.isPackaged ? process.env.DIST : path.join(process.env.DIST, '../public')

let win;

// Helper: Recursive directory search
async function scanDirectory(dir, fileMap = new Map()) {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  for (let entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await scanDirectory(fullPath, fileMap);
    } else if (entry.isFile() && entry.name.toUpperCase().endsWith('.JPG')) {
      const baseName = path.parse(entry.name).name.toUpperCase();
      if (!fileMap.has(baseName)) {
        fileMap.set(baseName, []);
      }
      fileMap.get(baseName).push(fullPath);
    }
  }
  return fileMap;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1000,
    height: 800,
    webPreferences: {
      preload: path.join(app.getAppPath(), 'dist-electron', 'preload.js'),
    },
    // Dark mode aesthetic base
    backgroundColor: '#0f172a',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0f172a',
      symbolColor: '#74b9ff'
    }
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    // Rigidly loads dist index inside production ASAR bundles
    win.loadFile(path.join(app.getAppPath(), 'dist', 'index.html'))
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.whenReady().then(() => {
  ipcMain.handle('dialog:selectFolder', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      properties: ['openDirectory']
    })
    if (canceled) return null
    return filePaths[0]
  })

  ipcMain.handle('extract:start', async (event, data) => {
    const { source, output, listText } = data;
    try {
      event.sender.send('extract:progress', { current: 0, total: 1, init: true, message: 'Scanning files...' });
      
      const rawNames = listText.split(/[,\s\n]+/).filter(Boolean);
      const targetNames = rawNames.map(name => {
        let n = name.toUpperCase();
        if (n.endsWith('.JPG')) n = n.slice(0, -4);
        return n;
      });

      const fileMap = await scanDirectory(source);
      let matchedPaths = [];
      for (const name of targetNames) {
        if (fileMap.has(name)) {
          matchedPaths.push(...fileMap.get(name));
        }
      }

      let copiedCount = 0;
      const total = matchedPaths.length;
      if (total === 0) {
         event.sender.send('extract:error', 'No matching .JPG files found.');
         return;
      }

      await fs.promises.mkdir(output, { recursive: true });

      for (const srcPath of matchedPaths) {
        const relPath = path.relative(source, srcPath);
        const destPath = path.join(output, relPath);
        
        await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
        await fs.promises.copyFile(srcPath, destPath);
        
        copiedCount++;
        event.sender.send('extract:progress', { current: copiedCount, total, init: false });
      }

      event.sender.send('extract:complete', { success: true, copiedCount, total });
    } catch (err) {
      console.error(err);
      event.sender.send('extract:error', err.message);
    }
  })

  ipcMain.handle('compress:scan', async (event, source) => {
    try {
      const fileMap = await scanDirectory(source);
      let totalSize = 0;
      let count = 0;
      for (const [basename, paths] of fileMap.entries()) {
        for (const p of paths) {
          const stats = await fs.promises.stat(p);
          totalSize += stats.size;
          count++;
        }
      }
      return { count, avgSize: count > 0 ? totalSize / count : 0, totalSize };
    } catch (err) {
      console.error(err);
      throw err;
    }
  });

  ipcMain.handle('compress:start', async (event, data) => {
    const { source, output, settings } = data;
    try {
      event.sender.send('compress:progress', { current: 0, total: 1, message: 'Mapping files...' });
      const fileMap = await scanDirectory(source);
      let matchedPaths = [];
      for (const [basename, paths] of fileMap.entries()) {
        matchedPaths.push(...paths);
      }
      
      const total = matchedPaths.length;
      if (total === 0) {
        event.sender.send('compress:error', 'No .JPG files found to compress.');
        return;
      }
      
      await fs.promises.mkdir(output, { recursive: true });
      
      const sharp = (await import('sharp')).default;
      let processed = 0;

      for (const srcPath of matchedPaths) {
         const relPath = path.relative(source, srcPath);
         const destPath = path.join(output, relPath);
         await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
         
         const sharpInstance = sharp(srcPath);
         const metadata = await sharpInstance.metadata();
         const isLandscape = (metadata.width || 0) >= (metadata.height || 0);

         let resizeOpts = { withoutEnlargement: true, fit: 'inside' };
         if (settings.axis === 'width') resizeOpts.width = settings.size;
         else if (settings.axis === 'long') {
           if (isLandscape) resizeOpts.width = settings.size; else resizeOpts.height = settings.size;
         } else if (settings.axis === 'short') {
           if (isLandscape) resizeOpts.height = settings.size; else resizeOpts.width = settings.size;
         }

         await sharpInstance
            .resize(resizeOpts)
            .jpeg({ quality: settings.quality, mozjpeg: true })
            .toFile(destPath);
            
         processed++;
         event.sender.send('compress:progress', { current: processed, total });
      }

      event.sender.send('compress:complete', { success: true, processed, total });
    } catch (err) {
      console.error(err);
      event.sender.send('compress:error', err.message);
    }
  });

  // Helper for yauzl promisification
  function openZip(zipPath) {
    return new Promise((resolve, reject) => {
      yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
        if (err) reject(err);
        else resolve(zipfile);
      });
    });
  }

  ipcMain.handle('merge:scan', async (event, source) => {
    try {
      const entries = await fs.promises.readdir(source, { withFileTypes: true });
      let zipFiles = entries.filter(e => e.isFile() && e.name.toLowerCase().endsWith('.zip')).map(e => e.name);
      
      // Natural sort: Archive.zip, Archive(1).zip
      zipFiles.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
      
      return { count: zipFiles.length, files: zipFiles };
    } catch (err) {
      console.error(err);
      throw err;
    }
  });

  ipcMain.handle('merge:start', async (event, data) => {
    const { source, output, skipDuplicates, normalizeRoot } = data;
    try {
      let entries = await fs.promises.readdir(source, { withFileTypes: true });
      let zipFiles = entries.filter(e => e.isFile() && e.name.toLowerCase().endsWith('.zip')).map(e => e.name);
      zipFiles.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

      if (zipFiles.length === 0) {
        event.sender.send('merge:error', 'No ZIP files found.');
        return;
      }

      await fs.promises.mkdir(output, { recursive: true });

      let zipIndex = 0;
      let totalExtracted = 0;

      for (const zipName of zipFiles) {
        zipIndex++;
        const zipPath = path.join(source, zipName);
        event.sender.send('merge:progress', { 
           message: `Extracting ZIP ${zipIndex} / ${zipFiles.length}: ${zipName}`,
           zipIndex, zipTotal: zipFiles.length, extracted: totalExtracted
        });

        const zipfile = await openZip(zipPath);

        await new Promise((resolve, reject) => {
          zipfile.readEntry();
          zipfile.on("entry", async (entry) => {
            if (/\/$/.test(entry.fileName)) {
               zipfile.readEntry(); // Skip directory entries, we auto mkDirs based on file paths
               return;
            }

            let extractPath = entry.fileName;
            if (normalizeRoot) {
               const parts = extractPath.split('/');
               if (parts.length > 1) {
                  parts.shift(); // Remove top level folder e.g "Archive/"
                  extractPath = parts.join('/');
               }
            }

            let finalDestPath = path.join(output, extractPath);

            try {
              if (skipDuplicates) {
                 try {
                   await fs.promises.access(finalDestPath);
                   zipfile.readEntry(); // File exists, skip
                   return;
                 } catch (err) { /* does not exist, proceed */ }
              } else {
                 let suffix = 1;
                 const ext = path.extname(finalDestPath);
                 const base = path.parse(finalDestPath).name;
                 const dir = path.dirname(finalDestPath);
                 let checkPath = finalDestPath;
                 while(true) {
                   try {
                     await fs.promises.access(checkPath);
                     checkPath = path.join(dir, `${base}(${suffix})${ext}`);
                     suffix++;
                   } catch(e) { break; } 
                 }
                 finalDestPath = checkPath;
              }

              await fs.promises.mkdir(path.dirname(finalDestPath), { recursive: true });

              zipfile.openReadStream(entry, (err, readStream) => {
                if (err) { reject(err); return; }
                const writeStream = fs.createWriteStream(finalDestPath);
                readStream.pipe(writeStream);
                writeStream.on("close", () => {
                   totalExtracted++;
                   if (totalExtracted % 15 === 0) { // Throttle IPC
                     event.sender.send('merge:progress', {
                       message: `Extracting ZIP ${zipIndex} / ${zipFiles.length} (${totalExtracted} total files)`,
                       zipIndex, zipTotal: zipFiles.length, extracted: totalExtracted
                     });
                   }
                   zipfile.readEntry();
                });
                writeStream.on("error", reject);
              });
            } catch (err) {
              reject(err);
            }
          });
          zipfile.on("end", resolve);
          zipfile.on("error", reject);
        });
      }

      event.sender.send('merge:complete', { success: true, totalExtracted });
    } catch (err) {
       console.error(err);
       event.sender.send('merge:error', err.message);
    }
  });

  createWindow()
})
