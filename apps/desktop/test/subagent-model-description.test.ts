import assert from "node:assert/strict";
import test from "node:test";
import { localizeError, setActiveLocale, tr, trf } from "../src/renderer/locale";

test("subagent model descriptions have localized accessible labels and placeholders", () => {
  const expected: Record<string, { settings: string; label: string; button: string; error: string }> = {
    "zh-CN": { settings: "模型设置", label: "模型简介（可选）", button: "设置 Claude Haiku 的模型", error: "子代理模型简介必须是不超过 500 个字符的文本" },
    en: { settings: "Model settings", label: "Model description (optional)", button: "Configure Claude Haiku model", error: "Subagent model description must be text no longer than 500 characters." },
    "zh-TW": { settings: "模型設定", label: "模型簡介（選填）", button: "設定 Claude Haiku 的模型", error: "子代理模型簡介必須是不超過 500 個字元的文字" },
    ja: { settings: "モデル設定", label: "モデルの説明（任意）", button: "Claude Haiku のモデル設定", error: "サブエージェントのモデル説明は、500文字以内のテキストである必要があります。" },
    ko: { settings: "모델 설정", label: "모델 설명(선택 사항)", button: "Claude Haiku 모델 설정", error: "서브에이전트 모델 설명은 500자 이하의 텍스트여야 합니다." },
  };
  try {
    for (const [locale, copy] of Object.entries(expected)) {
      setActiveLocale(locale as Parameters<typeof setActiveLocale>[0]);
      assert.equal(tr("模型设置", "Model settings"), copy.settings, `${locale} dialog title`);
      assert.equal(tr("模型简介（可选）", "Model description (optional)"), copy.label, `${locale} visible description label`);
      assert.equal(trf("设置 {0} 的模型", "Configure {0} model", "Claude Haiku"), copy.button, `${locale} model settings button label`);
      assert.equal(localizeError("子代理模型简介必须是不超过 500 个字符的文本"), copy.error, `${locale} validation error`);
    }
  } finally {
    setActiveLocale("zh-CN");
  }
});
