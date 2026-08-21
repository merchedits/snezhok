const fs = require("node:fs");
const path = require("node:path");
const { withDangerousMod, withSettingsGradle } = require("expo/config-plugins");

module.exports = function withAndroidMessagingE2E(config) {
  config = withSettingsGradle(config, (settingsConfig) => {
    if (!settingsConfig.modResults.contents.includes("include ':messagingE2e'")) {
      settingsConfig.modResults.contents += "\ninclude ':messagingE2e'\n";
    }
    return settingsConfig;
  });

  return withDangerousMod(config, ["android", async (dangerousConfig) => {
    const templateRoot = path.join(dangerousConfig.modRequest.projectRoot, "performance", "messaging-e2e");
    const moduleRoot = path.join(dangerousConfig.modRequest.platformProjectRoot, "messagingE2e");
    const sourceRoot = path.join(moduleRoot, "src", "main");
    const kotlinRoot = path.join(sourceRoot, "java", "xyz", "merchedits", "snezhok", "e2e");
    const resourceRoot = path.join(sourceRoot, "res", "values");
    fs.mkdirSync(kotlinRoot, { recursive: true });
    fs.mkdirSync(resourceRoot, { recursive: true });
    fs.copyFileSync(path.join(templateRoot, "messaging-e2e.gradle"), path.join(moduleRoot, "build.gradle"));
    fs.copyFileSync(path.join(templateRoot, "AndroidManifest.xml"), path.join(sourceRoot, "AndroidManifest.xml"));
    fs.copyFileSync(path.join(templateRoot, "strings.xml"), path.join(resourceRoot, "strings.xml"));
    for (const filename of ["FixtureActivity.kt", "MessagingSmokeTests.kt"]) {
      fs.copyFileSync(path.join(templateRoot, filename), path.join(kotlinRoot, filename));
    }
    return dangerousConfig;
  }]);
};
