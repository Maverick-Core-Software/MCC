// Panel 3 — Hardware monitor (placeholder gauges; DEMO values only, no live data).
import { Gauge, Panel } from '../../components/Dashboard.jsx';

export default function HardwareMonitor() {
  return (
    <Panel title="Hardware — aiwa + Workbench">
      <p className="commanderDemoBadge">DEMO — static values, no live data wired yet</p>
      <div className="commanderGaugeRow">
        <Gauge label="CPU" value={65} unit="%" sublabel="Workbench (DEMO)" />
        <Gauge label="RAM" value={45} unit="%" sublabel="Workbench (DEMO)" />
        <Gauge label="TEMP" value={76} max={100} unit="°" sublabel="Workbench (DEMO)" />
      </div>
      <p className="commanderEmptySub">Live: GPU available / loaded / in-use, CPU, RAM used/avail, disk used/avail, SSD SMART health, temps for everything.</p>
    </Panel>
  );
}
