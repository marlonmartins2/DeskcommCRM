import { normalizarTermoAcademia } from "./consulta-grade";

const TERMOS_DE_INFORMACAO_OPERACIONAL =
  /\b(endereco|localizacao|telefone|whatsapp|e mail|email|contato|abre|abrir|abertura|fecha|fechar|fechamento|funcionamento|funciona|regra|regras|norma|normas|orientacao|orientacoes)\b/i;

/**
 * Identifica somente pedidos inequívocos sobre a operação da academia.
 * “Horário” sozinho não entra: normalmente é pergunta sobre a grade de aulas.
 */
export function sinalDeConversaSobreInformacoesAcademia(
  mensagens: readonly { direction: string; body: string }[],
): boolean {
  const janela = mensagens.slice(-6).map((mensagem) => mensagem.body).join(" ");
  return TERMOS_DE_INFORMACAO_OPERACIONAL.test(normalizarTermoAcademia(janela));
}
