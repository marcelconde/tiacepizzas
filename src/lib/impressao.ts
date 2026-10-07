import QRCode from 'qrcode'
import { PAGAMENTO, TIPO, brl, cpf, dataHora, enderecoTexto, telefone } from './formato'
import type { ConfigFiscal, Configuracoes, NotaFiscal, Pedido } from './tipos'

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string)

const linha = (esq: string, dir: string, classe = '') => `<div class="lin ${classe}"><span>${esq}</span><span>${dir}</span></div>`

function itensHtml(p: Pedido, comPreco: boolean) {
  return (p.pedido_itens ?? [])
    .slice()
    .sort((a, b) => a.ordem - b.ordem)
    .map((i) => {
      const extras = i.adicionais.map((a) => `<div class="sub">+ ${esc(a.nome)}</div>`).join('')
      const obs = i.observacoes ? `<div class="sub obs">Obs: ${esc(i.observacoes)}</div>` : ''
      return `<div class="item">${linha(`<b>${i.quantidade}x</b> ${esc(i.nome)}`, comPreco ? brl(i.total) : '')}${extras}${obs}</div>`
    })
    .join('')
}

function cabecalhoPedido(p: Pedido) {
  const end = p.tipo === 'entrega' ? enderecoTexto(p.endereco) : ''
  return `
    <div class="centro grande"><b>PEDIDO #${p.numero}</b></div>
    <div class="centro"><b>${TIPO[p.tipo].toUpperCase()}</b> · ${dataHora(p.criado_em)}</div>
    <hr>
    <div><b>${esc(p.cliente_nome)}</b></div>
    ${p.cliente_telefone ? `<div>${telefone(p.cliente_telefone)}</div>` : ''}
    ${end ? `<div class="destaque">${esc(end)}</div>` : ''}
    ${p.endereco?.referencia ? `<div>Ref: ${esc(p.endereco.referencia)}</div>` : ''}
  `
}

async function blocoFiscal(p: Pedido, nota: NotaFiscal, fiscal: ConfigFiscal | null | undefined) {
  const qr = nota.qrcode_url ? await QRCode.toDataURL(nota.qrcode_url, { margin: 0, width: 240, errorCorrectionLevel: 'M' }) : ''
  const chave = (nota.chave ?? '').replace(/\D/g, '').replace(/(\d{4})/g, '$1 ').trim()
  const tributos = fiscal?.aliquota_tributos ? (p.total * Number(fiscal.aliquota_tributos)) / 100 : 0
  return `
    <hr>
    <div class="centro"><b>Documento Auxiliar da Nota Fiscal de Consumidor Eletrônica</b></div>
    ${nota.ambiente === 'homologacao' ? '<div class="centro"><b>EMITIDA EM AMBIENTE DE HOMOLOGAÇÃO — SEM VALOR FISCAL</b></div>' : ''}
    <div class="centro">NFC-e nº ${esc(nota.numero)} Série ${esc(nota.serie)} · ${dataHora(nota.criado_em)}</div>
    <div class="centro">Consulte pela chave de acesso em</div>
    <div class="centro quebra">${esc(nota.url_consulta)}</div>
    <div class="centro quebra"><b>${chave}</b></div>
    <div class="centro">${p.cpf_nota ? `CONSUMIDOR CPF ${cpf(p.cpf_nota)}` : 'CONSUMIDOR NÃO IDENTIFICADO'}</div>
    ${nota.protocolo ? `<div class="centro">Protocolo de autorização: ${esc(nota.protocolo)}</div>` : ''}
    ${qr ? `<div class="centro"><img class="qr" src="${qr}" alt=""></div>` : ''}
    ${tributos ? `<div class="centro pequeno">Tributos totais incidentes (Lei Federal 12.741/2012): ${brl(tributos)}</div>` : ''}
  `
}

