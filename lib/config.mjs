// Centralized configuration: environment-derived constants and shared paths.
// Env is populated by server.mjs before this module loads.
import path from 'node:path';
import { platform } from 'node:os';
import { fileURLToPath } from 'node:url';

// rootDir is the project root (this file lives in ./lib).
export const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const distDir = path.join(rootDir, 'dist');
export const port = Number(process.env.PORT || 3011);
export const deployStartedAt = new Date().toISOString();
const isWin = platform() === 'win32';
export const prometheusUrl = process.env.PROMETHEUS_URL || 'http://192.168.1.12:9090';
export const ragUrl = process.env.MAV_RAG_URL || 'http://192.168.1.12:8181';
// ── AI providers ──────────────────────────────────────────────────────────
// Direct API keys for Claude (Anthropic), Gemini (Google), and Codex (OpenAI).
// OpenRouter for anything else (review, fallbacks).
// Local llama.cpp (custom Qwen) serves the code executor first, with OpenRouter
// as the fallback when the local server is offline.
export const localModelUrl = process.env.LOCAL_MODEL_URL || 'http://localhost:8080/v1';
export const localModel = process.env.LOCAL_MODEL || 'qwen3-14b';
export const openRouterUrl = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
export const openRouterApiKey = process.env.OPENROUTER_API_KEY || '';
export const openRouterModel = process.env.OPENROUTER_MODEL || 'z-ai/glm-5.2';
export const openRouterExecutorModel = process.env.OPENROUTER_EXECUTOR_MODEL || 'z-ai/glm-5.2';
// Models offered in the UI model selector (all valid OpenRouter IDs).
export const OPENROUTER_MODELS = [
  { id: 'z-ai/glm-5.2',                 label: 'GLM 5.2',           tier: 'cheap'    },
  { id: 'anthropic/claude-sonnet-4.6',  label: 'Claude Sonnet 4.6', tier: 'premium'  },
  { id: 'anthropic/claude-haiku-4.5',   label: 'Claude Haiku 4.5',  tier: 'fast'     },
  { id: 'openai/gpt-4o-mini',           label: 'GPT-4o Mini',       tier: 'cheap'    },
  { id: 'openai/gpt-4o',                label: 'GPT-4o',            tier: 'premium'  },
  { id: 'deepseek/deepseek-v3.2',       label: 'DeepSeek V3.2',     tier: 'cheap'    },
  { id: 'google/gemini-3.5-flash',      label: 'Gemini 3.5 Flash',  tier: 'fast'     },
  { id: 'qwen/qwen3-coder',              label: 'Qwen3 Coder',       tier: 'cheap'    },
];
export const piExecutable = process.env.PI_EXECUTABLE || 'pi';
export const piModel = process.env.PI_MODEL || 'qwen3-14b';
export const seoAppUrl = process.env.SEO_APP_URL || '';
export const geminiApiKey = process.env.GEMINI_API_KEY || '';
export const geminiModel = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
export const GEMINI_MODES = new Set(['review']); // Gemini = everyday chat only (REVIEW mode)
export const openAiApiKey = process.env.OPENAI_API_KEY || '';
export const openAiBaseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com';
export const openAiModel = process.env.OPENAI_MODEL || 'gpt-4o';
export const nimApiKey = process.env.NVIDIA_NIM_API_KEY || '';
// qwen2.5-coder-32b retired (410), qwen3.5-122b-a10b too slow (60s timeout) — llama-3.3-70b for main tasks
export const nimModel = process.env.NIM_MODEL || 'meta/llama-3.3-70b-instruct';
// QC uses a fast 8B model — "SHIP or HOLD" doesn't need a 70B model
export const nimQcModel = process.env.NIM_QC_MODEL || 'meta/llama-3.1-8b-instruct';

