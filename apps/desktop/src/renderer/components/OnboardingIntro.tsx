import { appLocales, type AppLocale, type ReleaseNotes } from "@vela/shared";
import type { CSSProperties } from "react";
import velaLogoUrl from "../../../resources/icon.png";
import subagentsShot from "../assets/onboarding/subagents.png";
import traceShot from "../assets/onboarding/trace.png";
import compactShot from "../assets/onboarding/compact.png";
import { ObBurst, ObDeco, ObHelloArt, ObPanel, obColor } from "./onboarding-art";
import type { OnboardingCopy } from "./onboarding-copy";
import { featureScreens, type FeatureScreen, type OnboardingScreen } from "./onboarding-flow";
import { Lines, Opt, fill } from "./onboarding-ui";

export interface IntroNav {
  /** 介绍模式下进入 "done" 表示关闭介绍。 */
  go: (screen: OnboardingScreen) => void;
}

/** 介绍结束后去哪：完整引导进入设置，只看介绍时直接结束。 */
const afterIntro = (mode: "full" | "intro"): OnboardingScreen => mode === "intro" ? "done" : "step-1";

export function Brand({ small, dark }: { small?: boolean; dark?: boolean }) {
  return (
    <div className={`ob-brand${small ? " sm" : ""}${dark ? " dk" : ""}`}>
      <span className="ob-mark"><img src={velaLogoUrl} alt="" /></span>
      <span>Vela</span>
    </div>
  );
}

const localeGlyph: Record<AppLocale, { glyph: string; name: string }> = {
  "zh-TW": { glyph: "繁", name: "繁體中文" },
  "zh-CN": { glyph: "简", name: "简体中文" },
  en: { glyph: "En", name: "English" },
  ja: { glyph: "あ", name: "日本語" },
  ko: { glyph: "한", name: "한국어" },
};
const greetings = ["Hello", "你好", "哈囉", "こんにちは", "안녕하세요"];

/** 第一页：在一切开始之前先选语言。标题用各国语言打招呼，不依赖当前语言。 */
export function LanguageScreen({ copy, locale, onPick, onContinue }: { copy: OnboardingCopy; locale: AppLocale; onPick: (locale: AppLocale) => void; onContinue: () => void }) {
  return (
    <section className="ob-scr-body ob-language" aria-labelledby="ob-language-title">
      <Brand small dark />
      <ObDeco className="ob-deco-tr" size={300} viewBox="0 0 300 280">
        <circle cx="226" cy="64" r="112" fill={obColor.sun} />
        <use href="#ob-star" transform="translate(72 196) scale(.95)" fill={obColor.coral} />
        <use href="#ob-frond" transform="translate(120 130) rotate(-18) scale(.8)" fill={obColor.green} />
      </ObDeco>
      <div className="ob-language-main">
        <span className="ob-chip">{copy.chipLanguage}</span>
        <div className="ob-greetings" aria-hidden="true">
          {greetings.map((text, index) => <span key={text} className={`g${index}`}>{text}</span>)}
        </div>
        <h1 id="ob-language-title">{copy.languageTitle}</h1>
        <p className="ob-language-sub">{copy.languageSub}</p>
        <div className="ob-language-grid" role="radiogroup" aria-label={copy.language}>
          {appLocales.map((id) => (
            <Opt key={id} selected={locale === id} onClick={() => onPick(id)} className="ob-language-opt" label={localeGlyph[id].name}>
              <b>{localeGlyph[id].glyph}</b><span>{localeGlyph[id].name}</span>
            </Opt>
          ))}
        </div>
        <div className="ob-cta"><button type="button" className="ob-go blue" onClick={onContinue}>{copy.languageContinue} →</button></div>
      </div>
      <svg className="ob-language-ship" viewBox="0 0 400 470" aria-hidden="true"><use href="#ob-ship" width="400" height="470" /></svg>
    </section>
  );
}

