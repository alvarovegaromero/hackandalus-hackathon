export function resourceSummary(ids: string[]) {
  return (
    [
      ["ambulance-", "Ambulances"],
      ["police-", "Policía"],
      ["civil-guard-", "Guardia Civil"],
    ] as const
  )
    .flatMap(([prefix, label]) => {
      const count = ids.filter((id) => id.startsWith(prefix)).length;
      return count ? [`${count}× ${label}`] : [];
    })
    .join(" · ");
}
