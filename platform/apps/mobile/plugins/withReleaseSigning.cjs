const { withAppBuildGradle } = require("expo/config-plugins");

const releaseSigningBlock = `
        release {
            def keystorePath = System.getenv('SNEZHOK_KEYSTORE_FILE')
            if (!keystorePath) {
                throw new GradleException('SNEZHOK_KEYSTORE_FILE is required for a release build')
            }
            storeFile file(keystorePath)
            storePassword System.getenv('SNEZHOK_KEYSTORE_PASSWORD')
            keyAlias System.getenv('SNEZHOK_KEY_ALIAS') ?: 'snezhok'
            keyPassword System.getenv('SNEZHOK_KEY_PASSWORD')
        }`;

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (gradleConfig) => {
    let source = gradleConfig.modResults.contents;
    if (!source.includes("SNEZHOK_KEYSTORE_FILE")) {
      const debugBlock = /(^\s*debug\s*\{\s*\n\s*storeFile file\('debug\.keystore'\)[\s\S]*?^\s*\})/m;
      if (!debugBlock.test(source)) throw new Error("Could not locate Android debug signing configuration");
      source = source.replace(debugBlock, `$1${releaseSigningBlock}`);
    }
    const buildTypesIndex = source.indexOf("buildTypes {");
    if (buildTypesIndex < 0) throw new Error("Could not locate Android build types");
    const beforeBuildTypes = source.slice(0, buildTypesIndex);
    let buildTypes = source.slice(buildTypesIndex);
    buildTypes = buildTypes.replace(/(debug\s*\{[\s\S]*?)signingConfig signingConfigs\.(?:debug|release)/, "$1signingConfig signingConfigs.debug");
    buildTypes = buildTypes.replace(/(release\s*\{[\s\S]*?)signingConfig signingConfigs\.(?:debug|release)/, "$1signingConfig signingConfigs.release");
    source = beforeBuildTypes + buildTypes;
    gradleConfig.modResults.contents = source;
    return gradleConfig;
  });
};
