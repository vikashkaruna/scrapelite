// Toast.jsx — lightweight global toast via React context.
import { createContext, useCallback, useContext, useRef, useState } from "react";
import Icon from "./Icon.jsx";

const ToastContext = createContext(() => {});

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null);
  const timer = useRef(null);

  const showToast = useCallback((msg, icon = "check-circle") => {
    setToast({ msg, icon, id: Date.now() });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 2600);
  }, []);

  return (
    <ToastContext.Provider value={showToast}>
      {children}
      {toast && (
        <div className="toast" key={toast.id}>
          <Icon name={toast.icon} size={18} /> {toast.msg}
        </div>
      )}
    </ToastContext.Provider>
  );
}