/** 第一眼：Vela 打招呼，左侧蓝色色纸，右侧落下的拼贴。 */
export function HelloScreen({ copy, notes, mode, nav }: { copy: OnboardingCopy; notes: ReleaseNotes | null; mode: "full" | "intro"; nav: IntroNav }) {
  const hasNews = Boolean(notes);
  return (
    <section className="ob-scr-body ob-hello" aria-labelledby="ob-hello-title">
      <div className="ob-collage-wrap"><ObHelloArt /></div>
      <ObPanel width={720} fill={obColor.cobalt} edge={624} />
      <div className="ob-brand-big"><span className="ob-mark"><img src={velaLogoUrl} alt="" /></span><span>Vela</span></div>
      <div className="ob-hello-text">
        <h1 id="ob-hello-title"><Lines text={copy.helloBefore} /><span className="name">{copy.helloName}</span>{copy.helloAfter}</h1>
        <p>{copy.helloBody}</p>
        <div className="ob-cta">
          <button type="button" className="ob-go" onClick={() => nav.go("tour")}>{copy.helloGo} →</button>
          {mode === "full"
            ? <button type="button" className="ob-skip" onClick={() => nav.go("step-1")}>{copy.helloSkip}</button>
            : <button type="button" className="ob-skip" onClick={() => nav.go("done")}>{copy.helloCloseIntro}</button>}
        </div>
      </div>
      {mode === "full" ? (
        <div className="ob-tabs">
          <button type="button" className="on" onClick={() => nav.go("tour")}>{copy.helloTabTour}</button>
          {hasNews ? <button type="button" onClick={() => nav.go("news")}>{fill(copy.helloTabNews, notes!.version)}</button> : null}
          <button type="button" onClick={() => nav.go("step-1")}>{hasNews ? copy.helloTabSetup : copy.helloTabSetup.replace("③", "②")}</button>
        </div>
      ) : null}
    </section>
  );
}

const tileStyles: { bg: string; ink?: boolean; tilt?: number }[] = [
  { bg: obColor.cobalt }, { bg: obColor.sun, ink: true, tilt: 1.2 }, { bg: obColor.green, tilt: -1 }, { bg: obColor.coral },
  { bg: obColor.sky, ink: true, tilt: -1.1 }, { bg: obColor.ink }, { bg: obColor.cobalt, tilt: 1 }, { bg: obColor.sun, ink: true },
];

function TileIcon({ index }: { index: number }) {
  const { sun, cream, sky, coral, ink, cobalt, green } = obColor;
  const icons = [
    <><path d="M9 4C14 12 16 20 17 28H9Z" fill={sun} /><path d="M20 10C24 16 26 22 27 28H20Z" fill={cream} /><path d="M6 12C5 18 4 23 2 28H6Z" fill={sky} /></>,
    <><path d="M4 26C10 26 10 14 17 14S24 8 30 8" stroke={ink} strokeWidth="3" fill="none" strokeLinecap="round" strokeDasharray="1 6" /><circle cx="4" cy="26" r="4" fill={coral} /><circle cx="30" cy="8" r="4" fill={cobalt} /></>,
    <><rect x="3" y="6" width="28" height="6" rx="3" fill={sun} /><rect x="3" y="15" width="20" height="6" rx="3" fill={cream} /><rect x="3" y="24" width="12" height="6" rx="3" fill={sky} /></>,
    <><rect x="6" y="3" width="4" height="28" rx="2" fill={ink} /><path d="M10 5H29L23 12L29 19H10Z" fill={sun} /></>,
    <><rect x="3" y="8" width="28" height="20" rx="4" fill={cream} /><path d="M3 11L17 21L31 11" stroke={ink} strokeWidth="2.6" fill="none" /><circle cx="29" cy="8" r="5" fill={coral} /></>,
    <><path d="M24 4A13 13 0 1 0 30 24A10 10 0 0 1 24 4Z" fill={sun} /><use href="#ob-star" transform="translate(27 9) scale(.2)" fill={cream} /></>,
    <><path d="M6 3H22L28 9V31H6Z" fill={cream} /><path d="M22 3V9H28Z" fill={sky} /><path d="M11 15H23M11 21H23M11 27H18" stroke={ink} strokeWidth="2.4" strokeLinecap="round" /></>,
    <><rect x="4" y="18" width="7" height="12" rx="2" fill={cobalt} /><rect x="14" y="10" width="7" height="20" rx="2" fill={coral} /><rect x="24" y="4" width="7" height="26" rx="2" fill={green} /></>,
  ];
  return <svg viewBox="0 0 34 34" aria-hidden="true">{icons[index]}</svg>;
}

