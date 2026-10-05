const { app, BrowserWindow, ipcMain, dialog } = require('electron')
const path = require('path')
const fs = require('fs')
const yauzl = require('yauzl')

let win

const activeProcesses = {
  extract: false,
  compress: false,
  merge: false
}

async function scanInputs(inputs, fileMap = new Map(), baseDir = null) {
  const inputList = Array.isArray(inputs) ? inputs : [inputs]
  
  for (const inputPath of inputList) {
    try {
      const stats = await fs.promises.stat(inputPath)
      if (stats.isDirectory()) {
        const entries = await fs.promises.readdir(inputPath, { withFileTypes: true })
        const childPaths = entries.map(e => path.join(inputPath, e.name))
        await scanInputs(childPaths, fileMap, baseDir || inputPath)
      } else if (stats.isFile()) {
        const ext = path.extname(inputPath).toLowerCase()
        if (['.jpg', '.jpeg', '.png', '.webp', '.gif', '.tiff', '.tif', '.avif', '.bmp', '.heic', '.heif'].includes(ext)) {
          const baseName = path.parse(inputPath).name.toUpperCase()
          if (!fileMap.has(baseName)) {
            fileMap.set(baseName, [])
          }
          const relPath = baseDir ? path.relative(baseDir, inputPath) : path.basename(inputPath)
          fileMap.get(baseName).push({ fullPath: inputPath, relPath })
        }
      }
    } catch (e) {
      console.error(`Error scanning ${inputPath}:`, e)
    }
  }
  return fileMap
}

