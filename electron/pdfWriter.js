const fs = require('fs')

// Minimal streaming PDF writer: one JPEG per page, page size = image size (1px = 1pt).
// Pages are written to disk as they arrive so memory stays flat on large batches.
class JpegPdfWriter {
  constructor(filePath) {
    this.filePath = filePath
    this.handle = null
    this.position = 0
    this.offsets = [] // offsets[objNum] = byte offset
    this.pageRefs = []
    this.nextObj = 3 // 1 = Catalog, 2 = Pages (written at the end)
  }

  async open() {
    this.handle = await fs.promises.open(this.filePath, 'w')
    await this._write(Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1'))
  }

  async _write(buf) {
    await this.handle.write(buf, 0, buf.length, this.position)
    this.position += buf.length
  }

  async _writeObject(num, ...parts) {
    this.offsets[num] = this.position
    await this._write(Buffer.from(`${num} 0 obj\n`, 'latin1'))
    for (const part of parts) {
      await this._write(Buffer.isBuffer(part) ? part : Buffer.from(part, 'latin1'))
    }
    await this._write(Buffer.from('\nendobj\n', 'latin1'))
  }

  // jpeg: Buffer of a baseline/progressive JPEG; channels: 1 (gray) or 3 (RGB)
  async addJpegPage(jpeg, width, height, channels = 3) {
    const imgNum = this.nextObj++
    const contentNum = this.nextObj++
    const pageNum = this.nextObj++
    const colorSpace = channels === 1 ? '/DeviceGray' : '/DeviceRGB'

    await this._writeObject(imgNum,
      `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace ${colorSpace} /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
      jpeg,
      '\nendstream')

    const content = `q ${width} 0 0 ${height} 0 0 cm /Im0 Do Q`
    await this._writeObject(contentNum, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`)

    await this._writeObject(pageNum,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /XObject << /Im0 ${imgNum} 0 R >> >> /Contents ${contentNum} 0 R >>`)

    this.pageRefs.push(`${pageNum} 0 R`)
  }

  get pageCount() {
    return this.pageRefs.length
  }

  async close() {
    await this._writeObject(2, `<< /Type /Pages /Kids [${this.pageRefs.join(' ')}] /Count ${this.pageRefs.length} >>`)
    await this._writeObject(1, '<< /Type /Catalog /Pages 2 0 R >>')

    const size = this.nextObj
    const xrefStart = this.position
    let xref = `xref\n0 ${size}\n0000000000 65535 f \n`
    for (let i = 1; i < size; i++) {
      xref += `${String(this.offsets[i]).padStart(10, '0')} 00000 n \n`
    }
    xref += `trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`
    await this._write(Buffer.from(xref, 'latin1'))
    await this.handle.close()
    this.handle = null
  }

  // Close and delete a partial file (cancel / total failure)
  async abort() {
    if (this.handle) {
      await this.handle.close().catch(() => {})
      this.handle = null
    }
    await fs.promises.unlink(this.filePath).catch(() => {})
  }
}

module.exports = { JpegPdfWriter }
