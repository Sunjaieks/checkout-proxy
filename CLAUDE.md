# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

**Build and Development:**
- `npm run build` - Build the application using electron-vite
- `npm run start` - Start development server with hot reload and debugging on port 9222
- `npm run watch` - Start development server with file watching
- `npm run preview` - Preview the built application

**Distribution:**
- `npm run pack` - Package application for current platform (builds to `dist/` directory)
- `npm run dist` - Create distributable packages for current platform
- `npm run dist:win` - Create Windows installer (NSIS format)
- `npm run dist:mac` - Create macOS DMG installer

**Dependencies:**
- Electron: 44.4.5 (bundles Node.js 24.21.0, Chromium 152)
- Node.js version: >= 24.5.0 (required by the built-in proxy support used by the proxy core; see `engines` in package.json)
- npm version: >= 10.9.4

## Architecture Overview

This is an Electron-based HTTPS proxy application with dynamic certificate generation and host mapping capabilities. The architecture follows a three-process pattern:

**Main Process (`src/main/main.js`):**
- Application lifecycle management and window creation
- Configuration management (loads/saves from user data directory)
- IPC handlers for renderer communication
- Proxy server lifecycle management via `startServers()` and `stopServers()`

**Preload Script (`src/preload/preload.js`):**
- Security bridge between main and renderer processes
- Exposes controlled API through `contextBridge` as `electronAPI`

**Renderer Process (`src/renderer/`):**
- Main window: Profile selection and proxy control
- Editor window: JSON configuration editor with validation
- Help window: Displays README.md content as formatted help

**Proxy Core (`src/proxy/`):**
- `proxy-server.js` - HTTP/HTTPS proxy implementation with SNI callback. Upstream-proxy
  forwarding uses Node's built-in proxy support (the `proxyEnv` Agent option, Node >= 24.5)
  via `getProxyAgent()` — this replaced the former hand-rolled `agent.js` (`CustomHttpAgent`).
- `cache.js` - LRU cache for generated certificates
- Certificate generation using node-forge with dynamic SNI

## Key Components

**Configuration System:**
- Default config: `src/constant/default-config.json`
- User config: Auto-saved to `${userData}/checkout-proxy-config-v1.json`
- Config validation via `checkConfig()` in `src/util/sharedUtil.js`
- Profile-based proxy rules with host mapping support

**Certificate Management:**
- Root CA loaded from `resources/rootCA.crt` and `resources/rootCA.key`
- Dynamic certificate generation per hostname using SNI callback
- Certificates cached with LRU eviction (20,000 entries, 10-day TTL)

**Proxy Features:**
- HTTP CONNECT tunneling for HTTPS traffic
- Host-based proxy routing (`hostUsingProxy`, `hostBypassProxy`)
- Fixed rules for specific host:port mappings (`httpFixedRule`, `httpsFixedRule`)
- CORS bypass capability (experimental)
- Keep-alive connection support

## File Structure Patterns

- `src/main/` - Main process code
- `src/preload/` - Preload scripts for security
- `src/renderer/` - UI components and renderer logic
- `src/proxy/` - Core proxy server implementation
- `src/util/` - Shared utilities (Node.js and browser compatible)
- `resources/` - Static assets (certificates, icons)
- `out/` - Built application files (generated)
- `dist/` - Distribution packages (generated)

## Important Notes

- The application requires trusted root CA installation for HTTPS interception
- Uses one local port: for HTTP proxy (default 18881), another port for HTTPS MITM is eliminated by inline TLS termination
- Profiles define different upstream proxy configurations for different development scenarios
- Configuration changes require stopping and restarting the proxy servers

## Merge Port
Eliminate httpsServer's dedicated listen port by doing inline TLS termination in the HTTP CONNECT handler — wrap cliSoc directly with tls.TLSSocket and emit secureConnection on httpsServer.