function createWindow() {
  const distPath = app.isPackaged ? path.join(app.getAppPath(), 'dist') : path.join(__dirname, '../dist')
  process.env.DIST = distPath

  win = new BrowserWindow({
    width: 1200,
    height: 800,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 15, y: 15 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  // Help diagnose if any load fails
  win.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    dialog.showErrorBox('Load Failure', `Failed to load: ${errorDescription} (${errorCode})\nURL: ${validatedURL}`);
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    // Standard relative path inside asar/dist-electron -> asar/dist
    const indexPath = path.join(__dirname, '..', 'dist', 'index.html')
    win.loadFile(indexPath).catch(err => {
      dialog.showErrorBox('File Load Error', `Could not load index.html from: ${indexPath}\nError: ${err.message}`);
    });
  }
}

app.whenReady().then(() => {
  // IPC Handlers
  ipcMain.handle('dialog:selectFolder', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      properties: ['openDirectory', 'createDirectory']
    })
    if (canceled) return null
    return filePaths[0]
  })

  ipcMain.handle('dialog:selectSource', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      properties: ['openFile', 'openDirectory', 'multiSelections'],
      filters: [
        { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'tiff', 'tif', 'avif', 'bmp', 'heic', 'heif'] }
      ]
    })
    if (canceled) return null
    return filePaths
  })

  ipcMain.handle('cancel:process', async (event, moduleName) => {
    activeProcesses[moduleName] = false
    console.log(`[CANCEL] Process ${moduleName} signal received.`)
    return { success: true }
  })

  ipcMain.handle('dialog:selectMergeSource', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      properties: ['openFile', 'openDirectory', 'multiSelections'],
      filters: [
        { name: 'ZIP Archives', extensions: ['zip'] }
      ]
    })
    if (canceled) return null
    return filePaths
  })

  ipcMain.handle('extract:start', async (event, { source, output, listText }) => {
    const fileNames = listText.split(/[\n,;]+/).map(s => s.trim().toUpperCase()).filter(s => s.length > 0)
    const fileMap = await scanInputs(source)
    
    let copiedCount = 0
    let totalTargets = fileNames.length
    const failedFiles = []

    activeProcesses.extract = true
    try {
      for (let i = 0; i < fileNames.length; i++) {
        if (!activeProcesses.extract) {
           win.webContents.send('extract:error', 'Process canceled by user')
           return { canceled: true }
        }
        const targetName = fileNames[i]
        const matches = fileMap.get(targetName)
        
        if (matches) {
          for (const fileObj of matches) {
             const { fullPath, relPath } = fileObj
             try {
                const dest = path.join(output, relPath)
                await fs.promises.mkdir(path.dirname(dest), { recursive: true })
                await fs.promises.copyFile(fullPath, dest)
                copiedCount++
             } catch (e) {
                failedFiles.push({ fileName: path.basename(fullPath), error: e.message })
             }
          }
        } else {
          failedFiles.push({ fileName: targetName, error: 'File name not found in source directory' })
        }
        win.webContents.send('extract:progress', { current: i + 1, total: totalTargets })
      }
      win.webContents.send('extract:complete', { copiedCount, failedFiles })
      return { success: true }
    } finally {
      activeProcesses.extract = false
    }
  })

  ipcMain.handle('compress:scan', async (event, source) => {
    const fileMap = await scanInputs(source)
    let count = 0
    let totalSize = 0
    for (const fileObjects of fileMap.values()) {
      for (const obj of fileObjects) {
        const s = await fs.promises.stat(obj.fullPath)
        totalSize += s.size
        count++
      }
    }
    return { count, totalSize }
  })

  ipcMain.handle('compress:start', async (event, { source, output, settings }) => {
    const sharp = require('sharp')
    const fileMap = await scanInputs(source)
    const allFiles = []
    for (const fileObjects of fileMap.values()) {
        allFiles.push(...fileObjects)
    }

    const numCores = require('os').cpus().length || 4
    const concurrency = Math.max(1, numCores - 1)
    console.log(`[COMPRESS] Starting multi-threaded compression with ${concurrency} parallel workers for ${allFiles.length} files.\nUsing high-quality mozjpeg.\n`)

    let processed = 0
    let failed = 0
    const failedFiles = []
    activeProcesses.compress = true

    const fileQueue = [...allFiles]

    async function worker() {
      while (fileQueue.length > 0 && activeProcesses.compress) {
        const fileObj = fileQueue.shift()
        if (!fileObj) break
        const { fullPath, relPath } = fileObj
        
        const fileName = path.basename(fullPath)
        try {
          const outPath = path.join(output, relPath)
          await fs.promises.mkdir(path.dirname(outPath), { recursive: true })

          let pipeline = sharp(fullPath).rotate()
          
          if (settings.axis === 'width') {
            pipeline = pipeline.resize({ width: settings.size })
          } else if (settings.axis === 'height') {
            pipeline = pipeline.resize({ height: settings.size })
          } else if (settings.axis === 'short') {
            pipeline = pipeline.resize(settings.size, settings.size, { fit: 'outside' })
          } else {
            pipeline = pipeline.resize(settings.size, settings.size, { fit: 'inside' })
          }

          // Preserve mozjpeg: true for maximum high-quality compression savings
          await pipeline.jpeg({ quality: settings.quality, mozjpeg: true }).toFile(outPath)
          processed++
        } catch (e) {
          failed++
          failedFiles.push({ fileName, error: e.message })
          console.error('Sharp error:', e)
          win.webContents.send('compress:progress', { message: `FAILED: ${fileName} - ${e.message}` })
        }
        
        win.webContents.send('compress:progress', { current: processed, total: allFiles.length })
      }
    }

    try {
      const workers = []
      for (let w = 0; w < concurrency; w++) {
        workers.push(worker())
      }
      await Promise.all(workers)

      if (!activeProcesses.compress) {
         win.webContents.send('compress:error', 'Process canceled by user')
         return { canceled: true }
      }

      win.webContents.send('compress:complete', { processed, total: allFiles.length, failed, failedFiles })
      return { success: true }
    } finally {
      activeProcesses.compress = false
    }
  })

  ipcMain.handle('merge:scan', async (event, source) => {
    try {
      const sourceList = Array.isArray(source) ? source : [source]
      const zipPaths = []
      for (const s of sourceList) {
          const stat = await fs.promises.stat(s)
          if (stat.isDirectory()) {
              const files = await fs.promises.readdir(s)
              zipPaths.push(...files.filter(f => f.toLowerCase().endsWith('.zip')).map(f => path.join(s, f)))
          } else if (s.toLowerCase().endsWith('.zip')) {
              zipPaths.push(s)
          }
      }
      
      // Natural sort
      zipPaths.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
      
      return { count: zipPaths.length, files: zipPaths }
    } catch (err) {
      console.error('Scan error:', err)
      throw err
    }
  })

  // Self-repair function to truncate trailing junk bytes added to ZIP files (e.g. from downloads, split-merges, etc.)
  async function fixZipIfHasExtraBytes(filePath) {
    let handle;
    try {
      handle = await fs.promises.open(filePath, 'r+');
      const stat = await handle.stat();
      const fileSize = stat.size;
      if (fileSize < 22) return; // Too small to be a zip
      
      const readLength = Math.min(fileSize, 65536 + 22);
      const buffer = Buffer.alloc(readLength);
      await handle.read(buffer, 0, readLength, fileSize - readLength);
      
      // Search backwards for the EOCD signature: 0x50, 0x4b, 0x05, 0x06
      let eocdOffset = -1;
      for (let i = readLength - 22; i >= 0; i--) {
        if (buffer[i] === 0x50 && buffer[i+1] === 0x4b && buffer[i+2] === 0x05 && buffer[i+3] === 0x06) {
          eocdOffset = i;
          break;
        }
      }
      
      if (eocdOffset === -1) {
        return;
      }
      
      const commentLength = buffer.readUInt16LE(eocdOffset + 20);
      const actualEocdOffsetInFile = fileSize - readLength + eocdOffset;
      const expectedFileSize = actualEocdOffsetInFile + 22 + commentLength;
      
      if (fileSize > expectedFileSize) {
        const extraBytes = fileSize - expectedFileSize;
        console.log(`[ZIP REPAIR] Found ${extraBytes} extra bytes at the end of ${path.basename(filePath)}. Truncating to ${expectedFileSize} bytes.`);
        await handle.truncate(expectedFileSize);
      }
    } catch (err) {
      console.error(`[ZIP REPAIR] Error inspecting/repairing ${path.basename(filePath)}:`, err);
    } finally {
      if (handle) await handle.close();
    }
  }

  // Helper for yauzl promisification
  function openZip(zipPath) {
    return new Promise((resolve, reject) => {
      yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
        if (err) reject(err);
        else resolve(zipfile);
      });
    });
  }

  ipcMain.handle('merge:start', async (event, { source, output, skipDuplicates, normalizeRoot }) => {
    try {
      const sourceList = Array.isArray(source) ? source : [source]
      const zipPaths = []
      for (const s of sourceList) {
          const stat = await fs.promises.stat(s)
          if (stat.isDirectory()) {
             const files = await fs.promises.readdir(s)
             zipPaths.push(...files.filter(f => f.toLowerCase().endsWith('.zip')).map(f => path.join(s, f)))
          } else if (s.toLowerCase().endsWith('.zip')) {
             zipPaths.push(s)
          }
      }

      // Natural sort
      zipPaths.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))

      if (zipPaths.length === 0) {
         win.webContents.send('merge:error', 'No ZIP files found.')
         return
      }

      await fs.promises.mkdir(output, { recursive: true })

      let totalExtracted = 0
      activeProcesses.merge = true
      for (let i = 0; i < zipPaths.length; i++) {
          if (!activeProcesses.merge) {
             throw new Error('Process canceled by user')
          }
          const zp = zipPaths[i]
        win.webContents.send('merge:progress', {
           message: `Extracting ZIP ${i + 1} / ${zipPaths.length}: ${path.basename(zp)} (${totalExtracted} total files)`,
           zipIndex: i, zipTotal: zipPaths.length, extracted: totalExtracted
        })
        
        await fixZipIfHasExtraBytes(zp)
        const zipfile = await openZip(zp)

        await new Promise((resolve, reject) => {
          zipfile.readEntry()
          
          zipfile.on('entry', async (entry) => {
            try {
              if (/\/$/.test(entry.fileName)) {
                zipfile.readEntry()
                return
              }

              let targetSubPath = entry.fileName
              if (normalizeRoot) {
                const parts = targetSubPath.split('/')
                if (parts.length > 1) {
                   parts.shift() // Remove top level folder e.g "Archive/"
                   targetSubPath = parts.join('/')
                }
              }

              let finalDestPath = path.join(output, targetSubPath)

              if (skipDuplicates) {
                 try {
                   await fs.promises.access(finalDestPath)
                   zipfile.readEntry() // File exists, skip
                   return
                 } catch (err) { /* does not exist, proceed */ }
              } else {
                 let suffix = 1
                 const ext = path.extname(finalDestPath)
                 const base = path.parse(finalDestPath).name
                 const dir = path.dirname(finalDestPath)
                 let checkPath = finalDestPath
                 while (true) {
                   try {
                     await fs.promises.access(checkPath)
                     checkPath = path.join(dir, `${base}(${suffix})${ext}`)
                     suffix++
                   } catch(e) { break } 
                 }
                 finalDestPath = checkPath
              }

              await fs.promises.mkdir(path.dirname(finalDestPath), { recursive: true })
              
              zipfile.openReadStream(entry, (err, readStream) => {
                 if (err) { reject(err); return; }
                 
                 const writeStream = fs.createWriteStream(finalDestPath)
                 
                 readStream.on('error', (rErr) => {
                    writeStream.destroy()
                    reject(rErr)
                 })
                 
                 writeStream.on('error', (wErr) => {
                    readStream.destroy()
                    reject(wErr)
                 })
                 
                 readStream.pipe(writeStream)
                 
                 writeStream.on('close', () => {
                    totalExtracted++
                    if (totalExtracted % 15 === 0) { // Throttle IPC
                      win.webContents.send('merge:progress', {
                        message: `Extracting ZIP ${i + 1} / ${zipPaths.length} (${totalExtracted} total files)`,
                        zipIndex: i, zipTotal: zipPaths.length, extracted: totalExtracted
                      })
                    }
                    zipfile.readEntry()
                 })
              })
            } catch (err) {
              reject(err)
            }
          })

          zipfile.on('end', () => resolve())
          zipfile.on('error', (zErr) => reject(zErr))
        })
      }
      win.webContents.send('merge:complete', { totalExtracted })
      return { success: true }
    } catch (err) {
      console.error('Merge error:', err)
      win.webContents.send('merge:error', err.message)
    } finally {
      activeProcesses.merge = false
    }
  })

  
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
