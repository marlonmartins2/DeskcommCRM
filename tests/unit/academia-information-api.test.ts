import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@/lib/modules/require-academia", () => ({ requireAcademia: vi.fn() }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));

import { GET, PUT } from "@/app/api/v1/academia/information/route";
import { audit } from "@/lib/audit";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { requireAcademia } from "@/lib/modules/require-academia";
import { createClient } from "@/lib/supabase/server";

const org = "a2370000-0000-4000-8000-000000000001";
const actor = "a2370000-0000-4000-8000-000000000002";
const orgMaybeSingle = vi.fn();
const profileMaybeSingle = vi.fn();
const hoursOrder = vi.fn();
const rpc = vi.fn();

function tableQuery(table: string) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    maybeSingle: table === "organizations" ? orgMaybeSingle : profileMaybeSingle,
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.order.mockImplementation(() => hoursOrder());
  return query;
}

const queries = new Map<string, ReturnType<typeof tableQuery>>();
const from = vi.fn((table: string) => {
  const query = tableQuery(table);
  queries.set(table, query);
  return query;
});

const validBody = {
  revision: 0,
  profile: {
    address: "Rua A, 10",
    phone: "1133334444",
    whatsapp: "11999998888",
    email: "contato@example.com",
    public_rules: "Leve toalha.",
  },
  timezone: "America/Sao_Paulo",
  opening_hours: [{ weekday: 1, opens_at: "05:00", closes_at: "12:00" }],
};

function request(body: unknown = validBody) {
  return new Request("http://localhost/api/v1/academia/information", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  queries.clear();
  vi.mocked(requireSupportWrite).mockResolvedValue(null);
  vi.mocked(requireAcademia).mockResolvedValue({
    ok: true,
    org: { orgId: org },
    user: { id: actor },
  } as never);
  orgMaybeSingle.mockResolvedValue({ data: { timezone: "America/Sao_Paulo" }, error: null });
  profileMaybeSingle.mockResolvedValue({ data: null, error: null });
  hoursOrder.mockResolvedValue({ data: [], error: null });
  rpc.mockResolvedValue({ data: 1, error: null });
  vi.mocked(createClient).mockResolvedValue({ from, rpc } as never);
});

it("GET sem perfil devolve revisão zero e os sete dias fechados", async () => {
  const response = await GET();
  const body = await response.json();

  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(body.data).toEqual({
    revision: 0,
    profile: {
      address: null,
      phone: null,
      whatsapp: null,
      email: null,
      public_rules: null,
    },
    timezone: "America/Sao_Paulo",
    opening_hours: expect.arrayContaining([
      { weekday: 1, label: "Segunda-feira", closed: true, periods: [] },
      { weekday: 7, label: "Domingo", closed: true, periods: [] },
    ]),
  });
  expect(body.data.opening_hours).toHaveLength(7);
});

it("GET filtra as três leituras pelo tenant e normaliza TIME", async () => {
  profileMaybeSingle.mockResolvedValue({
    data: { address: "Rua A", phone: null, whatsapp: null, email: null, public_rules: null, revision: 3 },
    error: null,
  });
  hoursOrder.mockResolvedValue({
    data: [{ weekday: 1, opens_at: "05:00:00", closes_at: "23:00:00" }],
    error: null,
  });

  const body = await (await GET()).json();

  expect(queries.get("organizations")?.eq).toHaveBeenCalledWith("id", org);
  expect(queries.get("academia_profiles")?.eq).toHaveBeenCalledWith("organization_id", org);
  expect(queries.get("academia_opening_hours")?.eq).toHaveBeenCalledWith("organization_id", org);
  expect(body.data.opening_hours[0]).toEqual({
    weekday: 1,
    label: "Segunda-feira",
    closed: false,
    periods: [{ opens_at: "05:00", closes_at: "23:00" }],
  });
});

it("PUT deriva tenant da sessão, grava pela RPC e audita apenas metadados seguros", async () => {
  const response = await PUT(request());

  expect(response.status).toBe(200);
  expect(requireSupportWrite).toHaveBeenCalledBefore(vi.mocked(requireAcademia));
  expect(requireAcademia).toHaveBeenCalledWith(expect.any(String), "manager");
  expect(rpc).toHaveBeenCalledWith("fn_salvar_academia_info", {
    p_org: org,
    p_expected_revision: 0,
    p_address: "Rua A, 10",
    p_phone: "1133334444",
    p_whatsapp: "11999998888",
    p_email: "contato@example.com",
    p_public_rules: "Leve toalha.",
    p_timezone: "America/Sao_Paulo",
    p_periods: [{ weekday: 1, opens_at: "05:00", closes_at: "12:00" }],
  });
  expect(audit).toHaveBeenCalledWith(expect.objectContaining({
    action: "academia_info.updated",
    organizationId: org,
    actorUserId: actor,
    metadata: {
      fields_changed: [
        "address",
        "phone",
        "whatsapp",
        "email",
        "public_rules",
        "timezone",
        "opening_hours",
      ],
      opening_periods: 1,
    },
  }));
  expect(JSON.stringify(vi.mocked(audit).mock.calls)).not.toContain("Rua A, 10");
  expect(await response.json()).toEqual({ data: { revision: 1 } });
});

it("PUT rejeita tenant enviado pelo corpo antes de chamar a RPC", async () => {
  const response = await PUT(request({ ...validBody, organization_id: org }));

  expect(response.status).toBe(422);
  expect(rpc).not.toHaveBeenCalled();
  expect(audit).not.toHaveBeenCalled();
});

it("suporte somente leitura é barrado antes do RBAC e do banco", async () => {
  vi.mocked(requireSupportWrite).mockResolvedValue(new Response(null, { status: 403 }) as never);

  expect((await PUT(request())).status).toBe(403);
  expect(requireAcademia).not.toHaveBeenCalled();
  expect(createClient).not.toHaveBeenCalled();
});

it("viewer é barrado pelo papel manager", async () => {
  vi.mocked(requireAcademia).mockResolvedValue({
    ok: false,
    response: new Response(null, { status: 403 }),
  } as never);

  expect((await PUT(request())).status).toBe(403);
  expect(rpc).not.toHaveBeenCalled();
});

it("conflito de revisão da RPC vira 409", async () => {
  rpc.mockResolvedValue({ data: null, error: { code: "40001" } });

  expect((await PUT(request())).status).toBe(409);
  expect(audit).not.toHaveBeenCalled();
});

it.each(["22023", "23514"])("erro de validação %s da RPC vira 422", async (code) => {
  rpc.mockResolvedValue({ data: null, error: { code } });

  expect((await PUT(request())).status).toBe(422);
  expect(audit).not.toHaveBeenCalled();
});
