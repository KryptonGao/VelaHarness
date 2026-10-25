import { useId, useState } from "react";
import {
  maxPricePerMillion, parseModelPrice, pricingCurrencies, pricingCurrencySymbols, priceFields, removeModelPrice,
  upsertModelPrice, type ModelPrice, type PriceField, type PricingCurrency,
} from "@vela/shared";
import { saveModelPrices, useModelPrices } from "../../model-prices";
import { tr, trf } from "../../locale";

export interface PriceableModel {
  /** `provider/model`，与用量记录里的模型标识一致。 */
  key: string;
  /** 下拉框里的分组名（提供方）。 */
  group: string;
  label: string;
}

type Draft = Record<PriceField, string> & { model: string; currency: PricingCurrency };

const emptyDraft: Draft = { model: "", currency: "CNY", input: "", output: "", cacheWrite: "", cacheRead: "" };

const fieldLabels: Record<PriceField, () => string> = {
  input: () => tr("输入", "Input"),
  output: () => tr("输出", "Output"),
  cacheWrite: () => tr("缓存写入", "Cache write"),
  cacheRead: () => tr("缓存读取", "Cache read"),
};

function formatPrice(value: number): string {
  return String(Number(value.toFixed(6)));
}

function draftOf(price: ModelPrice): Draft {
  return {
    model: price.model, currency: price.currency,
    input: formatPrice(price.input), output: formatPrice(price.output),
    cacheWrite: formatPrice(price.cacheWrite), cacheRead: formatPrice(price.cacheRead),
  };
}

/** 把表单文本转成价格；返回错误文案而不是静默改写输入。 */
function validate(draft: Draft): { price: ModelPrice } | { error: string } {
  const model = draft.model.trim();
  if (!model) return { error: tr("请填写模型。", "Enter a model.") };
  const numbers: Partial<Record<PriceField, number>> = {};
  for (const field of priceFields) {
    const text = draft[field].trim();
    if (!text) return { error: trf("请填写「{0}」价格；没有这项收费时填 0。", "Enter the {0} price, or 0 if it is free.", fieldLabels[field]()) };
    const value = Number(text);
    if (!Number.isFinite(value) || value < 0) return { error: trf("「{0}」价格必须是不小于 0 的数字。", "The {0} price must be a number that is 0 or more.", fieldLabels[field]()) };
    if (value > maxPricePerMillion) return { error: trf("「{0}」价格不能超过 {1}。", "The {0} price cannot exceed {1}.", fieldLabels[field](), maxPricePerMillion.toLocaleString()) };
    numbers[field] = value;
  }
  const price = parseModelPrice({ model, currency: draft.currency, ...numbers });
  return price ? { price } : { error: tr("价格不正确。", "Invalid price.") };
}

