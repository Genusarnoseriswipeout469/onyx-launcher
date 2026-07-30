const fsp = require("node:fs/promises");
const os = require("node:os");
const { execFile } = require("node:child_process");

function execFileResult(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { windowsHide: true, timeout: 4_000, ...options },
      (error, stdout) => {
        if (error) reject(error);
        else resolve(String(stdout || "").trim());
      },
    );
  });
}

function parseCpuTime(value) {
  const text = String(value || "").trim();
  const [dayPart, clockPart] = text.includes("-")
    ? text.split("-", 2)
    : ["0", text];
  const parts = clockPart.split(":").map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return 0;
  const seconds =
    parts.length === 3
      ? parts[0] * 3600 + parts[1] * 60 + parts[2]
      : parts.length === 2
        ? parts[0] * 60 + parts[1]
        : parts[0] || 0;
  return (Number(dayPart) * 86_400 + seconds) * 1_000;
}

async function sampleLinuxProcess(pid) {
  const [status, schedstat] = await Promise.all([
    fsp.readFile(`/proc/${pid}/status`, "utf8"),
    fsp.readFile(`/proc/${pid}/schedstat`, "utf8"),
  ]);
  const rssKiB = Number(status.match(/^VmRSS:\s+(\d+)\s+kB$/m)?.[1] || 0);
  const runtimeNs = Number(schedstat.trim().split(/\s+/)[0] || 0);
  return {
    rssBytes: rssKiB * 1024,
    cpuTimeMs: runtimeNs / 1_000_000,
  };
}

async function sampleWindowsProcess(pid) {
  const output = await execFileResult("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    `$p=Get-Process -Id ${Number(pid)} -ErrorAction Stop; [Console]::Write(('{0}|{1}' -f $p.WorkingSet64,$p.TotalProcessorTime.TotalMilliseconds))`,
  ]);
  const [rssBytes, cpuTimeMs] = output.split("|").map(Number);
  if (!Number.isFinite(rssBytes) || !Number.isFinite(cpuTimeMs)) {
    throw new Error("Failed to read Minecraft process metrics");
  }
  return { rssBytes, cpuTimeMs };
}

async function sampleDarwinProcess(pid) {
  const output = await execFileResult("ps", [
    "-o",
    "rss=",
    "-o",
    "cputime=",
    "-p",
    String(pid),
  ]);
  const match = output.match(/^\s*(\d+)\s+(.+?)\s*$/);
  if (!match) throw new Error("Failed to read process metrics");
  return {
    rssBytes: Number(match[1]) * 1024,
    cpuTimeMs: parseCpuTime(match[2]),
  };
}

async function sampleProcess(pid, platform = process.platform) {
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error("Invalid Minecraft process ID");
  }
  if (platform === "linux") return sampleLinuxProcess(pid);
  if (platform === "win32") return sampleWindowsProcess(pid);
  if (platform === "darwin") return sampleDarwinProcess(pid);
  throw new Error(`Metrics collection is not supported on ${platform}`);
}

function downsampleTimeline(values, limit = 60) {
  if (values.length <= limit) return values;
  const output = [];
  for (let index = 0; index < limit; index += 1) {
    const sourceIndex = Math.round(
      (index / Math.max(limit - 1, 1)) * (values.length - 1),
    );
    output.push(values[sourceIndex]);
  }
  return output;
}

function buildInsights(summary, allocatedMemoryGiB, exitCode) {
  const insights = [];
  const allocatedBytes = Number(allocatedMemoryGiB || 0) * 1024 ** 3;
  if (allocatedBytes && summary.peakRssBytes >= allocatedBytes * 0.9) {
    insights.push({
      code: "memory-pressure",
      severity: "warning",
      value: summary.peakRssBytes,
    });
  } else if (
    allocatedMemoryGiB >= 6 &&
    summary.peakRssBytes > 0 &&
    summary.peakRssBytes <= allocatedBytes * 0.45
  ) {
    insights.push({
      code: "memory-overallocated",
      severity: "info",
      value: summary.recommendedMemoryGiB,
    });
  }
  if (summary.startupMs != null && summary.startupMs > 60_000) {
    insights.push({
      code: "slow-startup",
      severity: "warning",
      value: summary.startupMs,
    });
  }
  if (summary.maxGcPauseMs >= 500) {
    insights.push({
      code: "long-gc-pause",
      severity: "warning",
      value: summary.maxGcPauseMs,
    });
  }
  if (summary.outOfMemory) {
    insights.unshift({
      code: "out-of-memory",
      severity: "error",
      value: summary.peakRssBytes,
    });
  } else if (exitCode !== 0 && summary.durationMs < 45_000) {
    insights.push({
      code: "early-crash",
      severity: "warning",
      value: summary.durationMs,
    });
  }
  if (!insights.length && summary.sampleCount > 0) {
    insights.push({
      code: "stable-session",
      severity: "info",
      value: summary.peakRssBytes,
    });
  }
  return insights.slice(0, 4);
}

