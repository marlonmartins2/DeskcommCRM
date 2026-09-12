import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

const pool = new Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${process.env.TEST_DB_PORT}/postgres`,
});

const org = randomUUID();
const otherOrg = randomUUID();
const manager = randomUUID();
const viewer = randomUUID();
const outsider = randomUUID();

async function as(
  user: string,
  query: string,
  args: unknown[] = [],
) {
  const client = await pool.connect();

  try {
    await client.query("begin");
    await client.query("set local role authenticated");
    await client.query("select set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ sub: user, aal: "aal1" }),
    ]);
    const result = await client.query(query, args);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function save(
  user: string,
  targetOrg: string,
  revision: number,
  periods: unknown = [
    { weekday: 1, opens_at: "05:00", closes_at: "23:00" },
  ],
) {
  return as(
    user,
    `select public.fn_salvar_academia_info(
      $1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb
    ) revision`,
    [
      targetOrg,
      revision,
      "Rua A, 10",
      "1133334444",
      "11999998888",
      "contato@example.com",
      "Leve toalha.",
      "America/Sao_Paulo",
      JSON.stringify(periods),
    ],
  );
}

beforeAll(async () => {
  await pool.query(
    `insert into public.organizations(id,slug,legal_name,display_name,settings)
     values
       ($1,$2,'Academia A','Academia A','{"modules":{"academia":true}}'),
       ($3,$4,'Academia B','Academia B','{"modules":{"academia":true}}')`,
    [org, `academia-info-${org}`, otherOrg, `academia-info-${otherOrg}`],
  );
  await pool.query(
    `insert into auth.users(id,email)
     values ($1,$2),($3,$4),($5,$6)`,
    [
      manager,
      `academia-info-manager-${manager}@invariant.test`,
      viewer,
      `academia-info-viewer-${viewer}@invariant.test`,
      outsider,
      `academia-info-outsider-${outsider}@invariant.test`,
    ],
  );
  await pool.query(
    `insert into public.user_organizations(organization_id,user_id,role,accepted_at)
     values ($1,$2,'manager',now()),($1,$3,'viewer',now()),($4,$5,'manager',now())`,
    [org, manager, viewer, otherOrg, outsider],
  );
});

afterAll(() => pool.end());

describe.sequential("informações operacionais da academia no banco", () => {
  it("salva atomicamente e isola a leitura entre organizações", async () => {
    expect((await save(manager, org, 0)).rows[0].revision).toBe(1);

    expect(
      (await as(viewer, "select address from public.academia_profiles where organization_id=$1", [org]))
        .rows[0].address,
    ).toBe("Rua A, 10");
    expect(
      (await as(outsider, "select address from public.academia_profiles where organization_id=$1", [org]))
        .rowCount,
    ).toBe(0);
    expect(
      (await as(viewer, "select weekday,opens_at::text,closes_at::text from public.academia_opening_hours where organization_id=$1", [org]))
        .rows[0],
    ).toEqual({ weekday: 1, opens_at: "05:00:00", closes_at: "23:00:00" });
    expect(
      (await as(outsider, "select weekday from public.academia_opening_hours where organization_id=$1", [org]))
        .rowCount,
    ).toBe(0);
  });

  it("recusa viewer, tenant alheio e revisão antiga", async () => {
    await expect(save(viewer, org, 1)).rejects.toMatchObject({ code: "42501" });
    await expect(save(outsider, org, 1)).rejects.toMatchObject({ code: "42501" });
    await expect(save(manager, org, 0)).rejects.toMatchObject({ code: "40001" });
  });

  it("rejeita segundo período no dia e reverte o agregado inteiro", async () => {
    await expect(
      save(manager, org, 1, [
        { weekday: 1, opens_at: "05:00", closes_at: "12:00" },
        { weekday: 1, opens_at: "14:00", closes_at: "23:00" },
      ]),
    ).rejects.toMatchObject({ code: "22023" });

    const profile = await pool.query(
      "select address,revision from public.academia_profiles where organization_id=$1",
      [org],
    );
    const periods = await pool.query(
      "select opens_at::text,closes_at::text from public.academia_opening_hours where organization_id=$1",
      [org],
    );

    expect(profile.rows[0]).toEqual({ address: "Rua A, 10", revision: 1 });
    expect(periods.rows).toEqual([{ opens_at: "05:00:00", closes_at: "23:00:00" }]);
  });

  it("módulo desligado oculta dados e bloqueia gravação sem apagá-los", async () => {
    await pool.query(
      "update public.organizations set settings=jsonb_set(settings,'{modules,academia}','false'::jsonb,true) where id=$1",
      [org],
    );

    try {
      expect(
        (await as(viewer, "select organization_id from public.academia_profiles where organization_id=$1", [org]))
          .rowCount,
      ).toBe(0);
      await expect(save(manager, org, 1)).rejects.toMatchObject({ code: "42501" });
    } finally {
      await pool.query(
        "update public.organizations set settings=jsonb_set(settings,'{modules,academia}','true'::jsonb,true) where id=$1",
        [org],
      );
    }

    expect(
      (await as(viewer, "select organization_id from public.academia_profiles where organization_id=$1", [org]))
        .rowCount,
    ).toBe(1);
  });

  it("não expõe tabelas ou RPC à anon nem DML direto a authenticated", async () => {
    const privileges = await pool.query(
      `select
        has_table_privilege('anon','public.academia_profiles','select') profile_select,
        has_table_privilege('anon','public.academia_opening_hours','select') hours_select,
        has_function_privilege(
          'anon',
          'public.fn_salvar_academia_info(uuid,integer,text,text,text,text,text,text,jsonb)',
          'execute'
        ) rpc_execute`,
    );

    expect(privileges.rows[0]).toEqual({
      profile_select: false,
      hours_select: false,
      rpc_execute: false,
    });
    await expect(
      as(manager, "update public.academia_profiles set address='Direto' where organization_id=$1", [org]),
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      as(manager, "insert into public.academia_opening_hours(organization_id,weekday,opens_at,closes_at) values($1,2,'08:00','18:00')", [org]),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it.each([
    [{ weekday: 0, opens_at: "05:00", closes_at: "23:00" }],
    [{ weekday: 8, opens_at: "05:00", closes_at: "23:00" }],
    [{ weekday: 1, opens_at: "23:00", closes_at: "05:00" }],
    [{ weekday: 1, opens_at: "05:00:01", closes_at: "23:00" }],
  ])("recusa período inválido pela RPC", async (period) => {
    await expect(save(manager, org, 1, [period])).rejects.toMatchObject({ code: "22023" });
  });
});
