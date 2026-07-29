# Third-party notices

Onyx Launcher uses open-source packages distributed under their respective
licenses, including Electron, React, Vite, Framer Motion, Lucide, Archiver and
node-stream-zip. The exact dependency tree and package licenses are available
through `package-lock.json` and `npm` package metadata.

The default Microsoft OAuth public client ID belongs to the open-source
Prism Launcher project:
https://github.com/PrismLauncher/PrismLauncher
Prism Launcher is distributed under GNU GPL v3. Onyx uses its public application
identity for the Microsoft consumer device-code flow and does not include Prism
Launcher code or claim any client secret.

The launcher accesses these external services:

- Mojang version metadata, libraries and asset CDN;
- Microsoft identity, Xbox Live and Minecraft Services for authentication;
- Fabric Meta, Quilt Meta, Forge Maven and NeoForge Maven;
- Eclipse Adoptium API for Java runtime packages;
- Modrinth API and project download URLs.

Minecraft game files, third-party mods and Java runtime archives are downloaded
at the user's request and remain governed by their owners' licenses.
