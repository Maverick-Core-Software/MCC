// 3D data-center map of the Maverick Core ecosystem — server racks, cable connections, click-to-open rack detail.
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

const EDGE_TYPES = {
  http: { c: 0x378ADD, label: 'HTTP / REST' },
  rag: { c: 0x1D9E75, label: 'RAG / knowledge' },
  llm: { c: 0xBA7517, label: 'LLM inference' },
  slack: { c: 0x7F77DD, label: 'Slack' },
  mcp: { c: 0xEF9F27, label: 'MCP (stdio)' },
  db: { c: 0x1D9E75, label: 'Supabase / DB' },
  monitor: { c: 0x888780, label: 'Monitoring' },
  spawn: { c: 0xD4537E, label: 'Process spawn' },
  deploy: { c: 0x888780, label: 'Deploy / host' },
  planned: { c: 0xB4B2A9, label: 'Planned (not built)' },
  legacy: { c: 0xE24B4A, label: 'Legacy / deprecated' },
};
const ZONES = [
  { id: 'clients', label: 'Aisle 1 - Clients & surfaces', color: 0x7F77DD, z: -330 },
  { id: 'core', label: 'Aisle 2 - Maverick core apps', color: 0xEF9F27, z: -110 },
  { id: 'infra', label: 'Aisle 3 - Homelab infra (Proxmox AIWA)', color: 0x1D9E75, z: 110 },
  { id: 'cloud', label: 'Aisle 4 - Cloud & external services', color: 0x378ADD, z: 330 },
];
const N = (o) => Object.assign({ h: 70 }, o);
const NODES = [
  N({ id: 'slackHome', label: 'Slack - homelab-monitor', sub: 'app A0BEL5VVD40', zone: 'clients',
    role: "The HomeLab agent's own Slack workspace app - alerts, status, and approve/deny taps for gated fixes.",
    kv: 'App ID  A0BEL5VVD40\nChannel C0BBJ3Z5S59' }),
  N({ id: 'assistant', label: 'maverick-assistant', sub: 'React/Vite PWA - :3012 prod', zone: 'clients',
    role: 'Thin client - the face of the system. No LLM and no database of its own; every request is proxied straight into MCC.',
    kv: ':5174 dev - :3012 prod\nTailscale Funnel in prod' }),
  N({ id: 'slackMav', label: 'Slack - Maverick', sub: 'app A0BDV7S96FP - live', zone: 'clients', live: true, h: 82,
    role: "grizzly-hcp's own dedicated Slack app. Operator-only: answers in the ops channel and Carter's 1:1 DM.",
    kv: 'App ID  A0BDV7S96FP\nChannel C0BDU7PQ12M + Carter DM' }),

  N({ id: 'homelab', label: 'HomeLab-Agent', sub: 'PM2 mcc-dashboard-agent', zone: 'core', live: true, h: 82,
    role: 'Autonomous homelab watchdog. Monitors every service, tails PM2 logs, alerts to Slack, self-heals behind a Slack approval tap.',
    kv: 'Python asyncio - webhook :7331\nREMEDIATION_ENABLED=false' }),
  N({ id: 'seo', label: 'SEO-Agents-App', sub: 'PM2 mav-bridge - :8790', zone: 'core', live: true, h: 76,
    role: 'Weekly autonomous SEO crew. A Node bridge wraps a Python CrewAI binary that researches and publishes content every Friday.',
    kv: 'Node bridge :8790 -> seo-agents.exe\nschedule: Fri 08:30' }),
  N({ id: 'mcc', label: 'MCC', sub: 'PM2 mav-console - :3011 prod', zone: 'core', hub: true, live: true, h: 130,
    role: 'The brain and the hub. Every request routes through MCC; it fans out to all LLM providers, calls the other apps, queries shared knowledge.',
    kv: 'Node http + React 19/Vite SPA\n:3000 dev - :3011 prod' }),
  N({ id: 'vercel', label: 'Vercel', sub: 'MaverickForge host', zone: 'core', h: 66,
    role: 'Hosting + deploy target for MaverickForge.', kv: 'Production deploys via Vercel' }),
  N({ id: 'grizzly', label: 'grizzly-hcp', sub: 'PM2 mav-slack - Maverick brain', zone: 'core', live: true, h: 92,
    role: '"Maverick" - the single shared brain. One Mastra agent specialized per surface by a Channel type: text, voice, cli, employee, slack, advisory.',
    kv: 'src/agent/ - createMaverickAgent(channel)\nstdio entry run.ts (spawned by MCC)' }),
  N({ id: 'maverickforge', label: 'MaverickForge', sub: 'PM2 maverickforge - AI SDK v6', zone: 'core', live: true, h: 76,
    role: 'Custom multi-model AI coding workbench. Cost/perf routing across providers, Monaco editor + diff-approve, two-model debate planner.',
    kv: 'Vercel AI SDK v6 - React 19 PWA' }),
  N({ id: 'hcpmcp', label: 'housecall-pro-mcp', sub: 'MCP - 77 tools - stdio + HTTP :7332', zone: 'core', star: true, live: true, h: 92,
    role: "The canonical Housecall Pro layer - 77 MCP tools spanning customers, jobs, estimates, pricebook, scheduling. Now grizzly's live write spine.",
    kv: 'PM2 daemon - Streamable HTTP :7332\nauth: Playwright session (no API key)' }),

  N({ id: 'llama', label: 'llama.cpp', sub: ':8080 local GGUF', zone: 'infra', h: 66,
    role: 'Local GGUF inference server on the homelab box.', kv: 'AIWA :8080' }),
  N({ id: 'litellm', label: 'LiteLLM proxy', sub: ':4000 OpenAI-compatible', zone: 'infra', h: 66,
    role: 'Unified OpenAI-compatible proxy in front of multiple providers.', kv: 'AIWA :4000' }),
  N({ id: 'rag', label: 'RAG + Qdrant', sub: ':8181 - Qdrant :6333', zone: 'infra', rag: true, h: 0,
    role: 'The shared knowledge backbone. Every app that needs context - MCC and grizzly - queries it for /ask, /estimate, /stats. Rendered as a knowledge core, not a rack.',
    kv: 'AIWA :8181 (Qdrant vector store :6333)' }),
  N({ id: 'prometheus', label: 'Prometheus', sub: ':9090 metrics', zone: 'infra', h: 66,
    role: 'Time-series metrics store for host + service health.', kv: 'AIWA :9090' }),
  N({ id: 'proxmox', label: 'Proxmox API', sub: ':8006 hypervisor', zone: 'infra', h: 66,
    role: 'Hypervisor / host control plane for the AIWA box.', kv: 'AIWA :8006 - node pve' }),
  N({ id: 'promsync', label: 'prometheus-sync', sub: 'PM2 prometheus-sync', zone: 'infra', live: true, h: 56,
    role: 'Small Node process that pushes host metrics into Prometheus.', kv: 'PM2 prometheus-sync (node)' }),

  N({ id: 'anthropic', label: 'Anthropic', sub: 'Claude models', zone: 'cloud', h: 66, role: 'Claude model provider (Opus / Sonnet / Haiku).', kv: 'api.anthropic.com' }),
  N({ id: 'openrouter', label: 'OpenRouter', sub: 'multi-model gateway', zone: 'cloud', h: 66, role: "Aggregated model gateway - also powers HomeLab-Agent's Slack chat brain.", kv: 'openrouter.ai/api/v1' }),
  N({ id: 'supabase', label: 'Supabase', sub: 'shared Postgres', zone: 'cloud', star: true, h: 92, role: 'The shared cloud Postgres database - common to MCC, the SEO app, and the HomeLab agent.', kv: 'project tbvsycqfpkkxitdbgfsj' }),
  N({ id: 'gmail', label: 'Gmail-multi', sub: ':8000 mail service', zone: 'cloud', h: 66, role: "Gmail access service used by grizzly's email watcher to read inbound estimate requests.", kv: ':8000' }),
  N({ id: 'hcp', label: 'Housecall Pro', sub: 'field-service CRM', zone: 'cloud', h: 76, role: 'The live field-service CRM - customers, jobs, estimates, pricebook. System of record for the trade business.', kv: 'app.housecallpro.com (internal API)' }),
  N({ id: 'nim', label: 'NVIDIA NIM', sub: 'model endpoints', zone: 'cloud', h: 66, role: 'NVIDIA NIM inference endpoints.', kv: 'integrate.api.nvidia.com' }),
  N({ id: 'gemini', label: 'Google Gemini', sub: 'models - Veo', zone: 'cloud', h: 66, role: 'Gemini models (and Veo video for SEO content).', kv: 'generativelanguage.googleapis.com' }),
  N({ id: 'openai', label: 'OpenAI', sub: 'incl. Realtime', zone: 'cloud', h: 66, role: 'OpenAI models, including the Realtime API for voice.', kv: 'api.openai.com' }),
  N({ id: 'marketing', label: 'Marketing APIs', sub: 'FB - GBP - WP - SerpAPI', zone: 'cloud', h: 66, role: "The SEO crew's publishing + research surface.", kv: 'Facebook Graph - GBP - WordPress - SerpAPI' }),
  N({ id: 'homedepot', label: 'Home Depot', sub: 'materials pricing', zone: 'cloud', h: 66, role: "Materials lookup / pricing source for grizzly's estimates.", kv: 'homedepot.com' }),
];
const E = (from, to, type, label) => ({ from, to, type, label });
const EDGES = [
  E('assistant', 'mcc', 'http', 'proxies /api/*'),
  E('mcc', 'seo', 'http', '/seo/*'),
  E('mcc', 'seo', 'planned', '/memory (not built)'),
  E('mcc', 'grizzly', 'spawn', 'ASK/AGENT -> run.ts brain'),
  E('mcc', 'grizzly', 'spawn', 'estimate -> from-chat.ts'),
  E('mcc', 'rag', 'rag', '/ask /estimate /stats'),
  E('mcc', 'supabase', 'db', 'read/write'),
  E('mcc', 'anthropic', 'llm', ''),
  E('mcc', 'openrouter', 'llm', ''),
  E('mcc', 'nim', 'llm', ''),
  E('mcc', 'gemini', 'llm', ''),
  E('mcc', 'openai', 'llm', 'incl. Realtime voice'),
  E('mcc', 'litellm', 'llm', ''),
  E('mcc', 'llama', 'llm', 'local'),
  E('seo', 'supabase', 'db', 'seo_runs - weekly_posts'),
  E('seo', 'marketing', 'http', 'publish + research'),
  E('grizzly', 'slackMav', 'slack', 'chat + DM'),
  E('grizzly', 'mcc', 'http', '/api/extract-file'),
  E('grizzly', 'rag', 'rag', 'pricebook context'),
  E('grizzly', 'hcp', 'legacy', 'cookie client (rollback only)'),
  E('grizzly', 'hcpmcp', 'mcp', 'write spine (HTTP :7332)'),
  E('grizzly', 'homedepot', 'http', 'materials'),
  E('grizzly', 'gmail', 'http', 'email-watcher'),
  E('hcpmcp', 'hcp', 'mcp', '77 tools - Playwright cookies'),
  E('maverickforge', 'hcpmcp', 'mcp', 'MCP client'),
  E('maverickforge', 'anthropic', 'llm', 'via AI Gateway'),
  E('maverickforge', 'openai', 'llm', 'via AI Gateway'),
  E('maverickforge', 'vercel', 'deploy', 'deploy'),
  E('homelab', 'slackHome', 'slack', 'alerts + approvals'),
  E('homelab', 'prometheus', 'monitor', 'reads metrics'),
  E('homelab', 'supabase', 'db', 'agent_* audit log'),
  E('homelab', 'mcc', 'monitor', 'health :3000'),
  E('homelab', 'llama', 'monitor', 'health :8080'),
  E('homelab', 'seo', 'monitor', 'health :8790'),
  E('promsync', 'prometheus', 'monitor', 'push'),
];

