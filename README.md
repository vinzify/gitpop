<div align="center">
  <img src="https://raw.githubusercontent.com/vinzify/gitpop/main/banner.png" width="800" />
  <h1>GitPop</h1>
  <p><strong>A blazing fast, AI-powered Git commit extension for the Windows Context Menu.</strong></p>
  
  <p>
    <a href="https://github.com/vinzify/gitpop/releases"><img src="https://img.shields.io/github/v/release/vinzify/gitpop?style=flat-square&color=blue" alt="Current Release"></a>
    <a href="https://tauri.app/"><img src="https://img.shields.io/badge/Built_with-Tauri_%7C_Rust-orange?style=flat-square" alt="Built with Tauri & Rust"></a>
    <a href="https://github.com/vinzify/gitpop/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square" alt="License: MIT"></a>
    <a href="https://github.com/vinzify/gitpop/stargazers"><img src="https://img.shields.io/github/stars/vinzify/gitpop?style=social" alt="GitHub stars"></a>
  </p>
</div>
GitPop transforms your Windows File Explorer right-click menu into a powerful, intelligent source control extension. It bridges the gap between terminal commands and heavy GUI clients by offering a fast, sleek contextual popup mirroring VS Code's source control tab.

## ✨ Features
* **Zero-Friction Context Menu:** Right-click anywhere in a Git repository to immediately open GitPop.
* **Instant Native UI:** Built with Tauri + Rust + React. Native performance, tiny memory footprint, opens instantly.
* **AI Conventional Commits:** Press the "Sparkle" button to generate a conventional commit message.
  * *Local & Private:* Connects locally to [Ollama](https://ollama.com/) (defaults to `llama3.2`) so your proprietary code never leaves your machine.
* **Premium Aesthetics:** Dark mode, glassmorphism UI overlay right over your File Explorer.

## 🚀 Installation

GitPop features a built-in one-click setup. No administrator prompts or shell scripts required!

1. **Download** the latest installer (`.msi` or `.exe`) from the [Releases page](https://github.com/vinzify/gitpop/releases).
2. **Launch** `GitPop` from your Start Menu.
3. Click **"Add to Right-Click Menu"**.
4. You're done! Right-click any folder or empty space inside a `.git` repository and enjoy.

*(You can remove it at any time by opening GitPop from the Start Menu and clicking "Remove from Context Menu").*

## 🤖 AI Commit Generation

GitPop features robust, intelligent commit message auto-generation capabilities. It supports both local and cloud AI models.

### ⚙️ Configuring Your AI Provider
Click the **Settings** (gear) icon in the top right of the application to choose your AI engine.

#### Option 1: Local Ollama (Default & Most Secure)
If you want to ensure your proprietary code never leaves your machine:
1. Download [Ollama](https://ollama.com/).
2. Run `ollama pull llama3.2` (or your preferred code model) in your terminal.
3. Ensure Ollama is running (`localhost:11434`), stage your files in GitPop, and click **Sparkle**.

#### Option 2: Cloud & Custom AI Models
GitPop natively supports major proprietary cloud providers and **any OpenAI-compatible API**.
1. Select **OpenAI**, **Google Gemini**, **Anthropic Claude**, or **Custom** in the GitPop settings.
2. Enter your desired Model Name (e.g., `gpt-4o`, `gemini-1.5-flash`, `claude-3-5-sonnet`, or any local/custom ID).
3. Provide your API Key (and API Base URL if using Custom mode).
*(Your configuration and keys are securely stored entirely locally on your machine).*

## 🛠️ Development

Built with Tauri 2.0, React, TypeScript, and Rust.

```bash
# Clone the repository
git clone git@github.com:vinzify/gitpop.git
cd gitpop

# Install dependencies
npm install

# Run the development server
npm run tauri dev

# Build the release bundle
npm run tauri build
```

---
---
**License:** MIT

---
💖 **Support the Project**

If GitPop saves you time and you want to support its continued development, consider sending an ETH donation:
`0xe7043f731a2f36679a676938e021c6B67F80b9A1`
