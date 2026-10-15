// Maverick Commander v2 rebuild shell — dark NOC grid layout.
// Routing/wiring comes next; this shell renders the 7 panels with
// placeholder empty states and no live data.
import { useEffect, useState } from 'react';
import AgentFeed from './panels/AgentFeed.jsx';
import SocialMonitor from './panels/SocialMonitor.jsx';
import HardwareMonitor from './panels/HardwareMonitor.jsx';
import NetworkDiagram from './panels/NetworkDiagram.jsx';
import Automations from './panels/Automations.jsx';
import Services from './panels/Services.jsx';
import SeoPipeline from './panels/SeoPipeline.jsx';
import './commander.css';

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export default function CommanderLayout({ activeAgents = 0, errorCount = 0, subtitle = 'Maverick Commander' }) {
  const now = useClock();
  const clock = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(now);
  const date = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).format(now);
  return (
    <div className="commanderShell">
      <header className="commanderHeader">
        <div className="commanderTitle">
          <span className="commanderBrand">Maverick Commander</span>
          <span className="commanderSubtitle">{subtitle}</span>
        </div>
        <div className="commanderClock">
          <span className="commanderTime">{clock}</span>
          <span className="commanderDate">{date}</span>
        </div>
        <div className="commanderAgentCounts" aria-live="polite">
          <span>AI AGENTS: <strong>{activeAgents} ACTIVE</strong> | <strong className={errorCount > 0 ? 'commanderError' : ''}>{errorCount} ERRORS</strong></span>
        </div>
      </header>
      <main className="commanderGrid">
        <AgentFeed />
        <HardwareMonitor />
        <NetworkDiagram />
        <SocialMonitor />
        <Automations />
        <Services />
        <SeoPipeline />
      </main>
    </div>
  );
}