function buildRegressionInsights(current, baseline) {
  if (!current?.available || !baseline?.available) return [];
  const insights = [];
  const currentFps = Number(current.fps?.averageFps);
  const baselineFps = Number(baseline.fps?.averageFps);
  if (
    current.fps?.available &&
    baseline.fps?.available &&
    Number.isFinite(currentFps) &&
    Number.isFinite(baselineFps) &&
    baselineFps >= 30
  ) {
    const dropPercent = ((baselineFps - currentFps) / baselineFps) * 100;
    if (dropPercent >= 15 && baselineFps - currentFps >= 5) {
      insights.push({
        code: "fps-regression",
        severity: "warning",
        value: Math.round(dropPercent * 10) / 10,
      });
    }
  }

  const currentStartup = Number(current.startupMs);
  const baselineStartup = Number(baseline.startupMs);
  if (
    Number.isFinite(currentStartup) &&
    Number.isFinite(baselineStartup) &&
    baselineStartup > 0
  ) {
    const increasePercent =
      ((currentStartup - baselineStartup) / baselineStartup) * 100;
    if (
      increasePercent >= 20 &&
      currentStartup - baselineStartup >= 5_000
    ) {
      insights.push({
        code: "startup-regression",
        severity: "warning",
        value: Math.round(increasePercent * 10) / 10,
      });
    }
  }

  const currentMemory = Number(current.peakRssBytes);
  const baselineMemory = Number(baseline.peakRssBytes);
  if (
    Number.isFinite(currentMemory) &&
    Number.isFinite(baselineMemory) &&
    baselineMemory > 0
  ) {
    const increasePercent =
      ((currentMemory - baselineMemory) / baselineMemory) * 100;
    if (
      increasePercent >= 20 &&
      currentMemory - baselineMemory >= 256 * 1024 ** 2
    ) {
      insights.push({
        code: "memory-regression",
        severity: "warning",
        value: Math.round(increasePercent * 10) / 10,
      });
    }
  }

  return insights;
}

class FlightRecorder {
  constructor({
    startedAt = Date.now(),
    allocatedMemoryGiB = 6,
    sampleIntervalMs = 5_000,
    sampleProvider = sampleProcess,
    now = () => Date.now(),
  } = {}) {
    this.startedAt = startedAt;
    this.allocatedMemoryGiB = allocatedMemoryGiB;
    this.sampleIntervalMs = sampleIntervalMs;
    this.sampleProvider = sampleProvider;
    this.now = now;
    this.pid = null;
    this.timer = null;
    this.sampling = false;
    this.stopped = false;
    this.previous = null;
    this.sampleCount = 0;
    this.rssTotal = 0;
    this.cpuTotal = 0;
    this.cpuSamples = 0;
    this.peakRssBytes = 0;
    this.peakCpuPercent = 0;
    this.timeline = [];
    this.readyAt = null;
    this.worldReadyAt = null;
    this.gcEvents = 0;
    this.maxGcPauseMs = 0;
    this.outOfMemory = false;
  }

  attach(pid) {
    if (this.stopped || this.timer) return;
    this.pid = Number(pid);
    void this.sample();
    this.timer = setInterval(() => void this.sample(), this.sampleIntervalMs);
    this.timer.unref?.();
  }

