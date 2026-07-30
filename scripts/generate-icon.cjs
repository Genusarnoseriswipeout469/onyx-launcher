const { app, BrowserWindow } = require("electron");
const fsp = require("node:fs/promises");
const path = require("node:path");

function pngToIco(png) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);

  const entry = Buffer.alloc(16);
  entry.writeUInt8(0, 0);
  entry.writeUInt8(0, 1);
  entry.writeUInt8(0, 2);
  entry.writeUInt8(0, 3);
  entry.writeUInt16LE(1, 4);
  entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(png.length, 8);
  entry.writeUInt32LE(22, 12);
  return Buffer.concat([header, entry, png]);
}

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 256,
    height: 256,
    frame: false,
    show: false,
    backgroundColor: "#080a0c",
    webPreferences: { backgroundThrottling: false },
  });
  const svg = `
    <svg width="256" height="256" viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="28" y1="16" x2="232" y2="245" gradientUnits="userSpaceOnUse">
          <stop stop-color="#171D19"/>
          <stop offset="1" stop-color="#080A0C"/>
        </linearGradient>
        <linearGradient id="lime" x1="70" y1="54" x2="183" y2="203" gradientUnits="userSpaceOnUse">
          <stop stop-color="#DCFFA8"/>
          <stop offset="1" stop-color="#89C83A"/>
        </linearGradient>
        <filter id="glow" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="10" result="blur"/>
          <feColorMatrix in="blur" values="0 0 0 0 0.72 0 0 0 0 0.95 0 0 0 0 0.40 0 0 0 .42 0"/>
          <feBlend in="SourceGraphic"/>
        </filter>
      </defs>
      <rect x="12" y="12" width="232" height="232" rx="58" fill="url(#bg)"/>
      <rect x="13" y="13" width="230" height="230" rx="57" stroke="#FFFFFF" stroke-opacity=".1" stroke-width="2"/>
      <g filter="url(#glow)">
        <path d="M128 43L210 128L128 213L46 128L128 43Z" fill="#B8F365" fill-opacity=".06" stroke="url(#lime)" stroke-width="9"/>
        <path d="M91 90L128 71L165 90L147 128L165 166L128 185L91 166L109 128L91 90Z" fill="url(#lime)"/>
        <path d="M109 128L128 105L147 128L128 151L109 128Z" fill="#11170C"/>
      </g>
    </svg>`;
  const html = `<!doctype html><html><body style="margin:0;background:#080a0c;overflow:hidden">${svg}</body></html>`;
  await window.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(html)}`,
  );
  await new Promise((resolve) => setTimeout(resolve, 300));
  const png = (await window.capturePage()).toPNG();
  const output = path.resolve(__dirname, "..", "build");
  await fsp.mkdir(output, { recursive: true });
  await fsp.writeFile(path.join(output, "icon.png"), png);
  await fsp.writeFile(path.join(output, "icon.ico"), pngToIco(png));
  window.destroy();
  app.exit(0);
}).catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  app.exit(1);
});

setTimeout(() => {
  process.stderr.write("Failed to generate the icon within 15 seconds.\n");
  app.exit(1);
}, 15_000).unref();
