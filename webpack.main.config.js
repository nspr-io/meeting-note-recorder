const path = require('path');
const webpack = require('webpack');
const dotenv = require('dotenv');
const CopyPlugin = require('copy-webpack-plugin');

module.exports = (env, argv) => {
  const isDevelopment = argv.mode === 'development';

  // Load environment variables from .env file for build-time injection
  // This ensures credentials are available in production builds
  const envConfig = dotenv.config({ path: path.resolve(__dirname, '.env') }).parsed || {};
  const aliasConfig = isDevelopment
    ? {}
    : {
        fsevents: path.resolve(__dirname, 'src/main/stubs/fsevents-stub.js'),
        'chokidar/lib/fsevents-handler': path.resolve(__dirname, 'src/main/stubs/fsevents-handler-stub.js'),
      };

  const plugins = [
    new webpack.DefinePlugin({
      'process.env.NODE_ENV': JSON.stringify(isDevelopment ? 'development' : 'production'),
      // Inject Google OAuth app credentials (required - not user-configurable)
      'process.env.GOOGLE_CLIENT_ID': JSON.stringify(envConfig.GOOGLE_CLIENT_ID || ''),
      'process.env.GOOGLE_CLIENT_SECRET': JSON.stringify(envConfig.GOOGLE_CLIENT_SECRET || ''),
      // Inject optional defaults (users can override these in Settings UI)
      'process.env.RECALL_API_KEY': JSON.stringify(envConfig.RECALL_API_KEY || ''),
      'process.env.RECALL_API_URL': JSON.stringify(envConfig.RECALL_API_URL || ''),
      'process.env.RECALL_API_BASE': JSON.stringify(envConfig.RECALL_API_URL || ''),
      'process.env.ANTHROPIC_API_KEY': JSON.stringify(envConfig.ANTHROPIC_API_KEY || ''),
      'process.env.LOG_LEVEL': JSON.stringify(envConfig.LOG_LEVEL || 'info'),
    }),
    new CopyPlugin({
      patterns: [
        {
          from: path.resolve(__dirname, 'src/main/styles'),
          to: path.resolve(__dirname, 'dist/styles'),
        },
      ],
    }),
  ];

  if (!isDevelopment) {
    plugins.push(new webpack.NormalModuleReplacementPlugin(
      /^fsevents$/,
      path.resolve(__dirname, 'src/main/stubs/fsevents-stub.js')
    ));
  }

  return {
    entry: './src/main/index.ts',
    target: 'electron-main',
    module: {
      rules: [
        {
          test: /\.ts$/,
          use: 'ts-loader',
          exclude: /node_modules/,
        },
        {
          test: /\.css$/,
          type: 'asset/source',
        },
      ],
    },
    resolve: {
      extensions: ['.ts', '.js'],
      alias: aliasConfig,
    },
    output: {
      filename: 'index.js',
      path: path.resolve(__dirname, 'dist/main'),
    },
    externals: {
      '@recallai/desktop-sdk': 'commonjs @recallai/desktop-sdk',
      'electron-store': 'commonjs electron-store',
    },
    plugins,
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
};