/** 认识我：八张色纸，前三张可以点开看实机画面。 */
export function TourScreen({ copy, notes, mode, nav }: { copy: OnboardingCopy; notes: ReleaseNotes | null; mode: "full" | "intro"; nav: IntroNav }) {
  const next: OnboardingScreen = notes ? "news" : afterIntro(mode);
  return (
    <section className="ob-scr-body ob-tour" aria-labelledby="ob-tour-title">
      <Brand small dark />
      <ObDeco className="ob-deco-tr" size={260} viewBox="0 0 260 250">
        <circle cx="196" cy="56" r="104" fill={obColor.sun} />
        <use href="#ob-star" transform="translate(62 176) scale(.9)" fill={obColor.coral} />
      </ObDeco>
      <div className="ob-tour-head">
        <div>
          <span className="ob-chip">{copy.tourChip}</span>
          <h2 id="ob-tour-title">{copy.tourTitleBefore}<span>{copy.tourTitleEm}</span>{copy.tourTitleAfter}</h2>
        </div>
        <p>{copy.tourHint}</p>
      </div>
      <div className="ob-tour-grid">
        <div className="ob-tiles">
          {copy.tourTiles.map((tile, index) => {
            const style = tileStyles[index]!;
            const target = featureScreens[index];
            const css: CSSProperties = { background: style.bg, color: style.ink ? obColor.ink : obColor.cream, transform: style.tilt ? `rotate(${style.tilt}deg)` : undefined };
            const body = (
              <>
                {target ? <em>{copy.tourLive}</em> : null}
                <TileIcon index={index} />
                <b>{tile.title}</b><span>{tile.hint}</span>
              </>
            );
            return target
              ? <button key={tile.title} type="button" className="ob-tile" style={css} onClick={() => nav.go(target)}>{body}</button>
              : <div key={tile.title} className="ob-tile static" style={css}>{body}</div>;
          })}
        </div>
        <div className="ob-more">{copy.tourMore}{copy.tourMoreChips.map((chip) => <span key={chip}>{chip}</span>)}</div>
      </div>
      <div className="ob-bar">
        <span className="ob-where">{notes ? copy.tourWhere : copy.tourWhereNoNews}</span>
        <span className="ob-r">
          <button type="button" className="ob-pill" onClick={() => nav.go("hello")}>{copy.previous}</button>
          <button type="button" className="ob-pill fill" onClick={() => nav.go(next)}>
            {notes ? copy.tourNext : mode === "intro" ? copy.newsDone : copy.newsStart} →
          </button>
        </span>
      </div>
    </section>
  );
}

const featureArt: Record<FeatureScreen, { bg: string; ink: boolean; shot: string; tags: { x: number; y: number; tone: "" | "y" | "b"; tilt: number }[]; deco: "star" | "frond" | "sun" }> = {
  "feat-agents": { bg: obColor.cobalt, ink: false, shot: subagentsShot, deco: "star", tags: [{ x: 56, y: 212, tone: "", tilt: -4 }, { x: 470, y: -18, tone: "y", tilt: 3 }] },
  "feat-trace": { bg: obColor.sun, ink: true, shot: traceShot, deco: "frond", tags: [{ x: 160, y: 72, tone: "b", tilt: -4 }, { x: 370, y: 316, tone: "", tilt: 3 }] },
  "feat-compact": { bg: obColor.green, ink: false, shot: compactShot, deco: "sun", tags: [{ x: 470, y: 214, tone: "y", tilt: 3 }, { x: 340, y: 456, tone: "", tilt: -4 }] },
};
const stripTilt = [-1.2, 0.9, -0.6];

