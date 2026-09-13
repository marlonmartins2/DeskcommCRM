import { normalizarTermoAcademia } from "./consulta-grade";

export const ASSUNTOS_DE_INFORMACAO_ACADEMIA = [
  "address",
  "contact",
  "opening_hours",
  "rules",
] as const;

export type AssuntoInformacaoAcademia = typeof ASSUNTOS_DE_INFORMACAO_ACADEMIA[number];

const TERMOS_POR_ASSUNTO: Readonly<Record<AssuntoInformacaoAcademia, RegExp>> = {
  address: /\b(endereco|localizacao|onde fica)\b/i,
  contact: /\b(telefone|whatsapp|e mail|email|contato)\b/i,
  opening_hours:
    /\b(abre|abrem|abrir|abertura|abert[oa]s?|fecha|fecham|fechar|fechamento|fechad[oa]s?|funcionamento|funciona)\b/i,
  rules: /\b(regra|regras|norma|normas|orientacao|orientacoes)\b/i,
};

const TERMOS_DE_EXCECAO_OPERACIONAL =
  /\b(feriado|feriados|recesso|recessos|excecao|excecoes|data especifica|natal|ano novo|carnaval|pascoa)\b/i;
const DATA_NUMERICA = /\b\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?\b/;
const DATA_POR_EXTENSO = /\b\d{1,2}\s+de\s+(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b/i;

export type EstadoDaConsultaInformacoesAcademia = "succeeded" | "failed";
export type StatusDaConsultaInformacoesAcademia =
  | "not_called"
  | "partial"
  | EstadoDaConsultaInformacoesAcademia;

function ultimaMensagemInbound(
  mensagens: readonly { direction: string; body: string }[],
): string {
  return mensagens.findLast((mensagem) => mensagem.direction === "inbound")?.body ?? "";
}

export function ehAssuntoInformacaoAcademia(
  value: unknown,
): value is AssuntoInformacaoAcademia {
  return typeof value === "string" &&
    ASSUNTOS_DE_INFORMACAO_ACADEMIA.some((assunto) => assunto === value);
}

export function assuntosSolicitadosNasInformacoesAcademia(
  mensagens: readonly { direction: string; body: string }[],
): AssuntoInformacaoAcademia[] {
  const entrada = normalizarTermoAcademia(ultimaMensagemInbound(mensagens));
  return ASSUNTOS_DE_INFORMACAO_ACADEMIA.filter((assunto) =>
    TERMOS_POR_ASSUNTO[assunto].test(entrada),
  );
}

function consultaOficialConcluida(result: unknown): boolean {
  return typeof result === "object" && result !== null &&
    "source" in result && result.source === "cadastro_operacional" &&
    !("error" in result);
}

/** Registra sucesso somente depois de a ponte devolver a fonte oficial. */
export async function acompanharConsultaInformacoesAcademia<T>(
  execute: () => Promise<T>,
  assunto: AssuntoInformacaoAcademia | null,
  registrar: (
    estado: EstadoDaConsultaInformacoesAcademia,
    assunto: AssuntoInformacaoAcademia | null,
  ) => void,
): Promise<T> {
  try {
    const result = await execute();
    registrar(
      consultaOficialConcluida(result) && assunto !== null ? "succeeded" : "failed",
      assunto,
    );
    return result;
  } catch (error) {
    registrar("failed", assunto);
    throw error;
  }
}

/** Estado por assunto do turno; consultas fora do pedido não alteram o veredito. */
export function criarEstadoConsultaInformacoesAcademia(
  assuntosObrigatorios: readonly AssuntoInformacaoAcademia[],
) {
  const concluidos = new Set<AssuntoInformacaoAcademia>();
  const falhos = new Set<AssuntoInformacaoAcademia>();

  return {
    registrar(
      estado: EstadoDaConsultaInformacoesAcademia,
      assunto: AssuntoInformacaoAcademia | null,
    ): void {
      if (assunto === null || !assuntosObrigatorios.includes(assunto)) return;
      if (estado === "succeeded") {
        concluidos.add(assunto);
        falhos.delete(assunto);
        return;
      }
      falhos.add(assunto);
    },
    status(): StatusDaConsultaInformacoesAcademia {
      if (assuntosObrigatorios.length === 0) return "not_called";
      if (assuntosObrigatorios.every((assunto) => concluidos.has(assunto))) return "succeeded";
      if (assuntosObrigatorios.some((assunto) => falhos.has(assunto))) return "failed";
      if (assuntosObrigatorios.some((assunto) => concluidos.has(assunto))) return "partial";
      return "not_called";
    },
    assuntosConcluidos(): AssuntoInformacaoAcademia[] {
      return [...concluidos];
    },
  };
}

/** O handoff é fallback, nunca atalho para evitar uma consulta disponível. */
export function podeExecutarHandoffDeInformacaoAcademia(input: {
  active: boolean;
  available: boolean;
  status: StatusDaConsultaInformacoesAcademia;
  exceptionActive: boolean;
}): boolean {
  return !input.active || input.exceptionActive || !input.available || input.status === "failed";
}

/**
 * Identifica somente pedidos inequívocos sobre a operação da academia.
 * “Horário” sozinho não entra: normalmente é pergunta sobre a grade de aulas.
 */
export function sinalDeConversaSobreInformacoesAcademia(
  mensagens: readonly { direction: string; body: string }[],
): boolean {
  return assuntosSolicitadosNasInformacoesAcademia(mensagens).length > 0;
}

/** Data especial sem tabela de ocorrências exige confirmação humana. */
export function sinalDeExcecaoNasInformacoesAcademia(
  mensagens: readonly { direction: string; body: string }[],
): boolean {
  const entrada = ultimaMensagemInbound(mensagens);
  return DATA_NUMERICA.test(entrada) ||
    DATA_POR_EXTENSO.test(normalizarTermoAcademia(entrada)) ||
    TERMOS_DE_EXCECAO_OPERACIONAL.test(normalizarTermoAcademia(entrada));
}
