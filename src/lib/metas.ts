// Metas dos indicadores (Configurações → Metas e indicadores).
import type { Meta } from './tipos'

/** O limite da meta como número, ou null quando o campo ficou em branco. */
export const limiteDaMeta = (v: unknown) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))

/**
 * Indicador com meta? Com os dois campos em branco (ou os dois zerados) o indicador não é avaliado:
 * o número aparece no painel sem Ruim, Médio ou Bom.
 */
export function metaDefinida(meta: Meta | undefined): meta is Meta {
  if (!meta) return false
  return (limiteDaMeta(meta.ruim) ?? 0) !== 0 || (limiteDaMeta(meta.bom) ?? 0) !== 0
}
