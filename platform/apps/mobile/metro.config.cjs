const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");
const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];
config.resolver.disableHierarchicalLookup = false;

// The contracts workspace is authored as NodeNext TypeScript, so its relative
// source imports use the emitted `.js` extension. Metro receives the
// `react-native` source export before emission; resolve those specifiers back
// to their TypeScript source when no JavaScript file exists. Package and real
// JavaScript imports still use Metro's normal resolver unchanged.
const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = defaultResolveRequest ?? context.resolveRequest;
  try {
    return resolve(context, moduleName, platform);
  } catch (error) {
    if (!moduleName.startsWith(".") || !moduleName.endsWith(".js")) throw error;
    return resolve(context, moduleName.slice(0, -3), platform);
  }
};

module.exports = config;
