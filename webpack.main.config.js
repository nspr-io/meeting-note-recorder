const path = require('path');

module.exports = {
  entry: './src/main/index.ts',
  target: 'electron-main',
  module: {
    rules: [
      {
        test: /\.ts$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
    ],
  },
  resolve: {
    extensions: ['.ts', '.js'],
  },
  output: {
    filename: 'index.js',
    path: path.resolve(__dirname, 'dist/main'),
  },
  externals: {
    '@recallai/desktop-sdk': 'commonjs @recallai/desktop-sdk',
    'electron-store': 'commonjs electron-store',
  },
  // Memory optimizations for dev mode
  cache: {
    type: 'memory',
    maxGenerations: 1,
  },
  optimization: {
    removeAvailableModules: false,
    removeEmptyChunks: false,
    splitChunks: false,
  },
};