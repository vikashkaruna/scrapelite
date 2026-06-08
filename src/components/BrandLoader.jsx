// BrandLoader.jsx — animated DatIQ mark used for any "in progress" state
// (dashboard loading, saving to the database, etc.). The bar-chart icon pulses
// inside an orb with a rotating progress sweep, over an indeterminate bar.
import Icon from "./Icon.jsx";

export default function BrandLoader({ title, sub, className = "" }) {
  return (
    <div className={"dash-loader" + (className ? " " + className : "")}>
      <div className="dash-loader-orb">
        <Icon name="bar-chart" size={34} strokeWidth={2.2} className="dash-loader-ico" />
      </div>
      {title && <div className="dash-loader-title">{title}</div>}
      {sub && <div className="dash-loader-sub">{sub}</div>}
      <div className="dash-loader-bar" />
    </div>
  );
}
