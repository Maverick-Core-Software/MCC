// PM2 ecosystem config — AIWA CT 103 (mav-console)
// Deploy path: /opt/mcc (clone of maverick-core-software/MCC)
// Environment secrets are injected by the AIWA secret pipeline.
require('dotenv').config({ path: '/opt/mcc/.env' });

module.exports = {
  apps: [
    {
      name: 'mav-console',
      script: 'server.mjs',
      cwd: '/opt/mcc',
      interpreter: 'node',
      watch: false,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '15s',
      restart_delay: 4000,
      env: {
        NODE_ENV: 'production',
        PORT: '3000',

        // ── PC-only features: point at CartersPC via Tailscale ──────────
        SEO_APP_URL: 'http://100.124.216.11:8790',
        // HCP_PROJECT_DIR: unset — estimate pipeline stays on PC
        // LOCAL_MODEL_URL: unset — GPU stays on PC; cloud fallback engages
        // GBP_PHOTOS_FOLDER: unset — photo upload stays on PC

        // ── AIWA-local services (same host/LAN, no change) ──────────────
        MAV_RAG_URL: 'http://192.168.1.12:8181',
        PROMETHEUS_URL: 'http://192.168.1.12:9090',
        OPENAI_BASE_URL: 'http://192.168.1.12:4000',

        // ── Filesystem paths — auto-resolve under /opt/mcc ─────────────
        // MAV_CONSOLE_DATA_DIR: defaults to /opt/mcc/.mav-console
        // MAV_SKILLS_PATH: defaults to /opt/mcc/skills
        // MAV_MEMORY_PATH: defaults to /opt/mcc/memory
        // BRAIN_VAULT_PATH: defaults to /opt/mcc/brain
        MAV_CONSOLE_WORKSPACE: '/opt/mcc',
        MAV_EXTRA_ROOTS: '',

        // ── API keys injected by secret pipeline ────────────────────────
        // OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY, ZAI_API_KEY,
        // NVIDIA_NIM_API_KEY, VENICE_API_KEY, OPENROUTER_API_KEY,
        // OPENAI_REALTIME_KEY, BRAVE_SEARCH_API_KEY, SUPABASE_SERVICE_KEY,
        // VITE_SUPABASE_ANON_KEY, THUMBTACK_WEBHOOK_SECRET,
        // GBP_UPLOAD_TOKEN, EMAIL_IMAP_PASS, EMAIL_SMTP_PASS
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: '/opt/mcc/logs/mav-console-error.log',
      out_file: '/opt/mcc/logs/mav-console-out.log',
      merge_logs: true,
    },
  ],
};