  ingestLog(text) {
    const value = String(text || "");
    const at = this.now();
    if (
      this.readyAt == null &&
      /(Backend library:|LWJGL Version|OpenAL initialized|Sound engine started)/i.test(
        value,
      )
    ) {
      this.readyAt = at;
    }
    if (
      this.worldReadyAt == null &&
      /(Loaded \d+ advancements|Preparing spawn area:\s*100%|Joined a game)/i.test(
        value,
      )
    ) {
      this.worldReadyAt = at;
    }
    for (const match of value.matchAll(
      /\b(?:Pause[^\r\n]*?|GC\(\d+\)[^\r\n]*?)(\d+(?:\.\d+)?)ms/gi,
    )) {
      const duration = Number(match[1]);
      if (!Number.isFinite(duration)) continue;
      this.gcEvents += 1;
      this.maxGcPauseMs = Math.max(this.maxGcPauseMs, duration);
    }
    if (
      /(OutOfMemoryError|Java heap space|unable to create new native thread)/i.test(
        value,
      )
    ) {
      this.outOfMemory = true;
    }
  }

  async sample() {
    if (this.stopped || this.sampling || !this.pid) return;
    this.sampling = true;
    try {
      const at = this.now();
      const current = await this.sampleProvider(this.pid);
      const rssBytes = Math.max(0, Number(current.rssBytes || 0));
      this.sampleCount += 1;
      this.rssTotal += rssBytes;
      this.peakRssBytes = Math.max(this.peakRssBytes, rssBytes);
      let cpuPercent = 0;
      if (this.previous) {
        const elapsed = at - this.previous.at;
        const cpuElapsed =
          Number(current.cpuTimeMs || 0) - this.previous.cpuTimeMs;
        if (elapsed > 0 && cpuElapsed >= 0) {
          cpuPercent = Math.min(
            os.cpus().length * 100,
            (cpuElapsed / elapsed) * 100,
          );
          this.cpuTotal += cpuPercent;
          this.cpuSamples += 1;
          this.peakCpuPercent = Math.max(this.peakCpuPercent, cpuPercent);
        }
      }
      this.previous = {
        at,
        cpuTimeMs: Number(current.cpuTimeMs || 0),
      };
      this.timeline.push({
        atSeconds: Math.max(0, Math.round((at - this.startedAt) / 1_000)),
        rssBytes,
        cpuPercent: Math.round(cpuPercent * 10) / 10,
      });
      if (this.timeline.length > 240) {
        this.timeline = this.timeline.filter(
          (_sample, index) => index % 2 === 0,
        );
      }
    } catch {
      // The process may be between spawn and initialization, or already gone.
    } finally {
      this.sampling = false;
    }
  }

  async stop({ exitCode = null, endedAt = this.now() } = {}) {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (!this.stopped) await this.sample();
    this.stopped = true;
    const peakGiB = this.peakRssBytes / 1024 ** 3;
    const recommendedMemoryGiB = Math.max(
      2,
      Math.min(32, Math.ceil(Math.max(1.5, peakGiB * 1.3))),
    );
    const summary = {
      available: this.sampleCount > 0,
      durationMs: Math.max(0, endedAt - this.startedAt),
      sampleCount: this.sampleCount,
      peakRssBytes: this.peakRssBytes,
      averageRssBytes: this.sampleCount
        ? Math.round(this.rssTotal / this.sampleCount)
        : 0,
      averageCpuPercent: this.cpuSamples
        ? Math.round((this.cpuTotal / this.cpuSamples) * 10) / 10
        : 0,
      peakCpuPercent: Math.round(this.peakCpuPercent * 10) / 10,
      startupMs:
        this.readyAt == null ? null : Math.max(0, this.readyAt - this.startedAt),
      worldReadyMs:
        this.worldReadyAt == null
          ? null
          : Math.max(0, this.worldReadyAt - this.startedAt),
      gcEvents: this.gcEvents,
      maxGcPauseMs: this.maxGcPauseMs,
      outOfMemory: this.outOfMemory,
      recommendedMemoryGiB,
      timeline: downsampleTimeline(this.timeline),
      insights: [],
    };
    summary.insights = buildInsights(
      summary,
      this.allocatedMemoryGiB,
      exitCode,
    );
    return summary;
  }
}

module.exports = {
  parseCpuTime,
  sampleProcess,
  downsampleTimeline,
  buildInsights,
  buildRegressionInsights,
  FlightRecorder,
};
