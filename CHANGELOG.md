# Changelog - Pixiy Versioning System

All notable changes, fixes, and improvements to **Pixiy** are documented in this file.

---

## [1.0.1] - 2026-05-28

### Added
- **Detailed Failure Audit Logs**: In-app scrollable monospace error dashboards now catch, collect, and display exact corrupted file exceptions (e.g., `VipsJpeg: premature end of JPEG image`) and missing items during Extract Image and Batch Compression tasks.
- **Amber Warning State**: Progress bars switch to a custom warning amber (`#f59e0b`) color and bypass the 3-second auto-hide timeout when individual failures are present.
- **List-Name Validation**: The extraction list text parsing now flags missing files as `"File name not found in source directory"` with text auditing.

---

## [1.0.0] - 2026-05-28

### Added
- **Folder Structure Preservation**: Extract Image and Batch Compression recursively parse and recreate original nested multi-level directory paths (e.g. `Folder/Subfolder/image.jpg`) inside the output folder instead of flattening them.
- **Multi-Threaded Parallel Compression**: Leverages multi-core processing (`os.cpus().length - 1` workers concurrently) under high-quality MozJPEG compression.
- **Active Cancellation Engines**: Thread-safe abort buttons added across all three menus (Extract, Compress, Merge) to immediately stop filesystem tasks and reset UI states.
- **Auto-Repairing ZIP Extractor (EOCD Recovery)**: Dynamic backward-buffer scanner that fixes trailing-junk corrupted ZIP headers in-place.
- **Mixed Browse System**: Fully integrated multi-ZIP and directory scanning filters.
- **macOS Native Directory Creation**: Enabled folder creation inside browsing dialog overlays.
