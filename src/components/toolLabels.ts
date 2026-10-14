const LABELS: Record<string, string> = {
  rechercher_jurisprudence_judiciaire: "Jurisprudence judiciaire",
  rechercher_jurisprudence_administrative: "Jurisprudence administrative",
  rechercher_decisions_constitutionnelles: "Conseil constitutionnel",
  rechercher_decisions_cnil: "Décisions CNIL",
  rechercher_code: "Codes",
  rechercher_dans_texte_legal: "Textes consolidés",
  recherche_journal_officiel: "Journal officiel",
  dernier_journal_officiel: "Derniers JO",
  rechercher_conventions_collectives: "Conventions collectives",
  lister_codes_juridiques: "Liste des codes",
  base_locale: "Base locale",
};

export function toolLabel(name: string): string {
  return LABELS[name] ?? name.replace(/_/g, " ");
}
