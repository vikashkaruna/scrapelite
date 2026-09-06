// src/components/engagement/AnalyticsPanel.jsx — Outreach Metrics, Conversion Funnel & Channel Performance
import { useMemo } from "react";
import Icon from "../Icon.jsx";
import Button from "../Button.jsx";

export default function AnalyticsPanel({
  analytics = {},
  campaignTitle = "Current Campaign",
  onExportCsv,
}) {
  const {
    total_prospects = 0,
    sent_count = 0,
    delivered_count = 0,
    opened_count = 0,
    clicked_count = 0,
    replied_count = 0,
    converted_count = 0,
    opted_out_count = 0,
    rates = {},
    channel_breakdown = {},
  } = analytics;

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
        {onExportCsv && (
          <Button variant="secondary" size="sm" icon="download" onClick={onExportCsv}>
            Export Metrics CSV
          </Button>
        )}
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
