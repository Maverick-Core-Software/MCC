// Panel 1 — Agent activity feed. Live terminal-style list backed by
// GET /api/agents/feed (see routes/agents.mjs). Polls every 3s.
// No fake, demo, or seeded entries: empty means no updates have been posted.
import { useEffect, useRef, useState } from 'react';
import { Panel } from '../../components/Dashboard.jsx';

const POLL_MS = 3000;

const LEVEL_COLORS = {
  info: '#7dd3fc',
  warn: '#fbbf24',
  error: '#ef4444',
};

const STATUS_COLORS = {
  active: '#22c55e',
  idle: '#9aa7bd',
  error: '#ef4444',
  offline: '#64748b',
};

function formatTime(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return String(ts);
  return d.toLocaleTimeString(undefined, { hour12: false });
}

export default function AgentFeed() {
  const [entries, setEntries] = useState(null); // null = not loaded yet
  const [agents, setAgents] = useState([]);
  const [error, setError] = useState(null);
  const logRef = useRef(null);
  const stickRef = useRef(true);

  useEffect(() => {
    let cancelled = false;
    async function fetchFeed() {
      try {
        const res = await fetch('/api/agents/feed', { headers: { accept: 'application/json' } });
        if (!res.ok) throw new Error(`Feed request failed: ${res.status}`);
        const payload = await res.json();
        if (cancelled) return;
        setEntries(Array.isArray(payload.entries) ? payload.entries : []);
        setAgents(Array.isArray(payload.agents) ? payload.agents : []);
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    }
    fetchFeed();
    const id = setInterval(fetchFeed, POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // Auto-scroll to newest, unless the user scrolled up to read history.
  useEffect(() => {
    const el = logRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [entries]);

  function handleScroll() {
    const el = logRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  }

  return (
    <Panel title="Agent Activity">
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
        {agents.length === 0 && (
          <span style={{ color: '#9aa7bd', fontSize: '0.8rem' }}>No agents reporting yet.</span>
        )}
        {agents.map((a) => (
          <span
            key={a.name}
            title={`${a.name}: ${a.status}`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              border: '1px solid #232836',
              borderRadius: 999,
              padding: '2px 8px',
              fontSize: '0.75rem',
              color: '#e8edf5',
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: STATUS_COLORS[a.status] || STATUS_COLORS.offline,
                display: 'inline-block',
              }}
            />
            {a.name} · {a.status}
          </span>
        ))}
      </div>
      <div
        className="commanderTerminal"
        role="log"
        aria-label="Agent activity feed"
        ref={logRef}
        onScroll={handleScroll}
        style={{ overflowY: 'auto', maxHeight: 320 }}
      >
        {entries === null && !error && (
          <p className="commanderEmpty">Loading agent feed…</p>
        )}
        {error && (
          <p style={{ color: '#ef4444', margin: '8px 0' }}>
            Feed unavailable: {error}
          </p>
        )}
        {entries !== null && !error && entries.length === 0 && (
          <p className="commanderEmpty">
            No agent updates yet — waiting for the first post to /api/agents/feed.
          </p>
        )}
        {entries !== null && !error && entries.map((e, i) => (
          <div key={`${e.ts}-${e.agent}-${i}`} style={{ margin: '2px 0', wordBreak: 'break-word' }}>
            <span style={{ color: '#64748b' }}>[{formatTime(e.ts)}]</span>{' '}
            <span style={{ color: '#e8edf5', fontWeight: 700 }}>{e.agent}</span>{' '}
            <span style={{ color: LEVEL_COLORS[e.level] || LEVEL_COLORS.info }}>
              {e.message}
            </span>
          </div>
        ))}
      </div>
    </Panel>
  );
}
