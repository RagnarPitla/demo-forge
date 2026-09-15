{
  "name": "__SLUG__",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "description": "__TITLE__ - click-through demo reconstructed from __SOURCE__",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview --port 4173",
    "verify": "node scripts/verify-all.mjs",
    "gate": "npm run build && node scripts/verify-render.mjs"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "vite": "^5.4.11",
    "@vitejs/plugin-react": "^4.3.4",
    "vite-plugin-singlefile": "^2.0.3",
    "playwright": "^1.49.0"
  }
}
