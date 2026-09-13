import { describe, expect, it } from "vitest";

import {
  acompanharConsultaInformacoesAcademia,
  assuntosSolicitadosNasInformacoesAcademia,
  criarEstadoConsultaInformacoesAcademia,
  podeExecutarHandoffDeInformacaoAcademia,
  sinalDeConversaSobreInformacoesAcademia,
  sinalDeExcecaoNasInformacoesAcademia,
  type AssuntoInformacaoAcademia,
  type EstadoDaConsultaInformacoesAcademia,
} from "@/lib/academia/consulta-informacoes";

describe("sinal de informações operacionais da academia", () => {
  it.each([
    "Que horas abre segunda?",
    "Qual é o endereço da academia?",
    "Vocês têm WhatsApp?",
    "Qual o e-mail para contato?",
    "Como funciona aos domingos?",
    "Quais são as regras da academia?",
    "Onde fica a academia?",
    "Vocês abrem aos sábados?",
    "Que horas vocês fecham?",
    "Está aberto agora?",
    "A academia está fechada hoje?",
  ])("reconhece pedido inequívoco: %s", (body) => {
    expect(sinalDeConversaSobreInformacoesAcademia([{ direction: "inbound", body }])).toBe(true);
  });

  it.each([
    "Tem CrossFit segunda de manhã?",
    "Qual o horário do spinning?",
    "Quero saber os horários das aulas",
    "Bom dia",
  ])("não confunde grade ou conversa genérica: %s", (body) => {
    expect(sinalDeConversaSobreInformacoesAcademia([{ direction: "inbound", body }])).toBe(false);
  });

  it("usa somente a entrada atual e ignora uma pergunta operacional antiga", () => {
    const messages = [
      { direction: "inbound", body: "Qual o endereço?" },
      { direction: "outbound", body: "Ficamos na Rua A." },
      { direction: "inbound", body: "Obrigado!" },
    ];
    expect(sinalDeConversaSobreInformacoesAcademia(messages)).toBe(false);
  });

  it("ignora texto operacional da resposta anterior do agente", () => {
    expect(sinalDeConversaSobreInformacoesAcademia([
      { direction: "outbound", body: "Abrimos às 05:00 e fechamos às 22:00." },
      { direction: "inbound", body: "Obrigado!" },
    ])).toBe(false);
  });

  it.each([
    ["Onde fica e qual o telefone?", ["address", "contact"]],
    ["Que horas abrem?", ["opening_hours"]],
    ["Quais são as normas?", ["rules"]],
  ] as const)("classifica os assuntos pedidos em: %s", (body, expected) => {
    expect(assuntosSolicitadosNasInformacoesAcademia([
      { direction: "inbound", body },
    ])).toEqual(expected);
  });

  it.each([
    "A academia abre no feriado?",
    "Qual o funcionamento no Natal?",
    "Vocês abrem em 12/10?",
    "E no feriado?",
    "A academia abre em 7 de setembro?",
    "Qual o funcionamento em 2026-09-07?",
  ])("identifica data que exige confirmação humana: %s", (body) => {
    expect(sinalDeExcecaoNasInformacoesAcademia([{ direction: "inbound", body }])).toBe(true);
  });

  it("não trata segunda-feira regular como exceção", () => {
    expect(sinalDeExcecaoNasInformacoesAcademia([
      { direction: "inbound", body: "Que horas abrem na segunda?" },
    ])).toBe(false);
  });

  it("não herda a exceção de uma entrada anterior", () => {
    expect(sinalDeExcecaoNasInformacoesAcademia([
      { direction: "inbound", body: "A academia abre no feriado?" },
      { direction: "outbound", body: "Vou encaminhar para confirmação." },
      { direction: "inbound", body: "Onde fica a academia?" },
    ])).toBe(false);
  });

  it("só registra sucesso depois que a consulta oficial retorna", async () => {
    const estados: Array<{
      estado: EstadoDaConsultaInformacoesAcademia;
      assunto: AssuntoInformacaoAcademia | null;
    }> = [];
    let concluir!: (value: unknown) => void;
    const pendente = new Promise((resolve) => { concluir = resolve; });
    const consulta = acompanharConsultaInformacoesAcademia(
      () => pendente,
      "address",
      (estado, assunto) => estados.push({ estado, assunto }),
    );

    expect(estados).toEqual([]);
    concluir({ source: "cadastro_operacional", address: "Rua A" });
    await expect(consulta).resolves.toMatchObject({ source: "cadastro_operacional" });
    expect(estados).toEqual([{ estado: "succeeded", assunto: "address" }]);
  });

  it("registra falha quando a ponte devolve erro ao modelo", async () => {
    const estados: string[] = [];
    await expect(acompanharConsultaInformacoesAcademia(
      async () => ({ error: "banco indisponível" }),
      "opening_hours",
      (estado) => estados.push(estado),
    )).resolves.toEqual({ error: "banco indisponível" });
    expect(estados).toEqual(["failed"]);
  });

  it("registra falha e preserva a exceção se a execução lançar", async () => {
    const estados: string[] = [];
    await expect(acompanharConsultaInformacoesAcademia(
      async () => { throw new Error("ponte indisponível"); },
      "rules",
      (estado) => estados.push(estado),
    )).rejects.toThrow("ponte indisponível");
    expect(estados).toEqual(["failed"]);
  });

  it("não registra sucesso sem um assunto válido", async () => {
    const eventos: Array<[string, AssuntoInformacaoAcademia | null]> = [];
    await acompanharConsultaInformacoesAcademia(
      async () => ({ source: "cadastro_operacional", address: "Rua A" }),
      null,
      (estado, assunto) => eventos.push([estado, assunto]),
    );
    expect(eventos).toEqual([["failed", null]]);
  });

  it("só conclui depois de consultar cada assunto pedido", () => {
    const estado = criarEstadoConsultaInformacoesAcademia(["address", "opening_hours"]);
    estado.registrar("succeeded", "address");
    expect(estado.status()).toBe("partial");
    expect(estado.assuntosConcluidos()).toEqual(["address"]);

    estado.registrar("succeeded", "rules");
    expect(estado.status()).toBe("partial");

    estado.registrar("succeeded", "opening_hours");
    expect(estado.status()).toBe("succeeded");
    expect(estado.assuntosConcluidos()).toEqual(["address", "opening_hours"]);
  });

  it("só libera o fallback quando falha um assunto realmente pedido", () => {
    const estado = criarEstadoConsultaInformacoesAcademia(["opening_hours"]);
    estado.registrar("failed", "address");
    expect(estado.status()).toBe("not_called");
    estado.registrar("failed", "opening_hours");
    expect(estado.status()).toBe("failed");
  });
});

describe("handoff de informações operacionais", () => {
  const base = {
    active: true,
    available: true,
    status: "not_called" as const,
    exceptionActive: false,
  };

  it("não deixa o modelo trocar uma consulta disponível por handoff", () => {
    expect(podeExecutarHandoffDeInformacaoAcademia(base)).toBe(false);
    expect(podeExecutarHandoffDeInformacaoAcademia({
      ...base,
      status: "succeeded",
    })).toBe(false);
  });

  it.each([
    { active: false },
    { exceptionActive: true },
    { available: false },
    { status: "failed" as const },
  ])("autoriza somente fallback ou fluxo fora do gate: %o", (override) => {
    expect(podeExecutarHandoffDeInformacaoAcademia({ ...base, ...override })).toBe(true);
  });
});
