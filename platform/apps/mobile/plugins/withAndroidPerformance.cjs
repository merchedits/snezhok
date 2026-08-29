const fs = require("node:fs");
const path = require("node:path");
const {
  withAndroidManifest,
  withAppBuildGradle,
  withDangerousMod,
  withSettingsGradle,
} = require("expo/config-plugins");

const PROFILE_INSTALLER = 'implementation("androidx.profileinstaller:profileinstaller:1.4.1")';
const SKIA_PROGUARD_RULE = "-keep class com.shopify.reactnative.skia.** { *; }";

function insertIntoBlock(source, blockName, addition) {
  const start = source.indexOf(`${blockName} {`);
  if (start < 0) throw new Error(`Could not locate Android ${blockName} block`);
  const brace = source.indexOf("{", start);
  let depth = 0;
  for (let index = brace; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return `${source.slice(0, index)}${addition}\n${source.slice(index)}`;
  }
  throw new Error(`Android ${blockName} block is not balanced`);
}

module.exports = function withAndroidPerformance(config) {
  config = withAppBuildGradle(config, (gradleConfig) => {
    let source = gradleConfig.modResults.contents;
    if (!source.includes("androidx.profileinstaller:profileinstaller")) {
      source = insertIntoBlock(source, "dependencies", `\n    ${PROFILE_INSTALLER}`);
    }
    gradleConfig.modResults.contents = source;
    return gradleConfig;
  });

  config = withSettingsGradle(config, (settingsConfig) => {
    if (!settingsConfig.modResults.contents.includes("include ':macrobenchmark'")) {
      settingsConfig.modResults.contents += "\ninclude ':macrobenchmark'\n";
    }
    return settingsConfig;
  });

  config = withAndroidManifest(config, (manifestConfig) => {
    const application = manifestConfig.modResults.manifest.application?.[0];
    if (!application) throw new Error("Android application manifest is missing");
    application.profileable = [{ $: { "android:shell": "true" } }];
    return manifestConfig;
  });

  return withDangerousMod(config, ["android", async (dangerousConfig) => {
    const templateRoot = path.join(dangerousConfig.modRequest.projectRoot, "performance", "macrobenchmark");
    const benchmarkRoot = path.join(dangerousConfig.modRequest.platformProjectRoot, "macrobenchmark");
    const sourceRoot = path.join(benchmarkRoot, "src", "main");
    fs.mkdirSync(path.join(sourceRoot, "java", "xyz", "merchedits", "snezhok", "benchmark"), { recursive: true });
    fs.mkdirSync(path.join(sourceRoot, "res", "values"), { recursive: true });
    fs.copyFileSync(path.join(templateRoot, "macrobenchmark.gradle"), path.join(benchmarkRoot, "build.gradle"));
    fs.copyFileSync(path.join(templateRoot, "AndroidManifest.xml"), path.join(sourceRoot, "AndroidManifest.xml"));
    fs.copyFileSync(path.join(templateRoot, "strings.xml"), path.join(sourceRoot, "res", "values", "strings.xml"));
    for (const filename of ["BaselineProfileGenerator.kt", "StartupBenchmarks.kt"]) {
      fs.copyFileSync(path.join(templateRoot, filename), path.join(sourceRoot, "java", "xyz", "merchedits", "snezhok", "benchmark", filename));
    }
    const generatedProfile = path.join(dangerousConfig.modRequest.projectRoot, "performance", "baseline-prof.txt");
    if (fs.existsSync(generatedProfile)) {
      const appMain = path.join(dangerousConfig.modRequest.platformProjectRoot, "app", "src", "main");
      fs.mkdirSync(appMain, { recursive: true });
      fs.copyFileSync(generatedProfile, path.join(appMain, "baseline-prof.txt"));
    }
    const proguardRules = path.join(dangerousConfig.modRequest.platformProjectRoot, "app", "proguard-rules.pro");
    const proguardSource = fs.readFileSync(proguardRules, "utf8");
    if (!proguardSource.includes(SKIA_PROGUARD_RULE)) {
      fs.appendFileSync(proguardRules, `\n# React Native Skia native renderer\n${SKIA_PROGUARD_RULE}\n`);
    }
    return dangerousConfig;
  }]);
};
