"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  academiaInformationWriteSchema,
  type AcademiaInformationWrite,
} from "@/lib/academia/information";
import { weekdays } from "@/lib/academia/schedule";
import { FUSOS_OFERECIDOS } from "@/lib/tempo/fusos";
import { useT } from "@/hooks/i18n/useT";

type InformationResponse = {
  revision: number;
  profile: AcademiaInformationWrite["profile"];
  timezone: string;
  opening_hours: Array<{
    weekday: number;
    closed: boolean;
    periods: Array<{ opens_at: string; closes_at: string }>;
  }>;
};

function editableInformation(info: InformationResponse): AcademiaInformationWrite {
  return {
    revision: info.revision,
    profile: info.profile,
    timezone: info.timezone,
    opening_hours: info.opening_hours.flatMap((day) =>
      day.closed ? [] : day.periods.map((period) => ({ weekday: day.weekday, ...period })),
    ),
  };
}

function serialized(value: AcademiaInformationWrite) {
  return JSON.stringify(value);
}

export function AcademiaInformation({ canEdit }: { canEdit: boolean }) {
  const t = useT();
  const [information, setInformation] = useState<AcademiaInformationWrite | null>(null);
  const [savedSnapshot, setSavedSnapshot] = useState("");
  const [loadError, setLoadError] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saving, setSaving] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((current) => current + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/v1/academia/information", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("load_failed");
        const body: { data: InformationResponse } = await response.json();
        const loaded = editableInformation(body.data);
        if (!controller.signal.aborted) {
          setInformation(loaded);
          setSavedSnapshot(serialized(loaded));
          setLoadError(false);
          setSaveError("");
        }
      } catch {
        if (!controller.signal.aborted) setLoadError(true);
      }
    })();
    return () => controller.abort();
  }, [reloadKey]);

  const changed = information !== null && serialized(information) !== savedSnapshot;
  const timezoneOptions = useMemo(() => {
    if (!information || FUSOS_OFERECIDOS.some((item) => item.codigo === information.timezone)) {
      return FUSOS_OFERECIDOS;
    }
    return [{ codigo: information.timezone, rotulo: information.timezone }, ...FUSOS_OFERECIDOS];
  }, [information]);

  function updateProfile(field: keyof AcademiaInformationWrite["profile"], value: string) {
    setInformation((current) => current && ({
      ...current,
      profile: { ...current.profile, [field]: value },
    }));
  }

  function toggleDay(weekday: number, open: boolean) {
    setInformation((current) => {
      if (!current) return current;
      const withoutDay = current.opening_hours.filter((period) => period.weekday !== weekday);
      return {
        ...current,
        opening_hours: open
          ? [...withoutDay, { weekday, opens_at: "", closes_at: "" }].sort((a, b) => a.weekday - b.weekday)
          : withoutDay,
      };
    });
  }

  function updatePeriod(weekday: number, field: "opens_at" | "closes_at", value: string) {
    setInformation((current) => current && ({
      ...current,
      opening_hours: current.opening_hours.map((period) =>
        period.weekday === weekday ? { ...period, [field]: value } : period,
      ),
    }));
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!information) return;
    const parsed = academiaInformationWriteSchema.safeParse(information);
    if (!parsed.success) {
      setSaveError(t(parsed.error.issues[0]?.message ?? "Confira os dados informados."));
      return;
    }

    setSaving(true);
    setSaveError("");
    try {
      const response = await fetch("/api/v1/academia/information", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const body = await response.json();
      if (!response.ok) {
        setSaveError(t(body.error?.message ?? "Não foi possível salvar as informações."));
        return;
      }
      const saved = { ...parsed.data, revision: body.data.revision };
      setInformation(saved);
      setSavedSnapshot(serialized(saved));
      toast.success(t("Informações salvas."));
    } catch {
      setSaveError(t("Não foi possível confirmar a gravação. Recarregue para conferir antes de tentar novamente."));
    } finally {
      setSaving(false);
    }
  }

  return <section aria-label={t("Informações da unidade")} className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-xl font-semibold">{t("Informações da unidade")}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("Cadastre os dados oficiais usados pela equipe e pela IA no atendimento.")}</p>
      </div>
      <Button type="button" variant="outline" onClick={reload} disabled={saving}>{t("Atualizar informações")}</Button>
    </div>
    <p className="rounded-lg bg-muted p-3 text-sm">{t("O funcionamento abaixo representa a semana regular. Feriados, recessos e exceções precisam de confirmação humana.")}</p>
    {!canEdit && <p className="text-sm text-muted-foreground">{t("Administradores e gestores podem editar estas informações.")}</p>}
    {loadError && <div role="alert" className="rounded-lg border p-4">
      <p>{t("Não foi possível atualizar as informações. Os dados exibidos podem estar desatualizados.")}</p>
      <Button className="mt-3" type="button" variant="outline" onClick={reload}>{t("Tentar novamente")}</Button>
    </div>}
    {!information && !loadError && <p role="status">{t("Carregando informações…")}</p>}
    {information && <form className="space-y-6" onSubmit={(event) => void save(event)}>
      <fieldset disabled={!canEdit || saving} className="min-w-0 space-y-6">
        <div className="rounded-xl border bg-card p-4 sm:p-5">
          <h3 className="font-semibold">{t("Dados gerais")}</h3>
          <div className="mt-4 grid min-w-0 gap-4 sm:grid-cols-2">
            <div className="min-w-0 space-y-2 sm:col-span-2">
              <Label htmlFor="academia-address">{t("Endereço")}</Label>
              <Textarea id="academia-address" maxLength={500} value={information.profile.address ?? ""} onChange={(event) => updateProfile("address", event.target.value)} />
            </div>
            <div className="min-w-0 space-y-2">
              <Label htmlFor="academia-phone">{t("Telefone")}</Label>
              <Input id="academia-phone" maxLength={32} value={information.profile.phone ?? ""} onChange={(event) => updateProfile("phone", event.target.value)} />
            </div>
            <div className="min-w-0 space-y-2">
              <Label htmlFor="academia-whatsapp">{t("WhatsApp")}</Label>
              <Input id="academia-whatsapp" maxLength={32} value={information.profile.whatsapp ?? ""} onChange={(event) => updateProfile("whatsapp", event.target.value)} />
            </div>
            <div className="min-w-0 space-y-2">
              <Label htmlFor="academia-email">{t("E-mail")}</Label>
              <Input id="academia-email" type="email" maxLength={320} value={information.profile.email ?? ""} onChange={(event) => updateProfile("email", event.target.value)} />
            </div>
            <div className="min-w-0 space-y-2">
              <Label htmlFor="academia-timezone">{t("Fuso horário")}</Label>
              <select id="academia-timezone" className="h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm" value={information.timezone} onChange={(event) => setInformation({ ...information, timezone: event.target.value })}>
                {timezoneOptions.map((option) => <option key={option.codigo} value={option.codigo}>{option.rotulo}</option>)}
              </select>
            </div>
          </div>
        </div>

        <div className="rounded-xl border bg-card p-4 sm:p-5">
          <h3 className="font-semibold">{t("Funcionamento semanal")}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{t("Cada dia aberto tem um único período contínuo de abertura e fechamento.")}</p>
          <div className="mt-4 space-y-3">
            {weekdays.map((day) => {
              const period = information.opening_hours.find((item) => item.weekday === day.value);
              const dayLabel = t(day.label);
              const masculineDay = day.value === 6 || day.value === 7;
              const openLabel = t(masculineDay ? "aberto" : "aberta");
              const stateLabel = t(period
                ? masculineDay ? "Aberto" : "Aberta"
                : masculineDay ? "Fechado" : "Fechada");
              return <div key={day.value} className="grid min-w-0 gap-3 rounded-lg border p-3 sm:grid-cols-[minmax(10rem,1fr)_minmax(8rem,0.7fr)_minmax(8rem,0.7fr)] sm:items-end">
                <label className="flex min-h-10 items-center gap-2 text-sm font-medium">
                  <input type="checkbox" aria-label={`${dayLabel} ${openLabel}`} checked={Boolean(period)} onChange={(event) => toggleDay(day.value, event.target.checked)} />
                  {dayLabel} · {stateLabel}
                </label>
                <div className="min-w-0 space-y-2">
                  <Label htmlFor={`academia-opens-${day.value}`}>{t("Abertura")}</Label>
                  <Input id={`academia-opens-${day.value}`} aria-label={`${t("Abertura de")} ${dayLabel}`} type="time" step={60} required={Boolean(period)} disabled={!canEdit || saving || !period} value={period?.opens_at ?? ""} onChange={(event) => updatePeriod(day.value, "opens_at", event.target.value)} />
                </div>
                <div className="min-w-0 space-y-2">
                  <Label htmlFor={`academia-closes-${day.value}`}>{t("Fechamento")}</Label>
                  <Input id={`academia-closes-${day.value}`} aria-label={`${t("Fechamento de")} ${dayLabel}`} type="time" step={60} required={Boolean(period)} disabled={!canEdit || saving || !period} value={period?.closes_at ?? ""} onChange={(event) => updatePeriod(day.value, "closes_at", event.target.value)} />
                </div>
              </div>;
            })}
          </div>
        </div>

        <div className="rounded-xl border bg-card p-4 sm:p-5">
          <h3 className="font-semibold">{t("Regras e orientações")}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{t("Use texto livre somente para orientações públicas que podem ser informadas ao cliente.")}</p>
          <Textarea className="mt-4 min-h-32" aria-label={t("Regras e orientações")} maxLength={5000} value={information.profile.public_rules ?? ""} onChange={(event) => updateProfile("public_rules", event.target.value)} />
        </div>
      </fieldset>
      {changed && <p role="status" className="text-sm text-muted-foreground">{t("Alterações não salvas.")}</p>}
      {saveError && <p role="alert" className="text-sm text-destructive">{saveError}</p>}
      {canEdit && <div className="flex flex-wrap justify-end gap-3">
        <Button type="button" variant="outline" disabled={!changed || saving} onClick={reload}>{t("Descartar alterações")}</Button>
        <Button type="submit" disabled={!changed || saving}>{t(saving ? "Salvando…" : "Salvar informações")}</Button>
      </div>}
    </form>}
  </section>;
}