async function viaCliente(p: Pedido, cfg: Configuracoes, fiscal?: ConfigFiscal | null) {
  const nota = p.notas_fiscais?.find((n) => n.status === 'autorizada')
  const enderecoLoja = [cfg.logradouro && `${cfg.logradouro}, ${cfg.numero ?? 's/n'}`, cfg.bairro, cfg.cidade && `${cfg.cidade}/${cfg.uf ?? ''}`]
    .filter(Boolean)
    .join(' — ')
  const troco = p.forma_pagamento === 'dinheiro' && p.troco_para ? p.troco_para - p.total : 0

  return `
    <section>
      <div class="centro titulo"><b>${esc(nota && fiscal?.razao_social ? fiscal.razao_social : cfg.nome_loja)}</b></div>
      ${nota && fiscal?.cnpj ? `<div class="centro">CNPJ ${esc(fiscal.cnpj)}${fiscal.inscricao_estadual ? ` · IE ${esc(fiscal.inscricao_estadual)}` : ''}</div>` : ''}
      ${enderecoLoja ? `<div class="centro">${esc(enderecoLoja)}</div>` : ''}
      ${cfg.telefone ? `<div class="centro">${telefone(cfg.telefone)}</div>` : ''}
      <hr>
      ${cabecalhoPedido(p)}
      <hr>
      ${itensHtml(p, true)}
      <hr>
      ${linha('Subtotal', brl(p.subtotal))}
      ${p.taxa_entrega > 0 ? linha('Taxa de entrega', brl(p.taxa_entrega)) : ''}
      ${p.desconto > 0 ? linha(`Desconto${p.cupom_codigo ? ` (${esc(p.cupom_codigo)})` : ''}`, `- ${brl(p.desconto)}`) : ''}
      ${linha('<b>TOTAL</b>', `<b>${brl(p.total)}</b>`, 'grande')}
      ${linha('Pagamento', `${PAGAMENTO[p.forma_pagamento]}${p.pago ? ' (pago)' : ''}`)}
      ${troco > 0 ? linha(`Troco para ${brl(p.troco_para)}`, brl(troco), 'destaque') : ''}
      ${p.observacoes ? `<hr><div class="destaque">Obs: ${esc(p.observacoes)}</div>` : ''}
      ${nota ? await blocoFiscal(p, nota, fiscal) : '<hr><div class="centro pequeno">NÃO É DOCUMENTO FISCAL</div>'}
      <div class="centro pequeno rodape">Acompanhe: ${location.host}/pedido · código ${p.codigo}<br>Obrigado pela preferência!</div>
    </section>`
}

function viaCozinha(p: Pedido) {
  return `
    <section class="cozinha">
      <div class="centro"><b>*** COZINHA ***</b></div>
      ${cabecalhoPedido(p)}
      <hr>
      ${itensHtml(p, false)}
      ${p.observacoes ? `<hr><div class="destaque">Obs: ${esc(p.observacoes)}</div>` : ''}
    </section>`
}

function estilo(largura: number) {
  const util = largura === 58 ? 48 : 72 // área imprimível típica das bobinas
  return `
    @page { size: ${largura}mm auto; margin: 0; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: "Courier New", ui-monospace, monospace; font-size: ${largura === 58 ? 10 : 12}px; line-height: 1.25; color: #000; }
    section { width: ${util}mm; margin: 0 auto; padding: 2mm 0 6mm; page-break-after: always; }
    section:last-child { page-break-after: auto; }
    hr { border: 0; border-top: 1px dashed #000; margin: 5px 0; }
    .centro { text-align: center; }
    .titulo { font-size: 1.4em; }
    .grande { font-size: 1.25em; }
    .pequeno { font-size: .85em; }
    .destaque { font-weight: bold; }
    .quebra { word-break: break-all; }
    .lin { display: flex; justify-content: space-between; gap: 6px; }
    .lin span:last-child { white-space: nowrap; }
    .item { margin-bottom: 3px; }
    .sub { padding-left: 14px; }
    .obs { font-weight: bold; }
    .qr { width: 34mm; height: 34mm; margin: 6px auto; }
    .rodape { margin-top: 8px; }
    .cozinha { font-size: 1.25em; }
    .cozinha .item { margin-bottom: 8px; }
  `
}

/**
 * Imprime o cupom do pedido (e a via da cozinha, se pedida) pelo navegador.
 * Para sair direto na térmica sem a janela de impressão, abra o Chrome com --kiosk-printing.
 */
export async function imprimirPedido(
  p: Pedido,
  cfg: Configuracoes,
  opcoes: { fiscal?: ConfigFiscal | null; cozinha?: boolean; cliente?: boolean } = {},
) {
  const largura = cfg.impressao?.largura === 58 ? 58 : 80
  const vias: string[] = []
  if (opcoes.cozinha ?? cfg.impressao?.via_cozinha) vias.push(viaCozinha(p))
  if (opcoes.cliente ?? true) vias.push(await viaCliente(p, cfg, opcoes.fiscal))

  const quadro = document.createElement('iframe')
  quadro.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'
  document.body.appendChild(quadro)
  const doc = quadro.contentDocument!
  doc.open()
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>Pedido ${p.numero}</title><style>${estilo(largura)}</style></head><body>${vias.join('')}</body></html>`)
  doc.close()

  await Promise.all(Array.from(doc.images).map((img) => (img.complete ? null : new Promise((ok) => (img.onload = img.onerror = ok)))))
  const janela = quadro.contentWindow!
  janela.onafterprint = () => quadro.remove()
  janela.focus()
  janela.print()
  setTimeout(() => quadro.remove(), 60_000)
}
