/**
 * 引导的画面顺序。先选语言，再认识 Vela，然后八步设定，最后启航。
 * 「新到港」只在安装包里带有当前版本的发布说明时出现。
 */
export const configStepCount = 8;

export const featureScreens = ["feat-agents", "feat-trace", "feat-compact"] as const;
export type FeatureScreen = (typeof featureScreens)[number];

export type ConfigScreen = `step-${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8}`;
export type OnboardingScreen = "language" | "hello" | "tour" | FeatureScreen | "news" | ConfigScreen | "done";

export const configScreens: readonly ConfigScreen[] = ["step-1", "step-2", "step-3", "step-4", "step-5", "step-6", "step-7", "step-8"];
const introScreens: readonly OnboardingScreen[] = ["hello", "tour", ...featureScreens, "news"];

/** 完整引导（首次安装）或只看介绍（设置里的「重看介绍」，不含语言与设定）。 */
export type OnboardingMode = "full" | "intro";

export function screenOrder(mode: OnboardingMode, hasNews: boolean): OnboardingScreen[] {
  const intro = introScreens.filter((screen) => hasNews || screen !== "news");
  return mode === "intro" ? intro : ["language", ...intro, ...configScreens, "done"];
}

export function isOnboardingScreen(value: unknown): value is OnboardingScreen {
  return typeof value === "string" && (value === "language" || value === "done" || introScreens.includes(value as OnboardingScreen) || configScreens.includes(value as ConfigScreen));
}

/** 设定步骤编号 1–8；其他画面返回 null。 */
export function configStepNumber(screen: OnboardingScreen): number | null {
  const index = configScreens.indexOf(screen as ConfigScreen);
  return index < 0 ? null : index + 1;
}

export const optionalConfigSteps: readonly number[] = [4, 7];

/** 读取上次停下的画面；旧版本存的是数字（0 欢迎、1–8 设定、9 完成）。 */
export function restoreScreen(stored: string | null | undefined, legacyStep: string | null | undefined): OnboardingScreen {
  if (isOnboardingScreen(stored)) return stored;
  const step = Number(legacyStep);
  if (legacyStep && Number.isInteger(step)) {
    if (step >= 1 && step <= configStepCount) return configScreens[step - 1]!;
    if (step === 9) return "done";
  }
  return "language";
}
