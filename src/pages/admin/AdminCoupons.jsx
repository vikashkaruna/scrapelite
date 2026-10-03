// AdminCoupons.jsx — coupon CRUD management.
import { useState, useEffect } from "react";
import { getCoupons, saveCoupon, deleteCoupon, buildCouponsSyncPayload, buildCouponCatalogPayload } from "../../lib/adminService.js";
import { saveCouponsConfig, syncCouponsFromServer } from "../../lib/adminConfigService.js";
import { useToast } from "../../components/Toast.jsx";
import Icon from "../../components/Icon.jsx";
import Button from "../../components/Button.jsx";

const EMPTY_FORM = {
  id: null, code: "", type: "percent", value: "", maxUses: "", planId: "", expiresAt: "", active: true,
};

function CouponRow({ coupon, onEdit, onToggle, onDelete }) {
  const expired = coupon.expiresAt && new Date(coupon.expiresAt) < new Date();
  const exhausted = coupon.maxUses > 0 && coupon.uses >= coupon.maxUses;
  const status = !coupon.active ? "inactive" : expired ? "expired" : exhausted ? "exhausted" : "active";
  return (
    <tr className={"coupon-row status-" + status}>
      <td><code className="coupon-code">{coupon.code}</code></td>
      <td>
        <span className={"coupon-type-pill " + coupon.type}>
          {coupon.type === "percent" ? `${coupon.value}% off` : `+${coupon.value} extractions`}
        </span>
      </td>
      <td>{coupon.uses} / {coupon.maxUses || "∞"}</td>
      <td>{coupon.expiresAt || "—"}</td>
      <td>{coupon.planId === "manual" ? (
        <span className="coupon-plan-manual">Manual assign</span>
      ) : coupon.planId || "All plans"}</td>
      <td><span className={"status-badge " + status}>{status}</span></td>
      <td className="coupon-actions">
        <button className="icon-action" title="Edit" onClick={() => onEdit(coupon)}>
          <Icon name="edit" size={14} />
        </button>
        <button className="icon-action" title={coupon.active ? "Deactivate" : "Activate"}
          onClick={() => onToggle(coupon)}>
          <Icon name={coupon.active ? "x" : "check"} size={14} />
        </button>
        <button className="icon-action danger" title="Delete" onClick={() => onDelete(coupon.id)}>
          <Icon name="trash" size={14} />
        </button>
      </td>
    </tr>
  );
}

