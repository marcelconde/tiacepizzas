// Exportação de relatórios em CSV, Excel (XLSX) e PDF. As bibliotecas pesadas só são baixadas na hora de exportar.

export interface TabelaExport {
  titulo: string
  colunas: string[]
  linhas: (string | number | null | undefined)[][]
}

const limpo = (v: unknown) => String(v ?? '').replace(/[  ]/g, ' ')

function baixar(nome: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nome
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

export function exportarCsv(nome: string, tabelas: TabelaExport[]) {
  const celula = (v: unknown) => {
    const s = typeof v === 'number' ? String(v).replace('.', ',') : limpo(v)
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const partes = tabelas.map((t) => [t.titulo, t.colunas.map(celula).join(';'), ...t.linhas.map((l) => l.map(celula).join(';'))].join('\r\n'))
  baixar(`${nome}.csv`, new Blob(['﻿' + partes.join('\r\n\r\n')], { type: 'text/csv;charset=utf-8' }))
}

// ---------------------------------------------------------------- XLSX
const xml = (s: string) => s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c] as string)
function coluna(n: number) {
  let s = ''
  for (let i = n + 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s
  return s
}

function planilha(t: TabelaExport) {
  const linha = (valores: unknown[], n: number, estilo = 0) =>
    `<row r="${n}">${valores
      .map((v, i) => {
        const ref = `${coluna(i)}${n}`
        if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}" s="${Number.isInteger(v) ? 0 : 2}"><v>${v}</v></c>`
        return `<c r="${ref}" t="inlineStr"${estilo ? ` s="${estilo}"` : ''}><is><t xml:space="preserve">${xml(limpo(v))}</t></is></c>`
      })
      .join('')}</row>`
  const larguras = t.colunas.map((c, i) => Math.min(50, Math.max(c.length, ...t.linhas.map((l) => limpo(l[i]).length)) + 2))
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols>${larguras
    .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
    .join('')}</cols><sheetData>${linha(t.colunas, 1, 1)}${t.linhas.map((l, i) => linha(l, i + 2)).join('')}</sheetData></worksheet>`
}

export async function exportarXlsx(nome: string, tabelas: TabelaExport[]) {
  const { zipSync, strToU8 } = await import('fflate')
  const abas = tabelas.map((t, i) => ({ nome: xml(t.titulo.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31)) || `Planilha ${i + 1}`, conteudo: planilha(t) }))
  const arquivos: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${abas
        .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
        .join('')}</Types>`,
    ),
    '_rels/.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ),
    'xl/workbook.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${abas
        .map((a, i) => `<sheet name="${a.nome}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
        .join('')}</sheets></workbook>`,
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${abas
        .map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
        .join('')}<Relationship Id="rId${abas.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    ),
    // estilos: 0 = normal, 1 = cabeçalho em negrito, 2 = número com duas casas
    'xl/styles.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>`,
    ),
  }
  abas.forEach((a, i) => (arquivos[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(a.conteudo)))
  const zip = zipSync(arquivos)
  baixar(`${nome}.xlsx`, new Blob([zip.buffer as ArrayBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
}

// ---------------------------------------------------------------- PDF
export async function exportarPdf(nome: string, titulo: string, subtitulo: string, tabelas: TabelaExport[]) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  doc.setFont('helvetica', 'bold').setFontSize(16).text(limpo(titulo), 40, 50)
  doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(110).text(limpo(subtitulo), 40, 66)
  let y = 92
  for (const t of tabelas) {
    if (y > 740) {
      doc.addPage()
      y = 50
    }
    doc.setFont('helvetica', 'bold').setFontSize(12).setTextColor(20).text(limpo(t.titulo), 40, y)
    autoTable(doc, {
      startY: y + 8,
      head: [t.colunas.map(limpo)],
      body: t.linhas.map((l) => l.map((v) => (typeof v === 'number' ? v.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) : limpo(v)))),
      styles: { fontSize: 9, cellPadding: 4 },
      headStyles: { fillColor: [54, 37, 28] },
      alternateRowStyles: { fillColor: [247, 245, 242] },
      margin: { left: 40, right: 40 },
    })
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 30
  }
  const paginas = doc.getNumberOfPages()
  for (let i = 1; i <= paginas; i++) {
    doc.setPage(i).setFont('helvetica', 'normal').setFontSize(8).setTextColor(140)
    doc.text(`Tia Cê Pizzas · gerado em ${new Date().toLocaleString('pt-BR')} · página ${i} de ${paginas}`, 40, 820)
  }
  doc.save(`${nome}.pdf`)
}

/** Botões de exportação padronizados chamam esta função com o formato escolhido. */
export function exportar(formato: 'csv' | 'xlsx' | 'pdf', nome: string, titulo: string, subtitulo: string, tabelas: TabelaExport[]) {
  if (formato === 'csv') return exportarCsv(nome, tabelas)
  if (formato === 'xlsx') return exportarXlsx(nome, tabelas)
  return exportarPdf(nome, titulo, subtitulo, tabelas)
}
