import { randomUUID } from "node:crypto";

import { projectOpeningWeek, academiaInformationWriteSchema } from "@/lib/academia/information";
import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { requireAcademia } from "@/lib/modules/require-academia";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const profileFields = "address,phone,whatsapp,email,public_rules,revision";
const openingFields = "weekday,opens_at,closes_at";
const emptyProfile = {
  address: null,
  phone: null,
  whatsapp: null,
  email: null,
  public_rules: null,
};

export async function GET() {
  const requestId = randomUUID();
  const auth = await requireAcademia(requestId);
  if (!auth.ok) return auth.response;

  const db = await createClient();
  const orgId = auth.org.orgId;
  const [organization, profile, openingHours] = await Promise.all([
    db.from("organizations").select("timezone").eq("id", orgId).maybeSingle(),
    db.from("academia_profiles").select(profileFields).eq("organization_id", orgId).maybeSingle(),
    db.from("academia_opening_hours").select(openingFields).eq("organization_id", orgId).order("weekday"),
  ]);

  if (organization.error || profile.error || openingHours.error || !organization.data) {
    return fail("internal_error", "Não foi possível carregar as informações da academia.", 500, { requestId });
  }

  const periods = (openingHours.data ?? []).map((period) => ({
    weekday: period.weekday,
    opens_at: period.opens_at.slice(0, 5),
    closes_at: period.closes_at.slice(0, 5),
  }));
  const profileData = profile.data
    ? {
        address: profile.data.address,
        phone: profile.data.phone,
        whatsapp: profile.data.whatsapp,
        email: profile.data.email,
        public_rules: profile.data.public_rules,
      }
    : emptyProfile;

  return ok({
    revision: profile.data?.revision ?? 0,
    profile: profileData,
    timezone: organization.data.timezone,
    opening_hours: projectOpeningWeek(periods),
  }, {
    requestId,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function PUT(request: Request) {
  const denied = await requireSupportWrite();
  if (denied) return denied;

  const requestId = randomUUID();
  const auth = await requireAcademia(requestId, "manager");
  if (!auth.ok) return auth.response;

  const parsed = academiaInformationWriteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return fail(
      "validation_failed",
      parsed.error.issues[0]?.message ?? "Dados inválidos.",
      422,
      { requestId },
    );
  }

  const { revision, profile, timezone, opening_hours: openingHours } = parsed.data;
  const { data, error } = await (await createClient()).rpc("fn_salvar_academia_info", {
    p_org: auth.org.orgId,
    p_expected_revision: revision,
    p_address: profile.address,
    p_phone: profile.phone,
    p_whatsapp: profile.whatsapp,
    p_email: profile.email,
    p_public_rules: profile.public_rules,
    p_timezone: timezone,
    p_periods: openingHours,
  } as never);

  if (error?.code === "40001") {
    return fail("conflict", "Estas informações foram alteradas. Recarregue a página antes de salvar novamente.", 409, { requestId });
  }
  if (error?.code === "22023" || error?.code === "23514") {
    return fail("validation_failed", "Confira os dados e os horários informados.", 422, { requestId });
  }
  if (error?.code === "42501") {
    return fail("forbidden", "Você não tem permissão para salvar estas informações.", 403, { requestId });
  }
  if (error || typeof data !== "number") {
    return fail("internal_error", "Não foi possível salvar as informações da academia.", 500, { requestId });
  }

  await audit({
    action: "academia_info.updated",
    organizationId: auth.org.orgId,
    actorUserId: auth.user.id,
    resourceType: "academia_profiles",
    resourceId: auth.org.orgId,
    requestId,
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
      opening_periods: openingHours.length,
    },
  });

  return ok({ revision: data }, { requestId });
}
