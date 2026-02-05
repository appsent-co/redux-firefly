const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// Watch the parent directory for changes
config.watchFolders = [
  path.resolve(__dirname, '..'), // Parent redux-firefly directory
];

// Resolve redux-firefly from parent directory
config.resolver.nodeModulesPaths = [
  path.resolve(__dirname, 'node_modules'),
  path.resolve(__dirname, '../node_modules'),
];

// Ensure proper source extensions
config.resolver.sourceExts = [...config.resolver.sourceExts, 'cjs'];

// Force React and React Native to resolve from example's node_modules only
// This prevents "multiple copies of React" errors when using file:.. links
config.resolver.extraNodeModules = {
  react: path.resolve(__dirname, 'node_modules/react'),
  'react-native': path.resolve(__dirname, 'node_modules/react-native'),
  'react-redux': path.resolve(__dirname, 'node_modules/react-redux'),
};

// Add custom resolver for redux-firefly subpath exports
config.resolver.resolveRequest = (context, moduleName, platform) => {
  // Handle redux-firefly/react subpath
  if (moduleName === 'redux-firefly/react') {
    return {
      filePath: path.resolve(__dirname, '../dist/react.js'),
      type: 'sourceFile',
    };
  }

  // Handle redux-firefly main export
  if (moduleName === 'redux-firefly') {
    return {
      filePath: path.resolve(__dirname, '../dist/index.js'),
      type: 'sourceFile',
    };
  }

  // Fall back to default resolver (which will use extraNodeModules for React packages)
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
