import { describe, expect, it } from "vitest";

import {
  academiaInformationWriteSchema,
  projectOpeningWeek,
} from "@/lib/academia/information";

const base = {
  revision: 0,
  profile: {
    address: "Rua A, 10",
    phone: "1133334444",
    whatsapp: "11999998888",
    email: "contato@example.com",
    public_rules: "Leve toalha.",
  },
  timezone: "America/Sao_Paulo",
  opening_hours: [{ weekday: 1, opens_at: "05:00", closes_at: "23:00" }],
};

describe("informações operacionais da academia", () => {
  it("projeta os sete dias com um período contínuo por dia aberto", () => {
    const parsed = academiaInformationWriteSchema.parse(base);
    const week = projectOpeningWeek(parsed.opening_hours);

    expect(week).toHaveLength(7);
    expect(week[0]).toEqual({
      weekday: 1,
      label: "Segunda-feira",
      closed: false,
      periods: [{ opens_at: "05:00", closes_at: "23:00" }],
    });
    expect(week[1]).toEqual({
      weekday: 2,
      label: "Terça-feira",
      closed: true,
      periods: [],
    });
  });

  it("normaliza campos opcionais vazios sem inventar contato", () => {
    const parsed = academiaInformationWriteSchema.parse({
      ...base,
      profile: {
        address: "  ",
        phone: "",
        whatsapp: null,
        email: "",
        public_rules: null,
      },
    });

    expect(parsed.profile).toEqual({
      address: null,
      phone: null,
      whatsapp: null,
      email: null,
      public_rules: null,
    });
  });

  it("ordena dias sem alterar o horário de parede", () => {
    const parsed = academiaInformationWriteSchema.parse({
      ...base,
      opening_hours: [
        { weekday: 7, opens_at: "08:00", closes_at: "12:00" },
        { weekday: 1, opens_at: "05:00", closes_at: "23:00" },
      ],
    });

    expect(parsed.opening_hours).toEqual([
      { weekday: 1, opens_at: "05:00", closes_at: "23:00" },
      { weekday: 7, opens_at: "08:00", closes_at: "12:00" },
    ]);
  });

  it("recusa dois períodos no mesmo dia", () => {
    expect(
      academiaInformationWriteSchema.safeParse({
        ...base,
        opening_hours: [
          { weekday: 1, opens_at: "05:00", closes_at: "12:00" },
          { weekday: 1, opens_at: "14:00", closes_at: "23:00" },
        ],
      }).success,
    ).toBe(false);
  });

  it.each([
    ["abertura igual ao fechamento", { ...base, opening_hours: [{ weekday: 1, opens_at: "12:00", closes_at: "12:00" }] }],
    ["período atravessando a meia-noite", { ...base, opening_hours: [{ weekday: 1, opens_at: "23:00", closes_at: "05:00" }] }],
    ["dia zero", { ...base, opening_hours: [{ weekday: 0, opens_at: "05:00", closes_at: "12:00" }] }],
    ["dia oito", { ...base, opening_hours: [{ weekday: 8, opens_at: "05:00", closes_at: "12:00" }] }],
    ["hora fora do formato", { ...base, opening_hours: [{ weekday: 1, opens_at: "5:00", closes_at: "12:00" }] }],
    ["fuso inexistente", { ...base, timezone: "Nao/Existe" }],
    ["e-mail inválido", { ...base, profile: { ...base.profile, email: "email-invalido" } }],
    ["endereço acima do teto", { ...base, profile: { ...base.profile, address: "a".repeat(501) } }],
    ["telefone acima do teto", { ...base, profile: { ...base.profile, phone: "1".repeat(33) } }],
    ["WhatsApp acima do teto", { ...base, profile: { ...base.profile, whatsapp: "1".repeat(33) } }],
    ["e-mail acima do teto", { ...base, profile: { ...base.profile, email: `${"a".repeat(310)}@example.com` } }],
    ["regras acima do teto", { ...base, profile: { ...base.profile, public_rules: "a".repeat(5001) } }],
  ])("recusa %s", (_case, input) => {
    expect(academiaInformationWriteSchema.safeParse(input).success).toBe(false);
  });
});
