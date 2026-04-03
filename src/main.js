document.addEventListener('DOMContentLoaded', () => {
    const tabs = document.querySelectorAll('.tab');
    const views = document.querySelectorAll('.view');
    
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            views.forEach(v => v.classList.remove('active'));
            
            tab.classList.add('active');
            const targetId = tab.getAttribute('data-target');
            document.getElementById(targetId).classList.add('active');
        });
    });

    // --- Extract Module Logic ---
    const btnBrowseSource = document.getElementById('btnBrowseExtractSource');
    const btnBrowseOutput = document.getElementById('btnBrowseExtractOutput');
    const extractSourceInput = document.getElementById('extractSourceInput');
    const extractOutputInput = document.getElementById('extractOutputInput');
    const extractListInput = document.getElementById('extractListInput');
    const btnStartExtract = document.getElementById('btnStartExtract');

    const extractProgressContainer = document.getElementById('extractProgressContainer');
    const extractProgressFill = document.getElementById('extractProgressFill');
    const extractProgressText = document.getElementById('extractProgressText');

    function checkExtractReady() {
        if (extractSourceInput.value && extractOutputInput.value && extractListInput.value.trim().length > 0) {
            btnStartExtract.disabled = false;
        } else {
            btnStartExtract.disabled = true;
        }
    }

    btnBrowseSource.addEventListener('click', async () => {
        const folder = await window.electronAPI.selectFolder();
        if (folder) {
            extractSourceInput.value = folder;
            checkExtractReady();
        }
    });

    btnBrowseOutput.addEventListener('click', async () => {
        const folder = await window.electronAPI.selectFolder();
        if (folder) {
            extractOutputInput.value = folder;
            checkExtractReady();
        }
    });

    extractListInput.addEventListener('input', checkExtractReady);

    btnStartExtract.addEventListener('click', async () => {
        const data = {
            source: extractSourceInput.value,
            output: extractOutputInput.value,
            listText: extractListInput.value
        };
        
        btnStartExtract.disabled = true;
        extractProgressContainer.classList.remove('hidden');
        extractProgressFill.style.width = '0%';
        extractProgressFill.style.background = 'linear-gradient(90deg, #3b82f6, #60a5fa)';
        extractProgressText.innerText = 'Initializing...';
        
        await window.electronAPI.extractFiles(data);
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
        extractProgressText.innerText = `Complete! ${result.copiedCount} copied.`;
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
    const valSize = document.getElementById('valSize');
    const valQual = document.getElementById('valQual');

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
        if (currentScan.count === 0) {
            compressEstimationText.innerText = 'Estimated Content: Select a folder...';
            return;
        }
        
        let ratio = 0.12; // default medium
        let selectedMode = 'medium';
        compModes.forEach(r => { if (r.checked) selectedMode = r.value; });
        
        if (selectedMode === 'custom') customSettingsBlock.classList.remove('hidden');
        else customSettingsBlock.classList.add('hidden');

        if (selectedMode === 'high') ratio = 0.08;
        else if (selectedMode === 'medium') ratio = 0.12;
        else if (selectedMode === 'low') ratio = 0.30;
        else if (selectedMode === 'custom') {
            const qual = parseInt(customQual.value, 10);
            ratio = (qual / 100) * 0.25; // heuristic ratio
        }

        const estOut = currentScan.totalSize * ratio;
        compressEstimationText.innerText = `Content: ${currentScan.count} images (~${formatBytes(currentScan.totalSize)}). Estimated Output: ~${formatBytes(estOut)}`;
    }

    function checkCompressReady() {
        calculateEstimation();
        if (compressSourceInput.value && compressOutputInput.value && currentScan.count > 0) {
            btnStartCompress.disabled = false;
        } else {
            btnStartCompress.disabled = true;
        }
    }

    compModes.forEach(r => r.addEventListener('change', checkCompressReady));
    customSize.addEventListener('input', (e) => { valSize.innerText = e.target.value; calculateEstimation(); });
    customQual.addEventListener('input', (e) => { valQual.innerText = e.target.value; calculateEstimation(); });

    btnBrowseCompressSource.addEventListener('click', async () => {
        const folder = await window.electronAPI.selectFolder();
        if (folder) {
            compressSourceInput.value = folder;
            compressEstimationText.innerText = 'Scanning...';
            try {
                currentScan = await window.electronAPI.scanCompressFolder(folder);
                checkCompressReady();
            } catch(e) {
                compressEstimationText.innerText = 'Error scanning folder';
            }
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
        else if (selectedMode === 'custom') settings = { axis: customResizeAxis.value, size: parseInt(customSize.value, 10), quality: parseInt(customQual.value, 10) };

        const data = {
            source: compressSourceInput.value,
            output: compressOutputInput.value,
            settings
        };
        
        btnStartCompress.disabled = true;
        compProgressContainer.classList.remove('hidden');
        compProgressFill.style.width = '0%';
        compProgressFill.style.background = 'linear-gradient(90deg, #3b82f6, #60a5fa)';
        compProgressText.innerText = 'Initializing...';
        
        await window.electronAPI.compressFiles(data);
    });

    window.electronAPI.onCompressProgress((data) => {
        if (data.message) {
            compProgressText.innerText = data.message;
            return;
        }
        const percent = Math.round((data.current / data.total) * 100);
        compProgressFill.style.width = `${percent}%`;
        compProgressText.innerText = `${data.current} / ${data.total} files compressed`;
    });

    window.electronAPI.onCompressComplete((result) => {
        btnStartCompress.disabled = false;
        compProgressText.innerText = `Complete! ${result.processed} compressed.`;
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
        if (mergeSourceInput.value && mergeOutputInput.value && currentMergeScan.count > 0) {
            btnStartMerge.disabled = false;
        } else {
            btnStartMerge.disabled = true;
        }
    }

    btnBrowseMergeSource.addEventListener('click', async () => {
        const folder = await window.electronAPI.selectFolder();
        if (folder) {
            mergeSourceInput.value = folder;
            mergeEstimationText.innerText = 'Scanning...';
            try {
                currentMergeScan = await window.electronAPI.scanMergeFolder(folder);
                mergeEstimationText.innerText = `Found: ${currentMergeScan.count} split ZIP files`;
                checkMergeReady();
            } catch(e) {
                mergeEstimationText.innerText = 'Error scanning folder';
            }
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
            source: mergeSourceInput.value,
            output: mergeOutputInput.value,
            skipDuplicates: mergeSkipDuplicates.checked,
            normalizeRoot: mergeNormalizeRoot.checked
        };
        
        btnStartMerge.disabled = true;
        mergeProgressContainer.classList.remove('hidden');
        mergeProgressFill.style.width = '0%';
        mergeProgressFill.style.background = 'linear-gradient(90deg, #3b82f6, #60a5fa)';
        mergeProgressText.innerText = 'Initializing...';
        
        await window.electronAPI.mergeFiles(data);
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
        mergeProgressText.innerText = `Complete! Extracted ${result.totalExtracted} files across all ZIPs.`;
    });

    window.electronAPI.onMergeError((err) => {
        btnStartMerge.disabled = false;
        mergeProgressText.innerText = `Error: ${err}`;
        mergeProgressFill.style.background = '#ef4444'; // red error state
    });

});

