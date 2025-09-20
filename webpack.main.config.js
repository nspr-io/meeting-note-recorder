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
};