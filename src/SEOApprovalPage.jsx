import { useCallback, useEffect, useState } from 'react';
import { querySeoWorkflow, querySeoActions, approveSeoAction, runSeoAction, dismissSeoAction, querySeoWeekPosts, querySeoTaskLog, generateFacebookSchedule, api } from './lib/api.js';
import { postHealth } from './lib/seoRules.js';

const TYPE_LABEL = { seo_run: 'SEO RUN', website_task: 'WEBSITE TASK', social_post: 'SOCIAL POST' };
const STATE_COLOR = { pending_approval: '#f59e0b', needs_approval: '#f59e0b', approved: '#10b981', executing: '#6366f1', complete: '#10b981', needs_verification: '#ef4444', error: '#ef4444', 'not-configured': '#6b7280' };

const STATUS_BADGE = {
  pending: { label: 'PENDING', color: '#f59e0b' },
  in_process: { label: 'IN PROCESS', color: '#6366f1' },
  completed: { label: 'COMPLETED', color: '#10b981' },
  failed: { label: 'FAILED', color: '#ef4444' },
};
const PRIORITY_COLOR = { critical: '#ef4444', high: '#f59e0b', medium: '#6366f1', low: '#6b7280' };
const MEDIA_ICON = { video: '🎬 video', photo: '✅ photo', downgraded: '⚠️ photo (no video)', none: '⛔ no media' };

const POST_STATUS_COLOR = { posted: '#10b981', done: '#10b981', scheduled: '#06b6d4', approved: '#6366f1', pending_approval: '#f59e0b', posting: '#8b5cf6', skipped: '#4b5563', needs_verification: '#ef4444', error: '#ef4444' };
const POST_STATUS_LABEL = { posted: 'POSTED', done: 'POSTED', scheduled: 'SCHEDULED', approved: 'QUEUED', pending_approval: 'PENDING', posting: 'POSTING…', skipped: 'SKIPPED', needs_verification: 'NEEDS VERIFY', error: 'ERROR' };
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function clean(str) {
  return (str || '').replace(/\*\*/g, '').trim();
}

