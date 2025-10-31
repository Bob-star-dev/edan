/** @type {import('next').NextConfig} */
const NodePolyfillPlugin = require('node-polyfill-webpack-plugin');
const CopyPlugin = require('copy-webpack-plugin');

const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true',
});

const nextConfig = {
  reactStrictMode: true,
  webpack: (config, {}) => {
    config.resolve.extensions.push('.ts', '.tsx');
    config.resolve.fallback = { fs: false };

    config.plugins.push(
      new NodePolyfillPlugin(),
      new CopyPlugin({
        patterns: [
          // Copy ONNX Runtime WASM files to public directory
          // Files in public/ directory are served from root URL in Next.js
          {
            from: './node_modules/onnxruntime-web/dist/*.wasm',
            to: '../public/static/wasm/[name][ext]',
          },
          // Copy model files to public directory
          {
            from: './models',
            to: '../public/static/models',
          },
        ],
      })
    );

    return config;
  },
};

const withPWA = require('next-pwa')({
  dest: 'public',
});

module.exports = withBundleAnalyzer(withPWA(nextConfig));

// module.exports = nextConfig