export default function AdminCoupons() {
  const showToast = useToast();
  // Legacy manual coupons belong to the retired admin-discount flow. Keep them
  // out of the public catalog; plan grants are issued from Admin › Users.
  const [coupons, setCoupons] = useState(() => getCoupons().filter((c) => c.planId !== "manual"));
  const [form, setForm] = useState(EMPTY_FORM);
  const [formOpen, setFormOpen] = useState(false);
  const [formError, setFormError] = useState("");
  const [syncing, setSyncing] = useState(false);

  // The browser's localStorage is only a cache: pull the server's list in (and
  // push up anything only this browser has) so every admin session sees the
  // same coupons, bonus and manual-assign ones included.
  useEffect(() => {
    let alive = true;
    syncCouponsFromServer().then((merged) => {
      if (alive && merged) setCoupons(merged.filter((c) => c.planId !== "manual"));
    });
    return () => { alive = false; };
  }, []);

  const handleField = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  // Pushes the current local coupon list to the checkout-facing store (see
  // admin-coupons-config.js). Percent-type coupons are worthless until this
  // succeeds — they can't reduce a real charge from localStorage alone — so
  // this reports failure explicitly rather than only logging it.
  async function syncToServer(nextCoupons) {
    setSyncing(true);
    try {
      const res = await saveCouponsConfig(buildCouponsSyncPayload(nextCoupons), buildCouponCatalogPayload(nextCoupons));
      if (res.persisted === false) {
        showToast(res.warning || "Saved locally only — coupon can't be used at checkout yet.");
      }
    } catch (e) {
      showToast(e.message || "Couldn't sync coupon to checkout — it won't be redeemable yet.");
    } finally {
      setSyncing(false);
    }
  }

  const handleSave = async (e) => {
    e.preventDefault();
    setFormError("");
    if (!form.code.trim()) { setFormError("Coupon code is required."); return; }
    if (!form.value || isNaN(Number(form.value)) || Number(form.value) <= 0) {
      setFormError("Enter a valid discount value."); return;
    }
    const coupon = {
      ...form,
      code: form.code.toUpperCase().replace(/\s+/g, ""),
      value: Number(form.value),
      maxUses: form.maxUses ? Number(form.maxUses) : 0,
    };
    if (coupon.id == null) delete coupon.id; // create: let saveCoupon generate the id
    const next = saveCoupon(coupon);
    setCoupons(next);
    setForm(EMPTY_FORM);
    setFormOpen(false);
    await syncToServer(next);
  };

  const handleEdit = (coupon) => {
    setFormError("");
    setForm({
      id:        coupon.id,
      code:      coupon.code,
      type:      coupon.type,
      value:     String(coupon.value),
      maxUses:   coupon.maxUses ? String(coupon.maxUses) : "",
      planId:    coupon.planId || "",
      expiresAt: coupon.expiresAt || "",
      active:    coupon.active,
    });
    setFormOpen(true);
  };

  const handleNew = () => {
    if (formOpen && form.id == null) { setFormOpen(false); return; } // toggle closed
    setForm(EMPTY_FORM);
    setFormError("");
    setFormOpen(true);
  };

  const handleToggle = async (coupon) => {
    const next = saveCoupon({ ...coupon, active: !coupon.active });
    setCoupons(next);
    await syncToServer(next);
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this coupon? This cannot be undone.")) return;
    const next = deleteCoupon(id);
    setCoupons(next);
    await syncToServer(next);
  };

  return (
    <div className="admin-section">
      <div className="admin-section-head">
      <div>
          <h2 className="admin-section-title">Public coupons & discounts</h2>
          <p className="admin-section-sub">Manage paid checkout promotions. User-specific plan grants are issued from Admin › Users.</p>
        </div>
        <Button variant="primary" size="sm" icon="plus" onClick={handleNew}>
          New coupon
        </Button>
      </div>

      {formOpen && (
        <div className="card card-pad coupon-form-card">
          <h3 className="coupon-form-title">{form.id != null ? "Edit coupon" : "Create coupon"}</h3>
          <form className="coupon-create-form" onSubmit={handleSave}>
            <div className="cf-row">
              <div className="cf-field">
                <label>Code</label>
                <input type="text" placeholder="e.g. SAVE20" value={form.code}
                  onChange={(e) => handleField("code", e.target.value.toUpperCase())} maxLength={24} />
              </div>
              <div className="cf-field">
                <label>Type</label>
                <select value={form.type} onChange={(e) => handleField("type", e.target.value)}>
                  <option value="percent">% Discount</option>
                  <option value="extractions">Bonus extractions</option>
                </select>
              </div>
              <div className="cf-field">
                <label>{form.type === "percent" ? "Discount %" : "Extraction bonus"}</label>
                <input type="number" min="1" max={form.type === "percent" ? "100" : "10000"}
                  placeholder={form.type === "percent" ? "20" : "100"}
                  value={form.value} onChange={(e) => handleField("value", e.target.value)} />
              </div>
            </div>
            <div className="cf-row">
              <div className="cf-field">
                <label>Max uses (0 = unlimited)</label>
                <input type="number" min="0" placeholder="100" value={form.maxUses}
                  onChange={(e) => handleField("maxUses", e.target.value)} />
              </div>
              <div className="cf-field">
                <label>Restrict to plan (optional)</label>
                <select value={form.planId} onChange={(e) => handleField("planId", e.target.value)}>
                  <option value="">All plans</option>
                  <option value="free">Free</option>
                  <option value="go">Go</option>
                  <option value="select">Select</option>
                  <option value="pro">Pro</option>
                  <option value="business">Business</option>
                  <option value="agency">Agency</option>
                </select>
              </div>
              <div className="cf-field">
                <label>Expiry date (optional)</label>
                <input type="date" value={form.expiresAt}
                  onChange={(e) => handleField("expiresAt", e.target.value)} />
              </div>
            </div>
            {formError && <div className="cf-error"><Icon name="alert-triangle" size={13} />{formError}</div>}
            <div className="cf-actions">
              <Button variant="primary" type="submit" size="sm">{form.id != null ? "Update coupon" : "Save coupon"}</Button>
              <Button variant="ghost" size="sm" onClick={() => { setFormOpen(false); setForm(EMPTY_FORM); }}>Cancel</Button>
            </div>
          </form>
        </div>
      )}

      <div className="card admin-table-card">
        <div className="admin-table-scroll">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Discount</th>
                <th>Uses</th>
                <th>Expiry</th>
                <th>Plan</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {coupons.length === 0 ? (
                <tr><td colSpan={7} className="admin-empty">No coupons yet. Create one above.</td></tr>
              ) : (
                coupons.map((c) => (
                  <CouponRow key={c.id} coupon={c} onEdit={handleEdit} onToggle={handleToggle} onDelete={handleDelete} />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
