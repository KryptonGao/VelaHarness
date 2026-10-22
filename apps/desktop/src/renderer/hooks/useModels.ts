import type {
  AppState,
  AuthMethodType,
  AuthNotice,
  AuthPromptRequest,
  CustomModelInput,
  ModelAuthEvent,
  ModelCatalog,
  ModelRefreshResult,
  ThinkingLevel,
} from "@vela/shared";
import { useCallback, useEffect, useState } from "react";

export interface LoginState {
  active: boolean;
  notices: AuthNotice[];
  progress: string | null;
  prompt: AuthPromptRequest | null;
  error: string | null;
}

const idleLogin: LoginState = {
  active: false,
  notices: [],
  progress: null,
  prompt: null,
  error: null,
};

export function useModels(setAppState: (state: AppState) => void, conversationId?: string) {
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [login, setLogin] = useState<LoginState>(idleLogin);
  const [refreshing, setRefreshing] = useState(false);

  const reload = useCallback(async () => {
    const api = window.vela;
    if (!api) return;
    try {
      setCatalog(await api.getCatalog());
      setCatalogError(null);
    } catch (error) {
      setCatalogError(error instanceof Error ? error.message : "无法读取模型");
    }
  }, []);

  useEffect(() => {
    const api = window.vela;
    if (!api) return;
    void reload();
    return api.onModelEvent((event) => {
      if (event.type === "catalog") {
        void reload();
        return;
      }
      setLogin((current) => applyLoginEvent(current, event));
    });
  }, [reload]);

  /** 立即从 Pi 重新获取模型列表。出错时返回 null 并写入 actionError。 */
  const refreshFromPi = useCallback(async (): Promise<ModelRefreshResult | null> => {
    const api = window.vela;
    if (!api) return null;
    setRefreshing(true);
    setActionError(null);
    try {
      const result = await api.refreshCatalog();
      setCatalog(result.catalog);
      setCatalogError(null);
      return result;
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "无法获取模型列表");
      return null;
    } finally {
      setRefreshing(false);
    }
  }, []);

  const mutate = useCallback(async (task: () => Promise<AppState>, refreshCatalog: boolean) => {
    setActionError(null);
    try {
      setAppState(await task());
      if (refreshCatalog) await reload();
      return null;
    } catch (error) {
      const message = error instanceof Error ? error.message : "模型操作失败";
      setActionError(message);
      return message;
    }
  }, [reload, setAppState]);

  const select = useCallback((provider: string, id: string) => {
    const api = window.vela;
    if (!api) return Promise.resolve();
    return mutate(() => api.selectModel(provider, id, conversationId), false);
  }, [mutate, conversationId]);

  const setThinking = useCallback((level: ThinkingLevel) => {
    const api = window.vela;
    if (!api) return Promise.resolve();
    return mutate(() => api.setThinkingLevel(level, conversationId), false);
  }, [mutate, conversationId]);

  const add = useCallback((input: CustomModelInput) => {
    const api = window.vela;
    if (!api) return Promise.resolve("应用还没准备好");
    return mutate(async () => {
      if (!conversationId) return api.addModel(input);
      await api.registerModel(input);
      return api.selectModel(input.providerId, input.modelId, conversationId);
    }, true);
  }, [mutate, conversationId]);

  const register = useCallback((input: CustomModelInput) => {
    const api = window.vela;
    if (!api) return Promise.resolve("应用还没准备好");
    return mutate(() => api.registerModel(input), true);
  }, [mutate]);

  const remove = useCallback((provider: string, id: string) => {
    const api = window.vela;
    if (!api) return Promise.resolve();
    return mutate(() => api.removeModel(provider, id), true);
  }, [mutate]);

  const logout = useCallback((providerId: string) => {
    const api = window.vela;
    if (!api) return Promise.resolve();
    return mutate(() => api.logout(providerId), true);
  }, [mutate]);

  const loginProvider = useCallback(async (providerId: string, type: AuthMethodType) => {
    const api = window.vela;
    if (!api) return;
    setActionError(null);
    setLogin({ ...idleLogin, active: true });
    try {
      const result = await api.login(providerId, type);
      setAppState(result.state);
      if (!result.cancelled) await reload();
      setLogin({ ...idleLogin });
    } catch (error) {
      setLogin((current) => ({
        ...current,
        active: true,
        error: error instanceof Error ? error.message : "登录失败",
        prompt: null,
      }));
    }
  }, [reload, setAppState]);

  const replyLogin = useCallback(async (promptId: string, value: string | null) => {
    const api = window.vela;
    if (!api) return;
    await api.replyLogin(promptId, value);
  }, []);

  const cancelLogin = useCallback(async () => {
    await window.vela?.cancelLogin();
  }, []);

  const dismissLogin = useCallback(() => {
    setLogin(idleLogin);
  }, []);

  return {
    catalog,
    catalogError,
    actionError,
    login,
    refreshing,
    reload,
    refreshFromPi,
    select,
    setThinking,
    add,
    register,
    remove,
    logout,
    loginProvider,
    replyLogin,
    cancelLogin,
    dismissLogin,
  };
}

function applyLoginEvent(state: LoginState, event: ModelAuthEvent): LoginState {
  if (event.type === "catalog") return state;
  if (event.type === "cleared") {
    if (!state.active) return state;
    return { ...state, prompt: null };
  }
  if (event.type === "prompt") return { ...state, active: true, prompt: event.request };
  if (event.notice.type === "progress") return { ...state, active: true, progress: event.notice.message };
  return { ...state, active: true, notices: [...state.notices, event.notice].slice(-8) };
}
