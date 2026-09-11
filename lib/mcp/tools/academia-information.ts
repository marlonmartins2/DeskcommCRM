/** Consulta read-only das informações operacionais oficiais da academia. */
import { z } from "zod";

import { projectOpeningWeek, type OpeningPeriod } from "@/lib/academia/information";
import { ApiError } from "@/lib/api/types";
import { lerModulos } from "@/lib/modules/config";
import type { McpContext, McpToolDefinition } from "../types";

const inputShape = {
  subject: z.enum(["address", "contact", "opening_hours", "rules"]),
  weekday: z.number().int().min(1).max(7).optional(),
  temporal_reference: z.enum(["today", "now"]).optional(),
};

interface OrganizationRow {
  settings: unknown;
  timezone: string;
}

interface ProfileRow {
  address: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  public_rules: string | null;
  updated_at: string;
}

interface OpeningRow {
  weekday: number;
  opens_at: string;
  closes_at: string;
  updated_at?: string;
}

const notice =
  "Horário semanal regular. Feriados, recessos e exceções precisam de confirmação humana.";

function localNow(timezone: string, now = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(now).map((part) => [part.type, part.value]),
  );
  const localDate = `${parts.year}-${parts.month}-${parts.day}`;
  const localTime = `${parts.hour}:${parts.minute}`;
  const day = new Date(`${localDate}T00:00:00.000Z`).getUTCDay();
  return { localDate, localTime, weekday: day === 0 ? 7 : day };
}

function latestTimestamp(profile: ProfileRow | null, hours: OpeningRow[]) {
  return [profile?.updated_at, ...hours.map((row) => row.updated_at)]
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null;
}

async function profileFor(ctx: McpContext): Promise<ProfileRow | null> {
  const { data, error } = await ctx.supabase
    .from("academia_profiles")
    .select("address,phone,whatsapp,email,public_rules,updated_at")
    .eq("organization_id", ctx.organizationId)
    .maybeSingle();
  if (error) throw new Error(`consultar_perfil_academia_falhou: ${error.message}`);
  return data as ProfileRow | null;
}

export const crmGetAcademiaInfo: McpToolDefinition<typeof inputShape> = {
  name: "crm_get_academia_info",
  description:
    "Consulta endereço, contatos, horário de funcionamento semanal regular ou regras públicas " +
    "diretamente no cadastro operacional da academia. Use antes de responder esses dados. " +
    "Não confirma feriados, recessos ou exceções; nesses casos peça atendimento humano.",
  inputSchema: inputShape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  handler: async (input, ctx) => {
    const { data, error } = await ctx.supabase
      .from("organizations")
      .select("settings,timezone")
      .eq("id", ctx.organizationId)
      .maybeSingle();
    if (error) throw new Error(`consultar_modulo_academia_falhou: ${error.message}`);
    const organization = data as OrganizationRow | null;
    if (!organization || !lerModulos(organization.settings).academia) {
      throw new ApiError(
        403,
        "module_disabled",
        undefined,
        ctx.requestId,
        "O módulo Academia está desativado nesta empresa.",
      );
    }

    const profile = await profileFor(ctx);
    const base = {
      source: "cadastro_operacional" as const,
      schedule_kind: "semanal_regular" as const,
      timezone: organization.timezone,
      exception_notice: notice,
    };

    if (input.subject === "address") {
      return {
        ...base,
        address: profile?.address ?? null,
        missing_fields: profile?.address ? [] : ["address"],
        updated_at: profile?.updated_at ?? null,
      };
    }
    if (input.subject === "contact") {
      const contact = {
        phone: profile?.phone ?? null,
        whatsapp: profile?.whatsapp ?? null,
        email: profile?.email ?? null,
      };
      return {
        ...base,
        contact,
        missing_fields: Object.entries(contact)
          .filter(([, value]) => !value)
          .map(([field]) => field),
        updated_at: profile?.updated_at ?? null,
      };
    }
    if (input.subject === "rules") {
      return {
        ...base,
        public_rules: profile?.public_rules ?? null,
        missing_fields: profile?.public_rules ? [] : ["public_rules"],
        updated_at: profile?.updated_at ?? null,
      };
    }

    const { data: hoursData, error: hoursError } = await ctx.supabase
      .from("academia_opening_hours")
      .select("weekday,opens_at,closes_at,updated_at")
      .eq("organization_id", ctx.organizationId)
      .order("weekday");
    if (hoursError) {
      throw new Error(`consultar_funcionamento_academia_falhou: ${hoursError.message}`);
    }
    const hours = (hoursData ?? []) as OpeningRow[];
    const periods: OpeningPeriod[] = hours.map((row) => ({
      weekday: row.weekday,
      opens_at: row.opens_at.slice(0, 5),
      closes_at: row.closes_at.slice(0, 5),
    }));
    const week = projectOpeningWeek(periods);
    const temporal = input.temporal_reference
      ? localNow(organization.timezone)
      : null;
    const selectedWeekday = temporal?.weekday ?? input.weekday;
    const selected = selectedWeekday
      ? week.find((day) => day.weekday === selectedWeekday)
      : undefined;
    const openingHours = selected
      ? {
          weekday: selected.weekday,
          day: selected.label,
          closed: selected.closed,
          periods: selected.periods,
        }
      : week.map((day) => ({
          weekday: day.weekday,
          day: day.label,
          closed: day.closed,
          periods: day.periods,
        }));
    const withinRegularHours = selected && temporal && input.temporal_reference === "now"
      ? !selected.closed && selected.periods.some(
          (period) => temporal.localTime >= period.opens_at && temporal.localTime < period.closes_at,
        )
      : undefined;

    return {
      ...base,
      opening_hours: openingHours,
      missing_fields: [],
      updated_at: latestTimestamp(profile, hours),
      ...(temporal && input.temporal_reference
        ? {
            temporal_reference: {
              kind: input.temporal_reference,
              local_date: temporal.localDate,
              ...(input.temporal_reference === "now"
                ? { local_time: temporal.localTime, within_regular_hours: withinRegularHours }
                : {}),
            },
          }
        : {}),
    };
  },
};
