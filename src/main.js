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
        let selectedMode = 'medium';
        compModes.forEach(r => { if (r.checked) selectedMode = r.value; });
        
        if (selectedMode === 'custom') customSettingsBlock.classList.remove('hidden');
        else customSettingsBlock.classList.add('hidden');

        if (currentScan.count === 0) {
            compressEstimationText.innerText = 'Estimated Content: Select valid images...';
            return;
        }
        
        let ratio = 0.12; // default medium
        
        if (selectedMode === 'high') ratio = 0.08;
        else if (selectedMode === 'medium') ratio = 0.12;
        else if (selectedMode === 'low') ratio = 0.30;
        else if (selectedMode === 'custom') {
            const qual = parseInt(customQual.value, 10) || 80;
            ratio = (qual / 100) * 0.25; 
        }

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
        let selectedMode = 'medium';
        compModes.forEach(r => { if (r.checked) selectedMode = r.value; });

        let settings = { axis: 'long', size: 2560, quality: 75 };
        if (selectedMode === 'high') settings = { axis: 'width', size: 1080, quality: 70 };
        else if (selectedMode === 'low') settings = { axis: 'long', size: 4000, quality: 90 };
        else if (selectedMode === 'custom') settings = { 
            axis: customResizeAxis.value, 
            size: parseInt(customSize.value, 10) || 2048, 
            quality: parseInt(customQual.value, 10) || 80 
        };

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

});



