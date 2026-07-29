type FormattingLocale = "ru" | "en";

export function formatPlaytime(
  minutes: number,
  locale: FormattingLocale = "ru",
) {
  if (minutes < 60) return `${minutes} ${locale === "ru" ? "мин" : "min"}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${locale === "ru" ? "ч" : "h"}`;
  return locale === "ru"
    ? `${Math.floor(hours / 24)} дн ${hours % 24} ч`
    : `${Math.floor(hours / 24)} d ${hours % 24} h`;
}

export function compactNumber(
  value: number,
  locale: FormattingLocale = "ru",
) {
  return new Intl.NumberFormat(locale === "ru" ? "ru" : "en", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatBytes(
  value = 0,
  locale: FormattingLocale = "ru",
) {
  const units =
    locale === "ru" ? ["Б", "КБ", "МБ", "ГБ"] : ["B", "KB", "MB", "GB"];
  if (!value) return `0 ${units[0]}`;
  const index = Math.min(
    Math.floor(Math.log(value) / Math.log(1024)),
    units.length - 1,
  );
  return `${(value / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}
