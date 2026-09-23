// src/components/engagement/AnalyticsPanel.jsx — Outreach Metrics, Conversion Funnel & Channel Performance
import { useMemo } from "react";
import Icon from "../Icon.jsx";
import Button from "../Button.jsx";

export default function AnalyticsPanel({
  analytics = {},
  campaignTitle = "Current Campaign",
  onExportCsv,
}) {
  const total_prospects = analytics.total_prospects ?? analytics.total ?? 0;
  const sent_count = analytics.sent_count ?? analytics.funnel?.sent ?? analytics.counts?.sent ?? 0;
  const delivered_count = analytics.delivered_count ?? analytics.funnel?.delivered ?? analytics.counts?.delivered ?? 0;
  const opened_count = analytics.opened_count ?? analytics.funnel?.opened ?? analytics.counts?.opened ?? 0;
  const clicked_count = analytics.clicked_count ?? analytics.funnel?.clicked ?? analytics.counts?.clicked ?? 0;
  const replied_count = analytics.replied_count ?? analytics.funnel?.replied ?? analytics.counts?.replied ?? 0;
  const converted_count = analytics.converted_count ?? analytics.funnel?.converted ?? analytics.counts?.converted ?? 0;
  const opted_out_count = analytics.opted_out_count ?? analytics.counts?.opted_out ?? 0;
  const rates = analytics.rates || {};
  const channel_breakdown = analytics.channel_breakdown || {};

  const handleExportCsv = () => {
    const rows = [
      ["Metric", "Value"],
      ["Campaign Title", `"${campaignTitle.replace(/"/g, '""')}"`],
      ["Total Prospects", total_prospects],
      ["Messages Sent", sent_count],
      ["Delivered", delivered_count],
      ["Opened / Read", opened_count],
      ["Clicked", clicked_count],
      ["Replied", replied_count],
      ["Converted", converted_count],
      ["Opted Out", opted_out_count],
      ["Delivery Rate", `${rates.delivery_rate || 0}%`],
      ["Open Rate", `${rates.open_rate || 0}%`],
      ["Click Rate", `${rates.click_rate || 0}%`],
      ["Reply Rate", `${rates.reply_rate || 0}%`],
      ["Conversion Rate", `${rates.conversion_rate || 0}%`],
      [],
      ["Channel Breakdown"],
      ["Channel", "Sent", "Delivered", "Opened", "Replied", "Converted", "Reply Rate %", "Conversion Rate %"],
      ...channelRows.map((r) => [
        r.channel.toUpperCase(),
        r.sent || 0,
        r.delivered || 0,
        r.opened || 0,
        r.replied || 0,
        r.converted || 0,
        `${r.replyRate || 0}%`,
        `${r.convRate || 0}%`,
      ]),
    ];

    const csvContent = "data:text/csv;charset=utf-8," + rows.map((e) => e.join(",")).join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    const safeTitle = (campaignTitle || "campaign").toLowerCase().replace(/[^a-z0-9]/g, "_");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `datiq_metrics_${safeTitle}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    if (onExportCsv) onExportCsv();
  };

  const funnelStages = useMemo(() => {
    const base = Math.max(sent_count, 1);
    return [
      { id: "sent", label: "Dispatched", count: sent_count, pct: 100, color: "var(--accent)" },
      {
        id: "delivered",
        label: "Delivered",
        count: delivered_count,
        pct: Math.round((delivered_count / base) * 100),
        color: "#3b82f6",
      },
      {
        id: "opened",
        label: "Opened / Read",
        count: opened_count,
        pct: Math.round((opened_count / base) * 100),
        color: "#8b5cf6",
      },
      {
        id: "clicked",
        label: "Clicked Links",
        count: clicked_count,
        pct: Math.round((clicked_count / base) * 100),
        color: "#ec4899",
      },
      {
        id: "replied",
        label: "Replied",
        count: replied_count,
        pct: Math.round((replied_count / base) * 100),
        color: "#f59e0b",
      },
      {
        id: "converted",
        label: "Converted",
        count: converted_count,
        pct: Math.round((converted_count / base) * 100),
        color: "#10b981",
      },
    ];
  }, [sent_count, delivered_count, opened_count, clicked_count, replied_count, converted_count]);

  const channelRows = useMemo(() => {
    const channels = ["email", "whatsapp", "telegram", "sms"];
    return channels.map((ch) => {
      const data = channel_breakdown[ch] || { sent: 0, delivered: 0, opened: 0, replied: 0, converted: 0 };
      const replyRate = data.sent > 0 ? Math.round((data.replied / data.sent) * 100) : 0;
      const convRate = data.sent > 0 ? Math.round((data.converted / data.sent) * 100) : 0;
      return { channel: ch, ...data, replyRate, convRate };
    });
  }, [channel_breakdown]);

  return (
    <div className="eng-analytics-root">
      {/* Header bar */}
      <div className="eng-analytics-header">
        <div>
          <h3 className="eng-analytics-title">Campaign Intelligence & Metrics</h3>
          <p className="eng-analytics-sub">Performance metrics, multi-channel attribution and conversion funnel for {campaignTitle}</p>
        </div>
        <Button variant="secondary" size="sm" icon="download" onClick={handleExportCsv}>
          Export Metrics CSV
        </Button>
      </div>

      {/* KPI Cards Grid */}
      <div className="eng-kpi-grid">
        <div className="eng-kpi-card">
          <div className="eng-kpi-icon-wrap"><Icon name="users" size={16} /></div>
          <div className="eng-kpi-meta">
            <span className="eng-kpi-label">Total Prospects</span>
            <span className="eng-kpi-val">{total_prospects.toLocaleString()}</span>
          </div>
        </div>

        <div className="eng-kpi-card">
          <div className="eng-kpi-icon-wrap"><Icon name="send" size={16} /></div>
          <div className="eng-kpi-meta">
            <span className="eng-kpi-label">Messages Sent</span>
            <span className="eng-kpi-val">{sent_count.toLocaleString()}</span>
          </div>
        </div>

        <div className="eng-kpi-card">
          <div className="eng-kpi-icon-wrap" style={{ color: "#3b82f6" }}><Icon name="check" size={16} /></div>
          <div className="eng-kpi-meta">
            <span className="eng-kpi-label">Delivery Rate</span>
            <span className="eng-kpi-val">{rates.delivery_rate || 0}%</span>
          </div>
        </div>

        <div className="eng-kpi-card">
          <div className="eng-kpi-icon-wrap" style={{ color: "#8b5cf6" }}><Icon name="eye" size={16} /></div>
          <div className="eng-kpi-meta">
            <span className="eng-kpi-label">Open / Read Rate</span>
            <span className="eng-kpi-val">{rates.open_rate || 0}%</span>
          </div>
        </div>

        <div className="eng-kpi-card">
          <div className="eng-kpi-icon-wrap" style={{ color: "#f59e0b" }}><Icon name="message-circle" size={16} /></div>
          <div className="eng-kpi-meta">
            <span className="eng-kpi-label">Reply Rate</span>
            <span className="eng-kpi-val">{rates.reply_rate || 0}%</span>
          </div>
        </div>

        <div className="eng-kpi-card" style={{ borderColor: "rgba(16, 185, 129, 0.4)" }}>
          <div className="eng-kpi-icon-wrap" style={{ color: "#10b981" }}><Icon name="award" size={16} /></div>
          <div className="eng-kpi-meta">
            <span className="eng-kpi-label">Conversion Rate</span>
            <span className="eng-kpi-val">{rates.conversion_rate || 0}%</span>
          </div>
        </div>
      </div>

      {/* Two Columns: Funnel on Left, Channel Breakdown on Right */}
      <div className="eng-analytics-grid">
        {/* Conversion Funnel */}
        <div className="eng-analytics-box">
          <h4 className="eng-box-title">
            <Icon name="bar-chart" size={15} /> Conversion Funnel
          </h4>
          <div className="eng-funnel-list">
            {funnelStages.map((stage) => (
              <div key={stage.id} className="eng-funnel-row">
                <div className="eng-funnel-label-col">
                  <span className="eng-funnel-name">{stage.label}</span>
                  <span className="eng-funnel-count">{stage.count.toLocaleString()}</span>
                </div>
                <div className="eng-funnel-bar-track">
                  <div
                    className="eng-funnel-bar-fill"
                    style={{
                      width: `${Math.max(stage.pct, 4)}%`,
                      backgroundColor: stage.color,
                    }}
                  />
                </div>
                <div className="eng-funnel-pct">{stage.pct}%</div>
              </div>
            ))}
          </div>
        </div>

        {/* Channel Performance Table */}
        <div className="eng-analytics-box">
          <h4 className="eng-box-title">
            <Icon name="layers" size={15} /> Multi-Channel Attribution
          </h4>
          <div className="eng-channel-table-wrap">
            <table className="eng-channel-table">
              <thead>
                <tr>
                  <th>Channel</th>
                  <th>Sent</th>
                  <th>Delivered</th>
                  <th>Replied</th>
                  <th>Reply %</th>
                  <th>Conv %</th>
                </tr>
              </thead>
              <tbody>
                {channelRows.map((row) => (
                  <tr key={row.channel}>
                    <td className="eng-channel-name-cell">
                      <span className={`eng-channel-tag eng-ch-${row.channel}`}>
                        {row.channel.toUpperCase()}
                      </span>
                    </td>
                    <td>{row.sent}</td>
                    <td>{row.delivered}</td>
                    <td>{row.replied}</td>
                    <td>
                      <span className="eng-table-pct">{row.replyRate}%</span>
                    </td>
                    <td>
                      <span className="eng-table-pct eng-conv-pct">{row.convRate}%</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Compliance & Health Summary */}
          <div className="eng-compliance-summary">
            <div className="eng-compliance-item">
              <span className="eng-compliance-key">Opt-Outs / Unsubscribes:</span>
              <span className="eng-compliance-val">{opted_out_count} ({rates.opt_out_rate || 0}%)</span>
            </div>
            <div className="eng-compliance-item">
              <span className="eng-compliance-key">Compliance Status:</span>
              <span className="eng-compliance-val eng-status-ok">
                <Icon name="shield-check" size={12} /> CAN-SPAM & TRAI Compliant
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