// Zhipu z.ai — direct GLM API. Powers the Maverick Agent (ASK brain) and the
// dashboard "Z.AI BRAIN" status indicator. OpenAI-compatible endpoint.
export const zaiApiKey = process.env.ZAI_API_KEY || '';
export const zaiBaseUrl = process.env.ZAI_BASE_URL || 'https://api.z.ai/api/paas/v4';
export const zaiModel = process.env.ZAI_MODEL || 'glm-5.2';
export const zaiVisionModel = process.env.ZAI_VISION_MODEL || 'glm-5v-turbo';
// Venice — provider primitive for Pro+ eval 2026-07 (primary for open-weight cloud traffic).
export const veniceApiKey = process.env.VENICE_API_KEY || '';
export const veniceBaseUrl = process.env.VENICE_BASE_URL || 'https://api.venice.ai/api/v1';
export const veniceModel = process.env.VENICE_MODEL || 'zai-org-glm-5-2';
export const veniceVisionModel = process.env.VENICE_VISION_MODEL || 'z-ai-glm-5v-turbo';
export const veniceQcModel = process.env.VENICE_QC_MODEL || 'llama-3.3-70b';
export const veniceLocalFallbackModel = process.env.VENICE_LOCAL_FALLBACK_MODEL || 'qwen3-6-27b';
// Models offered in the UI model selector (all valid Venice IDs).
export const VENICE_MODELS = [
  { id: 'zai-org-glm-5-2',              label: 'GLM 5.2',                tier: 'cheap'    },
  { id: 'deepseek-v3.2',                label: 'DeepSeek V3.2',         tier: 'cheap'    },
  { id: 'deepseek-v4-pro',              label: 'DeepSeek V4 Pro',       tier: 'premium'  },
  { id: 'llama-3.3-70b',                label: 'Llama 3.3 70B',         tier: 'fast'     },
  { id: 'qwen3-coder-480b-a35b-instruct-turbo', label: 'Qwen3 Coder',  tier: 'cheap'    },
  { id: 'kimi-k2-6',                    label: 'Kimi K2.6',             tier: 'premium'  },
];
// Anthropic — base URL (allows proxy / region redirects).
export const anthropicBaseUrl = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com';
export const anthropicApiKey = process.env.ANTHROPIC_API_KEY || '';
export const anthropicModel = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';
// Brave Search — free tier 2k queries/month: brave.com/search/api/
// TODO: Add BRAVE_SEARCH_API_KEY to .env once you get the key
export const braveApiKey = process.env.BRAVE_SEARCH_API_KEY || '';
export const dataDir = process.env.MAV_CONSOLE_DATA_DIR || path.join(rootDir, '.mav-console');
export const ledgerFile = path.join(dataDir, 'task-runs.json');
export const seoTaskLogFile = path.join(dataDir, 'seo-task-log.json');
export const orchestratorStateFile = path.join(dataDir, 'orchestrator-state.json');
export const thumbtackEventsFile = path.join(dataDir, 'thumbtack-events.jsonl');
export const thumbtackWebhookSecret = process.env.THUMBTACK_WEBHOOK_SECRET || '';
export const thumbtackClientId = process.env.THUMBTACK_CLIENT_ID || '';
export const thumbtackClientSecret = process.env.THUMBTACK_CLIENT_SECRET || '';
export const thumbtackStagingClientId = process.env.THUMBTACK_STAGING_CLIENT_ID || '';
export const thumbtackStagingClientSecret = process.env.THUMBTACK_STAGING_CLIENT_SECRET || '';
export const thumbtackOAuthAuthUrl = process.env.THUMBTACK_OAUTH_AUTH_URL || 'https://auth.thumbtack.com/oauth2/auth';
export const thumbtackOAuthTokenUrl = process.env.THUMBTACK_OAUTH_TOKEN_URL || 'https://auth.thumbtack.com/oauth2/token';
export const thumbtackApiBaseUrl = process.env.THUMBTACK_API_BASE_URL || 'https://api.thumbtack.com';
// Production scopes are explicit and have no default so activation fails closed.
export const thumbtackScopes = process.env.THUMBTACK_SCOPES || '';
export const thumbtackStagingOAuthAuthUrl = process.env.THUMBTACK_STAGING_OAUTH_AUTH_URL || '';
export const thumbtackStagingOAuthTokenUrl = process.env.THUMBTACK_STAGING_OAUTH_TOKEN_URL || '';
export const thumbtackStagingApiBaseUrl = process.env.THUMBTACK_STAGING_API_BASE_URL || '';
// Space-delimited, least-privilege staging permissions. There is intentionally no default.
export const thumbtackStagingScopes = process.env.THUMBTACK_STAGING_SCOPES || '';
export const thumbtackTokenEncryptionKey = process.env.THUMBTACK_TOKEN_ENCRYPTION_KEY || '';
// Make the persistence location explicit so OAuth fails closed if it is omitted.
export const thumbtackTokenStorePath = process.env.THUMBTACK_TOKEN_STORE_PATH || '';
// Production tokens are deliberately isolated from staging tokens.
export const thumbtackProductionTokenStorePath = process.env.THUMBTACK_PRODUCTION_TOKEN_STORE_PATH || '';
export function isStagingConfigured() {
  return Boolean(thumbtackStagingClientId && thumbtackStagingClientSecret && thumbtackStagingOAuthAuthUrl && thumbtackStagingOAuthTokenUrl && thumbtackStagingApiBaseUrl);
}
export const workspacePath = process.env.MAV_CONSOLE_WORKSPACE || rootDir;
export const memoryPath = process.env.MAV_MEMORY_PATH ||
  (isWin ? 'C:\\Users\\carte\\.claude\\projects\\memory' : path.join(rootDir, 'memory'));
