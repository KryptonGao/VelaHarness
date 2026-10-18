import { useEffect, useRef, useState } from "react";
import type { AppLocale, ThinkingSummaryModel } from "@vela/shared";

interface Prediction {
  key: string;
  text: string;
}

/**
 * 一轮回复结束后，向主进程请求对「用户下一条输入」的预测。
 * 只在本窗口里亲眼看到回复结束（streaming 由 true 变 false）时请求一次，
 * 打开历史对话不会触发；失败或没有合适的预测时静默无结果。
 */
export function useInputPrediction({ enabled, conversationId, predictionKey, streaming, model, locale }: {
  enabled: boolean;
  conversationId: string | null;
  predictionKey: string | null;
  streaming: boolean;
  model: ThinkingSummaryModel | null;
  locale: AppLocale;
}): string {
  const [prediction, setPrediction] = useState<Prediction | null>(null);
  const armed = useRef(false);
  const request = useRef(0);

  useEffect(() => {
    if (streaming) armed.current = true;
  }, [streaming]);

  // 关闭、切换对话或开始新一轮时丢弃旧预测并作废在途请求。
  useEffect(() => {
    if (!enabled || streaming) {
      request.current += 1;
      setPrediction(null);
    }
  }, [enabled, streaming, conversationId]);

  useEffect(() => {
    armed.current = false;
  }, [conversationId]);

  useEffect(() => {
    if (!enabled || streaming || !armed.current || !conversationId || !predictionKey) return;
    const api = window.vela;
    if (!api?.predictInput) return;
    armed.current = false;
    const id = ++request.current;
    void api.predictInput({ conversationId, locale, ...(model ? { model } : {}) }).then(
      (text) => {
        if (request.current === id && text) setPrediction({ key: predictionKey, text });
      },
      () => undefined,
    );
  }, [enabled, streaming, conversationId, predictionKey, model, locale]);

  return prediction && prediction.key === predictionKey ? prediction.text : "";
}