const byId = Object.fromEntries(NODES.map(n => [n.id, n]));
const zoneById = Object.fromEntries(ZONES.map(z => [z.id, z]));

export function EcosystemMapPage() {
  const stageRef = useRef(null);
  const hostRef = useRef(null);
  const searchRef = useRef(null);
  const legendRowsRef = useRef(null);
  const panelRef = useRef(null);
  const panelBodyRef = useRef(null);

  useEffect(() => {
    const stage = stageRef.current;
    const host = hostRef.current;
    let W = stage.clientWidth, H = stage.clientHeight;

    // fresh per-mount node/edge state
    for (const n of NODES) { n._group = null; n._materials = null; n._label = null; n._led = null; n._spin = null; }

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, W / H, 1, 5000);
    const OVERVIEW = { pos: new THREE.Vector3(0, 760, 600), target: new THREE.Vector3(0, 0, 0) };
    camera.position.copy(OVERVIEW.pos);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(W, H);
    host.appendChild(renderer.domElement);

    const labelRenderer = new CSS2DRenderer();
    labelRenderer.setSize(W, H);
    labelRenderer.domElement.style.position = 'absolute';
    labelRenderer.domElement.style.top = '0';
    labelRenderer.domElement.style.left = '0';
    labelRenderer.domElement.style.pointerEvents = 'none';
    host.appendChild(labelRenderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 1.0));
    const dl = new THREE.DirectionalLight(0xffffff, 0.55);
    dl.position.set(200, 700, 300);
    scene.add(dl);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.target.copy(OVERVIEW.target);
    controls.minDistance = 140;
    controls.maxDistance = 2200;
    controls.update();

    function makeFloorTexture() {
      const c = document.createElement('canvas'); c.width = 64; c.height = 64;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#2a2f3a'; ctx.fillRect(0, 0, 64, 64);
      ctx.strokeStyle = '#1b1f28'; ctx.lineWidth = 3;
      ctx.strokeRect(0, 0, 64, 64);
      ctx.fillStyle = '#333947';
      for (let i = 6; i < 58; i += 12) for (let j = 6; j < 58; j += 12) { ctx.beginPath(); ctx.arc(i, j, 1.1, 0, 7); ctx.fill(); }
      const tex = new THREE.CanvasTexture(c);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(20, 17);
      return tex;
    }
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(1050, 900),
      new THREE.MeshStandardMaterial({ map: makeFloorTexture(), roughness: 0.95, metalness: 0.05 })
    );
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);

    for (const z of ZONES) {
      const spacing = 72;
      const list = NODES.filter(n => n.zone === z.id);
      list.forEach((n, i) => { n.x = (i - (list.length - 1) / 2) * spacing; n.z = z.z; });

      const div = document.createElement('div');
      div.className = 'aisle-label';
      div.textContent = z.label;
      const label = new CSS2DObject(div);
      label.position.set(-490, 4, z.z - 30);
      scene.add(label);
    }

    const texCache = {};
    function rackTexture(colorHex, opts) {
      const key = colorHex + '|' + opts.live + '|' + opts.star + '|' + opts.hub;
      if (texCache[key]) return texCache[key];
      const c = document.createElement('canvas'); c.width = 128; c.height = 256;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#1b2030'; ctx.fillRect(0, 0, 128, 256);
      ctx.fillStyle = '#' + colorHex.toString(16).padStart(6, '0');
      ctx.fillRect(0, 0, 10, 256);
      const units = opts.hub ? 12 : 9;
      const uh = (256 - 20) / units;
      for (let i = 0; i < units; i++) {
        const y = 10 + i * uh;
        ctx.fillStyle = i % 2 === 0 ? '#252b3f' : '#212739';
        ctx.fillRect(16, y, 100, uh - 4);
        ctx.strokeStyle = '#0d1018'; ctx.lineWidth = 1; ctx.strokeRect(16, y, 100, uh - 4);
        ctx.fillStyle = '#0c0f16';
        ctx.beginPath(); ctx.arc(22, y + (uh - 4) / 2, 1.6, 0, 7); ctx.fill();
        ctx.beginPath(); ctx.arc(108, y + (uh - 4) / 2, 1.6, 0, 7); ctx.fill();
      }
      if (opts.star) {
        ctx.fillStyle = '#f2c14e';
        ctx.font = 'bold 22px sans-serif';
        ctx.fillText('*', 104, 30);
      }
      const tex = new THREE.CanvasTexture(c);
      texCache[key] = tex;
      return tex;
    }

    const nodeMeshes = [];
    for (const n of NODES) {
      const group = new THREE.Group();
      group.position.set(n.x, 0, n.z);
      const zoneColor = zoneById[n.zone].color;
      let pickMesh, materials = [];

      if (n.rag) {
        n.h = 64;
        const pedestal = new THREE.Mesh(
          new THREE.CylinderGeometry(20, 24, 10, 20),
          new THREE.MeshStandardMaterial({ color: 0x1b2030, roughness: 0.6 })
        );
        pedestal.position.y = 5;
        group.add(pedestal);
        const crystalMat = new THREE.MeshStandardMaterial({ color: 0x1D9E75, emissive: 0x0f6e56, emissiveIntensity: 0.6, roughness: 0.25, metalness: 0.3, transparent: true, opacity: 0.95 });
        const crystal = new THREE.Mesh(new THREE.IcosahedronGeometry(24, 0), crystalMat);
        crystal.position.y = 44;
        group.add(crystal);
        const wire = new THREE.Mesh(new THREE.IcosahedronGeometry(30, 0), new THREE.MeshBasicMaterial({ color: 0x5DCAA5, wireframe: true, transparent: true, opacity: 0.4 }));
        wire.position.y = 44;
        group.add(wire);
        pickMesh = crystal;
        materials = [crystalMat, wire.material, pedestal.material];
        n._spin = crystal;
      } else {
        const w = n.hub ? 58 : 40, d = n.hub ? 46 : 38, h = n.h;
        const tex = rackTexture(zoneColor, { live: !!n.live, star: !!n.star, hub: !!n.hub });
        const faceMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, metalness: 0.15, transparent: true, opacity: 0.97 });
        const sideMat = new THREE.MeshStandardMaterial({ color: 0x14171f, roughness: 0.7, transparent: true, opacity: 0.97 });
        materials = [faceMat, faceMat, sideMat, sideMat, faceMat, faceMat];
        const rack = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), materials);
        rack.position.y = h / 2;
        group.add(rack);
        pickMesh = rack;
        if (n.live) {
          const led = new THREE.Mesh(new THREE.SphereGeometry(2.6, 8, 8), new THREE.MeshStandardMaterial({ color: 0x1D9E75, emissive: 0x1D9E75, emissiveIntensity: 1 }));
          led.position.set(w / 2 - 6, h - 8, d / 2 + 0.5);
          group.add(led);
          n._led = led;
        }
        if (n.hub) {
          const beacon = new THREE.Mesh(new THREE.SphereGeometry(6, 12, 12), new THREE.MeshStandardMaterial({ color: 0xEF9F27, emissive: 0xBA7517, emissiveIntensity: 0.8 }));
          beacon.position.y = h + 8;
          group.add(beacon);
          n._led = beacon;
        }
      }
      pickMesh.userData.id = n.id;
      scene.add(group);
      n._group = group; n._materials = materials;

      const div = document.createElement('div');
      div.className = 'rack-label';
      div.innerHTML = (n.star && !n.rag ? '<span style="color:var(--amber);font-size:11px">&#9733;</span>' : '') + '<span>' + n.label + '</span>';
      div.addEventListener('click', () => selectNode(n.id));
      const co = new CSS2DObject(div);
      co.position.set(0, n.rag ? 76 : n.h + 6, 0);
      group.add(co);
      n._label = div;
      nodeMeshes.push(pickMesh);
    }

    const pairKey = (a, b) => [a, b].sort().join('|');
    const pairCount = {};
    for (const e of EDGES) pairCount[pairKey(e.from, e.to)] = (pairCount[pairKey(e.from, e.to)] || 0) + 1;
    const pairSeen = {};
    const edgeLines = [];
    for (const e of EDGES) {
      const a = byId[e.from], b = byId[e.to];
      const key = pairKey(e.from, e.to);
      const total = pairCount[key];
      pairSeen[key] = (pairSeen[key] || 0);
      const idx = pairSeen[key]++;
      const off = total > 1 ? (idx - (total - 1) / 2) * 10 : 0;
      const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz) || 1;
      const ox = -dz / len * off, oz = dx / len * off;
      const p1 = new THREE.Vector3(a.x + ox, 6, a.z + oz);
      const p2 = new THREE.Vector3(b.x + ox, 6, b.z + oz);
      const mid = new THREE.Vector3((p1.x + p2.x) / 2, 26, (p1.z + p2.z) / 2);
      const curve = new THREE.QuadraticBezierCurve3(p1, mid, p2);
      const pts = curve.getPoints(20);
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const type = EDGE_TYPES[e.type];
      const mat = new THREE.LineBasicMaterial({ color: type.c, transparent: true, opacity: 0.4 });
      const line = new THREE.Line(geo, mat);
      line.userData.e = e;
      scene.add(line);
      edgeLines.push(line);
    }

    const offTypes = new Set();
    function neighborsOf(id) {
      const set = new Set();
      for (const e of EDGES) {
        if (offTypes.has(e.type)) continue;
        if (e.from === id) set.add(e.to);
        if (e.to === id) set.add(e.from);
      }
      return set;
    }

    let selected = null;
    function setOpacity(mats, v) { for (const m of mats) m.opacity = v; }
    function applyHighlight() {
      if (!selected) {
        for (const n of NODES) { setOpacity(n._materials, 0.97); n._group.scale.setScalar(1); n._label.style.opacity = 1; }
        for (const l of edgeLines) { l.material.opacity = offTypes.has(l.userData.e.type) ? 0 : 0.4; }
        return;
      }
      const neighbors = neighborsOf(selected);
      for (const n of NODES) {
        const active = n.id === selected || neighbors.has(n.id);
        setOpacity(n._materials, active ? 0.97 : 0.12);
        n._group.scale.setScalar(n.id === selected ? 1.12 : 1);
        n._label.style.opacity = active ? 1 : 0.25;
      }
      for (const l of edgeLines) {
        const e = l.userData.e;
        const involved = (e.from === selected || e.to === selected) && !offTypes.has(e.type);
        l.material.opacity = offTypes.has(e.type) ? 0 : (involved ? 1 : 0.04);
      }
    }

    function panelHTML(n) {
      const zone = zoneById[n.zone];
      const conns = [];
      for (const e of EDGES) {
        if (e.from === n.id) conns.push({ other: e.to, type: e.type, dir: '->' });
        else if (e.to === n.id) conns.push({ other: e.from, type: e.type, dir: '<-' });
      }
      const hex = '#' + zone.color.toString(16).padStart(6, '0');
      let html = `<div style="display:inline-block;font-size:10px;letter-spacing:.1em;text-transform:uppercase;padding:4px 9px;border-radius:6px;font-weight:500;margin-bottom:10px;background:${hex}22;color:${hex}">${(zone.label.split(' - ')[1] || zone.label)}</div>`;
      html += `<h2 style="margin:4px 0 2px;display:flex;align-items:center;gap:8px">${n.label}${n.live ? '<span style="width:7px;height:7px;border-radius:50%;background:#1D9E75;display:inline-block"></span>' : ''}${n.star ? '<span style="color:var(--amber);font-size:14px">&#9733;</span>' : ''}</h2>`;
      html += `<div style="font-size:13px;color:var(--muted);line-height:1.6;margin:8px 0 16px">${n.role}</div>`;
      if (n.kv) html += `<div style="font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--cyan);margin-bottom:6px">Asset tag</div><div class="tag-block">${n.kv}</div>`;
      if (conns.length) {
        html += `<div style="font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--cyan);margin:16px 0 2px">Rack ports (${conns.length})</div><div style="border-bottom:1px solid var(--line)">`;
        conns.forEach((c, i) => {
          const t = EDGE_TYPES[c.type];
          const chex = '#' + t.c.toString(16).padStart(6, '0');
          html += `<div class="slot-row" data-go="${c.other}"><span class="slot-num">${String(i + 1).padStart(2, '0')}</span><span class="slot-dot" style="background:${chex}"></span><span class="slot-dir">${c.dir}</span><span class="slot-nm">${byId[c.other].label}</span></div>`;
        });
        html += '</div>';
      }
      return html;
    }

    function flyTo(pos, target, dur = 650) {
      controls.enabled = false;
      const p0 = camera.position.clone(), t0v = controls.target.clone();
      const start = performance.now();
      function step(now) {
        const t = Math.min(1, (now - start) / dur);
        const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
        camera.position.lerpVectors(p0, pos, e);
        controls.target.lerpVectors(t0v, target, e);
        controls.update();
        if (t < 1) requestAnimationFrame(step); else controls.enabled = true;
      }
      requestAnimationFrame(step);
    }

    const panel = panelRef.current;
    const panelBody = panelBodyRef.current;
    function selectNode(id) {
      selected = id;
      applyHighlight();
      const n = byId[id];
      flyTo(new THREE.Vector3(n.x + 10, (n.rag ? 70 : n.h) * 0.85 + 40, n.z + 150), new THREE.Vector3(n.x, (n.rag ? 70 : n.h) * 0.5, n.z));
      panelBody.innerHTML = panelHTML(n);
      panel.style.display = 'flex';
      panelBody.querySelectorAll('[data-go]').forEach(el => {
        el.addEventListener('click', () => selectNode(el.dataset.go));
      });
    }
    function deselect() { selected = null; applyHighlight(); panel.style.display = 'none'; }

    const closeBtn = panel.querySelector('.closePanelBtn');
    const onClose = () => { deselect(); flyTo(OVERVIEW.pos, OVERVIEW.target); };
    closeBtn.addEventListener('click', onClose);

    const legendRows = legendRowsRef.current;
    legendRows.innerHTML = '';
    const legendCleanups = [];
    for (const [k, v] of Object.entries(EDGE_TYPES)) {
      const row = document.createElement('div');
      row.className = 'legend-row';
      const hex = '#' + v.c.toString(16).padStart(6, '0');
      row.innerHTML = `<span class="legend-sw" style="background:${hex}"></span>${v.label}`;
      const onClick = () => {
        if (offTypes.has(k)) { offTypes.delete(k); row.classList.remove('off'); }
        else { offTypes.add(k); row.classList.add('off'); }
        applyHighlight();
      };
      row.addEventListener('click', onClick);
      legendCleanups.push(() => row.removeEventListener('click', onClick));
      legendRows.appendChild(row);
    }

    const search = searchRef.current;
    const onSearchInput = () => {
      const q = search.value.trim().toLowerCase();
      if (!q) { for (const n of NODES) n._label.style.opacity = selected ? n._label.style.opacity : 1; return; }
      for (const n of NODES) {
        const m = (n.label + ' ' + n.sub + ' ' + n.role).toLowerCase().includes(q);
        n._label.style.opacity = m ? 1 : 0.2;
      }
    };
    const onSearchKeydown = (e) => {
      if (e.key === 'Enter') {
        const q = search.value.trim().toLowerCase();
        const hit = NODES.find(n => (n.label + ' ' + n.sub + ' ' + n.role).toLowerCase().includes(q));
        if (hit) selectNode(hit.id);
      }
    };
    search.addEventListener('input', onSearchInput);
    search.addEventListener('keydown', onSearchKeydown);

    const topBtn = stage.querySelector('.topBtn');
    const resetBtn = stage.querySelector('.resetBtn');
    const onTop = () => flyTo(new THREE.Vector3(0.01, 980, 0.01), new THREE.Vector3(0, 0, 0));
    const onReset = () => {
      deselect();
      search.value = '';
      for (const n of NODES) n._label.style.opacity = 1;
      flyTo(OVERVIEW.pos, OVERVIEW.target);
    };
    topBtn.addEventListener('click', onTop);
    resetBtn.addEventListener('click', onReset);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let downPos = null;
    const onPointerDown = (e) => { downPos = { x: e.clientX, y: e.clientY }; };
    const onPointerUp = (e) => {
      if (!downPos) return;
      const dist = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
      downPos = null;
      if (dist > 5) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(nodeMeshes);
      if (hits.length) selectNode(hits[0].object.userData.id);
      else deselect();
    };
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerup', onPointerUp);

    function onResize() {
      W = stage.clientWidth; H = stage.clientHeight;
      camera.aspect = W / H; camera.updateProjectionMatrix();
      renderer.setSize(W, H); labelRenderer.setSize(W, H);
    }
    window.addEventListener('resize', onResize);

    let raf;
    let tPrev = performance.now();
    function animate(now) {
      raf = requestAnimationFrame(animate);
      const dt = (now - tPrev) / 1000; tPrev = now;
      controls.update();
      for (const n of NODES) {
        if (n._led && n.live) n._led.material.emissiveIntensity = 0.6 + 0.4 * Math.sin(now / 300);
        if (n._spin) n._spin.rotation.y += dt * 0.4;
      }
      renderer.render(scene, camera);
      labelRenderer.render(scene, camera);
    }
    raf = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      search.removeEventListener('input', onSearchInput);
      search.removeEventListener('keydown', onSearchKeydown);
      topBtn.removeEventListener('click', onTop);
      resetBtn.removeEventListener('click', onReset);
      closeBtn.removeEventListener('click', onClose);
      legendCleanups.forEach(fn => fn());
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      controls.dispose();
      renderer.dispose();
      host.innerHTML = '';
    };
  }, []);

  return (
    <div className="ecoMapPage">
      <h2 className="srOnly">Interactive 3D data center map of the Maverick Core ecosystem</h2>
      <div className="ecoMapRow">
        <div className="ecoMapStage" ref={stageRef}>
          <div className="ecoMapCanvasHost" ref={hostRef} />
          <div className="ecoMapTopBar">
            <input ref={searchRef} className="ecoMapSearch" placeholder="Search a service..." autoComplete="off" />
            <button type="button" className="topBtn ecoMapBtn">⊞ Top view</button>
            <button type="button" className="resetBtn ecoMapBtn">↻ Reset view</button>
          </div>
          <div className="ecoMapLegend">
            <div className="ecoMapLegendTitle">Cables — click to filter</div>
            <div ref={legendRowsRef} className="legendRows" />
          </div>
          <div className="ecoMapHint">drag to orbit &middot; scroll to zoom &middot; click a rack to open it</div>
        </div>
        <div className="ecoMapPanel" ref={panelRef}>
          <div className="ecoMapPanelHead">
            <button type="button" className="closePanelBtn" aria-label="Close">✕</button>
          </div>
          <div className="ecoMapPanelBody" ref={panelBodyRef} />
        </div>
      </div>
    </div>
  );
}
