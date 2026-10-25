import type { SkillCatalog, SkillMigrationResult } from "@vela/shared";
import { useEffect, useMemo, useState } from "react";
import { localizeError } from "../../locale";
import { SheetPresence } from "../Presence";
import { SkillMigrationDialog } from "../SkillMigrationDialog";
import {
  AlertIcon,
  ChevronRightIcon,
  CloseIcon,
  CopyIcon,
  FolderIcon,
  RefreshIcon,
  SearchIcon,
  SkillIcon,
  TrashIcon,
} from "../icons";
import type { SettingsCopy } from "../settings-copy";
import { Segmented, SettingsSwitch } from "./primitives";

type SkillItem = SkillCatalog["skills"][number];
type SkillFilter = "all" | "enabled" | "disabled";

const originOrder: SkillItem["origin"][] = ["user", "project", "agents"];

export function SkillsPage({ copy, workspacePath }: { copy: SettingsCopy; workspacePath: string | null }) {
  const text = copy.agent;
  const [catalog, setCatalog] = useState<SkillCatalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [migrationOpen, setMigrationOpen] = useState(false);
  const [migrationNotice, setMigrationNotice] = useState<string | null>(null);
  const [migrationError, setMigrationError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<SkillFilter>("all");
  const [detailLocation, setDetailLocation] = useState<string | null>(null);

  useEffect(() => {
    const api = window.vela;
    if (!api) return;
    let active = true;
    void api.listSkills().then(
      (next) => {
        if (!active) return;
        setCatalog(next);
        setError(null);
      },
      (caught: unknown) => {
        if (!active) return;
        setError(caught instanceof Error ? caught.message : text.skillsLoadError);
      },
    );
    return () => {
      active = false;
    };
  }, [workspacePath, text.skillsLoadError, refreshKey]);

  async function openDir(): Promise<void> {
    try {
      await window.vela?.openSkillsDirectory();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : text.skillsLoadError);
    }
  }

  function finishMigration(result: SkillMigrationResult): void {
    const count = result.copied.length + result.replaced.length;
    setMigrationOpen(false);
    setMigrationNotice(count > 0 ? text.migrateDone(count) : text.migrateNone);
    setMigrationError(result.skipped.length > 0
      ? result.skipped.map((item) => `${item.name}: ${item.message ?? text.migrateSkip[item.reason]}`).join(" ")
      : null);
    setRefreshKey((current) => current + 1);
  }

  async function toggleSkill(skill: SkillItem): Promise<void> {
    const api = window.vela;
    if (!api || pending) return;
    setPending(skill.name);
    setActionError(null);
    setConfirmingDelete(null);
    try {
      setCatalog(await api.setSkillEnabled(skill.name, !skill.enabled));
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : text.skillsLoadError);
    } finally {
      setPending(null);
    }
  }

  async function deleteSkill(skill: SkillItem): Promise<void> {
    const api = window.vela;
    if (!api || pending) return;
    if (confirmingDelete !== skill.name) {
      setConfirmingDelete(skill.name);
      setActionError(null);
      return;
    }
    setPending(skill.name);
    setActionError(null);
    try {
      setCatalog(await api.deleteSkill(skill.name, skill.location));
      setConfirmingDelete(null);
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : text.skillsLoadError);
    } finally {
      setPending(null);
    }
  }

  const skills = catalog?.skills ?? [];
  const needle = query.trim().toLowerCase();
  const visible = useMemo(
    () => skills.filter((skill) => {
      if (filter === "enabled" && !skill.enabled) return false;
      if (filter === "disabled" && skill.enabled) return false;
      if (!needle) return true;
      return skill.name.toLowerCase().includes(needle) || skill.description.toLowerCase().includes(needle);
    }),
    [skills, filter, needle],
  );
  const detail = detailLocation ? skills.find((skill) => skill.location === detailLocation) ?? null : null;
  const enabledCount = skills.filter((skill) => skill.enabled).length;
  const diagnostics = catalog?.diagnostics ?? [];
  const errorCount = diagnostics.filter((item) => item.type === "error").length;
  const warningCount = diagnostics.length - errorCount;

  return (
    <section className="skills-page" data-setting-id="skills">
      <p className="settings-hint">{text.skillsHint}</p>
      <div className="skills-toolbar">
        <Segmented<SkillFilter>
          label={text.skills}
          value={filter}
          onChange={setFilter}
          options={[
            { id: "all", label: `${text.skillFilterAll} ${skills.length}` },
            { id: "enabled", label: `${text.skillEnabled} ${enabledCount}` },
            { id: "disabled", label: `${text.skillDisabled} ${skills.length - enabledCount}` },
          ]}
        />
        <label className="settings-search skills-search">
          <SearchIcon size={14} />
          <input
            className="settings-search-input"
            type="search"
            value={query}
            placeholder={text.skillsSearch}
            aria-label={text.skillsSearch}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </div>
      <div className="skills-actions">
        {catalog ? <span className="skills-dir" title={catalog.skillsDir}>{catalog.skillsDir}</span> : <span className="skills-dir" />}
        {migrationNotice ? <span className="settings-saved">{migrationNotice}</span> : null}
        <button
          className="skills-icon-btn"
          type="button"
          aria-label={text.skillsRefresh}
          title={text.skillsRefresh}
          onClick={() => setRefreshKey((current) => current + 1)}
        >
          <RefreshIcon size={14} />
        </button>
        <button className="settings-secondary skills-action-btn" type="button" onClick={() => void openDir()}>
          <FolderIcon size={14} />
          {text.openSkills}
        </button>
        <button
          className="primary-btn skills-action-btn"
          type="button"
          onClick={() => {
            setMigrationNotice(null);
            setMigrationError(null);
            setMigrationOpen(true);
          }}
        >
          {text.migrate}
        </button>
      </div>
      {migrationError ? <p className="settings-error">{migrationError}</p> : null}
      <SheetPresence present={migrationOpen}>
        <SkillMigrationDialog copy={text} onClose={() => setMigrationOpen(false)} onDone={finishMigration} />
      </SheetPresence>
      {diagnostics.length > 0 ? (
        <details className={`skills-diagnostics${errorCount > 0 ? " has-error" : ""}`}>
          <summary>
            <ChevronRightIcon size={12} />
            <AlertIcon size={14} />
            <span>{text.skillsDiagnostics.replace("{0}", String(errorCount)).replace("{1}", String(warningCount))}</span>
          </summary>
          <ul>
            {diagnostics.map((item) => (
              <li key={`${item.type}:${item.path ?? ""}:${item.message}`}>
                {item.message}
                {item.path ? <span className="skills-diagnostics-path">{item.path}</span> : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {catalog && skills.length === 0 ? <p className="settings-note">{text.skillsEmpty}</p> : null}
      {catalog && skills.length > 0 && visible.length === 0 ? <p className="settings-note">{text.skillsNoMatch}</p> : null}
      {originOrder.map((origin) => {
        const items = visible.filter((skill) => skill.origin === origin);
        if (items.length === 0) return null;
        return (
          <section key={origin} className="skills-group" aria-label={text.skillOrigins[origin]}>
            <h3 className="skills-group-head">
              {text.skillOrigins[origin]}
              <span className="skills-group-count">{items.length}</span>
            </h3>
            <div className="skills-list">
              {items.map((skill) => (
                <SkillRow
                  key={skill.location}
                  skill={skill}
                  copy={text}
                  pending={pending === skill.name}
                  confirmingDelete={confirmingDelete === skill.name}
                  onOpen={() => setDetailLocation(skill.location)}
                  onToggle={() => void toggleSkill(skill)}
                  onDelete={() => void deleteSkill(skill)}
                />
              ))}
            </div>
          </section>
        );
      })}
      {actionError ? <p className="settings-error">{localizeError(actionError)}</p> : null}
      {catalog && skills.some((skill) => !skill.canDelete) ? (
        <p className="settings-note">{text.skillDeleteNote}</p>
      ) : null}
      {error ? <p className="settings-error">{error}</p> : null}
      <SheetPresence present={detail !== null}>
        {detail ? <SkillDetailDialog skill={detail} copy={text} onClose={() => setDetailLocation(null)} /> : null}
      </SheetPresence>
    </section>
  );
}

function SkillRow({
  skill,
  copy,
  pending,
  confirmingDelete,
  onOpen,
  onToggle,
  onDelete,
}: {
  skill: SkillItem;
  copy: SettingsCopy["agent"];
  pending: boolean;
  confirmingDelete: boolean;
  onOpen: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  return (
    <div className={`skills-row${skill.enabled ? "" : " disabled"}`}>
      <button type="button" className="skills-row-main" onClick={onOpen}>
        <span className="skills-row-icon" aria-hidden="true"><SkillIcon size={16} /></span>
        <span className="skills-row-copy">
          <span className="skills-row-name">
            {skill.name}
            {skill.disableModelInvocation ? <span className="skills-row-tag">{copy.skillCommandOnly}</span> : null}
          </span>
          <span className="skills-row-desc">{skill.description}</span>
        </span>
      </button>
      <div className="settings-skill-actions">
        <SettingsSwitch
          checked={skill.enabled}
          label={skill.enabled ? copy.skillDisable : copy.skillEnable}
          title={copy.skillToggleHint}
          disabled={pending}
          onChange={onToggle}
        />
        {skill.canDelete ? (
          <button
            type="button"
            className={`settings-skill-remove${confirmingDelete ? " confirm" : ""}`}
            aria-label={confirmingDelete ? copy.skillDeleteConfirm : copy.skillDelete}
            title={copy.skillDeleteHint}
            disabled={pending}
            onClick={onDelete}
          >
            {confirmingDelete ? copy.skillDeleteConfirm : <TrashIcon size={13} />}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function SkillDetailDialog({ skill, copy, onClose }: { skill: SkillItem; copy: SettingsCopy["agent"]; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function copyPath(): Promise<void> {
    try {
      await navigator.clipboard.writeText(skill.location);
      setCopied(true);
    } catch {
      // 剪贴板不可用时路径仍可手动选中复制。
    }
  }

  return (
    <div className="sheet-backdrop" onMouseDown={onClose}>
      <div
        className="sheet-card skill-detail-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="skill-detail-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="sheet-header skill-detail-header">
          <h2 id="skill-detail-title">{skill.name}</h2>
          <button className="skills-icon-btn" type="button" aria-label={copy.skillDetailClose} onClick={onClose}>
            <CloseIcon size={14} />
          </button>
        </header>
        <div className="skill-detail-body">
          <section>
            <h3>{copy.skillDetailDescription}</h3>
            <p className="skill-detail-text">{skill.description}</p>
          </section>
          <div className="skill-detail-grid">
            <section>
              <h3>{copy.skillDetailScope}</h3>
              <p className="skill-detail-text">{copy.skillOrigins[skill.origin]}</p>
            </section>
            <section>
              <h3>{copy.skillDetailStatus}</h3>
              <p className="skill-detail-text">
                {skill.enabled ? copy.skillEnabled : copy.skillDisabled}
                {skill.disableModelInvocation ? ` · ${copy.skillCommandOnly}` : ""}
              </p>
            </section>
          </div>
          <section>
            <h3>{copy.skillDetailPath}</h3>
            <div className="skill-detail-path">
              <code>{skill.location}</code>
              <button className="skills-icon-btn" type="button" aria-label={copy.skillCopyPath} title={copied ? copy.skillCopied : copy.skillCopyPath} onClick={() => void copyPath()}>
                <CopyIcon size={13} />
              </button>
            </div>
            {copied ? <span className="settings-saved">{copy.skillCopied}</span> : null}
          </section>
        </div>
      </div>
    </div>
  );
}
