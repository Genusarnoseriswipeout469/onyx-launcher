const os = require("node:os");
const { requiredJavaForMinecraft } = require("./preflight.cjs");

const GIB = 1024 ** 3;

function recommendInstanceResources({
  instance,
  totalMemory = os.totalmem(),
}) {
  const totalGiB = Math.max(2, Math.floor(totalMemory / GIB));
  const safeMaximumGiB = Math.max(2, Math.min(32, totalGiB - 3));
  const loader = String(instance?.loader || "Vanilla").toLowerCase();
  const modCount = Math.max(0, Number(instance?.modCount) || 0);
  const modded = !loader.includes("vanilla") && loader !== "";
  let target = 4;
  let tier = "vanilla";
  if (modded && modCount <= 35) {
    target = 4;
    tier = "light";
  } else if (modded && modCount <= 120) {
    target = 6;
    tier = "medium";
  } else if (modded && modCount <= 220) {
    target = 8;
    tier = "heavy";
  } else if (modded) {
    target = 10;
    tier = "extreme";
  }
  if (totalGiB <= 8) target = Math.min(target, 4);
  if (totalGiB <= 6) target = Math.min(target, 3);
  const memoryGiB = Math.max(2, Math.min(target, safeMaximumGiB));
  return {
    memoryGiB,
    safeMaximumGiB,
    totalMemoryGiB: totalGiB,
    javaMajor:
      instance?.javaMajor ||
      requiredJavaForMinecraft(instance?.version || "1.21"),
    tier,
    modCount,
  };
}

module.exports = {
  GIB,
  recommendInstanceResources,
};
