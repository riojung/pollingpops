type Row = Record<string, unknown>;
const rows = (value: unknown): Row[] => (Array.isArray(value) ? (value as Row[]) : []);
const workers: Record<string, { name: string; description: string }> = {
  reports: { name: "Reports", description: "Process reports from retained room evidence." },
  authoring: { name: "Authoring", description: "Process queued content authoring requests." },
  retention: { name: "Retention", description: "Run scheduled data retention work." },
  "billing-reconciliation": {
    name: "Billing reconciliation",
    description: "Process verified billing events.",
  },
  "business-integrations": {
    name: "Business integrations",
    description: "Deliver queued work to approved providers.",
  },
};

export function ServiceControls({
  controls,
  writable,
  onReview,
}: {
  controls: Row[];
  writable: boolean;
  onReview: (payload: Row) => void;
}) {
  const paused = controls.filter((control) => control.paused).length;
  return (
    <section className="service-controls">
      <div className="section-heading">
        <div>
          <h2>Service controls</h2>
          <p>Manage background processing across the platform.</p>
        </div>
        <span className={`status-pill ${paused ? "warning" : controls.length ? "positive" : ""}`}>
          {paused ? `${paused} paused` : controls.length ? "All running" : "No services"}
        </span>
      </div>
      {controls.map((control) => {
        const id = String(control.id);
        const worker = workers[id] ?? { name: id, description: "Background processing service." };
        return (
          <div className="service-row" key={id}>
            <span className="service-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1M5.6 18.4l2.1-2.1m8.6-8.6 2.1-2.1" />
                <circle cx="12" cy="12" r="5" />
              </svg>
            </span>
            <div className="service-copy">
              <strong>{worker.name}</strong>
              <small>{worker.description}</small>
            </div>
            <span className={`service-state ${control.paused ? "paused" : ""}`}>
              <i />
              {control.paused ? "Paused" : "Running"}
            </span>
            {writable && (
              <button
                className="small-button"
                aria-label={`${control.paused ? "Resume" : "Pause"} ${worker.name}`}
                onClick={() =>
                  onReview({
                    action: "worker.pause",
                    workerId: control.id,
                    paused: !control.paused,
                  })
                }
              >
                {control.paused ? "Resume" : "Pause"}
              </button>
            )}
          </div>
        );
      })}
      {controls.length === 0 && (
        <p className="empty">No service controls are available in this snapshot.</p>
      )}
    </section>
  );
}

export default function OverviewPanel({
  data,
  writable,
  onReview,
  onOperations,
}: {
  data: Row;
  writable: boolean;
  onReview: (payload: Row) => void;
  onOperations: () => void;
}) {
  const queues = rows(data.productQueues);
  const controls = rows(data.workerControls);
  const metrics = [
    {
      label: "Active rooms",
      value: rows(data.activeRooms).length,
      detail: "In the current room snapshot",
      icon: "◉",
    },
    {
      label: "Queued product jobs",
      value: queues.reduce((count, queue) => count + Number(queue.pending ?? 0), 0),
      detail: "Waiting for a product worker",
      icon: "≡",
    },
    {
      label: "Failed product jobs",
      value: queues.reduce((count, queue) => count + Number(queue.failed ?? 0), 0),
      detail: "Review in Operations",
      icon: "!",
    },
    {
      label: "Paused services",
      value: controls.filter((control) => control.paused).length,
      detail: `Across ${controls.length} background services`,
      icon: "Ⅱ",
    },
  ];
  return (
    <>
      <div className="stat-grid">
        {metrics.map((metric) => (
          <div className="stat-card" key={metric.label}>
            <div className="stat-label">
              <span>{metric.label}</span>
              <span className="stat-icon" aria-hidden="true">
                {metric.icon}
              </span>
            </div>
            <strong>{metric.value}</strong>
            <small>{metric.detail}</small>
          </div>
        ))}
      </div>
      <ServiceControls controls={controls} writable={writable} onReview={onReview} />
      <section className="guidance">
        <div className="section-heading">
          <div>
            <h2>Operational guidance</h2>
            <p>A few reminders for day-to-day administration.</p>
          </div>
          <button className="text-button" onClick={onOperations}>
            Open operations <span aria-hidden="true">↗</span>
          </button>
        </div>
        <div className="guidance-grid">
          <div>
            <span className="guidance-number">01</span>
            <h3>Review before changing</h3>
            <p>Check current queues and worker activity before pausing a service.</p>
          </div>
          <div>
            <span className="guidance-number">02</span>
            <h3>Keep a clear record</h3>
            <p>Every operational change requires a reason and appears in the audit timeline.</p>
          </div>
          <div>
            <span className="guidance-number">03</span>
            <h3>Investigate failed jobs</h3>
            <p>Inspect retained retry sources in Operations before scheduling a retry.</p>
          </div>
        </div>
      </section>
    </>
  );
}
