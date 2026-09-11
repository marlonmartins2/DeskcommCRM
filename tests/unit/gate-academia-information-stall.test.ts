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
  it("veta promessa de consulta sem execução", () => {
    const verdict = academiaInformationStallGate.evaluate(baseCtx({
      body: "Vou verificar o horário e já retorno.",
      academiaInformation: { active: true, toolCalledThisTurn: false },
    }));
    expect(verdict.pass).toBe(false);
    if (verdict.pass) throw new Error("inalcançável");
    expect(verdict.code).toBe("academia_information_stall_sem_ferramenta");
    expect(verdict.reason).toContain("crm_get_academia_info");
  });

  it("veta funcionamento factual sem consulta", () => {
    expect(academiaInformationStallGate.evaluate(baseCtx({
      body: "Na segunda, abrimos das 05:00 às 12:00.",
      academiaInformation: { active: true, toolCalledThisTurn: false },
    })).pass).toBe(false);
  });

  it("veta endereço factual sem consultar o cadastro", () => {
    expect(academiaInformationStallGate.evaluate(baseCtx({
      body: "Nosso endereço é Rua A, 10.",
      academiaInformation: { active: true, toolCalledThisTurn: false },
    })).pass).toBe(false);
  });

  it("libera funcionamento factual depois da execução", () => {
    expect(academiaInformationStallGate.evaluate(baseCtx({
      body: "Na segunda, o horário regular é das 05:00 às 12:00.",
      academiaInformation: { active: true, toolCalledThisTurn: true },
    })).pass).toBe(true);
  });

  it("permite explicar feriado e encaminhar sem afirmar funcionamento", () => {
    expect(academiaInformationStallGate.evaluate(baseCtx({
      body: "Em feriados o funcionamento pode mudar. Vou encaminhar para nossa equipe confirmar.",
      academiaInformation: { active: true, toolCalledThisTurn: false },
    })).pass).toBe(true);
  });

  it("é no-op sem capacidade armada", () => {
    const body = "Vou verificar o horário e já retorno.";
    expect(academiaInformationStallGate.evaluate(baseCtx({ body })).pass).toBe(true);
    expect(academiaInformationStallGate.evaluate(baseCtx({
      body,
      academiaInformation: { active: false, toolCalledThisTurn: false },
    })).pass).toBe(true);
  });
});
