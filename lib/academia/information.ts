import { z } from "zod";

import { weekdays } from "@/lib/academia/schedule";
import { fusoValido } from "@/lib/tempo/fusos";

const hhmmSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Informe um horário no formato HH:mm.");

function nullableText(maxLength: number) {
  return z
    .string()
    .trim()
    .max(maxLength)
    .nullable()
    .transform((value) => value || null);
}

const nullableEmailSchema = z
  .string()
  .trim()
  .max(320)
  .refine(
    (value) => value === "" || z.email().safeParse(value).success,
    "Informe um e-mail válido.",
  )
  .nullable()
  .transform((value) => value || null);

export const openingPeriodSchema = z
  .object({
    weekday: z.number().int().min(1).max(7),
    opens_at: hhmmSchema,
    closes_at: hhmmSchema,
  })
  .strict()
  .refine((period) => period.opens_at < period.closes_at, {
    message: "O fechamento deve ser posterior à abertura no mesmo dia.",
    path: ["closes_at"],
  });

export const academiaInformationWriteSchema = z
  .object({
    revision: z.number().int().min(0),
    profile: z
      .object({
        address: nullableText(500),
        phone: nullableText(32),
        whatsapp: nullableText(32),
        email: nullableEmailSchema,
        public_rules: nullableText(5000),
      })
      .strict(),
    timezone: z.string().trim().min(1).max(64).refine(fusoValido, "Informe um fuso horário válido."),
    opening_hours: z.array(openingPeriodSchema).max(7),
  })
  .strict()
  .superRefine((value, context) => {
    const seen = new Set<number>();

    value.opening_hours.forEach((period, index) => {
      if (seen.has(period.weekday)) {
        context.addIssue({
          code: "custom",
          message: "Informe no máximo um período por dia.",
          path: ["opening_hours", index, "weekday"],
        });
      }

      seen.add(period.weekday);
    });
  })
  .transform((value) => ({
    ...value,
    opening_hours: [...value.opening_hours].sort((left, right) => left.weekday - right.weekday),
  }));

export type AcademiaInformationWrite = z.infer<typeof academiaInformationWriteSchema>;
export type OpeningPeriod = z.infer<typeof openingPeriodSchema>;

export type OpeningWeekday = {
  weekday: number;
  label: string;
  closed: boolean;
  periods: Array<Pick<OpeningPeriod, "opens_at" | "closes_at">>;
};

export function projectOpeningWeek(periods: OpeningPeriod[]): OpeningWeekday[] {
  const periodsByWeekday = new Map(periods.map((period) => [period.weekday, period]));

  return weekdays.map(({ value, label }) => {
    const period = periodsByWeekday.get(value);

    return {
      weekday: value,
      label,
      closed: !period,
      periods: period
        ? [{ opens_at: period.opens_at, closes_at: period.closes_at }]
        : [],
    };
  });
}
