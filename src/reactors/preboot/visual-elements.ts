
import * as os from "../../os";
import spawn from "../../os/spawn";
import sf from "../../os/sf";
import shortcut from "../../os/shortcut";

import {app} from "electron";
import {join, dirname} from "path";

import rootLogger from "../../logger";
const logger = rootLogger.child("visual-elements");

const getStartMenuVbs = `set sh = WScript.CreateObject("Wscript.Shell")
startPath = sh.SpecialFolders("StartMenu")
WScript.echo startPath`;

const visualElementsManifest = `<Application xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <VisualElements
    BackgroundColor="#2E2B2C"
    ShowNameOnSquare150x150Logo="on"
    ForegroundText="light"/>
</Application>`;

const self = {
  async createIfNeeded (opts: any): Promise<void> {
    if (os.platform() !== "win32") {
      return;
    }

    logger.info(`Checking for Squirrel at ${shortcut.updateExePath}`);
    try {
      const updateStats = await sf.stat(shortcut.updateExePath);
      if (!updateStats.isFile()) {
        throw new Error("Update.exe is not a regular file");
      }
    } catch (e) {
      logger.warn(`While checking for squirrel: ${e} - skipping`);
      return;
    }

    const updateDirName = dirname(shortcut.updateExePath);
    const manifestPath = join(updateDirName, "itch.VisualElementsManifest.xml");

    logger.info(`Writing visual elements manifest at ${manifestPath}`);
    await sf.writeFile(manifestPath, visualElementsManifest, {encoding: "utf8"});

    logger.info(`Looking for start menu folder`);

    // avert your gaze for a minute...
    const vbsTempPath = join(app.getPath("temp"), "getstart.vbs");
    await sf.writeFile(vbsTempPath, getStartMenuVbs, {encoding: "utf8"});

    const out = await spawn.getOutput({
      command: "cscript",
      args: ["/nologo", vbsTempPath],
    });
    const startMenuPath = out.trim();
    logger.info(`Start menu path: ${out}`);

    // ...in fact, maybe don't read this file at all?
    const startStats = await sf.stat(out);
    if (!startStats.isDirectory()) {
      logger.warn(`Start menu is not a directory, giving up`);
      return;
    }

    const itchLinks = await sf.glob(`${app.getName()}.lnk`, {cwd: startMenuPath});
    logger.info(`Found shortcuts:\n${JSON.stringify(itchLinks, null, 2)}`);

    const mtime = Date.now() / 1000;
    for (const link of itchLinks) {
      const fullPath = join(startMenuPath, link);
      logger.info(`Touching ${fullPath}`);
      await sf.utimes(fullPath, mtime, mtime);
    }

    logger.info(`VisualElementsManifest successfully installed/updated!`);
  },
};

export default self;
