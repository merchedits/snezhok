const { withDangerousMod } = require("expo/config-plugins");
const { copyFile, mkdir, readFile, writeFile } = require("node:fs/promises");
const path = require("node:path");

/** Packages the complete GPL and dependency notices in every Android build. */
module.exports = function withLegalAssets(config) {
  return withDangerousMod(config, ["android", async (androidConfig) => {
    const repositoryRoot = path.resolve(androidConfig.modRequest.projectRoot, "../../..");
    const destination = path.join(androidConfig.modRequest.platformProjectRoot, "app", "src", "main", "assets", "legal");
    const gradleEvidenceSource = path.join(__dirname, "android-dependency-evidence.gradle");
    const gradleEvidenceDestination = path.join(androidConfig.modRequest.platformProjectRoot, "android-dependency-evidence.gradle");
    const appBuildGradle = path.join(androidConfig.modRequest.platformProjectRoot, "app", "build.gradle");
    await mkdir(destination, { recursive: true });
    await Promise.all([
      copyFile(path.join(repositoryRoot, "LICENSE"), path.join(destination, "LICENSE.txt")),
      copyFile(path.join(repositoryRoot, "THIRD_PARTY_NOTICES.md"), path.join(destination, "THIRD_PARTY_NOTICES.txt")),
      copyFile(gradleEvidenceSource, gradleEvidenceDestination),
    ]);
    const marker = 'apply from: rootProject.file("android-dependency-evidence.gradle")';
    const buildGradle = await readFile(appBuildGradle, "utf8");
    if (!buildGradle.includes(marker)) await writeFile(appBuildGradle, `${buildGradle.trimEnd()}\n\n${marker}\n`, "utf8");
    return androidConfig;
  }]);
};
