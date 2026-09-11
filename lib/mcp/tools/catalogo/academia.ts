import { declararTools } from "./tipos";

export const TOOLS_ACADEMIA = declararTools([
  {
    name: "crm_find_academia_classes",
    category: "read",
    rotulo: "Consultar a grade de aulas",
    explicacao:
      "Consulta dias, horários, público, professor e ambiente diretamente na grade semanal cadastrada da academia.",
    oQueToca: "Grade semanal da academia",
    risco: "seguro",
    pacotes: ["vender"],
  },
  {
    name: "crm_get_academia_info",
    category: "read",
    rotulo: "Consultar informações da academia",
    explicacao:
      "Consulta endereço, contatos, funcionamento semanal e regras diretamente nas informações oficiais da academia.",
    oQueToca: "Informações operacionais da academia",
    risco: "seguro",
    pacotes: ["vender"],
  },
]);
