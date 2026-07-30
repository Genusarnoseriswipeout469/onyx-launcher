import {
  Compass,
  Download,
  Home,
  ImageIcon,
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
  { id: "skins", labelKey: "nav.skins", icon: ImageIcon },
];

export const fallbackProjects: CatalogProject[] = [
  {
    project_id: "prominence-fallback",
    project_type: "modpack",
    slug: "prominence-ii-rpg",
    author: "LunaPixelStudios",
    title: "Prominence II: Hasturian Era",
    description:
      "A large RPG adventure with thoughtful progression, bosses, and hundreds of quests.",
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
      "World exploration, creature collecting, and tactical battles.",
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
      "An engineering sandbox with contraptions, factories, trains, and creative building.",
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
      "The familiar Minecraft experience with fast rendering and carefully chosen enhancements.",
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
    category: "UPDATE",
    title: "The version catalog updates automatically",
    text: "Releases and snapshots come directly from the Mojang manifest.",
    tone: "lime",
  },
  {
    id: 2,
    category: "CURATED",
    title: "5 modpacks for cozy survival",
    text: "Farming, decoration, and relaxed exploration.",
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