/** 功能整页：左边三张便签，右边实机截图加贴纸。 */
export function FeatureScreen({ copy, screen, notes, mode, nav }: { copy: OnboardingCopy; screen: FeatureScreen; notes: ReleaseNotes | null; mode: "full" | "intro"; nav: IntroNav }) {
  const index = featureScreens.indexOf(screen);
  const art = featureArt[screen];
  const feature = copy.features[index]!;
  const prev: OnboardingScreen = index === 0 ? "tour" : featureScreens[index - 1]!;
  const following = featureScreens[index + 1];
  const last: OnboardingScreen = notes ? "news" : afterIntro(mode);
  return (
    <section className={`ob-scr-body ob-feat${art.ink ? " ink" : ""}`} style={{ background: art.bg }} aria-labelledby={`ob-${screen}-title`}>
      <ObDeco className="ob-feat-deco" size={130} viewBox={art.deco === "frond" ? "0 0 100 100" : "-60 -60 120 120"}>
        {art.deco === "star" ? <use href="#ob-star" transform="scale(1.3)" fill={obColor.sun} />
          : art.deco === "frond" ? <use href="#ob-frond" fill={obColor.green} transform="rotate(18 50 50)" />
            : <circle r="48" fill={obColor.sun} />}
      </ObDeco>
      <div className="ob-feat-text">
        <span className={`ob-chip${art.ink ? "" : " cr"}`}>{fill(copy.featureChip, index + 1)}</span>
        <h2 id={`ob-${screen}-title`}>{feature.title}</h2>
        <p>{feature.lead}</p>
        {feature.points.map((point, at) => (
          <div key={point.title} className="ob-strip" style={{ transform: `rotate(${stripTilt[at]! * (index % 2 ? -1 : 1)}deg)` }}><b>{point.title}</b><span>{point.hint}</span></div>
        ))}
      </div>
      <div className="ob-shot-wrap">
        <div className="ob-shot"><img src={art.shot} alt={feature.shot} /></div>
        {feature.tags.map((tag, at) => {
          const place = art.tags[at]!;
          return <span key={tag} className={`ob-tag ${place.tone}`} style={{ left: place.x, top: place.y, transform: `rotate(${place.tilt}deg)` }}>{tag}</span>;
        })}
      </div>
      <div className={`ob-bar${art.ink ? "" : " lt"}`}>
        <button type="button" className="ob-link" onClick={() => nav.go("tour")}>{copy.featureBackToTour}</button>
        <span className="ob-r">
          <button type="button" className="ob-pill" onClick={() => nav.go(prev)}>{copy.featurePrev}</button>
          <button type="button" className={`ob-pill ${art.ink ? "fill" : "sun"}`} onClick={() => nav.go(following ?? last)}>
            {following ? fill(copy.featureNext, copy.features[index + 1]!.title) : notes ? copy.tourNext : mode === "intro" ? copy.newsDone : copy.newsStart} →
          </button>
        </span>
      </div>
    </section>
  );
}

const newsTilt = [-1.1, 0.8, 0.7, -0.9];

/** 新到港：这一版的新东西，内容来自安装包里的 release-notes.json。 */
export function NewsScreen({ copy, notes, mode, nav, onOpenNotes }: { copy: OnboardingCopy; notes: ReleaseNotes; mode: "full" | "intro"; nav: IntroNav; onOpenNotes: () => void }) {
  return (
    <section className="ob-scr-body ob-news" aria-labelledby="ob-news-title">
      <Brand small />
      <ObBurst text={notes.version} fill={obColor.coral} ink={obColor.cream} className="ob-news-burst" />
      <ObDeco className="ob-deco-tr" size={230} viewBox="0 0 230 230">
        <use href="#ob-frond" transform="translate(96 20) rotate(20) scale(1.5)" fill={obColor.green} />
        <use href="#ob-star" transform="translate(44 150) scale(.8)" fill={obColor.sun} />
      </ObDeco>
      <div className="ob-news-head">
        <small>{copy.newsKicker}</small>
        <h2 id="ob-news-title">{copy.newsTitle}</h2>
        <p className="ob-sum">{notes.summary}</p>
      </div>
      <div className="ob-news-body">
        <div className="ob-news-new">
          {notes.highlights.slice(0, 4).map((item, index) => (
            <div key={item.title} className="ob-strip" style={{ transform: `rotate(${newsTilt[index]}deg)` }}><b>{item.title}</b><span>{item.body}</span></div>
          ))}
        </div>
        {notes.improvements.length ? (
          <aside className="ob-news-imp">
            <h4>{fill(copy.newsMore, notes.improvements.length)}</h4>
            <ul>{notes.improvements.slice(0, 4).map((text) => <li key={text}><span>{text}</span></li>)}</ul>
          </aside>
        ) : null}
      </div>
      <div className="ob-bar lt">
        <button type="button" className="ob-link" onClick={onOpenNotes}>{copy.newsFullNotes}</button>
        <span className="ob-r">
          <button type="button" className="ob-pill" onClick={() => nav.go("tour")}>{copy.previous}</button>
          <button type="button" className="ob-pill sun" onClick={() => nav.go(afterIntro(mode))}>{mode === "intro" ? copy.newsDone : copy.newsStart} →</button>
        </span>
      </div>
    </section>
  );
}
