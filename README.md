# SeeitLive 🚀

**SeeitLive** (internally known as *RepoPreview*) is a powerful, client-side web application that allows you to instantly preview and run GitHub repositories directly inside your browser. No local cloning, no `npm install`, and no terminal commands required.

Simply paste any public GitHub repository URL, click **Run**, and watch the application build and run dynamically inside your browser tab!

---

## Key Features

- **⚡ In-Browser Node.js Environment**: Boots a client-side Node.js environment using the **WebContainer API** (`@webcontainer/api`) to run full Node.js web applications (Vite, Next.js, etc.) entirely within your browser sandbox.
- **📁 Static Project Renderer**: Automatically compiles and mounts static HTML/CSS/JS files, rewriting asset paths and inlining CSS imports using virtual `Blob` URLs for seamless static previews.
- **🔍 Intelligent Stack Detection**: Scans the repository structure to detect if it requires a Node build (detecting `package.json`) or if it's a static site (detecting `index.html`).
- **📟 Interactive Virtual Terminal**: A live logger panel showing the status of API requests, directory indexing, `npm install` progress, and dev server output.
- **📖 README Viewer**: Fetches and renders the target repository's `README.md` file in a dedicated tab with Github-style markdown styling and syntax-highlighted code blocks.
- **📊 Real-time Repo Insights**: Displays repository details (star counts, primary language, description, and last updated time) using the GitHub API.
- **🕒 Local History**: Remembers your 5 most recently previewed repositories using `localStorage` for fast access.

---

## Tech Stack

- **Framework**: React 19
- **Bundler**: Vite 8
- **Styling**: Tailwind CSS v4
- **Sandbox Orchestration**: `@webcontainer/api`
- **Markdown & Highlight**: `marked` & `highlight.js`
- **Icons**: `lucide-react`

---

## Getting Started

### Prerequisites

To run this application locally, you will need:
- [Node.js](https://nodejs.org/) (v18.0.0 or higher is recommended)
- `npm`, `yarn`, or `pnpm`

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/BHUVANESH0512/SeeitLive.git
   cd SeeitLive
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure Environment Variables:**
   Create a `.env` file in the root directory and add your GitHub Personal Access Token (PAT). This prevents running into GitHub API rate limits (60 requests per hour for unauthorized users):
   ```env
   VITE_GITHUB_TOKEN=your_github_personal_access_token_here
   ```
   > ⚠️ **Important:** Do NOT commit your `.env` file to Git. The project contains a `.gitignore` ruleset to prevent this.

4. **Start the development server:**
   ```bash
   npm run dev
   ```
   Open your browser and navigate to `http://localhost:5173` (or the port specified in your terminal).

---

## Deployment & Security Headers

Because **WebContainers** rely on `SharedArrayBuffer` for threading, your hosting provider **must** serve the application with specific HTTP security headers. 

Ensure the following headers are configured on your production server:

```http
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Opener-Policy: same-origin
```

### Deployment Configuration Examples

#### Vercel (`vercel.json`)
```json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "Cross-Origin-Embedder-Policy", "value": "require-corp" },
        { "key": "Cross-Origin-Opener-Policy", "value": "same-origin" }
      ]
    }
  ]
}
```

#### Netlify (`netlify.toml`)
```toml
[[headers]]
  for = "/*"
  [headers.values]
    Cross-Origin-Embedder-Policy = "require-corp"
    Cross-Origin-Opener-Policy = "same-origin"
```

---

## How it Works

1. **URL Parsing**: The application extracts the owner, repository name, and directory details from the provided GitHub link.
2. **Metadata & Tree Extraction**: It queries the GitHub REST API to pull repository metadata and recursively fetches the file tree.
3. **Stack Analysis**:
   - If a `package.json` is found: Bootstraps the WebContainer, copies all file contents (including base64 decoded binaries) into a virtual filesystem tree, runs `npm install`, and spawns `npm run dev`.
   - If no `package.json` but an `index.html` is found: Generates blob URLs for all assets, rewrites CSS `@import` paths and HTML dependency sources, and serves it as a static page inside an `iframe`.
4. **Rendering**: Mounts the running dev server URL or entry blob URL in a secured iframe for immediate interaction.