function FacebookPromptModal({ isOpen, prompt, onApprove, onCancel, loading }) {
  if (!isOpen) return null;
  const [edited, setEdited] = useState(prompt);
  useEffect(() => setEdited(prompt), [prompt]);
  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: '#00000080', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
      <div style={{ background: '#161922', border: '1px solid #2a2f45', borderRadius: 10, padding: 32, maxWidth: 700, width: '90vw', maxHeight: '90vh', overflow: 'auto' }}>
        <h2 style={{ color: '#f1f5f9', marginTop: 0, marginBottom: 16, fontSize: 18, fontWeight: 700 }}>Facebook Day 1 Video Prompt</h2>
        <p style={{ color: '#94a3b8', fontSize: 12, marginBottom: 16 }}>Review and approve the video generation prompt for Day 1, or edit it below.</p>
        <textarea
          value={edited}
          onChange={(e) => setEdited(e.target.value)}
          disabled={loading}
          style={{
            width: '100%', height: 200, padding: 12, borderRadius: 6, border: '1px solid #2a2f45',
            background: '#0f1117', color: '#f1f5f9', fontSize: 13, fontFamily: 'monospace',
            resize: 'vertical', marginBottom: 16, opacity: loading ? 0.6 : 1,
          }}
        />
        <div style={{ display: 'flex', gap: 12 }}>
          <button
            onClick={() => onApprove(edited)}
            disabled={loading}
            style={{ flex: 1, padding: '10px 0', background: loading ? '#2a2f45' : '#10b981', border: 'none', borderRadius: 6, color: '#fff', fontSize: 13, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer' }}
          >
            {loading ? 'Approving...' : '✓ APPROVE PROMPT'}
          </button>
          <button
            onClick={onCancel}
            disabled={loading}
            style={{ flex: 1, padding: '10px 0', background: '#2a2f45', border: '1px solid #2a2f45', borderRadius: 6, color: '#94a3b8', fontSize: 13, fontWeight: 700, cursor: loading ? 'not-allowed' : 'pointer' }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function WeekPostsSection({ weekPosts, promoted }) {
  const [tab, setTab] = useState('facebook');
  if (!weekPosts || (weekPosts.facebook?.length === 0 && weekPosts.gbp?.length === 0)) return null;

  const posts = tab === 'facebook' ? weekPosts.facebook : weekPosts.gbp;
  // Use Central time for today check — UTC rolls over at 7pm CT which falsely
  // shows tomorrow's posts as "POST TODAY".
  const todayParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const today = `${todayParts.find(p => p.type === 'year').value}-${todayParts.find(p => p.type === 'month').value}-${todayParts.find(p => p.type === 'day').value}`;

  const fbCount = weekPosts.facebook?.length || 0;
  const gbpCount = weekPosts.gbp?.length || 0;
  const fbPosted = weekPosts.facebook?.filter(p => p.status === 'posted' || p.status === 'done').length || 0;
  const gbpPosted = weekPosts.gbp?.filter(p => p.status === 'posted' || p.status === 'done').length || 0;
  const gbpScheduled = weekPosts.gbp?.filter(p => p.status === 'scheduled').length || 0;

  return (
    <div style={{ marginTop: promoted ? 0 : 32, marginBottom: promoted ? 24 : 0 }}>
      <div style={{
        borderTop: promoted ? 'none' : '1px solid #2a2f45',
        paddingTop: promoted ? 0 : 24,
        marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ color: promoted ? '#f1f5f9' : '#94a3b8', fontSize: promoted ? 14 : 11, fontWeight: 700, letterSpacing: promoted ? 0.5 : 1, textTransform: 'uppercase' }}>
          {promoted ? "This Week's Posts" : "This Week's Posts"}
        </div>
        <div style={{ color: '#6b7280', fontSize: 11 }}>
          {weekPosts.week_start} – {weekPosts.week_end}
        </div>
      </div>

      {/* Platform tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {[
          { key: 'facebook', label: 'Facebook', count: fbCount, posted: fbPosted, label2: null },
          { key: 'gbp', label: 'Google Business', count: gbpCount, posted: gbpPosted, scheduled: gbpScheduled },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            padding: '7px 14px', borderRadius: 6, border: '1px solid',
            borderColor: tab === t.key ? '#6366f1' : '#2a2f45',
            background: tab === t.key ? '#6366f122' : 'transparent',
            color: tab === t.key ? '#818cf8' : '#6b7280',
            fontSize: 12, fontWeight: 600, cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            {t.label}
            <span style={{ background: '#2a2f45', borderRadius: 10, padding: '1px 6px', fontSize: 10, color: '#94a3b8' }}>
              {t.scheduled != null
                ? `${t.posted} posted · ${t.scheduled} sched`
                : `${t.posted}/${t.count}`}
            </span>
          </button>
        ))}
      </div>

      {/* Posts grid */}
      {posts.length === 0 ? (
        <div style={{ color: '#6b7280', fontSize: 13, padding: '20px 0' }}>No posts scheduled this week.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {posts.map(post => {
            const isToday = post.post_date === today;
            const isPast = post.post_date < today;
            // Truthful per-post health. Red wins over the date/status colouring;
            // green only flips on for verified 'posted' rows. Neutral falls through
            // to the existing date/status logic below.
            const health = postHealth(post);
            // For scheduled GBP posts: show urgency based on date
            let statusColor = POST_STATUS_COLOR[post.status] || (isPast ? '#ef4444' : '#6b7280');
            let statusLabel = POST_STATUS_LABEL[post.status] || (isPast ? 'MISSED?' : 'SCHEDULED');
            if (post.status === 'scheduled') {
              if (isToday) { statusColor = '#f59e0b'; statusLabel = 'POST TODAY'; }
              else if (isPast) { statusColor = '#ef4444'; statusLabel = 'OVERDUE'; }
            }
            if (health.state === 'red') { statusColor = '#ef4444'; statusLabel = 'CHECK'; }
            const dateObj = new Date(post.post_date + 'T12:00:00');
            const dayLabel = DAYS[dateObj.getDay() === 0 ? 6 : dateObj.getDay() - 1];
            const rowBorder = health.state === 'red'
              ? '1px solid #ef444466'
              : isToday ? '1px solid #6366f144' : '1px solid #2a2f45';
            const rowBackground = health.state === 'red' ? '#1e1518' : isToday ? '#1e2235' : '#161922';

            return (
              <div key={post.id} style={{
                background: rowBackground,
                border: rowBorder,
                borderRadius: 7, padding: '10px 14px',
                display: 'flex', alignItems: 'center', gap: 12,
              }}>
                {/* Day */}
                <div style={{ minWidth: 42, textAlign: 'center' }}>
                  <div style={{ color: isToday ? '#818cf8' : '#6b7280', fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>{dayLabel}</div>
                  <div style={{ color: isToday ? '#f1f5f9' : '#94a3b8', fontSize: 13, fontWeight: 600 }}>{post.post_date?.slice(5)}</div>
                </div>

                {/* Divider */}
                <div style={{ width: 1, height: 36, background: '#2a2f45', flexShrink: 0 }} />

                {/* Content */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: '#f1f5f9', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {clean(post.service) || clean(post.hook) || `Day ${post.day}`}
                  </div>
                  {post.hook && (
                    <div style={{ color: '#6b7280', fontSize: 11, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {clean(post.hook)}
                    </div>
                  )}
                </div>

                {/* Status */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3, flexShrink: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    {health.state === 'green' && (
                      <span title="Verified — full media published with a real post id" style={{
                        background: '#10b98122', color: '#10b981', border: '1px solid #10b98144',
                        borderRadius: 4, padding: '2px 6px', fontSize: 10, fontWeight: 700,
                      }}>✓</span>
                    )}
                    {health.state === 'red' && (
                      <span title={health.reason} style={{
                        background: '#ef444422', color: '#ef4444', border: '1px solid #ef444444',
                        borderRadius: 4, padding: '2px 6px', fontSize: 10, fontWeight: 700, letterSpacing: 0.5,
                      }}>⚠ {health.reason}</span>
                    )}
                    <span style={{
                      background: statusColor + '22', color: statusColor,
                      border: `1px solid ${statusColor}44`, borderRadius: 4,
                      padding: '2px 7px', fontSize: 10, fontWeight: 700, letterSpacing: 1,
                    }}>{statusLabel}</span>
                  </div>
                  {post.posted_at && (
                    <span style={{ color: '#6b7280', fontSize: 10 }}>
                      {new Date(post.posted_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  )}
                  {post.error && (
                    <span style={{ color: '#ef4444', fontSize: 10, maxWidth: 140, textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={post.error}>
                      {post.error}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ label, color }) {
  return (
    <span style={{ background: (color || '#6b7280') + '22', color: color || '#6b7280', border: `1px solid ${color || '#6b7280'}44`, borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, whiteSpace: 'nowrap' }}>
      {label}
    </span>
  );
}

function ActionCard({ action, onApprove, onRun, busy }) {
  const [approving, setApproving] = useState(false);
  const [running, setRunning] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [result, setResult] = useState(null);
  // Optimistic local approve flag. The /seo/actions payload bucket-maps
  // 'approved' → 'pending' (correct for mav-bridge polling), so without this
  // flag the APPROVE button would keep showing until the 30s poll catches the
  // status flip to 'executing'. Set immediately on successful approve.
  const [approved, setApproved] = useState(false);

  const handleDismiss = async () => {
    setDismissing(true);
    setResult(null);
    try {
      const res = await dismissSeoAction(action.id, action.title || '', action.type);
      setResult({ ok: true, msg: res.message || 'Task skipped.' });
      onApprove?.();
    } catch (err) {
      setResult({ ok: false, msg: err.message });
    } finally {
      setDismissing(false);
    }
  };

  const handleApprove = async () => {
    setApproving(true);
    setResult(null);
    try {
      const res = await approveSeoAction(action.id, action.label, action.type);
      setApproved(true);
      setResult({ ok: true, msg: res.message || 'Approved — bridge will execute shortly.' });
      onApprove?.();
    } catch (err) {
      setResult({ ok: false, msg: err.message });
    } finally {
      setApproving(false);
    }
  };

  const handleRun = async () => {
    setRunning(true);
    setResult(null);
    try {
      const res = await runSeoAction(action.id, action.label, action.type, true);
      setResult({ ok: true, msg: res.message || 'Triggered.' });
      onRun?.();
    } catch (err) {
      setResult({ ok: false, msg: err.message });
    } finally {
      setRunning(false);
    }
  };

  const isPending = action.status === 'pending';
  // action.approval is the server-side flag (set once status flips past
  // pending_approval). `approved` is the local optimistic flag (set on click).
  const isApproved = approved || (action.status === 'pending' && Boolean(action.approval));
  const canApprove = action.status === 'pending' && action.approval_required && !isApproved;
  const badge = STATUS_BADGE[action.status] || STATUS_BADGE.pending;
  const media = action.media_status && action.media_status !== 'n/a' ? MEDIA_ICON[action.media_status] : null;

  return (
    <div style={{ background: '#1a1d26', border: `1px solid ${isPending ? '#f59e0b33' : '#2a2f45'}`, borderRadius: 8, padding: '14px 18px', marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <StatusBadge label={TYPE_LABEL[action.type] || action.type} color="#6b7280" />
        <span style={{ color: '#f1f5f9', fontWeight: 600, flex: 1, fontSize: 14 }}>{action.title}</span>
        {action.priority && <StatusBadge label={action.priority} color={PRIORITY_COLOR[action.priority] || '#6b7280'} />}
        <StatusBadge label={badge.label} color={badge.color} />
      </div>
      <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 6 }}>{action.description}</div>
      <div style={{ color: '#6b7280', fontSize: 11, marginTop: 4 }}>
        {action.assigned_agent}{media ? ` · ${media}` : ''}{action.posts_count != null ? ` · ${action.posts_count} posts` : ''}
      </div>
      {action.error && (
        <div style={{ color: '#ef4444', fontSize: 11, marginTop: 4 }} title={action.error}>{action.error}</div>
      )}

      {(canApprove || (isApproved && Boolean(action.live_adapter))) && (
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          {canApprove && (
            <button
              onClick={handleApprove}
              disabled={approving || running || dismissing || busy}
              style={{ flex: 1, padding: '9px 0', background: approving ? '#2a2f45' : '#10b981', border: 'none', borderRadius: 6, color: '#fff', fontSize: 13, fontWeight: 700, cursor: approving ? 'not-allowed' : 'pointer' }}
            >
              {approving ? 'Approving...' : '✓ APPROVE'}
            </button>
          )}
          {canApprove && (action.type === 'website_task' || action.type === 'weekly_post') && (
            <button
              onClick={handleDismiss}
              disabled={approving || running || dismissing || busy}
              style={{ padding: '9px 14px', background: 'transparent', border: '1px solid #2a2f45', borderRadius: 6, color: '#6b7280', fontSize: 13, fontWeight: 700, cursor: dismissing ? 'not-allowed' : 'pointer' }}
            >
              {dismissing ? '...' : '✕ SKIP'}
            </button>
          )}
          {isApproved && Boolean(action.live_adapter) && (
            <button
              onClick={handleRun}
              disabled={approving || running || dismissing || busy}
              style={{ flex: 1, padding: '9px 0', background: running ? '#2a2f45' : '#6366f1', border: 'none', borderRadius: 6, color: '#fff', fontSize: 13, fontWeight: 700, cursor: running ? 'not-allowed' : 'pointer' }}
            >
              {running ? 'Running...' : '▶ RUN LIVE'}
            </button>
          )}
        </div>
      )}

      {result && (
        <div style={{ marginTop: 8, padding: '6px 10px', background: result.ok ? '#10b98122' : '#ef444422', border: `1px solid ${result.ok ? '#10b98144' : '#ef444444'}`, borderRadius: 5, color: result.ok ? '#10b981' : '#ef4444', fontSize: 12 }}>
          {result.ok ? '✓ ' : '✗ '}{result.msg}
        </div>
      )}
    </div>
  );
}

const EVENT_LABEL = { approved: 'APPROVED', run: 'RUN NOW' };
const EVENT_COLOR = { approved: '#10b981', run: '#6366f1' };

// Collapsible wrapper for website_tasks. mav-bridge returns up to 20 of them
// bucketed as 'pending' even after approval, which made the page render a wall
// of near-identical cards. Group them into one summary header that expands on
// click — individual tasks still get full ActionCard detail when expanded.
function WebsiteTasksCard({ tasks, onApprove, onRun }) {
  const [open, setOpen] = useState(false);
  const pending = tasks.filter(t => t.status === 'pending' && t.approval_required).length;
  const failed = tasks.filter(t => t.status === 'failed').length;
  const inProcess = tasks.filter(t => t.status === 'in_process').length;

  return (
    <div style={{ marginBottom: 10 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', textAlign: 'left', cursor: 'pointer',
          background: '#1a1d26', border: `1px solid ${pending ? '#f59e0b33' : '#2a2f45'}`,
          borderRadius: 8, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 10,
        }}
      >
        <StatusBadge label="WEBSITE TASKS" color="#6b7280" />
        <span style={{ color: '#f1f5f9', fontWeight: 600, flex: 1, fontSize: 14 }}>
          {tasks.length} website task{tasks.length === 1 ? '' : 's'}
        </span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {pending > 0 && <StatusBadge label={`${pending} AWAIT`} color="#f59e0b" />}
          {inProcess > 0 && <StatusBadge label={`${inProcess} RUNNING`} color="#6366f1" />}
          {failed > 0 && <StatusBadge label={`${failed} FAILED`} color="#ef4444" />}
          {pending === 0 && inProcess === 0 && failed === 0 && (
            <StatusBadge label="QUEUED" color="#6b7280" />
          )}
        </div>
        <span style={{ color: '#6b7280', fontSize: 16 }}>{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div style={{ marginTop: 6, paddingLeft: 12, borderLeft: '1px solid #2a2f45', marginLeft: 8 }}>
          {tasks.map(action => (
            <ActionCard key={action.id} action={action} onApprove={onApprove} onRun={onRun} />
          ))}
        </div>
      )}
    </div>
  );
}

function TaskActivity({ tasks }) {
  if (!tasks || tasks.length === 0) return (
    <div style={{ marginTop: 32, borderTop: '1px solid #2a2f45', paddingTop: 24 }}>
      <div style={{ color: '#94a3b8', fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 12 }}>Task Activity</div>
      <div style={{ color: '#6b7280', fontSize: 13 }}>No task events yet. Approve or run an action to see activity here.</div>
    </div>
  );
  return (
    <div style={{ marginTop: 32, borderTop: '1px solid #2a2f45', paddingTop: 24 }}>
      <div style={{ color: '#94a3b8', fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 12 }}>Task Activity</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {tasks.map((t, i) => {
          const evColor = t.ok ? (EVENT_COLOR[t.event] || '#10b981') : '#ef4444';
          const evLabel = t.ok ? (EVENT_LABEL[t.event] || t.event.toUpperCase()) : 'FAILED';
          const typeLabel = TYPE_LABEL[t.type] || t.type?.toUpperCase() || 'TASK';
          const timeStr = new Date(t.at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
          return (
            <div key={i} style={{ background: '#161922', border: '1px solid #2a2f45', borderRadius: 7, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ background: evColor + '22', color: evColor, border: `1px solid ${evColor}44`, borderRadius: 4, padding: '2px 7px', fontSize: 10, fontWeight: 700, letterSpacing: 1, flexShrink: 0 }}>{evLabel}</span>
              <StatusBadge label={typeLabel} color="#6b7280" />
              <span style={{ color: '#f1f5f9', fontSize: 13, fontWeight: 600, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.label}</span>
              {t.msg && <span style={{ color: t.ok ? '#6b7280' : '#ef4444', fontSize: 11, maxWidth: 200, textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0 }} title={t.msg}>{t.msg}</span>}
              <span style={{ color: '#4b5563', fontSize: 11, flexShrink: 0 }}>{timeStr}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function SEOApprovalPage() {
  const [workflow, setWorkflow] = useState(null);
  const [actions, setActions] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [weekPosts, setWeekPosts] = useState(null);
  const [taskLog, setTaskLog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [pendingPrompt, setPendingPrompt] = useState(null);
  const [editedPrompt, setEditedPrompt] = useState('');
  const [promptApproving, setPromptApproving] = useState(false);
  const [promptResult, setPromptResult] = useState(null);

  const [genOpen, setGenOpen] = useState(false);
  const [genDays, setGenDays] = useState(7);
  const [genStart, setGenStart] = useState('');
  const [genLoading, setGenLoading] = useState(false);
  const [genResult, setGenResult] = useState(null);

  const load = useCallback(async () => {
    try {
      const [wf, ac, wp, tl] = await Promise.all([querySeoWorkflow(), querySeoActions(), querySeoWeekPosts(), querySeoTaskLog().catch(() => ({ tasks: [] }))]);
      setWorkflow(wf);
      setActions(ac.actions || []);
      setAlerts(ac.alerts || []);
      setWeekPosts(wp);
      setTaskLog(tl.tasks || []);
      setError(null);
      setLastUpdated(new Date());

      // If run is awaiting_prompt, fetch the pending prompt
      if (wf?.state === 'awaiting_prompt') {
        try {
          const res = await fetch(api('/api/workflows/seo/facebook/pending-prompt'), { cache: 'no-store' });
          if (res.ok) {
            const data = await res.json();
            if (!data.approved) {
              setPendingPrompt(data);
              setEditedPrompt(prev => prev || data.prompt);
            }
          }
        } catch { /* ignore */ }
      } else {
        setPendingPrompt(null);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleGenerateSchedule = async () => {
    setGenLoading(true);
    setGenResult(null);
    try {
      const res = await generateFacebookSchedule(genDays, genStart);
      setGenResult({ ok: true, msg: res.message || 'Started — check back in a few minutes.' });
      setGenOpen(false);
    } catch (err) {
      setGenResult({ ok: false, msg: err.message });
    } finally {
      setGenLoading(false);
    }
  };

  const handleApprovePrompt = async () => {
    setPromptApproving(true);
    setPromptResult(null);
    try {
      const res = await fetch(api('/api/workflows/seo/facebook/approve-prompt'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: editedPrompt }),
      });
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      setPromptResult({ ok: true, msg: 'Prompt approved — video generation starting...' });
      setPendingPrompt(null);
    } catch (err) {
      setPromptResult({ ok: false, msg: err.message });
    } finally {
      setPromptApproving(false);
    }
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 30_000);
    return () => clearInterval(interval);
  }, [load]);

  const stateColor = STATE_COLOR[workflow?.state] || '#6b7280';

  // Once the run is past the approval gate, the weekly posts grid becomes the
  // primary view. run_status comes from /seo/posts/week (the latest run's
  // live status); workflow.state is the broader pipeline state.
  const runStatus = weekPosts?.run_status;
  const isApproved = ['approved', 'executing', 'awaiting_prompt', 'done', 'posted']
    .includes(runStatus) || ['approved', 'executing', 'awaiting_prompt'].includes(workflow?.state);

  // Card filtering — reduce noise once approved:
  //  - seo_run cards: always show (already filtered to active/recent by mav-bridge)
  //  - weekly_post cards: hidden entirely once approved (they're in the grid above)
  //  - website_task cards: grouped into one collapsible card
  const seoRunActions = actions.filter(a => a.type === 'seo_run');
  const pendingRunCards = seoRunActions.filter(a => a.status === 'pending');
  const otherRunCards = seoRunActions.filter(a => a.status !== 'pending' && a.status !== 'completed');

  const weeklyPostCards = actions.filter(a =>
    a.type === 'weekly_post' && (!isApproved || a.status === 'failed')
  );
  const pendingWeeklyCards = weeklyPostCards.filter(a => a.status === 'pending');
  const otherWeeklyCards = weeklyPostCards.filter(a => a.status !== 'pending' && a.status !== 'completed');

  const websiteTasks = actions.filter(a => a.type === 'website_task');
  const completedActions = actions.filter(a => a.status === 'completed');

  // Pending count for the summary bar reflects what actually needs the user's
  // attention: seo_run + weekly_post cards that are still actionable. Website
  // tasks are collapsed, so don't surface their count at the top level.
  const pendingCount = pendingRunCards.length + pendingWeeklyCards.length;

  return (
    <div style={{ padding: '24px 28px', maxWidth: 920, margin: '0 auto' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, gap: 12 }}>
        <div>
          <h1 className="panelTitle" style={{ margin: 0, fontSize: 13, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>SEO Pipeline</h1>
          <p style={{ color: '#6b7280', margin: '4px 0 0', fontSize: 12 }}>
            Review and approve weekly content before it posts
            {lastUpdated && ` · updated ${lastUpdated.toLocaleTimeString()}`}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            onClick={() => { setGenOpen(o => !o); setGenResult(null); }}
            style={{
              padding: '7px 14px', background: genOpen ? '#1e3a5f' : 'transparent',
              border: '1px solid #2563eb55', borderRadius: 6, color: '#60a5fa',
              fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
            }}
          >
            + Generate Schedule
          </button>
          {workflow && (
            <StatusBadge label={(workflow.state || 'unknown').replace(/-/g, ' ')} color={stateColor} />
          )}
        </div>
      </div>

      {genOpen && (
        <div style={{ background: '#1a1d26', border: '1px solid #2563eb33', borderRadius: 8, padding: '16px 20px', marginBottom: 20 }}>
          <div style={{ color: '#94a3b8', fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 12 }}>Generate Facebook Schedule</div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div>
              <div style={{ color: '#6b7280', fontSize: 11, marginBottom: 4 }}>Days</div>
              <select
                value={genDays}
                onChange={e => setGenDays(Number(e.target.value))}
                style={{ padding: '7px 10px', background: '#0f1117', border: '1px solid #2a2f45', borderRadius: 5, color: '#f1f5f9', fontSize: 13 }}
              >
                {[3, 5, 7].map(d => <option key={d} value={d}>{d} days</option>)}
              </select>
            </div>
            <div>
              <div style={{ color: '#6b7280', fontSize: 11, marginBottom: 4 }}>Start Date (optional)</div>
              <input
                type="date"
                value={genStart}
                onChange={e => setGenStart(e.target.value)}
                style={{ padding: '7px 10px', background: '#0f1117', border: '1px solid #2a2f45', borderRadius: 5, color: '#f1f5f9', fontSize: 13 }}
              />
            </div>
            <button
              onClick={handleGenerateSchedule}
              disabled={genLoading}
              style={{
                padding: '8px 20px', background: genLoading ? '#2a2f45' : '#2563eb',
                border: 'none', borderRadius: 6, color: '#fff', fontSize: 13, fontWeight: 700,
                cursor: genLoading ? 'not-allowed' : 'pointer',
              }}
            >
              {genLoading ? 'Starting...' : '▶ Generate'}
            </button>
          </div>
          {genResult && (
            <div style={{ marginTop: 10, padding: '6px 10px', background: genResult.ok ? '#10b98122' : '#ef444422', border: `1px solid ${genResult.ok ? '#10b98144' : '#ef444444'}`, borderRadius: 5, color: genResult.ok ? '#10b981' : '#ef4444', fontSize: 12 }}>
              {genResult.ok ? '✓ ' : '✗ '}{genResult.msg}
            </div>
          )}
        </div>
      )}

      {loading && (
        <div style={{ color: '#6b7280', textAlign: 'center', padding: 60 }}>Loading pipeline status...</div>
      )}

      {error && (
        <div style={{ background: '#ef444422', border: '1px solid #ef444444', borderRadius: 8, padding: '12px 16px', color: '#ef4444', marginBottom: 20 }}>
          ✗ {error}
        </div>
      )}

      {!loading && !error && workflow && (
        <>
          {/* Summary bar */}
          <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
            {[
              { label: 'Pending Approval', value: pendingCount, color: '#f59e0b' },
              { label: 'Reports Generated', value: workflow.activeWorkflow?.reportsGenerated ?? 0, color: '#10b981' },
              { label: 'Alerts', value: alerts.length + (workflow.faults || []).length, color: '#ef4444' },
            ].map(s => (
              <div key={s.label} style={{ background: '#1a1d26', border: '1px solid #2a2f45', borderRadius: 8, padding: '12px 18px', flex: 1, textAlign: 'center' }}>
                <div style={{ color: s.color, fontSize: 22, fontWeight: 700 }}>{s.value}</div>
                <div style={{ color: '#6b7280', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1 }}>{s.label}</div>
              </div>
            ))}
          </div>

          {/* Alerts — same deduped list the HomePage banner uses (no double alert) */}
          {(alerts.length > 0 || (workflow.faults || []).length > 0) && (
            <div style={{ background: '#ef444411', border: '1px solid #ef444433', borderRadius: 8, padding: '10px 14px', marginBottom: 20 }}>
              {alerts.map((a) => (
                <div key={a.id} style={{ color: a.severity === 'warn' ? '#f59e0b' : '#ef4444', fontSize: 12, marginBottom: 4 }}>
                  ⚠ {a.title}{a.detail ? ` — ${a.detail}` : ''}
                </div>
              ))}
              {(workflow.faults || []).map((f, i) => (
                <div key={`wf-${i}`} style={{ color: '#ef4444', fontSize: 12 }}>⚠ {f}</div>
              ))}
            </div>
          )}

          {/* Awaiting prompt approval */}
          {pendingPrompt && (
            <div style={{ background: '#1a1020', border: '1px solid #7c3aed66', borderRadius: 10, padding: '20px 24px', marginBottom: 24 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <span style={{ background: '#7c3aed22', color: '#a78bfa', border: '1px solid #7c3aed44', borderRadius: 4, padding: '2px 8px', fontSize: 11, fontWeight: 700, letterSpacing: 1 }}>AWAITING PROMPT</span>
                <span style={{ color: '#f1f5f9', fontWeight: 700, fontSize: 14 }}>Day 1 Video Prompt — Review &amp; Approve</span>
              </div>
              <p style={{ color: '#94a3b8', fontSize: 12, margin: '0 0 12px' }}>
                GPT-4o enhanced Veo3 prompt for the first day Facebook video. Edit if needed, then approve to start video generation.
              </p>
              <textarea
                value={editedPrompt}
                onChange={e => setEditedPrompt(e.target.value)}
                disabled={promptApproving}
                style={{
                  width: '100%', height: 180, padding: 12, borderRadius: 6,
                  border: '1px solid #7c3aed44', background: '#0f1117', color: '#f1f5f9',
                  fontSize: 13, fontFamily: 'monospace', resize: 'vertical',
                  marginBottom: 12, boxSizing: 'border-box', opacity: promptApproving ? 0.6 : 1,
                }}
              />
              <button
                onClick={handleApprovePrompt}
                disabled={promptApproving}
                style={{
                  padding: '10px 28px', background: promptApproving ? '#2a2f45' : '#7c3aed',
                  border: 'none', borderRadius: 6, color: '#fff', fontSize: 13, fontWeight: 700,
                  cursor: promptApproving ? 'not-allowed' : 'pointer',
                }}
              >
                {promptApproving ? 'Approving...' : '✓ APPROVE PROMPT'}
              </button>
              {promptResult && (
                <div style={{ marginTop: 10, padding: '6px 10px', background: promptResult.ok ? '#10b98122' : '#ef444422', border: `1px solid ${promptResult.ok ? '#10b98144' : '#ef444444'}`, borderRadius: 5, color: promptResult.ok ? '#10b981' : '#ef4444', fontSize: 12 }}>
                  {promptResult.ok ? '✓ ' : '✗ '}{promptResult.msg}
                </div>
              )}
            </div>
          )}

          {/* Weekly posts grid — promoted to top once the run is past the
              approval gate. Before approval the cards below are the primary view;
              after, the clean Mon/Tue/Wed... grid is what users came to see. */}
          {isApproved && (
            <WeekPostsSection weekPosts={weekPosts} promoted />
          )}

          {/* Pending seo_run + weekly_post cards (weekly_post cards are hidden
              entirely once approved — they're in the grid above). */}
          {(pendingRunCards.length > 0 || pendingWeeklyCards.length > 0) && (
            <>
              <div style={{ color: '#f59e0b', fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10 }}>
                Awaiting Approval ({pendingRunCards.length + pendingWeeklyCards.length})
              </div>
              {pendingRunCards.map(action => (
                <ActionCard key={action.id} action={action} onApprove={load} onRun={load} />
              ))}
              {pendingWeeklyCards.map(action => (
                <ActionCard key={action.id} action={action} onApprove={load} onRun={load} />
              ))}
            </>
          )}

          {/* Website tasks — always grouped into one collapsible card.
              mav-bridge returns up to 20 of these bucketed as 'pending' even
              after approval, which made the page a wall of identical cards. */}
          {websiteTasks.length > 0 && (
            <>
              <div style={{ color: '#6b7280', fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', margin: '20px 0 10px' }}>
                Website Tasks
              </div>
              <WebsiteTasksCard tasks={websiteTasks} onApprove={load} onRun={load} />
            </>
          )}

          {/* Other (non-pending) run/weekly cards that still warrant visibility */}
          {(otherRunCards.length > 0 || otherWeeklyCards.length > 0) && (
            <>
              <div style={{ color: '#6b7280', fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', margin: '20px 0 10px' }}>
                Other Actions ({otherRunCards.length + otherWeeklyCards.length})
              </div>
              {otherRunCards.map(action => (
                <ActionCard key={action.id} action={action} onApprove={load} onRun={load} />
              ))}
              {otherWeeklyCards.map(action => (
                <ActionCard key={action.id} action={action} onApprove={load} onRun={load} />
              ))}
            </>
          )}

          {pendingRunCards.length === 0 && pendingWeeklyCards.length === 0
            && otherRunCards.length === 0 && otherWeeklyCards.length === 0
            && websiteTasks.length === 0 && completedActions.length === 0 && (
            <div style={{ color: '#6b7280', textAlign: 'center', padding: 60 }}>
              No pending actions. Pipeline is idle or already approved.
            </div>
          )}

          {completedActions.length > 0 && (
            <div style={{ color: '#10b981', fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', margin: '20px 0 0' }}>
              ✓ {completedActions.length} completed (last 48h)
            </div>
          )}

          {/* Workflow phase */}
          {workflow.activeWorkflow && (
            <div style={{ marginTop: 24, borderTop: '1px solid #2a2f45', paddingTop: 16, display: 'flex', gap: 16, color: '#6b7280', fontSize: 12 }}>
              <span><strong style={{ color: '#94a3b8' }}>Workflow:</strong> {workflow.activeWorkflow.name}</span>
              <span><strong style={{ color: '#94a3b8' }}>Phase:</strong> {(workflow.activeWorkflow.phase || '').replace(/_/g, ' ')}</span>
            </div>
          )}

          {/* Weekly posts grid at the BOTTOM when not yet approved — kept
              visible so the user can preview the week before approving. */}
          {!isApproved && (
            <WeekPostsSection weekPosts={weekPosts} />
          )}
          <TaskActivity tasks={taskLog} />
        </>
      )}
    </div>
  );
}
