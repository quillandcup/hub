/** "Heredia, Costa Rica": the city and the country's name, or whichever one is known; null when neither is. */
export function formatPlace(city: string | null | undefined, country: string | null | undefined): string | null {
  let countryName: string | null = null;
  if (country) {
    try {
      countryName = new Intl.DisplayNames(["en"], { type: "region" }).of(country) ?? country;
    } catch {
      countryName = country;
    }
  }
  return [city?.trim() || null, countryName].filter(Boolean).join(", ") || null;
}
