document.addEventListener('DOMContentLoaded', () => {
    const views = document.querySelectorAll('.view');
    const backButtons = document.querySelectorAll('.btn-back');
    
    function showView(targetId) {
        views.forEach(v => v.classList.remove('active'));
        document.getElementById(targetId).classList.add('active');
    }

    // --- Failed Files Log UI Helpers ---
    function showFailedFilesLog(containerId, failedFiles) {
        const container = document.getElementById(containerId);
        const existingLog = container.querySelector('.failed-files-log');
        if (existingLog) existingLog.remove();
        
        if (!failedFiles || failedFiles.length === 0) return;
        
        const logBox = document.createElement('div');
        logBox.className = 'failed-files-log';
        
        failedFiles.forEach(item => {
            const el = document.createElement('div');
            el.className = 'failed-file-item';
            el.innerHTML = `<strong>${item.fileName}</strong>: ${item.error}`;
            logBox.appendChild(el);
        });
        
        container.appendChild(logBox);
    }

    function clearFailedFilesLog(containerId) {
        const container = document.getElementById(containerId);
        const existingLog = container.querySelector('.failed-files-log');
        if (existingLog) existingLog.remove();
    }

    backButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetId = btn.getAttribute('data-target');
            showView(targetId);
        });
    });

    document.getElementById('btnOpenExtract').addEventListener('click', () => showView('extract'));
    document.getElementById('btnOpenCompress').addEventListener('click', () => showView('compress'));
    document.getElementById('btnOpenMerge').addEventListener('click', () => showView('merge'));
    document.getElementById('btnOpenPdf').addEventListener('click', () => showView('pdf'));

    // Stop stray drops (outside a drop zone) from navigating the window to the file
    document.addEventListener('dragover', (e) => e.preventDefault());
    document.addEventListener('drop', (e) => e.preventDefault());

    // --- Shared compression presets (Batch Compress + PDF) ---
    function getSelectedMode(radioName) {
        const checked = document.querySelector(`input[name="${radioName}"]:checked`);
        return checked ? checked.value : 'medium';
    }

    function getCompressionSettings(mode, axisEl, sizeEl, qualEl) {
        if (mode === 'high') return { axis: 'width', size: 1080, quality: 70 };
        if (mode === 'low') return { axis: 'long', size: 4000, quality: 90 };
        if (mode === 'custom') return {
            axis: axisEl.value,
            size: parseInt(sizeEl.value, 10) || 2048,
            quality: parseInt(qualEl.value, 10) || 80
        };
        return { axis: 'long', size: 2560, quality: 75 };
    }

    function getEstimateRatio(mode, qualEl) {
        if (mode === 'high') return 0.08;
        if (mode === 'low') return 0.30;
        if (mode === 'custom') return ((parseInt(qualEl.value, 10) || 80) / 100) * 0.25;
        return 0.12;
    }

    let extractSource = null;
    let compressSource = null;
    let mergeSource = null;

    function getSourceDisplay(src) {
        if (!src) return '';
        if (Array.isArray(src)) {
            if (src.length === 1) return src[0];
            return `${src.length} items selected`;
        }
        return src;
    }

    // --- Extract Module Logic ---
    const btnBrowseExtractSource = document.getElementById('btnBrowseExtractSource');
    const btnBrowseExtractOutput = document.getElementById('btnBrowseExtractOutput');
    const extractSourceInput = document.getElementById('extractSourceInput');
    const extractOutputInput = document.getElementById('extractOutputInput');
    const extractListInput = document.getElementById('extractListInput');
    const btnStartExtract = document.getElementById('btnStartExtract');

    const extractProgressContainer = document.getElementById('extractProgressContainer');
    const extractProgressFill = document.getElementById('extractProgressFill');
    const extractProgressText = document.getElementById('extractProgressText');

    function checkExtractReady() {
        if (extractSource && extractOutputInput.value && extractListInput.value.trim().length > 0) {
            btnStartExtract.disabled = false;
        } else {
            btnStartExtract.disabled = true;
        }
    }

    btnBrowseExtractSource.addEventListener('click', async () => {
        const result = await window.electronAPI.selectSource();
        if (result) {
            extractSource = result;
            extractSourceInput.value = getSourceDisplay(extractSource);
            checkExtractReady();
        }
    });

    btnBrowseExtractOutput.addEventListener('click', async () => {
        const folder = await window.electronAPI.selectFolder();
        if (folder) {
            extractOutputInput.value = folder;
            checkExtractReady();
        }
    });

    extractListInput.addEventListener('input', checkExtractReady);

    btnStartExtract.addEventListener('click', async () => {
        const data = {
            source: extractSource,
            output: extractOutputInput.value,
            listText: extractListInput.value
        };
        
        btnStartExtract.disabled = true;
        document.getElementById('btnCancelExtract').disabled = false;
        clearFailedFilesLog('extractProgressContainer');
        extractProgressContainer.classList.remove('hidden');
        extractProgressFill.style.width = '0%';
        extractProgressFill.style.background = 'var(--pink-primary)';
        extractProgressText.innerText = 'Initializing...';
        
        await window.electronAPI.extractFiles(data);
    });

    document.getElementById('btnCancelExtract').addEventListener('click', async () => {
        document.getElementById('btnCancelExtract').disabled = true;
        extractProgressText.innerText = 'Canceling...';
        await window.electronAPI.cancelProcess('extract');
    });

    window.electronAPI.onExtractProgress((data) => {
        if (data.init) {
            extractProgressText.innerText = data.message;
            return;
        }
        const percent = Math.round((data.current / data.total) * 100);
        extractProgressFill.style.width = `${percent}%`;
        extractProgressText.innerText = `${data.current} / ${data.total} files copied`;
    });

    window.electronAPI.onExtractComplete((result) => {
        btnStartExtract.disabled = false;
        const failedCount = result.failedFiles ? result.failedFiles.length : 0;
        
        if (failedCount > 0) {
            extractProgressText.innerText = `Complete with issues: ${result.copiedCount} success, ${failedCount} failed.`;
            extractProgressFill.style.background = '#f59e0b'; // warning orange
            showFailedFilesLog('extractProgressContainer', result.failedFiles);
        } else {
            extractProgressText.innerText = `Complete! All ${result.copiedCount} files copied.`;
            extractProgressFill.style.background = 'var(--pink-primary)';
            
            // Reset after 3 seconds to let user see status on pure success
            setTimeout(() => {
                extractSource = null;
                extractSourceInput.value = '';
                extractOutputInput.value = '';
                extractListInput.value = '';
                checkExtractReady();
                extractProgressContainer.classList.add('hidden');
            }, 3000);
        }
    });

    window.electronAPI.onExtractError((err) => {
        btnStartExtract.disabled = false;
        extractProgressText.innerText = `Error: ${err}`;
        extractProgressFill.style.background = '#ef4444'; // red error state
    });

    // --- Compress Module Logic ---
    const compressSourceInput = document.getElementById('compressSourceInput');
    const compressOutputInput = document.getElementById('compressOutputInput');
    const btnBrowseCompressSource = document.getElementById('btnBrowseCompressSource');
    const btnBrowseCompressOutput = document.getElementById('btnBrowseCompressOutput');
    const compressEstimationText = document.getElementById('compressEstimationText');
    const btnStartCompress = document.getElementById('btnStartCompress');

    const compModes = document.querySelectorAll('input[name="compMode"]');
    const customSettingsBlock = document.getElementById('customSettingsBlock');
    
    // Custom Inputs
    const customResizeAxis = document.getElementById('customResizeAxis');
    const customSize = document.getElementById('customSize');
    const customQual = document.getElementById('customQual');

    const compProgressContainer = document.getElementById('compProgressContainer');
    const compProgressFill = document.getElementById('compProgressFill');
    const compProgressText = document.getElementById('compProgressText');

    let currentScan = { count: 0, totalSize: 0, avgSize: 0 };

    function formatBytes(bytes, decimals = 2) {
        if (!+bytes) return '0 Bytes';
        const k = 1024, dm = decimals < 0 ? 0 : decimals, sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'], i = Math.floor(Math.log(bytes) / Math.log(k));
        return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
    }

    function calculateEstimation() {
        const selectedMode = getSelectedMode('compMode');

        if (selectedMode === 'custom') customSettingsBlock.classList.remove('hidden');
        else customSettingsBlock.classList.add('hidden');

        if (currentScan.count === 0) {
            compressEstimationText.innerText = 'Estimated Content: Select valid images...';
            return;
        }

        const ratio = getEstimateRatio(selectedMode, customQual);
        const estOut = currentScan.totalSize * ratio;
        compressEstimationText.innerText = `Content: ${currentScan.count} images (~${formatBytes(currentScan.totalSize)}). Est. Output: ~${formatBytes(estOut)}`;
    }

    function checkCompressReady() {
        calculateEstimation();
        if (compressSource && compressOutputInput.value && currentScan.count > 0) {
            btnStartCompress.disabled = false;
        } else {
            btnStartCompress.disabled = true;
        }
    }

    async function handleCompressScan() {
        if (!compressSource) return;
        compressEstimationText.innerText = 'Scanning...';
        try {
            currentScan = await window.electronAPI.scanCompressFolder(compressSource);
            checkCompressReady();
        } catch(e) {
            compressEstimationText.innerText = 'Error scanning content';
        }
    }

    compModes.forEach(r => r.addEventListener('change', checkCompressReady));
    customSize.addEventListener('input', checkCompressReady);
    customQual.addEventListener('input', checkCompressReady);

    btnBrowseCompressSource.addEventListener('click', async () => {
        const result = await window.electronAPI.selectSource();
        if (result) {
            compressSource = result;
            compressSourceInput.value = getSourceDisplay(compressSource);
            await handleCompressScan();
        }
    });

    btnBrowseCompressOutput.addEventListener('click', async () => {
        const folder = await window.electronAPI.selectFolder();
        if (folder) {
            compressOutputInput.value = folder;
            checkCompressReady();
        }
    });

    btnStartCompress.addEventListener('click', async () => {
        const settings = getCompressionSettings(getSelectedMode('compMode'), customResizeAxis, customSize, customQual);

        const data = {
            source: compressSource,
            output: compressOutputInput.value,
            settings
        };
        
        btnStartCompress.disabled = true;
        document.getElementById('btnCancelCompress').disabled = false;
        clearFailedFilesLog('compProgressContainer');
        compProgressContainer.classList.remove('hidden');
        compProgressFill.style.width = '0%';
        compProgressFill.style.background = 'var(--pink-primary)';
        compProgressText.innerText = 'Initializing...';
        
        await window.electronAPI.compressFiles(data);
    });

    document.getElementById('btnCancelCompress').addEventListener('click', async () => {
        document.getElementById('btnCancelCompress').disabled = true;
        compProgressText.innerText = 'Canceling...';
        await window.electronAPI.cancelProcess('compress');
    });

    window.electronAPI.onCompressProgress((data) => {
        if (data.message) {
            compProgressText.innerText = data.message;
            if (data.message.startsWith('FAILED')) {
                compProgressFill.style.background = '#ef4444';
            }
            return;
        }
        compProgressFill.style.background = 'var(--pink-primary)';
        const percent = Math.round((data.current / data.total) * 100);
        compProgressFill.style.width = `${percent}%`;
        compProgressText.innerText = `Processing: ${data.current} / ${data.total}`;
    });

    window.electronAPI.onCompressComplete((result) => {
        btnStartCompress.disabled = false;
        const failedCount = result.failedFiles ? result.failedFiles.length : 0;
        
        if (failedCount > 0) {
            compProgressText.innerText = `Complete with issues: ${result.processed} success, ${failedCount} failed.`;
            compProgressFill.style.background = '#f59e0b'; // amber warning
            showFailedFilesLog('compProgressContainer', result.failedFiles);
        } else {
            compProgressText.innerText = `Complete! All ${result.processed} images compressed.`;
            compProgressFill.style.background = 'var(--pink-primary)';
            
            // Reset after 3 seconds on success
            setTimeout(() => {
                compressSource = null;
                compressSourceInput.value = '';
                compressOutputInput.value = '';
                currentScan = { count: 0, totalSize: 0, avgSize: 0 };
                checkCompressReady();
                compProgressContainer.classList.add('hidden');
            }, 3000);
        }
    });

    window.electronAPI.onCompressError((err) => {
        btnStartCompress.disabled = false;
        compProgressText.innerText = `Error: ${err}`;
        compProgressFill.style.background = '#ef4444'; // red error state
    });

    // --- Merge Module Logic ---
    const mergeSourceInput = document.getElementById('mergeSourceInput');
    const mergeOutputInput = document.getElementById('mergeOutputInput');
    const btnBrowseMergeSource = document.getElementById('btnBrowseMergeSource');
    const btnBrowseMergeOutput = document.getElementById('btnBrowseMergeOutput');
    const mergeEstimationText = document.getElementById('mergeEstimationText');
    const btnStartMerge = document.getElementById('btnStartMerge');
    
    const mergeSkipDuplicates = document.getElementById('mergeSkipDuplicates');
    const mergeNormalizeRoot = document.getElementById('mergeNormalizeRoot');

    const mergeProgressContainer = document.getElementById('mergeProgressContainer');
    const mergeProgressFill = document.getElementById('mergeProgressFill');
    const mergeProgressText = document.getElementById('mergeProgressText');

    let currentMergeScan = { count: 0, files: [] };

    function checkMergeReady() {
        if (mergeSource && mergeOutputInput.value && currentMergeScan.count > 0) {
            btnStartMerge.disabled = false;
        } else {
            btnStartMerge.disabled = true;
        }
    }

    async function handleMergeScan() {
        if (!mergeSource) return;
        mergeEstimationText.innerText = 'Scanning...';
        try {
            currentMergeScan = await window.electronAPI.scanMergeFolder(mergeSource);
            mergeEstimationText.innerText = `Found: ${currentMergeScan.count} zip-related items`;
            checkMergeReady();
        } catch(e) {
            mergeEstimationText.innerText = 'Error scanning content';
        }
    }

    btnBrowseMergeSource.addEventListener('click', async () => {
        const result = await window.electronAPI.selectMergeSource();
        if (result) {
            mergeSource = result;
            mergeSourceInput.value = getSourceDisplay(mergeSource);
            await handleMergeScan();
        }
    });

    btnBrowseMergeOutput.addEventListener('click', async () => {
        const folder = await window.electronAPI.selectFolder();
        if (folder) {
            mergeOutputInput.value = folder;
            checkMergeReady();
        }
    });

    btnStartMerge.addEventListener('click', async () => {
        const data = {
            source: mergeSource,
            output: mergeOutputInput.value,
            skipDuplicates: mergeSkipDuplicates.checked,
            normalizeRoot: mergeNormalizeRoot.checked
        };
        
        btnStartMerge.disabled = true;
        document.getElementById('btnCancelMerge').disabled = false;
        mergeProgressContainer.classList.remove('hidden');
        mergeProgressFill.style.width = '0%';
        mergeProgressFill.style.background = 'var(--pink-primary)';
        mergeProgressText.innerText = 'Initializing...';
        
        try {
            await window.electronAPI.mergeFiles(data);
        } catch (err) {
            console.error('Merge click handler error:', err);
            btnStartMerge.disabled = false;
            mergeProgressText.innerText = `Error: ${err.message || err}`;
            mergeProgressFill.style.background = '#ef4444'; // red error state
        }
    });

    document.getElementById('btnCancelMerge').addEventListener('click', async () => {
        document.getElementById('btnCancelMerge').disabled = true;
        mergeProgressText.innerText = 'Canceling...';
        await window.electronAPI.cancelProcess('merge');
    });

    window.electronAPI.onMergeProgress((data) => {
        if (data.message) {
            mergeProgressText.innerText = data.message;
        }
        if (data.zipTotal) {
            const percent = Math.round((data.zipIndex / data.zipTotal) * 100);
            mergeProgressFill.style.width = `${percent}%`;
        }
    });

    window.electronAPI.onMergeComplete((result) => {
        btnStartMerge.disabled = false;
        mergeProgressFill.style.width = `100%`;
        mergeProgressText.innerText = `Complete! Processed ${result.totalExtracted || 0} files.`;
        
        // Reset after 3 seconds
        setTimeout(() => {
            mergeSource = null;
            mergeSourceInput.value = '';
            mergeOutputInput.value = '';
            mergeProgressContainer.classList.add('hidden');
            checkMergeReady();
        }, 3000);
    });

    window.electronAPI.onMergeError((err) => {
        btnStartMerge.disabled = false;
        mergeProgressText.innerText = `Error: ${err}`;
        mergeProgressFill.style.background = '#ef4444'; // red error state
    });

    // --- PDF Presentation Module Logic ---
    const pdfPageGrid = document.getElementById('pdfPageGrid');
    const pdfPageGridEmpty = document.getElementById('pdfPageGridEmpty');
    const pdfEstimationText = document.getElementById('pdfEstimationText');
    const pdfOutputInput = document.getElementById('pdfOutputInput');
    const btnAddPdfPhotos = document.getElementById('btnAddPdfPhotos');
    const btnSortPdfPhotos = document.getElementById('btnSortPdfPhotos');
    const btnClearPdfPhotos = document.getElementById('btnClearPdfPhotos');
    const btnBrowsePdfOutput = document.getElementById('btnBrowsePdfOutput');
    const btnStartPdf = document.getElementById('btnStartPdf');
    const btnCancelPdf = document.getElementById('btnCancelPdf');
    const btnShowPdf = document.getElementById('btnShowPdf');

    const pdfModes = document.querySelectorAll('input[name="pdfMode"]');
    const pdfCustomSettingsBlock = document.getElementById('pdfCustomSettingsBlock');
    const pdfCustomResizeAxis = document.getElementById('pdfCustomResizeAxis');
    const pdfCustomSize = document.getElementById('pdfCustomSize');
    const pdfCustomQual = document.getElementById('pdfCustomQual');

    const pdfProgressContainer = document.getElementById('pdfProgressContainer');
    const pdfProgressFill = document.getElementById('pdfProgressFill');
    const pdfProgressText = document.getElementById('pdfProgressText');

    let pdfPages = []; // [{ id, path, name, size, thumb }] in page order
    let nextPdfPageId = 1;
    let pdfOutputPath = null;
    let draggedPageId = null;
    let dropTarget = null; // { id, after }

    function updatePdfSummary() {
        const selectedMode = getSelectedMode('pdfMode');
        if (selectedMode === 'custom') pdfCustomSettingsBlock.classList.remove('hidden');
        else pdfCustomSettingsBlock.classList.add('hidden');

        const hasPages = pdfPages.length > 0;
        btnSortPdfPhotos.disabled = pdfPages.length < 2;
        btnClearPdfPhotos.disabled = !hasPages;
        btnStartPdf.disabled = !(hasPages && pdfOutputPath);

        if (!hasPages) {
            pdfEstimationText.innerText = 'Add photos, then drag to set the page order.';
            return;
        }
        const totalSize = pdfPages.reduce((sum, p) => sum + p.size, 0);
        const estOut = totalSize * getEstimateRatio(selectedMode, pdfCustomQual);
        const label = pdfPages.length === 1 ? 'page' : 'pages';
        pdfEstimationText.innerText = `${pdfPages.length} ${label} (~${formatBytes(totalSize)}). Est. PDF: ~${formatBytes(estOut)}. Drag to reorder.`;
    }

    function setThumb(thumbEl, page) {
        thumbEl.innerHTML = '';
        if (page.thumb) {
            const img = document.createElement('img');
            img.src = page.thumb;
            img.alt = '';
            thumbEl.appendChild(img);
        } else {
            thumbEl.innerText = page.thumb === false ? 'No preview' : '';
        }
    }

    function renderPdfPages() {
        pdfPageGrid.querySelectorAll('.page-tile').forEach(t => t.remove());
        pdfPageGridEmpty.classList.toggle('hidden', pdfPages.length > 0);

        pdfPages.forEach((page, index) => {
            const tile = document.createElement('div');
            tile.className = 'page-tile';
            tile.draggable = true;
            tile.dataset.id = page.id;
            tile.title = page.path;

            const thumb = document.createElement('div');
            thumb.className = 'page-thumb';
            setThumb(thumb, page);

            const number = document.createElement('span');
            number.className = 'page-number';
            number.innerText = index + 1;

            const remove = document.createElement('button');
            remove.className = 'page-remove';
            remove.title = 'Remove page';
            remove.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>';
            remove.addEventListener('click', (e) => {
                e.stopPropagation();
                pdfPages = pdfPages.filter(p => p.id !== page.id);
                renderPdfPages();
            });

            const name = document.createElement('div');
            name.className = 'page-name';
            name.innerText = page.name;

            tile.append(thumb, number, remove, name);

            tile.addEventListener('dragstart', (e) => {
                draggedPageId = page.id;
                tile.classList.add('dragging');
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', String(page.id));
            });
            tile.addEventListener('dragend', () => {
                draggedPageId = null;
                clearDropIndicator();
                tile.classList.remove('dragging');
            });

            pdfPageGrid.appendChild(tile);
        });

        updatePdfSummary();
    }

    // Load thumbnails a few at a time so large folders don't stall the main process
    let thumbsInFlight = 0;
    function loadPdfThumbs() {
        while (thumbsInFlight < 4) {
            const page = pdfPages.find(p => p.thumb === undefined);
            if (!page) return;
            page.thumb = null; // loading
            thumbsInFlight++;
            window.electronAPI.getThumbnail(page.path).then((dataUrl) => {
                page.thumb = dataUrl || false;
                const thumbEl = pdfPageGrid.querySelector(`.page-tile[data-id="${page.id}"] .page-thumb`);
                if (thumbEl) setThumb(thumbEl, page);
            }).finally(() => {
                thumbsInFlight--;
                loadPdfThumbs();
            });
        }
    }

    async function addPdfSources(sources) {
        if (!sources || sources.length === 0) return;
        pdfEstimationText.innerText = 'Scanning...';
        try {
            const files = await window.electronAPI.scanPdfSources(sources);
            const existing = new Set(pdfPages.map(p => p.path));
            files.filter(f => !existing.has(f.path)).forEach(f => {
                pdfPages.push({ id: nextPdfPageId++, path: f.path, name: f.name, size: f.size, thumb: undefined });
            });
            renderPdfPages();
            loadPdfThumbs();
        } catch (e) {
            pdfEstimationText.innerText = 'Error scanning content';
        }
    }

    function clearDropIndicator() {
        pdfPageGrid.querySelectorAll('.drop-before, .drop-after').forEach(t => t.classList.remove('drop-before', 'drop-after'));
        dropTarget = null;
    }

    pdfPageGrid.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (draggedPageId !== null) {
            e.dataTransfer.dropEffect = 'move';
            // Over a gap between tiles: keep the last indicator so the drop still lands there
            const tile = e.target.closest('.page-tile');
            if (!tile) return;
            clearDropIndicator();
            if (Number(tile.dataset.id) !== draggedPageId) {
                const rect = tile.getBoundingClientRect();
                const after = e.clientX > rect.left + rect.width / 2;
                tile.classList.add(after ? 'drop-after' : 'drop-before');
                dropTarget = { id: Number(tile.dataset.id), after };
            }
        } else if (e.dataTransfer.types.includes('Files')) {
            e.dataTransfer.dropEffect = 'copy';
            pdfPageGrid.classList.add('drop-active');
        }
    });

    pdfPageGrid.addEventListener('dragleave', (e) => {
        if (!pdfPageGrid.contains(e.relatedTarget)) {
            pdfPageGrid.classList.remove('drop-active');
            clearDropIndicator();
        }
    });

    pdfPageGrid.addEventListener('drop', async (e) => {
        e.preventDefault();
        pdfPageGrid.classList.remove('drop-active');

        if (draggedPageId !== null) {
            const target = dropTarget;
            const fromIndex = pdfPages.findIndex(p => p.id === draggedPageId);
            clearDropIndicator();
            if (fromIndex === -1 || !target) return; // dropped on itself
            const [moved] = pdfPages.splice(fromIndex, 1);
            const toIndex = pdfPages.findIndex(p => p.id === target.id) + (target.after ? 1 : 0);
            pdfPages.splice(toIndex, 0, moved);
            renderPdfPages();
            return;
        }

        const paths = [...e.dataTransfer.files].map(f => window.electronAPI.getPathForFile(f)).filter(Boolean);
        await addPdfSources(paths);
    });

    btnAddPdfPhotos.addEventListener('click', async () => {
        const result = await window.electronAPI.selectSource();
        if (result) await addPdfSources(result);
    });

    btnSortPdfPhotos.addEventListener('click', () => {
        pdfPages.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
        renderPdfPages();
    });

    btnClearPdfPhotos.addEventListener('click', () => {
        pdfPages = [];
        renderPdfPages();
    });

    btnBrowsePdfOutput.addEventListener('click', async () => {
        const filePath = await window.electronAPI.selectPdfOutput();
        if (filePath) {
            pdfOutputPath = filePath;
            pdfOutputInput.value = filePath;
            updatePdfSummary();
        }
    });

    pdfModes.forEach(r => r.addEventListener('change', updatePdfSummary));
    pdfCustomSize.addEventListener('input', updatePdfSummary);
    pdfCustomQual.addEventListener('input', updatePdfSummary);

    btnStartPdf.addEventListener('click', async () => {
        const settings = getCompressionSettings(getSelectedMode('pdfMode'), pdfCustomResizeAxis, pdfCustomSize, pdfCustomQual);
        const data = {
            files: pdfPages.map(p => p.path),
            output: pdfOutputPath,
            settings
        };

        btnStartPdf.disabled = true;
        btnCancelPdf.disabled = false;
        btnCancelPdf.classList.remove('hidden');
        btnShowPdf.classList.add('hidden');
        clearFailedFilesLog('pdfProgressContainer');
        pdfProgressContainer.classList.remove('hidden');
        pdfProgressFill.style.width = '0%';
        pdfProgressFill.style.background = 'var(--pink-primary)';
        pdfProgressText.innerText = 'Initializing...';

        await window.electronAPI.exportPdf(data);
    });

    btnCancelPdf.addEventListener('click', async () => {
        btnCancelPdf.disabled = true;
        pdfProgressText.innerText = 'Canceling...';
        await window.electronAPI.cancelProcess('pdf');
    });

    btnShowPdf.addEventListener('click', () => {
        if (pdfOutputPath) window.electronAPI.showItemInFolder(pdfOutputPath);
    });

    window.electronAPI.onPdfProgress((data) => {
        const percent = Math.round((data.current / data.total) * 100);
        pdfProgressFill.style.width = `${percent}%`;
        pdfProgressText.innerText = `Building page ${data.current} / ${data.total}`;
    });

    window.electronAPI.onPdfComplete((result) => {
        updatePdfSummary();
        btnCancelPdf.classList.add('hidden');
        const failedCount = result.failedFiles ? result.failedFiles.length : 0;
        const fileName = pdfOutputPath ? pdfOutputPath.split(/[\\/]/).pop() : 'PDF';
        pdfProgressFill.style.width = '100%';

        if (result.pages === 0) {
            pdfProgressText.innerText = 'No pages could be processed. PDF was not created.';
            pdfProgressFill.style.background = '#ef4444';
        } else if (failedCount > 0) {
            pdfProgressText.innerText = `Saved ${fileName} with issues: ${result.pages} pages, ${failedCount} skipped.`;
            pdfProgressFill.style.background = '#f59e0b'; // amber warning
            btnShowPdf.classList.remove('hidden');
        } else {
            pdfProgressText.innerText = `Complete! ${result.pages} pages saved to ${fileName}.`;
            pdfProgressFill.style.background = 'var(--pink-primary)';
            btnShowPdf.classList.remove('hidden');
        }
        showFailedFilesLog('pdfProgressContainer', result.failedFiles);
    });

    window.electronAPI.onPdfError((err) => {
        updatePdfSummary();
        btnCancelPdf.classList.add('hidden');
        pdfProgressText.innerText = `Error: ${err}`;
        pdfProgressFill.style.background = '#ef4444'; // red error state
    });

});



