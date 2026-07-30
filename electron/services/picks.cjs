const { fetchJson } = require("./network.cjs");

const PICK_DEFINITIONS = [
  {
    id: "fast-and-familiar",
    slug: "fabulously-optimized",
    mood: "performance",
    accent: "lime",
    minimumMemoryGiB: 2,
    recommendedMemoryGiB: 4,
    reason: "fast-and-familiar",
  },
  {
    id: "creature-adventure",
    slug: "cobblemon-fabric",
    mood: "adventure",
    accent: "cyan",
    minimumMemoryGiB: 3,
    recommendedMemoryGiB: 4,
    reason: "creature-adventure",
  },
  {
    id: "story-rpg",
    slug: "prominence-2-fabric",
    mood: "rpg",
    accent: "rose",
    minimumMemoryGiB: 6,
    recommendedMemoryGiB: 8,
    reason: "story-rpg",
  },
  {
    id: "better-vanilla",
    slug: "better-mc-fabric-bmc2",
    mood: "adventure",
    accent: "violet",
    minimumMemoryGiB: 6,
    recommendedMemoryGiB: 8,
    reason: "better-vanilla",
  },
  {
    id: "cozy-long-haul",
    slug: "bcg",
    mood: "cozy",
    accent: "amber",
    minimumMemoryGiB: 6,
    recommendedMemoryGiB: 8,
    reason: "cozy-long-haul",
  },
];

let cachedPicks = null;
let cachedAt = 0;

async function findProject(slug, signal) {
  const params = new URLSearchParams({
    query: slug,
    limit: "10",
    index: "relevance",
    facets: JSON.stringify([["project_type:modpack"]]),
  });
  const response = await fetchJson(
    `https://api.modrinth.com/v2/search?${params.toString()}`,
    { signal },
  );
  return response.hits?.find((project) => project.slug === slug) || null;
}

async function getOnyxPicks({ force = false, signal } = {}) {
  if (!force && cachedPicks && Date.now() - cachedAt < 15 * 60_000) {
    return structuredClone(cachedPicks);
  }
  const resolved = await Promise.all(
    PICK_DEFINITIONS.map(async (definition) => {
      const project = await findProject(definition.slug, signal);
      return project ? { ...definition, project } : null;
    }),
  );
  const picks = resolved.filter(Boolean);
  if (!picks.length) {
    throw new Error("The curated collection is temporarily unavailable");
  }
  cachedPicks = picks;
  cachedAt = Date.now();
  return structuredClone(picks);
}

module.exports = {
  PICK_DEFINITIONS,
  findProject,
  getOnyxPicks,
};
