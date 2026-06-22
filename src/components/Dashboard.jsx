// Shared dashboard UI primitives + the view-routing context, extracted from main.jsx.
import React, { useRef, useEffect, useMemo } from 'react';
import * as echarts from 'echarts';
import { clampPercent, colorFor, formatGbFromBytes, smartLabel } from '../lib/format.js';
import { compactModelName } from '../lib/dashboardHelpers.js';
import { useDeployStatus } from '../hooks/useMetrics.js';

export function Gauge({ label, value, sublabel, color, max = 100, unit = '%', compact = false, valueText = null, decimals = 0, warn = 60, crit = 85 }) {
  const ref = useRef(null);
  const chartRef = useRef(null);
  const safeValue = value == null ? 0 : Number(value);
  const displayValue = valueText ?? (value == null ? 'N/A' : safeValue.toFixed(decimals));
  const accent = color || colorFor(safeValue, warn, crit);

  useEffect(() => {
    if (!ref.current) return undefined;
    chartRef.current = echarts.init(ref.current, null, { renderer: 'canvas' });
    const resize = () => chartRef.current?.resize();
    window.addEventListener('resize', resize);
    return () => {
      window.removeEventListener('resize', resize);
      chartRef.current?.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!chartRef.current) return;
    const ratioValue = value == null ? 0 : Math.max(0, Math.min(max, safeValue));
    chartRef.current.setOption({
      animationDuration: 500,
      series: [
        {
          type: 'gauge',
          startAngle: 210,
          endAngle: -30,
          min: 0,
          max,
          radius: '96%',
          center: ['50%', '53%'],
          splitNumber: 4,
          progress: {
            show: true,
            roundCap: true,
            width: compact ? 8 : 11,
            itemStyle: {
              color: {
                type: 'linear',
                x: 0,
                y: 0,
                x2: 1,
                y2: 0,
                colorStops: [
                  { offset: 0, color: accent },
                  { offset: 1, color: '#f1f7ff' }
                ]
              },
              shadowBlur: 8,
              shadowColor: accent
            }
          },
          axisLine: {
            roundCap: true,
            lineStyle: { width: compact ? 8 : 11, color: [[1, '#2b2f39']] }
          },
          axisTick: { show: false },
          splitLine: { show: false },
          axisLabel: { show: false },
          pointer: { show: false },
          anchor: { show: false },
          detail: { show: false },
          data: [{ value: ratioValue }]
        }
      ]
    });
  }, [accent, compact, max, safeValue, value]);

      return (
    <div className="gaugeShell">
      <div ref={ref} className="gaugeChart" />
      <div className="gaugeValue" style={{ color: accent }}>
        {displayValue}
        {valueText == null && value != null ? unit : ''}
      </div>
      <div className="gaugeLabel">{label}</div>
      {sublabel ? <div className="gaugeSub">{sublabel}</div> : null}
    </div>
  );
}

export function Panel({ title, children, className = '' }) {
  return (
    <section className={`panel ${className}`}>
      {title ? <div className="panelTitle">{title}</div> : null}
      {children}
    </section>
  );
}

export const NAV_ITEMS = [
  { id: 'home', label: 'Home', icon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" width="16" height="16"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
  )},
  { id: 'hardware', label: 'Hardware', icon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" width="16" height="16"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
  )},
  { id: 'network', label: 'Network', icon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" width="16" height="16"><circle cx="12" cy="5" r="3"/><circle cx="4" cy="19" r="3"/><circle cx="20" cy="19" r="3"/><line x1="12" y1="8" x2="12" y2="13"/><line x1="12" y1="13" x2="4" y2="16"/><line x1="12" y1="13" x2="20" y2="16"/></svg>
  )},
  { id: 'orchestrator', label: 'Orchestrator', icon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" width="16" height="16"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
  )},
  { id: 'seo', label: 'SEO Pipeline', icon: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" width="16" height="16"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
  ), badge: true },
];

export function Sidebar({ status, modelStatus }) {
  const [view, setView] = useDashboardView();
  const deployStatus = useDeployStatus();
  const deployOk = deployStatus.state === 'ok';
  const time = useMemo(() => {
    const now = status.updatedAt || new Date();
    return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(now);
  }, [status.updatedAt]);

  return (
    <aside className="sidebar">
      <div className="sidebarLogo">
        <img src="/assets/maverick-core-commander-logo.png" className="sidebarLogoImg" alt="Maverick Core Commander" />
        <span className="sidebarLogoCollapsed">M</span>
      </div>

      <nav className="sidebarNav" aria-label="Dashboard view">
        {NAV_ITEMS.map(item => (
          <button
            key={item.id}
            className={`sidebarNavItem${view === item.id ? ' active' : ''}`}
            onClick={() => setView(item.id)}
          >
            <span className="sidebarNavIcon">{item.icon}</span>
            <span className="sidebarNavLabel">{item.label}</span>
            {item.badge && <span className="sidebarNavBadge" />}
          </button>
        ))}
      </nav>

      <div className="sidebarFooter">
        <div className="sidebarSystemStatus">
          <div className={`sidebarStatusRow ${status.state === 'online' ? 'online' : 'offline'}`}>
            <span className="sidebarStatusDot" />
            <div className="sidebarStatusInfo">
              <span className="sidebarStatusLabel">PROMETHEUS</span>
              <span className="sidebarStatusValue">{time}</span>
            </div>
          </div>
          <div className={`sidebarStatusRow ${modelStatus.state === 'online' ? 'online' : 'offline'}`}>
            <span className="sidebarStatusDot" />
            <div className="sidebarStatusInfo">
              <span className="sidebarStatusLabel">LOCAL MODEL</span>
              <span className="sidebarStatusValue">{compactModelName(modelStatus.model)}</span>
            </div>
          </div>
          <div className={`sidebarStatusRow ${deployOk ? 'online' : 'offline'}`}>
            <span className="sidebarStatusDot" />
            <div className="sidebarStatusInfo">
              <span className="sidebarStatusLabel">DEPLOY</span>
              <span className="sidebarStatusValue">{deployOk ? 'OK' : 'CHECKING…'}</span>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}

export const DashboardViewContext = React.createContext(['home', () => {}]);

export function useDashboardView() {
  return React.useContext(DashboardViewContext);
}

export function DriveBlock({ name, mount, used = null, freeBytes = null, totalBytes = null, smart = null, healthText = null, note = null }) {
  const safeUsed = used == null ? null : clampPercent(used);
  const statusText = healthText || smartLabel(smart);
  const statusClass = statusText === 'PENDING' ? 'pending' : smart === 0 ? 'bad' : statusText === 'HEALTHY' || smart === 1 ? 'ok' : '';
  const usedBytes = Number.isFinite(freeBytes) && Number.isFinite(totalBytes) ? totalBytes - freeBytes : null;
  return (
    <div className={`driveBlock ${safeUsed == null ? 'waiting' : ''}`}>
      <div className="driveHead">
        <span>{name}</span>
        <strong className={statusClass}>{statusText}</strong>
      </div>
      <div className="driveMeta">
        <em>{mount}</em>
        <b>{safeUsed == null ? 'WAITING' : `${Math.round(safeUsed)}% USED`}</b>
      </div>
      <div className="miniBar driveUsage"><i style={{ width: `${safeUsed ?? 0}%` }} /></div>
      <div className="driveStats">
        <span>{usedBytes == null ? 'USED --' : `USED ${formatGbFromBytes(usedBytes)}`}</span>
        <span>TOTAL {formatGbFromBytes(totalBytes)}</span>
      </div>
      {note ? <div className="driveNote">{note}</div> : null}
    </div>
  );
}
