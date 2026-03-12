const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

// Watch the library source for live reloading
config.watchFolders = [monorepoRoot];

// Resolve packages from both the example and the parent
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];

// Prevent the parent's node_modules copies of React packages from being bundled.
// This ensures only the example app's copies are used (no duplicate React).
const exclusionList = require('metro-config/src/defaults/exclusionList');
config.resolver.blockList = exclusionList([
  new RegExp(
    path.resolve(monorepoRoot, 'node_modules', '(react|react-native|react-redux)')
      .replace(/[/\\]/g, '[/\\\\]') + '[/\\\\].*'
  ),
]);

// Resolve redux-firefly imports to source for live development
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'redux-firefly/react') {
    return {
      filePath: path.resolve(monorepoRoot, 'src/react/index.ts'),
      type: 'sourceFile',
    };
  }

  if (moduleName === 'redux-firefly/toolkit') {
    return {
      filePath: path.resolve(monorepoRoot, 'src/toolkit/index.ts'),
      type: 'sourceFile',
    };
  }

  if (moduleName === 'redux-firefly') {
    return {
      filePath: path.resolve(monorepoRoot, 'src/index.ts'),
      type: 'sourceFile',
    };
  }

  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
