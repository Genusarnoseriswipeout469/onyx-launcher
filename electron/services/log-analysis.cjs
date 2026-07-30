const RULES = [
  {
    code: "out-of-memory",
    pattern: /OutOfMemoryError|Java heap space|GC overhead limit exceeded/i,
    severity: "error",
    title: "Minecraft ran out of memory",
    message:
      "Increase the instance memory by 2–4 GB or disable resource-heavy mods and resource packs.",
  },
  {
    code: "wrong-java",
    pattern:
      /UnsupportedClassVersionError|class file version \d+\.0|only recognizes class file versions/i,
    severity: "error",
    title: "Incompatible Java version",
    message:
      "Reset the custom Java path so Onyx can select a compatible version automatically.",
  },
  {
    code: "missing-dependency",
    pattern:
      /ModResolutionException|requires .+ but|missing (?:mandatory )?dependencies|Dependency resolution failed/i,
    severity: "error",
    title: "A mod dependency is missing",
    message:
      "Open the instance content and update its mods. The log below identifies the missing dependency.",
  },
  {
    code: "mixin-conflict",
    pattern:
      /MixinApplyError|MixinTransformerError|mixin.+(?:failed|error)|InjectionError/i,
    severity: "error",
    title: "Mod or mixin conflict",
    message:
      "A mod is incompatible with the current game version. Update the mods or temporarily disable the newest ones one at a time.",
  },
  {
    code: "native-crash",
    pattern: /EXCEPTION_ACCESS_VIOLATION|A fatal error has been detected by the Java Runtime/i,
    severity: "warning",
    title: "Driver or native library crash",
    message:
      "Update the graphics driver, disable overlays, and check rendering mods. Your world is not corrupted.",
  },
  {
    code: "disk-full",
    pattern:
      /No space left on device|There is not enough space/i,
    severity: "error",
    title: "The disk is full",
    message:
      "Free some space or use the safe migration option in Settings to move the instances directory.",
  },
  {
    code: "authentication",
    pattern:
      /InvalidCredentialsException|Failed to log in|authentication servers are down/i,
    severity: "warning",
    title: "Authentication problem",
    message:
      "Switch Microsoft accounts or try again after the services recover.",
  },
  {
    code: "corrupted-file",
    pattern:
      /zip END header not found|invalid (?:LOC|CEN) header|zip file is empty|checksum (?:failed|mismatch)|hash mismatch/i,
    severity: "error",
    title: "A game or mod file is corrupted",
    message:
      "Run automatic repair so Onyx downloads only the corrupted files again.",
  },
  {
    code: "bad-jvm-arguments",
    pattern:
      /Unrecognized VM option|Could not create the Java Virtual Machine|Invalid maximum heap size/i,
    severity: "error",
    title: "Java rejected the launch arguments",
    message:
      "Reset the custom JVM arguments and check the allocated memory.",
  },
  {
    code: "graphics-init",
    pattern:
      /GLFW error|OpenGL[^\n]*(?:not supported|failed|error)|Failed to create window|Pixel format launch/i,
    severity: "error",
    title: "Minecraft could not initialize graphics",
    message:
      "Update the graphics driver and disable incompatible rendering mods or overlays.",
  },
  {
    code: "permission-denied",
    pattern:
      /AccessDeniedException|Permission denied/i,
    severity: "error",
    title: "Instance files are not accessible",
    message:
      "Check the folder owner and permissions, or move the instances to an accessible directory.",
  },
];

function analyzeMinecraftLog(content = "") {
  const text = String(content).slice(-500_000);
  return RULES.filter((rule) => rule.pattern.test(text)).map(
    ({ pattern: _pattern, ...diagnosis }) => diagnosis,
  );
}

module.exports = {
  RULES,
  analyzeMinecraftLog,
};
