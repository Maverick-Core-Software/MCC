import React, { useCallback, useEffect, useRef, useState } from 'react';
import { approveSeoAction, querySeoActions } from './lib/api.js';
import { isDocumentResponse, MavMarkdown } from './mavUtils.js';

const MAV_RAG_URL = 'http://192.168.1.12:8181/estimate';

const PLATFORM_LABELS = {
  google_business_profile: 'Google Business',
  website_cms: 'Website',
  facebook_page: 'Facebook',
  review_platforms: 'Reviews',
};

const PLATFORM_COLORS = {
  google_business_profile: '#4285f4',
  website_cms: '#22c55e',
  facebook_page: '#1877f2',
  review_platforms: '#f59e0b',
};

function PlatformBadge({ platform }) {
  const label = PLATFORM_LABELS[platform] || platform;
  const color = PLATFORM_COLORS[platform] || '#888';
  return (
    <span className="cdb-badge" style={{ borderColor: color, color }}>
      {label}
    </span>
  );
}

function TaskCard({ action, onApprove, onSkip, busy }) {
  const [expanded, setExpanded] = useState(false);
  const isPost = action.source === 'gbp_posting_schedule' || action.source === 'facebook_posting_schedule';
  const postBody = action.post?.body || action.post?.hook || '';
  const dueLabel = action.due_window || '';

  return (
    <div className={`cdb-task-card ${busy ? 'cdb-task-card--busy' : ''}`}>
      <div className="cdb-task-header">
        <PlatformBadge platform={action.platform} />
        {dueLabel && <span className="cdb-task-due">{dueLabel}</span>}
      </div>
      <div className="cdb-task-title">{action.title}</div>
      {isPost && postBody && (
        <div className="cdb-task-preview">
          {expanded ? postBody : postBody.slice(0, 100) + (postBody.length > 100 ? '…' : '')}
          {postBody.length > 100 && (
            <button className="cdb-expand-btn" onClick={() => setExpanded(e => !e)}>
              {expanded ? 'less' : 'more'}
            </button>
          )}
        </div>
      )}
      {!isPost && action.steps?.length > 0 && (
        <div className="cdb-task-preview">{action.steps[0]}</div>
      )}
      <div className="cdb-task-actions">
        <button
          className="cdb-btn cdb-btn--approve"
          onClick={() => onApprove(action.id)}
          disabled={busy}
        >
          Approve
        </button>
        <button
          className="cdb-btn cdb-btn--skip"
          onClick={() => onSkip(action.id)}
          disabled={busy}
        >
          Skip
        </button>
      </div>
    </div>
  );
}

