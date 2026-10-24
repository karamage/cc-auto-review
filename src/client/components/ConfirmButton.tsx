import { type ReactNode, useState } from "react";
import { t } from "../i18n.ts";

/**
 * 押すとその場で確認を求めるボタン。
 * デスクトップアプリの WebView は window.confirm にダイアログを出さず false を返すため、確認は画面の中で取る。
 * required が false のときは確認を挟まずに実行する
 */
export function ConfirmButton({
  message,
  confirmLabel,
  onConfirm,
  required = true,
  disabled = false,
  variant,
  children,
}: {
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  required?: boolean;
  disabled?: boolean;
  variant?: "text";
  children: ReactNode;
}) {
  const [asking, setAsking] = useState(false);

  if (!asking || disabled) {
    return (
      <button
        type="button"
        data-variant={variant}
        disabled={disabled}
        onClick={() => (required ? setAsking(true) : onConfirm())}
      >
        {children}
      </button>
    );
  }
  return (
    <span className="inline-confirm">
      <span role="alert">{message}</span>
      <button type="button" onClick={() => setAsking(false)}>
        {t().confirm.cancel}
      </button>
      <button
        type="button"
        data-variant="danger"
        onClick={() => {
          setAsking(false);
          onConfirm();
        }}
      >
        {confirmLabel}
      </button>
    </span>
  );
}
