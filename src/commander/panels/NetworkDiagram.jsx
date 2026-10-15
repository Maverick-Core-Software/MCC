// Panel 4 — Network diagram (placeholder; no live data yet).
// This hosts the separate network diagram tab/page: live numbers on
// connection lines with color thresholds. It is distinct from the 3D
// ecosystem map (src/pages/EcosystemMapPage.jsx), which also needs
// updating but stays as its own view.
import { Panel } from '../../components/Dashboard.jsx';

export default function NetworkDiagram() {
  return (
    <Panel title="Network">
      <p className="commanderEmpty">Coming soon — data source TBD.</p>
      <p className="commanderEmptySub">Network diagram with live numbers and color-threshold connection lines. Reuse the existing diagram; the 3D ecosystem map is a separate view.</p>
    </Panel>
  );
}
