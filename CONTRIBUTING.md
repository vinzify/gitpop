# Contributing to GitPop

First off, thank you for considering contributing to GitPop! It's people like you that make GitPop such a great tool for the community.

## Local Development Setup

GitPop is built using **Tauri 2**, **Rust**, **React**, and **TypeScript**. You'll need Node.js and the Rust toolchain installed.

1. **Clone the repository:**
   ```bash
   git clone git@github.com:vinzify/gitpop.git
   cd gitpop
   ```

2. **Install frontend dependencies:**
   ```bash
   npm install
   ```

3. **Start the development server:**
   This command automatically boots up the Vite React server and runs `cargo build` to launch the Tauri window natively:
   ```bash
   npm run tauri dev
   ```

## Pull Request Process

1. Fork the repo and create your branch from `main`.
2. Ensure any new functionality includes relevant error handling.
3. Test the build locally by running `npm run tauri build` to ensure the release profile compiles without warnings.
4. Issue a Pull Request with a clear description of the problem and the proposed solution.