export const brainPath = process.env.BRAIN_VAULT_PATH ||
  (isWin ? 'C:\\Workspace\\Active\\brain' : path.join(rootDir, 'brain'));
export const skillsPath = process.env.MAV_SKILLS_PATH || path.join(rootDir, 'skills');
export const hcpDir = process.env.HCP_PROJECT_DIR ||
  (isWin ? 'C:\\Workspace\\Active\\grizzly-hcp' : '');
export const stagingRoot = path.join(rootDir, 'tmp', 'build-staging');
export const backupRoot = path.join(rootDir, 'tmp', 'build-backup');

// GBP Photo Pipeline — direct upload from iOS Shortcut.
// The picker reads the LOCAL CACHE (not Drive); default matches
// gbp-photo-pick.mjs:79-80 so uploads land where the picker actually scans.
export const gbpPhotosFolder =
  process.env.GBP_PHOTOS_LOCAL_CACHE || process.env.GBP_PHOTOS_FOLDER ||
  (isWin ? 'C:\\Workspace\\Shared\\Assets\\Media\\Grizzly\\GBP Post Photos' : '');
// Bearer token the Shortcut sends in Authorization header. Set in .env.
export const gbpUploadToken = process.env.GBP_UPLOAD_TOKEN || '';
export const gbpUploadMaxBytes = Number(process.env.GBP_UPLOAD_MAX_BYTES || 50_000_000); // 50 MB
export const GBP_PHOTO_EXTS = new Set(['.jpg', '.jpeg', '.png', '.heic', '.heif', '.webp']);

// Blocked system and sensitive paths — everything else is accessible.
// MAV_EXTRA_ROOTS is kept for backward compat but no longer needed for access control.
export const BLOCKED_ABS_RE = /[/\\](\\.env$|\\.git[/\\]|Windows[/\\]|Program Files[/\\]?|AppData[/\\]Local[/\\]Temp|System32[/\\]|SysWOW64[/\\]|WindowsApps[/\\]|etc[/\\](?!ssl)|proc[/\\]|sys[/\\]|boot[/\\]|dev[/\\])/i;
export const BLOCKED_REL = /^(\.env$|\.git(\/|$)|node_modules(\/|$)|package-lock\.json$|tmp(\/|$)|\.mav-console(\/|$))/i;

export const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg'
};

export const ALLOWED_ORIGINS = [
  'https://homelab-noc-dashboard.vercel.app',
  'https://carterspc.tailf72e3f.ts.net',
  'http://localhost:5173',
  'http://localhost:5174',  // maverick-assistant dev
  'http://localhost:3011',
  'http://localhost:3012',  // maverick-assistant prod
];
