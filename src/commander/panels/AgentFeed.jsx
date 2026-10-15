// Panel 1 — Agent activity feed (placeholder; no live data yet).
import { Panel } from '../../components/Dashboard.jsx';

export default function AgentFeed() {
  return (
    <Panel title="Agent Activity">
      <div className="commanderTerminal" role="log" aria-label="Agent activity feed">
        <p className="commanderEmpty">Coming soon — data source TBD.</p>
        <p className="commanderEmptySub">Live terminal-style scrolling list of what agents are doing across the workbench.</p>
      </div>
    </Panel>
  );
}
