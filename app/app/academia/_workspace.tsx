"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";
import { AcademiaCatalogs } from "./_catalogs";
import { AcademiaInformation } from "./_information";
import { AcademiaSchedule } from "./_schedule";

export function AcademiaWorkspace({ canEdit }: { canEdit: boolean }) {
  const t = useT();
  const [area, setArea] = useState<"schedule" | "catalogs" | "information">("schedule");
  return <>
    <div className="flex flex-wrap gap-2" aria-label={t("Áreas da academia")}>
      <Button variant={area === "schedule" ? "default" : "outline"} aria-pressed={area === "schedule"} onClick={() => setArea("schedule")}>{t("Grade semanal")}</Button>
      <Button variant={area === "catalogs" ? "default" : "outline"} aria-pressed={area === "catalogs"} onClick={() => setArea("catalogs")}>{t("Cadastros")}</Button>
      <Button variant={area === "information" ? "default" : "outline"} aria-pressed={area === "information"} onClick={() => setArea("information")}>{t("Informações")}</Button>
    </div>
    {area === "schedule" && <AcademiaSchedule canEdit={canEdit} />}
    {area === "catalogs" && <AcademiaCatalogs canEdit={canEdit} />}
    {area === "information" && <AcademiaInformation canEdit={canEdit} />}
  </>;
}
