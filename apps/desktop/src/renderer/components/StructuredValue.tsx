import { useState } from "react";
import type { JsonValue } from "@vela/shared";
import { tr, trf, useAppLocale } from "../locale";
import { resultPageSize, resultRecord, scalarTableColumns } from "./tool-result-model";
import "./tool-result-details.css";

function Scalar({ value }: { value: JsonValue | undefined }) {
  if (value === null) return <span className="tool-value-empty">null</span>;
  if (value === undefined) return <span className="tool-value-empty">—</span>;
  if (value === "") return <span className="tool-value-empty">{tr("空字符串", "Empty string")}</span>;
  if (typeof value === "boolean") return <span className="tool-value-boolean">{value ? tr("是", "Yes") : tr("否", "No")}</span>;
  return <span className="tool-value-text">{String(value)}</span>;
}

/** Text-only, bounded data view: values are never HTML or executable links. */
export function StructuredValue({ value, depth = 0 }: { value: JsonValue; depth?: number }) {
  useAppLocale();
  const [visible, setVisible] = useState(resultPageSize);
  if (value === null || typeof value !== "object") return <Scalar value={value} />;
  const array = Array.isArray(value);
  const length = array ? value.length : Object.keys(value).length;
  if (!length) return <span className="tool-value-empty">{array ? tr("空数组", "Empty array") : tr("空对象", "Empty object")}</span>;
  const columns = array ? scalarTableColumns(value) : null;
  const showMore = visible < length ? <button type="button" className="tool-result-more" onClick={() => setVisible(current => current + resultPageSize)}>
    {trf("继续显示（剩余 {0} 项）", "Show more ({0} remaining)", length - visible)}
  </button> : null;
  const content = array ? columns ? <>
    <div className="tool-value-table-scroll" tabIndex={0} role="region" aria-label={tr("结构化结果表格", "Structured results table")}>
      <table className="tool-value-table"><thead><tr>{columns.map(key => <th scope="col" key={key}>{key}</th>)}</tr></thead>
        <tbody>{value.slice(0, visible).map((row, index) => <tr key={index}>{columns.map(key => <td key={key}><Scalar value={resultRecord(row) ? row[key] : undefined} /></td>)}</tr>)}</tbody>
      </table>
    </div>{showMore}
  </> : <>
    <ol className="tool-value-list">{value.slice(0, visible).map((item, index) => <li key={index}><StructuredValue value={item} depth={depth + 1} /></li>)}</ol>{showMore}
  </> : <>
    <dl className="tool-result-fields tool-value-fields">{Object.entries(value).slice(0, visible).map(([key, item]) => <div key={key}>
      <dt>{key}</dt><dd><StructuredValue value={item} depth={depth + 1} /></dd>
    </div>)}</dl>{showMore}
  </>;
  return <details className="tool-value-branch" open={depth < 2 ? true : undefined}>
    <summary>{array ? trf("列表 · {0} 项", "List · {0} items", length) : trf("对象 · {0} 个字段", "Object · {0} fields", length)}</summary>
    <div className="tool-value-children">{content}</div>
  </details>;
}
