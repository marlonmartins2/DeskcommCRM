import { afterEach, describe, expect, it, vi } from "vitest";

import { crmGetAcademiaInfo } from "@/lib/mcp/tools/academia-information";
import type { McpContext } from "@/lib/mcp/types";

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

class FakeQuery implements PromiseLike<{ data: Row[]; error: { message: string } | null }> {
  private filters: Array<(row: Row) => boolean> = [];
  private ordering: string[] = [];

  constructor(
    private readonly rows: Row[],
    private readonly failure: string | null,
  ) {}

  select(): this { return this; }
  eq(column: string, value: unknown): this {
    this.filters.push((row) => row[column] === value);
    return this;
  }
  order(column: string): this {
    this.ordering.push(column);
    return this;
  }
  async maybeSingle() {
    const result = this.result();
    return { data: result.data[0] ?? null, error: result.error };
  }
  then<TResult1 = { data: Row[]; error: { message: string } | null }, TResult2 = never>(
    onfulfilled?: ((value: { data: Row[]; error: { message: string } | null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.result()).then(onfulfilled, onrejected);
  }
  private result() {
    if (this.failure) return { data: [], error: { message: this.failure } };
    let data = this.rows.filter((row) => this.filters.every((filter) => filter(row)));
    data = [...data].sort((left, right) => {
      for (const column of this.ordering) {
        const comparison = String(left[column]).localeCompare(String(right[column]));
        if (comparison !== 0) return comparison;
      }
      return 0;
    });
    return { data, error: null };
  }
}

function baseTables(academia = true): Tables {
  return {
    organizations: [
      { id: "org-1", settings: { modules: { academia } }, timezone: "America/Sao_Paulo" },
      { id: "org-2", settings: { modules: { academia: true } }, timezone: "UTC" },
    ],
    academia_profiles: [
      {
        organization_id: "org-1",
        address: "Rua A, 10",
        phone: null,
        whatsapp: "11999998888",
        email: null,
        public_rules: "Leve toalha.",
        updated_at: "2026-09-11T12:00:00.000Z",
      },
      {
        organization_id: "org-2",
        address: "Rua do outro tenant",
        phone: "0000000000",
        whatsapp: null,
        email: "outro@example.com",
        public_rules: "Regra alheia",
        updated_at: "2026-09-11T13:00:00.000Z",
      },
    ],
    academia_opening_hours: [
      { organization_id: "org-1", weekday: 1, opens_at: "05:00:00", closes_at: "23:00:00" },
      { organization_id: "org-2", weekday: 1, opens_at: "00:00:00", closes_at: "23:59:00" },
    ],
  };
}

function context(tables: Tables, failures: Record<string, string> = {}): McpContext {
  return {
    organizationId: "org-1",
    role: "agent",
    actor: { type: "ai_agent", id: "agent-1", role: "ai_operator" },
    apiTokenId: "token-1",
    requestId: "request-1",
    supabase: {
      from: (table: string) => new FakeQuery(tables[table] ?? [], failures[table] ?? null),
    } as never,
  };
}

afterEach(() => vi.useRealTimers());

describe("crm_get_academia_info", () => {
  it("devolve endereço oficial sem vazar o tenant alheio", async () => {
    const result = await crmGetAcademiaInfo.handler(
      { subject: "address" },
      context(baseTables()),
    );

    expect(result).toMatchObject({
      source: "cadastro_operacional",
      schedule_kind: "semanal_regular",
      timezone: "America/Sao_Paulo",
      address: "Rua A, 10",
      missing_fields: [],
      updated_at: "2026-09-11T12:00:00.000Z",
    });
    expect(JSON.stringify(result)).not.toMatch(/org-2|Rua do outro tenant/);
  });

  it("mantém telefone, WhatsApp e e-mail separados e explicita ausências", async () => {
    await expect(crmGetAcademiaInfo.handler(
      { subject: "contact" },
      context(baseTables()),
    )).resolves.toMatchObject({
      contact: { phone: null, whatsapp: "11999998888", email: null },
      missing_fields: ["phone", "email"],
    });
  });

  it("devolve o período regular da segunda-feira e marca domingo como fechado", async () => {
    const ctx = context(baseTables());
    await expect(crmGetAcademiaInfo.handler(
      { subject: "opening_hours", weekday: 1 },
      ctx,
    )).resolves.toMatchObject({
      source: "cadastro_operacional",
      schedule_kind: "semanal_regular",
      timezone: "America/Sao_Paulo",
      opening_hours: {
        weekday: 1,
        day: "Segunda-feira",
        closed: false,
        periods: [{ opens_at: "05:00", closes_at: "23:00" }],
      },
    });
    await expect(crmGetAcademiaInfo.handler(
      { subject: "opening_hours", weekday: 7 },
      ctx,
    )).resolves.toMatchObject({
      opening_hours: { weekday: 7, day: "Domingo", closed: true, periods: [] },
      missing_fields: [],
    });
  });

  it("resolve hoje e agora no fuso da organização", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-14T15:30:00.000Z")); // segunda, 12:30 em São Paulo

    const result = await crmGetAcademiaInfo.handler(
      { subject: "opening_hours", temporal_reference: "now" },
      context(baseTables()),
    );

    expect(result).toMatchObject({
      opening_hours: { weekday: 1, day: "Segunda-feira", closed: false },
      temporal_reference: {
        kind: "now",
        local_date: "2026-09-14",
        local_time: "12:30",
        within_regular_hours: true,
      },
    });
  });

  it("devolve regras públicas sem outros campos do perfil", async () => {
    const result = await crmGetAcademiaInfo.handler(
      { subject: "rules" },
      context(baseTables()),
    );
    expect(result).toMatchObject({ public_rules: "Leve toalha.", missing_fields: [] });
    expect(result).not.toHaveProperty("contact");
    expect(result).not.toHaveProperty("address");
  });

  it("falha fechado quando o módulo está desligado", async () => {
    await expect(crmGetAcademiaInfo.handler(
      { subject: "address" },
      context(baseTables(false)),
    )).rejects.toMatchObject({ code: "module_disabled", status: 403 });
  });

  it("propaga falha de banco com origem estável", async () => {
    await expect(crmGetAcademiaInfo.handler(
      { subject: "contact" },
      context(baseTables(), { academia_profiles: "banco indisponível" }),
    )).rejects.toThrow("consultar_perfil_academia_falhou: banco indisponível");
  });
});