function TasksPanel({ systemOk }) {
  const [actions, setActions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [skipped, setSkipped] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem('cdb-skipped') || '[]')); } catch { return new Set(); }
  });

  const load = useCallback(async () => {
    try {
      const data = await querySeoActions();
      const all = data?.actions || [];
      setActions(all.filter(a => a.status === 'needs_approval' || a.status === 'dry_run_ready'));
    } catch {
      setActions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  const handleApprove = async (id) => {
    setBusyId(id);
    try {
      await approveSeoAction(id);
      await load();
    } catch (e) {
      console.error('Approve failed:', e);
    } finally {
      setBusyId(null);
    }
  };

  const handleSkip = (id) => {
    const next = new Set(skipped);
    next.add(id);
    setSkipped(next);
    try { localStorage.setItem('cdb-skipped', JSON.stringify([...next])); } catch {}
  };

  const visible = actions.filter(a => !skipped.has(a.id));
  const doneCount = actions.length - visible.length;

  return (
    <div className="cdb-panel cdb-tasks">
      <div className="cdb-panel-header">
        <h2 className="cdb-panel-title">Needs Your Review</h2>
        <div className="cdb-panel-meta">
          <span className={`cdb-sys-pill ${systemOk ? 'cdb-sys-pill--ok' : 'cdb-sys-pill--warn'}`}>
            {systemOk ? 'System Healthy' : 'Check System'}
          </span>
        </div>
      </div>

      {loading && <div className="cdb-empty">Loading tasks…</div>}

      {!loading && visible.length === 0 && (
        <div className="cdb-empty">
          <p>Nothing needs your attention right now.</p>
          {doneCount > 0 && <span className="cdb-empty-sub">{doneCount} item{doneCount !== 1 ? 's' : ''} handled this session</span>}
        </div>
      )}

      {!loading && visible.length > 0 && (
        <div className="cdb-task-list">
          {visible.map(action => (
            <TaskCard
              key={action.id}
              action={action}
              onApprove={handleApprove}
              onSkip={handleSkip}
              busy={busyId === action.id}
            />
          ))}
          {doneCount > 0 && (
            <div className="cdb-done-note">{doneCount} item{doneCount !== 1 ? 's' : ''} handled</div>
          )}
        </div>
      )}
    </div>
  );
}

function MaverickPanel() {
  const [history, setHistory] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [previewContent, setPreviewContent] = useState(null);
  const historyRef = useRef([]);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);
  const abortRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history, busy]);

  const send = async (msg) => {
    msg = msg || input.trim();
    if (!msg || busy) return;
    setInput('');
    setBusy(true);

    const userMsg = { role: 'user', content: msg };
    const placeholder = { role: 'assistant', content: '' };
    setHistory(prev => [...prev, userMsg, placeholder]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(MAV_RAG_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: msg, history: historyRef.current, top_k: 12 }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`API ${res.status}`);
      const data = await res.json();
      const reply = data.reply || '[No response]';
      historyRef.current = [...historyRef.current, { role: 'user', content: msg }, { role: 'assistant', content: reply }];
      setHistory(prev => {
        const next = [...prev];
        next[next.length - 1] = { role: 'assistant', content: reply };
        return next;
      });
      if (isDocumentResponse(reply)) setPreviewContent(reply);
    } catch (err) {
      if (err.name !== 'AbortError') {
        setHistory(prev => {
          const next = [...prev];
          next[next.length - 1] = { role: 'assistant', content: `Sorry, something went wrong. Please try again.` };
          return next;
        });
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const STARTERS = [
    'Build a proposal for a 200A service upgrade',
    'Look up my last job for a customer',
    'What does Oncor require for underground service?',
    'Draft a Good / Better / Best for panel replacement',
  ];

  return (
    <>
    {previewContent && (
      <div className="cdb-preview-overlay" onClick={(e) => { if (e.target === e.currentTarget) setPreviewContent(null); }}>
        <div className="cdb-preview-modal">
          <div className="cdb-preview-modal-header">
            <span className="cdb-preview-modal-label">Document Preview</span>
            <button className="cdb-preview-modal-close" onClick={() => setPreviewContent(null)}>✕ Close</button>
          </div>
          <div className="cdb-preview-modal-body">
            <MavMarkdown content={previewContent} />
          </div>
        </div>
      </div>
    )}
    <div className="cdb-panel cdb-maverick">
      <div className="cdb-panel-header">
        <h2 className="cdb-panel-title">Ask Maverick</h2>
        {history.length > 0 && !busy && (
          <button className="cdb-clear-btn" onClick={() => { setHistory([]); historyRef.current = []; setPreviewContent(null); }}>
            New Chat
          </button>
        )}
      </div>

      <div className="cdb-chat">
        {history.length === 0 && (
          <div className="cdb-chat-empty">
            <p>Your business assistant. Ask about customers, jobs, or start a proposal.</p>
            <div className="cdb-starters">
              {STARTERS.map(s => (
                <button key={s} className="cdb-starter" onClick={() => { setInput(s); inputRef.current?.focus(); }}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {history.map((msg, i) => {
          const isDoc = msg.role === 'assistant' && isDocumentResponse(msg.content);
          return (
            <div key={i} className={`cdb-msg cdb-msg--${msg.role}`}>
              <div className="cdb-msg-bubble">
                {msg.role === 'assistant' && !msg.content && busy ? (
                  <span className="cdb-typing"><span /><span /><span /></span>
                ) : isDoc ? (
                  <>
                    <span style={{ opacity: .7 }}>{msg.content.slice(0, 100)}…</span>
                    <button className="cdb-preview-btn" onClick={() => setPreviewContent(msg.content)}>
                      ↑ Open Preview
                    </button>
                  </>
                ) : (
                  msg.content.split('\n').map((line, j) => (
                    <React.Fragment key={j}>{line}{j < msg.content.split('\n').length - 1 && <br />}</React.Fragment>
                  ))
                )}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <div className="cdb-input-row">
        <textarea
          ref={inputRef}
          className="cdb-textarea"
          rows={2}
          placeholder="Ask about a customer, job, or start a proposal…"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKey}
          disabled={busy}
        />
        {busy ? (
          <button className="cdb-send cdb-send--stop" onClick={() => abortRef.current?.abort()}>
            Stop
          </button>
        ) : (
          <button className="cdb-send" onClick={() => send()} disabled={!input.trim()}>
            Send
          </button>
        )}
      </div>
    </div>
    </>
  );
}

export default function ClientDashboard({ status, companyName = 'Grizzly Electrical Solutions' }) {
  const systemOk = status?.state === 'online';

  return (
    <div className="cdb-root">
      <header className="cdb-header">
        <div className="cdb-header-brand">
          <img src="/assets/maverick-core-commander-logo.png" alt="Maverick Core" className="cdb-logo" />
          <div className="cdb-header-text">
            <span className="cdb-company-name">{companyName}</span>
            <span className="cdb-powered-by">Powered by Maverick Core</span>
          </div>
        </div>
        <a href="/" className="cdb-admin-link" title="Admin">⚙</a>
      </header>

      <div className="cdb-body">
        <TasksPanel systemOk={systemOk} />
        <MaverickPanel />
      </div>
    </div>
  );
}
