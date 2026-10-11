import type { AppLocale, ReleaseNotes } from "@vela/shared";
import { useEffect, useRef, useState } from "react";
import { ObBurst, ObDefs, obColor } from "./onboarding-art";
import { onboardingCopy } from "./onboarding-copy";
import { fill } from "./onboarding-ui";
import "../onboarding.css";

/**
 * 更新后第一次打开时盖在主界面上的「新到港」。内容来自安装包里的 release-notes.json；
 * 颜色固定为引导的色纸，不随应用的深色模式变化。
 */
export function WhatsNewCard({ notes, locale, onClose }: { notes: ReleaseNotes; locale: AppLocale; onClose: () => void }) {
  const copy = onboardingCopy(locale);
  const [showMore, setShowMore] = useState(false);
  const close = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    close.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const tilt = [-1, 0.8, 0.6, -0.8];
  return (
    <div className="ob-wn" data-scheme="light" data-theme="daylight" lang={locale} role="dialog" aria-modal="true" aria-labelledby="ob-wn-title">
      <ObDefs />
      <div className="ob-wn-sheet">
        <ObBurst text={notes.version} fill={obColor.sun} ink={obColor.ink} />
        <small>{copy.updatedKicker}</small>
        <h2 id="ob-wn-title">{copy.newsTitle}</h2>
        <div className="ob-wn-grid">
          {notes.highlights.slice(0, 4).map((item, index) => (
            <div key={item.title} className="ob-strip" style={{ transform: `rotate(${tilt[index]}deg)` }}><b>{item.title}</b><span>{item.body}</span></div>
          ))}
        </div>
        {showMore && notes.improvements.length ? <ul className="ob-wn-more">{notes.improvements.map((text) => <li key={text}>{text}</li>)}</ul> : null}
        <div className="ob-wn-bar">
          <span>
            {notes.improvements.length ? (
              <button type="button" className="ob-link" aria-expanded={showMore} onClick={() => setShowMore((open) => !open)}>{fill(copy.newsMore, notes.improvements.length)}</button>
            ) : null}
            <button type="button" className="ob-link" onClick={() => void window.vela?.releaseNotes?.openPage().catch(() => undefined)}>{copy.newsFullNotes}</button>
          </span>
          <button ref={close} type="button" className="ob-pill sun" onClick={onClose}>{copy.continueWork} →</button>
        </div>
      </div>
    </div>
  );
}