export function ModelPricingEditor({ candidates }: { candidates: readonly PriceableModel[] }) {
  const prices = useModelPrices();
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const editing = prices.some(price => price.model === draft.model.trim());
  const names = new Map(candidates.map(item => [item.key, `${item.group} · ${item.label}`]));
  const groups = new Map<string, PriceableModel[]>();
  for (const item of candidates) groups.set(item.group, [...(groups.get(item.group) ?? []), item]);
  // 已登记价格的模型即使所在供应商已退出登录，也要能选中，才能继续编辑。
  const orphans = prices.filter(price => !names.has(price.model));

  const commit = (next: readonly ModelPrice[]) => {
    try {
      saveModelPrices(next);
      setError(null);
      return true;
    } catch {
      setError(tr("价格保存失败，请重试。", "Could not save prices. Try again."));
      return false;
    }
  };
  const submit = () => {
    const result = validate(draft);
    if ("error" in result) return setError(result.error);
    if (commit(upsertModelPrice(prices, result.price))) setDraft(emptyDraft);
  };
  const update = (patch: Partial<Draft>) => { setDraft(current => ({ ...current, ...patch })); setError(null); };

  return <section className="usage-section model-pricing" data-setting-id="model-pricing" aria-labelledby={`${id}-title`}>
    <h2 id={`${id}-title`}>{tr("模型价格", "Model pricing")}</h2>
    <p className="usage-note">{tr("手动登记每个模型的价格（每 100 万 Token），用量统计会据此计算费用。价格只保存在本机；人民币与美元不做换算，分别汇总。没有登记价格的模型不计费用，也不会显示为 0。",
      "Register the price of each model per 1M tokens and usage statistics will calculate costs from it. Prices stay on this device. CNY and USD are never converted and are totalled separately. Models without a price are left out of costs rather than shown as 0.")}</p>
    <form className="pricing-form" onSubmit={event => { event.preventDefault(); submit(); }} noValidate>
      <label className="pricing-model">{tr("模型", "Model")}
        <select value={draft.model} onChange={event => update({ model: event.target.value })}>
          <option value="">{tr("选择模型", "Choose a model")}</option>
          {[...groups].map(([group, items]) => <optgroup key={group} label={group}>
            {items.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}
          </optgroup>)}
          {orphans.length ? <optgroup label={tr("已登记价格", "Registered prices")}>
            {orphans.map(price => <option key={price.model} value={price.model}>{price.model}</option>)}
          </optgroup> : null}
        </select>
      </label>
      <label className="pricing-currency">{tr("币种", "Currency")}
        <select value={draft.currency} onChange={event => update({ currency: event.target.value as PricingCurrency })}>
          {pricingCurrencies.map(currency => <option key={currency} value={currency}>
            {currency === "CNY" ? tr("人民币 (¥)", "CNY (¥)") : tr("美元 ($)", "USD ($)")}
          </option>)}
        </select>
      </label>
      {priceFields.map(field => <label key={field} className="pricing-number">
        {fieldLabels[field]()}
        <input type="text" inputMode="decimal" value={draft[field]} onChange={event => update({ [field]: event.target.value })}
          placeholder="0" autoComplete="off" aria-label={trf("{0}价格（每 100 万 Token）", "{0} price per 1M tokens", fieldLabels[field]())} />
      </label>)}
      <div className="pricing-actions">
        <button type="submit" className="settings-secondary">{editing ? tr("更新价格", "Update price") : tr("添加价格", "Add price")}</button>
        {draft.model || draft.input || draft.output || draft.cacheWrite || draft.cacheRead
          ? <button type="button" className="settings-secondary" onClick={() => { setDraft(emptyDraft); setError(null); }}>{tr("清空", "Clear")}</button> : null}
      </div>
    </form>
    {error ? <p className="usage-warning" role="alert">{error}</p> : null}
    {prices.length === 0 ? <p className="usage-empty">{tr("还没有登记任何模型价格。", "No model prices registered yet.")}</p> :
      <div className="usage-table-scroll" tabIndex={0} role="region" aria-label={tr("已登记的模型价格", "Registered model prices")}>
        <table className="usage-table pricing-table">
          <thead><tr>
            <th scope="col">{tr("模型", "Model")}</th><th scope="col">{tr("币种", "Currency")}</th>
            {priceFields.map(field => <th key={field} scope="col">{fieldLabels[field]()}</th>)}
            <th scope="col"><span className="sr-only">{tr("操作", "Actions")}</span></th>
          </tr></thead>
          <tbody>{prices.map(price => <tr key={price.model}>
            <th scope="row" className="usage-model-name" title={price.model}>{names.get(price.model) ?? price.model}</th>
            <td>{price.currency}</td>
            {priceFields.map(field => <td key={field}>{pricingCurrencySymbols[price.currency]}{formatPrice(price[field])}</td>)}
            <td className="pricing-row-actions">
              <button type="button" className="settings-secondary" onClick={() => { setDraft(draftOf(price)); setError(null); }}>{tr("编辑", "Edit")}</button>
              <button type="button" className="settings-secondary" aria-label={trf("删除 {0} 的价格", "Delete price for {0}", price.model)}
                onClick={() => { commit(removeModelPrice(prices, price.model)); if (draft.model.trim() === price.model) setDraft(emptyDraft); }}>{tr("删除", "Delete")}</button>
            </td>
          </tr>)}</tbody>
        </table>
      </div>}
    <p className="usage-note">{tr("单位：每 100 万 Token。费用 = 输入 × 输入价 + 输出 × 输出价 + 缓存写入 × 缓存写入价 + 缓存读取 × 缓存读取价；其中输入指未命中缓存的 Token。",
      "Unit: per 1M tokens. Cost = input × input price + output × output price + cache write × cache write price + cache read × cache read price, where input means uncached tokens.")}</p>
  </section>;
}
