import { describe, expect, it } from "vitest";

import { sinalDeConversaSobreInformacoesAcademia } from "@/lib/academia/consulta-informacoes";

describe("sinal de informações operacionais da academia", () => {
  it.each([
    "Que horas abre segunda?",
    "Qual é o endereço da academia?",
    "Vocês têm WhatsApp?",
    "Qual o e-mail para contato?",
    "Como funciona aos domingos?",
    "Quais são as regras da academia?",
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

  it("usa somente a janela das seis mensagens mais recentes", () => {
    const messages = [
      { direction: "inbound", body: "Qual o endereço?" },
      ...Array.from({ length: 6 }, () => ({ direction: "outbound", body: "Conversa neutra" })),
    ];
    expect(sinalDeConversaSobreInformacoesAcademia(messages)).toBe(false);
  });
});
