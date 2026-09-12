import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

type InformationPayload = {
  revision: number;
  profile: {
    address: string | null;
    phone: string | null;
    whatsapp: string | null;
    email: string | null;
    public_rules: string | null;
  };
  timezone: string;
  opening_hours: Array<{
    weekday: number;
    closed: boolean;
    periods: Array<{ opens_at: string; closes_at: string }>;
  }>;
};

function writePayload(info: InformationPayload) {
  return {
    revision: info.revision,
    profile: info.profile,
    timezone: info.timezone,
    opening_hours: info.opening_hours.flatMap((day) =>
      day.closed ? [] : day.periods.map((period) => ({ weekday: day.weekday, ...period })),
    ),
  };
}

// Opt-in: instalação dedicada com dono criado por bootstrap-owner. O estado
// anterior é restaurado ao final, inclusive quando a asserção intermediária falha.
test("informações da academia persistem, detectam conflito e cabem no celular", async ({ page }) => {
  test.skip(!process.env.ACADEMIA_E2E_EMAIL || !process.env.ACADEMIA_E2E_PASSWORD);
  test.setTimeout(120_000);
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));

  await page.goto("/login");
  await page.locator("#email").fill(process.env.ACADEMIA_E2E_EMAIL!);
  await page.locator("#password").fill(process.env.ACADEMIA_E2E_PASSWORD!);
  await page.getByRole("button", { name: /entrar/i }).click();
  await page.waitForURL(/\/app(?:\/|$)/);
  await page.getByRole("link", { name: "Minha Academia", exact: true }).click();

  const originalResponse = await page.request.get("/api/v1/academia/information");
  expect(originalResponse.status()).toBe(200);
  const original = (await originalResponse.json()).data as InformationPayload;

  try {
    await page.getByRole("button", { name: "Informações", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Informações da unidade", exact: true })).toBeVisible();
    await page.getByLabel("Endereço", { exact: true }).fill("Rua da Verificação, 10");
    await page.getByLabel("Telefone", { exact: true }).fill("1133334444");
    await page.getByLabel("WhatsApp", { exact: true }).fill("11999998888");
    await page.getByLabel("E-mail", { exact: true }).fill("academia@example.com");
    await page.getByLabel("Regras e orientações", { exact: true }).fill("Leve toalha.");
    await page.getByLabel("Segunda-feira aberta").check();
    await page.getByLabel("Abertura de Segunda-feira").fill("23:00");
    await page.getByLabel("Fechamento de Segunda-feira").fill("05:00");
    await page.getByRole("button", { name: "Salvar informações", exact: true }).click();
    await expect(page.locator('p[role="alert"]')).toContainText(
      "O fechamento deve ser posterior à abertura",
    );
    await page.getByLabel("Abertura de Segunda-feira").fill("05:00");
    await page.getByLabel("Fechamento de Segunda-feira").fill("23:00");
    const sunday = page.getByLabel("Domingo aberto");
    if (await sunday.isChecked()) await sunday.uncheck();
    await expect(page.getByLabel("Domingo aberto")).not.toBeChecked();

    const saved = page.waitForResponse((response) =>
      response.url().endsWith("/api/v1/academia/information") && response.request().method() === "PUT",
    );
    await page.getByRole("button", { name: "Salvar informações", exact: true }).click();
    expect((await saved).status()).toBe(200);
    await expect(page.getByText("Informações salvas.", { exact: true })).toBeVisible();

    await page.reload();
    await page.getByRole("button", { name: "Informações", exact: true }).click();
    await expect(page.getByLabel("Endereço", { exact: true })).toHaveValue("Rua da Verificação, 10");
    await expect(page.getByLabel("Abertura de Segunda-feira")).toHaveValue("05:00");
    await expect(page.getByLabel("Domingo aberto")).not.toBeChecked();
    await page.screenshot({ path: ".superpowers/evidence/informacoes-desktop.png", fullPage: true });

    const freshResponse = await page.request.get("/api/v1/academia/information");
    const fresh = (await freshResponse.json()).data as InformationPayload;
    const concurrent = await page.request.put("/api/v1/academia/information", {
      data: {
        ...writePayload(fresh),
        profile: { ...fresh.profile, public_rules: "Alteração concorrente." },
      },
    });
    expect(concurrent.status()).toBe(200);
    await page.getByLabel("Regras e orientações", { exact: true }).fill("Tentativa com revisão antiga.");
    await page.getByRole("button", { name: "Salvar informações", exact: true }).click();
    await expect(page.locator('p[role="alert"]')).toContainText("Recarregue a página");

    await page.reload();
    await page.getByRole("button", { name: "Informações", exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page.getByLabel("Fechamento de Segunda-feira")).toBeVisible();
    await page.screenshot({ path: ".superpowers/evidence/informacoes-mobile.png", fullPage: true });
    expect(browserErrors).toEqual([]);
  } finally {
    const currentResponse = await page.request.get("/api/v1/academia/information");
    if (currentResponse.ok()) {
      const current = (await currentResponse.json()).data as InformationPayload;
      const restored = await page.request.put("/api/v1/academia/information", {
        data: { ...writePayload(original), revision: current.revision },
      });
      expect(restored.status()).toBe(200);
    }
  }
});

test("perfil de consulta vê os dados sem receber ações de gravação", async ({ page }) => {
  test.skip(!process.env.ACADEMIA_E2E_EMAIL || !process.env.ACADEMIA_E2E_PASSWORD);
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  await page.goto("/login");
  await page.locator("#email").fill(process.env.ACADEMIA_E2E_EMAIL!);
  await page.locator("#password").fill(process.env.ACADEMIA_E2E_PASSWORD!);
  await page.getByRole("button", { name: /entrar/i }).click();
  await page.waitForURL(/\/app(?:\/|$)/);
  const interfaceResponse = await page.request.get("/api/v1/auth/interface");
  expect(interfaceResponse.status()).toBe(200);
  const organizationId = (await interfaceResponse.json()).data.organization_id as string;
  const { data: listed, error: usersError } = await admin.auth.admin.listUsers({ perPage: 200 });
  expect(usersError).toBeNull();
  const user = listed.users.find((item) => item.email === process.env.ACADEMIA_E2E_EMAIL);
  expect(user).toBeTruthy();
  const { data: membership, error: membershipError } = await admin
    .from("user_organizations")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", user!.id)
    .maybeSingle();
  expect(membershipError).toBeNull();
  expect(membership).toBeTruthy();
  const originalRole = membership!.role;

  const { error: downgradeError } = await admin
    .from("user_organizations")
    .update({ role: "viewer" })
    .eq("organization_id", organizationId)
    .eq("user_id", user!.id);
  expect(downgradeError).toBeNull();

  try {
    await page.goto("/app/academia");
    await page.getByRole("button", { name: "Informações", exact: true }).click();
    await expect(page.getByText("Administradores e gestores podem editar estas informações.")).toBeVisible();
    await expect(page.getByLabel("Endereço", { exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Salvar informações", exact: true })).toHaveCount(0);
  } finally {
    const { error: restoreError } = await admin
      .from("user_organizations")
      .update({ role: originalRole })
      .eq("organization_id", organizationId)
      .eq("user_id", user!.id);
    expect(restoreError).toBeNull();
  }
});
