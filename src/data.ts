import {
  Compass,
  Download,
  Home,
  Library,
  Settings,
} from "lucide-react";
import type { TranslationKey } from "./i18n";
import type { CatalogProject, RouteId } from "./types";

export const navigation: Array<{
  id: RouteId;
  labelKey: TranslationKey;
  icon: typeof Home;
}> = [
  { id: "home", labelKey: "nav.home", icon: Home },
  { id: "library", labelKey: "nav.library", icon: Library },
  { id: "discover", labelKey: "nav.discover", icon: Compass },
  { id: "downloads", labelKey: "nav.downloads", icon: Download },
];

export const fallbackProjects: CatalogProject[] = [
  {
    project_id: "prominence-fallback",
    project_type: "modpack",
    slug: "prominence-ii-rpg",
    author: "LunaPixelStudios",
    title: "Prominence II: Hasturian Era",
    description:
      "Большое RPG-приключение с продуманной прогрессией, боссами и сотнями квестов.",
    categories: ["fabric", "adventure", "magic"],
    versions: ["1.20.1"],
    downloads: 8_750_000,
    follows: 88_000,
    icon_url: null,
    date_modified: "2026-01-01",
    latest_version: "",
    license: "LicenseRef-Custom",
    client_side: "required",
    server_side: "required",
  },
  {
    project_id: "cobblemon-fallback",
    project_type: "modpack",
    slug: "cobblemon",
    author: "Cobblemon",
    title: "Cobblemon",
    description:
      "Исследование мира, коллекционирование существ и тактические сражения.",
    categories: ["fabric", "adventure", "multiplayer"],
    versions: ["1.21.1"],
    downloads: 6_420_000,
    follows: 72_400,
    icon_url: null,
    date_modified: "2026-01-01",
    latest_version: "",
    license: "CC-BY-NC",
    client_side: "required",
    server_side: "required",
  },
  {
    project_id: "create-fallback",
    project_type: "modpack",
    slug: "create-perfect-world",
    author: "Community",
    title: "Create: Perfect World",
    description:
      "Инженерная песочница: механизмы, фабрики, поезда и красивое строительство.",
    categories: ["forge", "technology", "optimization"],
    versions: ["1.20.1"],
    downloads: 3_180_000,
    follows: 41_200,
    icon_url: null,
    date_modified: "2026-01-01",
    latest_version: "",
    license: "MIT",
    client_side: "required",
    server_side: "required",
  },
  {
    project_id: "vanilla-plus-fallback",
    project_type: "modpack",
    slug: "vanilla-perfect",
    author: "Onyx Picks",
    title: "Vanilla, Perfected",
    description:
      "Нативное ощущение Minecraft с быстрым рендером и аккуратными улучшениями.",
    categories: ["fabric", "lightweight", "optimization"],
    versions: ["1.21.1"],
    downloads: 1_940_000,
    follows: 26_000,
    icon_url: null,
    date_modified: "2026-01-01",
    latest_version: "",
    license: "MIT",
    client_side: "required",
    server_side: "optional",
  },
];

export const updateFeed = [
  {
    id: 1,
    category: "ОБНОВЛЕНИЕ",
    title: "Каталог версий обновляется автоматически",
    text: "Релизы и снапшоты приходят напрямую из манифеста Mojang.",
    tone: "lime",
  },
  {
    id: 2,
    category: "ПОДБОРКА",
    title: "5 сборок для уютного выживания",
    text: "Фермерство, декор и спокойное исследование.",
    tone: "violet",
  },
];

export const versions = [
  "1.21.6",
  "1.21.5",
  "1.21.4",
  "1.21.1",
  "1.20.1",
  "1.19.2",
  "1.18.2",
];

export const loaders = ["Fabric", "NeoForge", "Forge", "Quilt", "Vanilla"];

export const settingsNav = { id: "settings" as RouteId, icon: Settings };
