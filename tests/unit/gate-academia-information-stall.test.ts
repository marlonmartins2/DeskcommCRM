import { describe, expect, it } from "vitest";

import {
  academiaInformationStallGate,
  type GateContext,
} from "@/lib/agent-engine/guardrails/before-send";
import { PACING_DEFAULTS } from "@/lib/agent-engine/pacing/defaults";
import { SPINNING_DEFAULTS } from "@/lib/agent-engine/spinning/defaults";

function baseCtx(overrides: Partial<GateContext> = {}): GateContext {
  return {
    now: new Date("2026-09-14T15:30:00Z"),
    body: "",
    optedOut: false,
    provider: "waha",
    pacing: {
      knobs: PACING_DEFAULTS,
      state: { lastSentAt: null, sentToday: 0, numberActivatedAt: null },
      crmDailyLimit: null,
    },
    spinning: { knobs: SPINNING_DEFAULTS, window: [] },
    promise: { table: null },
    semanticPromise: null,
    disclosure: { template: null, isFirstOutbound: false, mode: "inject" },
    lgpd: null,
    casesEnabled: false,
    hasOpenCase: false,
    openedCaseThisTurn: false,
    ...overrides,
  };
}

describe("academiaInformationStallGate", () => {
  const pendente = {
    active: true,
    available: true,
    status: "not_called" as const,
    requiredSubjects: ["opening_hours"] as const,
    succeededSubjects: [] as const,
    exceptionActive: false,
    handoffSucceededThisTurn: false,
  };

  it("veta promessa de consulta sem execução", () => {
    const verdict = academiaInformationStallGate.evaluate(baseCtx({
      body: "Vou verificar o horário e já retorno.",
      academiaInformation: pendente,
    }));
    expect(verdict.pass).toBe(false);
    if (verdict.pass) throw new Error("inalcançável");
    expect(verdict.code).toBe("academia_information_stall_sem_ferramenta");
    expect(verdict.reason).toContain("crm_get_academia_info");
  });

  it("veta funcionamento factual sem consulta", () => {
    expect(academiaInformationStallGate.evaluate(baseCtx({
      body: "Na segunda, abrimos das 05:00 às 12:00.",
      academiaInformation: pendente,
    })).pass).toBe(false);
  });

  it("veta endereço factual sem consultar o cadastro", () => {
    expect(academiaInformationStallGate.evaluate(baseCtx({
      body: "Nosso endereço é Rua A, 10.",
      academiaInformation: {
        ...pendente,
        requiredSubjects: ["address"],
      },
    })).pass).toBe(false);
  });

  it("libera funcionamento factual depois da execução", () => {
    expect(academiaInformationStallGate.evaluate(baseCtx({
      body: "Na segunda, o horário regular é das 05:00 às 12:00.",
      academiaInformation: {
        ...pendente,
        status: "succeeded",
        succeededSubjects: ["opening_hours"],
      },
    })).pass).toBe(true);
  });

  it("não libera funcionamento quando a consulta concluída foi de outro assunto", () => {
    const verdict = academiaInformationStallGate.evaluate(baseCtx({
      body: "Na segunda, abrimos às 05:00.",
      academiaInformation: {
        ...pendente,
        succeededSubjects: ["address"],
      },
    }));
    expect(verdict.pass).toBe(false);
    if (verdict.pass) throw new Error("inalcançável");
    expect(verdict.reason).toContain("opening_hours");
  });

  it("não aceita handoff como atalho enquanto a consulta está disponível", () => {
    expect(academiaInformationStallGate.evaluate(baseCtx({
      body: "Vou encaminhar para a equipe.",
      academiaInformation: { ...pendente, handoffSucceededThisTurn: true },
    })).pass).toBe(false);
  });

  it("não aceita promessa textual de encaminhamento sem handoff real", () => {
    const verdict = academiaInformationStallGate.evaluate(baseCtx({
      body: "Em feriados o funcionamento pode mudar. Vou encaminhar para nossa equipe confirmar.",
      academiaInformation: { ...pendente, exceptionActive: true },
    }));
    expect(verdict.pass).toBe(false);
    if (verdict.pass) throw new Error("inalcançável");
    expect(verdict.code).toBe("academia_information_stall_handoff_obrigatorio");
  });

  it("libera exceção somente depois do handoff concluído", () => {
    expect(academiaInformationStallGate.evaluate(baseCtx({
      body: "O feriado precisa de confirmação da equipe.",
      academiaInformation: {
        ...pendente,
        exceptionActive: true,
        handoffSucceededThisTurn: true,
      },
    })).pass).toBe(true);
  });

  it.each([
    { available: false, status: "not_called" as const },
    { available: true, status: "failed" as const },
  ])("falha fechada sem inventar quando consulta está indisponível: %o", (state) => {
    const verdict = academiaInformationStallGate.evaluate(baseCtx({
      body: "A equipe pode confirmar para você.",
      academiaInformation: { ...pendente, ...state },
    }));
    expect(verdict.pass).toBe(false);
    if (verdict.pass) throw new Error("inalcançável");
    expect(verdict.code).toBe("academia_information_stall_consulta_indisponivel");
  });

  it.each([
    { available: false, status: "not_called" as const },
    { available: true, status: "failed" as const },
  ])("libera fallback somente após handoff efetivo: %o", (state) => {
    expect(academiaInformationStallGate.evaluate(baseCtx({
      body: "A equipe vai confirmar.",
      academiaInformation: {
        ...pendente,
        ...state,
        handoffSucceededThisTurn: true,
      },
    })).pass).toBe(true);
  });

  it("é no-op sem capacidade armada", () => {
    const body = "Vou verificar o horário e já retorno.";
    expect(academiaInformationStallGate.evaluate(baseCtx({ body })).pass).toBe(true);
    expect(academiaInformationStallGate.evaluate(baseCtx({
      body,
      academiaInformation: { ...pendente, active: false },
    })).pass).toBe(true);
  });
});
