import { describe, expect, it } from "vitest";

import { ACADEMIA_INFORMATION_SYSTEM_BLOCK } from "@/lib/agent-engine/agent/academia-information-prompt";

describe("instrução residente das informações da academia", () => {
  it("exige a fonte oficial no turno e resposta direta", () => {
    expect(ACADEMIA_INFORMATION_SYSTEM_BLOCK).toContain("crm_get_academia_info NESTE turno");
    expect(ACADEMIA_INFORMATION_SYSTEM_BLOCK).toContain("horário regular");
    expect(ACADEMIA_INFORMATION_SYSTEM_BLOCK).toContain("request_human_handoff");
    expect(ACADEMIA_INFORMATION_SYSTEM_BLOCK).toMatch(/n[aã]o diga que vai verificar depois/i);
    expect(ACADEMIA_INFORMATION_SYSTEM_BLOCK).toMatch(/abertura e fechamento/i);
    expect(ACADEMIA_INFORMATION_SYSTEM_BLOCK).toMatch(/n[aã]o est[aá] cadastrad[oa]/i);
  });
});
